# Design

## Context

现有 preview.queryErrors 复用 ProjectLogPostflightMonitor 定位日志与增量错误判断，保留该验收语义。scene.focusNode 有 selection_only 回退；新的视口聚焦不复用该成功判据。全部实现属于 peanut-pod-lite，遵守 Hub code-design、TypeScript与Cocos兼容规范。

## Goals / Non-Goals

目标为已批准计划的四个公开工具；非目标见 proposal。按日志实现→日志测试及实机验收→视口版本探测→视口实现与测试→组合验收串行推进，共享protocol、policy、MCP目录和生成物，不启动并行Agent。

## Decisions

- diagnostics.queryLogs 只读当前工程temp/logs/project.log，复用现有路径解析，新增独立有界读取器；不重写既有postflight，以免改变验收判定。无正则与任意路径输入。
- 固定策略集中声明100结果/64KiB返回/1MiB扫描、上下文默认2上限10；游标绑定工程及日志身份与位置指纹，遇轮转/清空/替换明确拒绝续读。按块读取，句柄finally释放；保留原文及未知级别，尾部未完成行不消费。
- viewport.queryState 无跨调用缓存；viewport.focusNodes 和 viewport.setState 走现有租约与受管任务，按3.8.3/3.8.7分别探测消息。不得猜测API；未知、不可读回或无目标进入视野证据返回未验证/拒绝，不标写任务已验证成功。
- 先只读状态和聚焦，再模式/网格；不实现Gizmo、撤销与实时节点操作。

## Risks / Trade-offs

日志同inode原位改写→游标内容指纹检测；并发变动→身份前后检查，返回不一致而不是完整快照。超长行→有界片段显式标记并可续读，不丢失游标语义。Creator接口不支持→保留unsupported和实机阻塞，不放宽支持画像。

## Migration Plan

新增能力不修改原接口。定向日志测试通过后在指定QA工程核对真实日志，再进入视口探测；两版Creator验收、OpenSpec strict、npm run verify、npm run pack、知识同步和远端SHA回读均通过才交付完成。缺失平台或原生证据保持待办，不自动归档。撤销新增能力注册可回滚，不迁移工程数据。
