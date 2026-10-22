# Proposal

## Why

AI 当前只能读取错误摘要，缺少有界日志上下文；场景选区聚焦也不能证明视口相机已聚焦。按用户已批准的计划复用现有能力，先交付日志诊断，再交付视口控制。

## What Changes

- 新增 diagnostics.queryLogs，提供有界尾读、增量和字面关键词搜索，保留堆栈与中文，报告截断、轮转和续读。
- 新增 viewport.queryState、viewport.focusNodes、viewport.setState，精确版本探测、授权修改和读回验证。
- 保持 preview.queryErrors 和 scene.focusNode 行为兼容；不改验收为“搜索无匹配即通过”。

## Capabilities

### New Capabilities

- `log-diagnostics`: 绑定当前工程的有界日志诊断。
- `viewport-control`: 当前编辑器视口的可验证控制。

### Modified Capabilities

无。

## Impact

仅 peanut-pod-lite：protocol、policy、runtime、mcp、Creator host 与对应测试和文档。新增工具属于 Lite；写操作继续消费本地审批租约。回滚为卸载新增能力并保留既有接口。

## Non-goals

不实现撤销、节点复制移动、事件订阅、全局偏好、正式发布；不修改其它产品仓库。用户已明确要求按本计划开始实施，规划落盘后继续 apply，不重复询问开工。
