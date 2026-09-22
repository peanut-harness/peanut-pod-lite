# Proposal

## Why

Lite 已证明同资源 FIFO、不同资源并行和单工程 writer 的正确性，但当前读路径、任务队列与资源等待队列缺少统一容量边界，持续高频调用可能把吞吐问题放大为排队、超时和内存增长。单工程大量操作需要从“逐调用提交”升级为“有界受理、并行准备、单 writer 微批提交”，在不牺牲 AssetDB/Creator 一致性的前提下提升有效吞吐。

## What Changes

- 为单工程建立分级 admission control：按连接、工程和操作成本限制并发与排队容量，队列满时返回稳定 `overloaded`、安全重试建议和可观测等待摘要，不再无界接收。
- 将只读调用区分轻量查询与重型扫描；相同只读请求可在短窗口内合并，缓存/快照结果绑定工程 revision，避免高频读取压满 Creator Bridge 或返回无法识别的新旧状态混合。
- 保持每工程唯一 AssetDB/editor writer，将可安全组合的同 owner 写任务改为并行规划、离线变换与单 writer 微批提交，批内共享 refresh/settle/postflight；同资源 FIFO、审批、幂等和资源闭包约束保持不变。
- 为显式批次定义原子边界与逐项结果：commit 前失败为 `unchanged`，可证明恢复时为 `rolled_back`，无法证明完全恢复时返回 `may_have_changed` 并禁止盲目重试；不宣称 Creator 不支持的数据库式全量事务。
- 增加公平切片与反饥饿策略，限制单批操作数、输入体积、准备并发和 writer 占用时间，使大量后台任务不会永久阻塞交互请求。
- 为终态任务、owner、evidence、幂等索引和插件 task ID 建立周期回收与硬容量上限，并暴露脱敏的队列深度、等待时间、event-loop lag、内存和 settle 延迟指标。
- 建立 Creator 3.8.3/3.8.7 单工程长稳矩阵，覆盖持续读、高频写、混合负载、队列过载、取消/超时、失败恢复和客户端重试风暴。

## Capabilities

### New Capabilities

- `mcp-throughput-control`: 定义单工程读写的有界受理、成本分级、读合并、revision 一致性、过载反馈、公平性和运行指标。

### Modified Capabilities

- `mcp-write-task-execution`: 增加并行准备、显式/自动微批提交、单 writer 批次边界、逐项结果和批次失败状态，同时保持既有资源互斥与同步兼容语义。
- `mcp-task-control`: 增加批次级状态/证据、周期回收和任务相关索引的硬容量边界，确保高频调用不会导致控制面状态无界增长。

## Impact

- **Runtime/Kernel:** 任务 ingress、scheduler、resource lock、batch coordinator、Hub 读写入口、owner/证据/幂等保留与指标快照。
- **Editor MCP:** operation 成本画像、读请求合并、资源闭包规划、Lumen/Asset/Scene/Prefab 批次适配、唯一批次 postflight。
- **Protocol:** 兼容追加 overload、batch receipt、逐项 outcome、revision、queue summary 与 retry guidance；现有单调用字段和默认同步行为不移除。
- **Creator host/QA:** 扩展 3.8.3/3.8.7 实机脚本，加入 30–60 分钟 soak、高水位和恢复验证；不扩大其它 Creator 版本写入支持。
- **Catalog:** 保持 83 项业务 operation、38 读和 45 写/破坏性操作不变；批次与控制面入口不计入业务 operation。
