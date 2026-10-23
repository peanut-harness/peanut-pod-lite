# Spec Delta

## Purpose

为 Creator 反射探针建立可授权、可查询、可取消并能验证生成物的烘焙闭环，使自动化调用方处理指定对象和有界批量任务，同时准确呈现部分失败及清理实际影响的资源范围。

## ADDED Requirements

### Requirement: Reflection baking has explicit bounded targets
系统 SHALL 通过 `reflectionProbe.startBake` 为获批显式探针集合启动有界烘焙任务。

#### Scenario: One or several probes are baked
- **GIVEN** 一个或多个当前场景探针通过版本、输入、容量、资源闭包和本地审批校验
- **WHEN** 所有者启动烘焙
- **THEN** 返回绑定探针集合的受管任务，不隐式扩大为整个场景或全部工程

#### Scenario: Admission fails
- **GIVEN** 集合为空、包含无效对象、超量或审批不匹配
- **WHEN** 系统受理烘焙
- **THEN** 在烘焙开始前拒绝，不留下生成资源或队列占位

### Requirement: Reflection progress and results are owner safe
系统 SHALL 通过 `reflectionProbe.queryBake` 返回当前 owner 烘焙任务的队列、进度、逐探针状态和有界结果证据。

#### Scenario: Batch partly completes
- **GIVEN** 同一批次部分探针完成，部分失败或等待
- **WHEN** 所有者查询烘焙
- **THEN** 返回逐探针实际状态和已验证生成物，不将批次误报为全部成功

#### Scenario: Another connection guesses a task
- **GIVEN** 当前连接不拥有目标烘焙任务
- **WHEN** 它请求任务信息
- **THEN** 返回不可用，不泄露存在性、探针身份、进度或资源路径

### Requirement: Reflection cancellation has verifiable scope
系统 SHALL 通过 `reflectionProbe.cancelBake` 仅取消 owner 所拥有且可安全取消的烘焙工作。

#### Scenario: Owner cancels selected pending work
- **GIVEN** owner 的任务仍有正在执行或等待的探针
- **WHEN** 请求取消全部本任务或其明确子集
- **THEN** 原生取消范围局限于该任务的获批目标，确认结果区分已完成、已取消及无法确认项

#### Scenario: Native cancellation cannot be verified
- **GIVEN** 原生取消失败或任务已越过取消窗口
- **WHEN** owner 请求取消
- **THEN** 返回明确原因并继续如实查询，不影响其他 owner 的烘焙或伪造取消成功

### Requirement: Clearing generated results is a destructive scoped write
系统 SHALL 使 `reflectionProbe.clearResults` 仅删除本次精确审批覆盖的生成资产并清除相应绑定。

#### Scenario: Generated results are cleared
- **GIVEN** 目标探针、生成资产及引用范围已在规划阶段确认，且已取得破坏性确认和有效审批
- **WHEN** 所有者清理结果
- **THEN** AssetDB 读回确认相应生成资产及绑定已清理，原始素材和范围外资产保持不变

#### Scenario: Resources change after approval
- **GIVEN** 审批后生成路径、探针绑定或引用闭包发生变化
- **WHEN** 清理准备执行
- **THEN** 在删除前拒绝并要求重新规划审批，不复用旧授权扩大删除范围

#### Scenario: Cleanup partly fails
- **GIVEN** 清理已发生部分删除且后续步骤失败
- **WHEN** 系统返回结果
- **THEN** 列出实际已清理、未清理及无法确认项，项目状态保守，不宣称全量回滚

### Requirement: Reflection success requires version specific runtime evidence
系统 SHALL 仅在精确版本实机证据、原生终态、生成物/绑定读回及既有后验均通过后报告烘焙能力可用和任务成功。

#### Scenario: Internal exports exist but are unverified
- **GIVEN** Creator 安装包包含内部 scene-script 导出但本候选未完成该版本能力验收
- **WHEN** 外部调用方请求新增写路径
- **THEN** 系统拒绝并说明缺证，不以内部导出存在代替真实可用性
