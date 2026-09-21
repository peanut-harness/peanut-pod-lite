# Proposal

## Why

Lite 的 Editor MCP 写调用当前同时经过 Hub 全局写槽、专用资源任务队列和独立 Execution Runtime，形成重复的串行、任务状态与 postflight 责任；其中 Hub 全局写槽还会遮蔽资源队列设计中的非冲突并行能力。近期资源闭包、AssetDB transaction 和结构化失败已经落地，现在需要统一任务控制语义并明确唯一执行边界，才能安全增加异步查询、取消、超时和幂等能力。

## What Changes

- 为 MCP capability 声明区分兼容的内联执行与宿主管理任务执行；未声明的现有插件继续使用内联模式。
- 将 Creator 3.8.x 作为同一 Host 兼容线处理，先以 3.8.3 基线和 3.8.7 回归建立宿主加载与写入证据，再按同一画像持续纳入其它 3.8 补丁版本。
- 将 Lite 的写/破坏性 Editor MCP capability 接入统一任务控制面，同时保留其专用资源闭包、工程 writer 和原子多资源锁调度。
- 保持现有同步调用默认行为和 83 项业务 operation 目录不变，并允许调用方显式请求异步执行。
- 增加独立于业务 operation 目录的任务状态、取消和安全证据查询能力；任务必须绑定调用连接和提供插件。
- 增加任务级超时与幂等语义；自动重试不在本变更范围内。
- 移除宿主管理任务上的 Hub 全局写槽与重复 postflight，未迁移的内联写 capability 保持原行为。
- 为任务执行器提供显式注册与统一组装入口，替代核心调度代码按任务 kind 持续增加硬编码分支。

## Capabilities

### New Capabilities

- `mcp-write-task-execution`: 定义 Editor MCP 写操作的受管任务执行、资源调度、同步兼容、异步受理和唯一 postflight 语义。
- `mcp-task-control`: 定义任务归属、状态、取消、证据、超时和幂等控制语义。

### Modified Capabilities

无。

## Impact

- `packages/protocol`：MCP capability 执行模型、任务状态和控制契约。
- `packages/sdk`：插件任务执行器注册与 invocation 归属传递。
- `packages/engine/modules/runtime`：共享任务控制面、执行器注册、原子多资源锁和调度策略接口。
- `packages/engine/modules/kernel`：插件任务 API、MCP Hub 调度边界、通用任务控制 capability 与审计关联。
- `packages/engine/modules/mcp`：Editor MCP 资源任务执行器、异步输入、结果适配和迁移后的 postflight。
- `packages/hosts/modules/creator-38`：Bridge 多连接集成与 Creator 3.8.7 实机验收入口。
- `packages/hosts` 与 `packages/hosts/modules/creator-38`：Creator 3.8.x 编辑器扩展运行时兼容、版本画像和实机验收入口。
- 兼容性：默认同步调用、已有工具名、83 项业务 operation、审批租约和 Pro 隔离保持不变。
