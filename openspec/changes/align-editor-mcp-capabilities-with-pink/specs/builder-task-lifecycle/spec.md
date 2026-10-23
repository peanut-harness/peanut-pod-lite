# Spec Delta

## Purpose

使 Creator 原生构建在超过一次请求的等待预算后仍可由任务所有者安全续查，并以同一次原生任务和真实新鲜产物判定完成，消除受理即成功、超时重复构建和取消状态失真的问题。

## ADDED Requirements

### Requirement: Build admission creates one traceable native association
系统 SHALL 将一次获批构建关联到唯一受管任务和唯一原生构建任务，并在保留期内提供同任务续查。

#### Scenario: Build outlives the synchronous wait
- **GIVEN** 一次合法构建超过 30 秒仍在运行且尚未到跟踪截止时间
- **WHEN** 同步等待预算耗尽后所有者查询 `task.status`
- **THEN** 返回同一受管任务的原生任务身份、当前阶段和未完成状态，不创建第二次构建

#### Scenario: Idempotent submission and repeated queries
- **GIVEN** 构建请求已绑定 owner、工程、输入摘要及幂等键
- **WHEN** 所有者重复查询或以相同键和相同摘要提交
- **THEN** 复用原任务，原生提交计数仍为一次

### Requirement: Build completion requires verified fresh artifacts
系统 SHALL 仅在关联原生任务已成功且本次构建产物通过身份、新鲜度及工程边界验证后报告构建成功。

#### Scenario: Web build completes
- **GIVEN** 原生 Web 构建成功且存在本次产生的非空入口文件
- **WHEN** 系统执行完成验证及既有 postflight
- **THEN** 同一受管任务进入成功终态，证据关联平台、开始时间及经验证的产物身份

#### Scenario: Native success lacks valid artifacts
- **GIVEN** 原生任务报告成功，但文件缺失、陈旧、为空、逃逸工程或平台没有声明的产物规则
- **WHEN** 系统验证产物
- **THEN** 返回产物未验证的失败或阻塞结果，不将路径提示当作成功证据

### Requirement: Native cancellation is reported truthfully
系统 SHALL 按任务所有权、安全阶段和原生取消可用性返回可验证的构建取消结果。

#### Scenario: Supported cancellation is confirmed
- **GIVEN** owner 请求取消且当前版本和阶段支持取消
- **WHEN** 原生任务确认已取消并完成安全收尾
- **THEN** 对应任务才进入取消终态，并保留实际生成物和项目状态摘要

#### Scenario: Cancellation is unsupported or too late
- **GIVEN** 当前原生接口不能取消或任务已越过安全边界
- **WHEN** owner 请求取消
- **THEN** 返回稳定的不支持或阶段冲突原因，继续跟踪原任务，不伪造已取消状态

### Requirement: Lost observation never triggers a duplicate build
系统 SHALL 对暂时查询失败、连接中断和跟踪截止时间使用保守状态及可恢复查询指引。

#### Scenario: Native task observation is interrupted
- **GIVEN** 构建已经受理且查询原生任务暂时失败
- **WHEN** 所有者查询任务
- **THEN** 返回最后确认状态、观测时间和无法确认原因，不误报完成或自动重提

#### Scenario: Tracking deadline expires
- **GIVEN** 原生任务到达声明的跟踪截止时间仍无可判定结果
- **WHEN** 系统结束自动跟踪
- **THEN** 返回完成未确认与保守项目状态，保留有界证据并阻止未知构建与冲突写入被视作安全并行
