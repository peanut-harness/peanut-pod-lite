# 单工程大量操作吞吐

## 基线

Runtime 测试包含固定种子 `0x5eed2026` 的单工程混合负载基线。基线并发提交 128 个操作，其中读取与写入比例由固定伪随机序列决定；提交阶段加入固定 1 ms 延迟，使排队与单 writer 行为可以稳定观测。

```bash
npm run test --workspace @peanut/pod-engine/runtime
```

测试输出一行 `throughput-baseline:<json>`，包含：

- `operationsPerSecond` 与总耗时；
- P50、P95、P99 端到端延迟；
- 拒绝数与排队峰值；
- 终态结果和证据保留数量；
- 采样期间 RSS 峰值。

该数值用于同机、同 Node 与同候选版本的前后对照，不作为跨机器绝对性能承诺。后续高吞吐验收必须同时满足结果等价、容量有界与 Creator 实机后验，不能只比较 QPS。

## 默认容量与背压

Lite 对单工程始终使用有界准入，生产默认值如下：

| 边界 | 默认值 |
|---|---:|
| 单连接在飞请求 | 8 |
| 单连接排队请求 | 32 |
| 单工程排队请求 | 64 |
| 控制面保留排队 | 16 |
| 轻读取并发 | 8 |
| 重读取并发 | 2 |
| prepare 并发 | 4 |
| writer 并发 | 1 |
| 显式批次分项 | 32 |
| 显式批次规范化输入 | 4 MiB |

队列满时请求在业务执行前以稳定 overload 详情失败，并携带 `retryAfterMs` 与脱敏队列摘要。客户端必须使用带抖动的退避重试，不得立即重放。`status`、`cancel` 与 metrics 使用保留的 control 容量；批次 writer 在安全分项边界达到 200 ms 后主动让出 event loop，但不会强制中断不可逆提交。

终态任务默认保留 5 分钟，每 30 秒扫描一次，工程最多保留 4096 项。单任务证据最多 32 项/64 KiB，单批证据最多 128 项/256 KiB；超限时保留稳定截断摘要与 dropped count，不静默删除非终态任务。

## 读取与批次

同一工程 revision 下的合格读取使用默认 10 ms 合并窗。写入受理、完成、刷新 settle 和外部变化都会推进或失效 revision；强一致读取会等待已受理 writer 屏障，不能返回跨 revision 快照。

显式批次在创建 task 前验证 operation 白名单、输入、审批、DAG、幂等键、资源闭包、32 项和 4 MiB 上限。prepare 最多并行 4 项，commit 使用联合资源锁和单 writer，并只生成一次 batch postflight。自动微批默认关闭；启用后窗口为 10 ms，且只合并严格白名单中 owner、operation、risk、审批状态一致且资源不冲突的相邻请求，不跨连接、revision 或因果边界。

批次失败状态必须保守解释：

- `unchanged`：确认尚未开始业务 operation；
- `rolled_back`：有证据证明已恢复到批次前状态；
- `may_have_changed`：已开始写入且无法证明完全恢复，禁止盲目自动重试。

逐项 outcome 和 batch status 才是业务结果；HTTP 成功或 task receipt 只表示请求已受理。

## 运维指标

健康快照仅公开有界聚合值：各成本类在飞/排队数、队列高水位、等待与 settle 延迟分位数、overload/retry/batch 计数、event-loop lag 和 RSS 高水位。排障时重点检查：

1. control P95 是否保持在 1 秒内；
2. writer 是否始终为 1，prepare 是否不超过 4；
3. queue、retained task、evidence 和 RSS 是否在高水位后回落；
4. `may_have_changed` 是否触发人工核验而非自动重试；
5. Creator 项目日志是否出现新增 error/warn、永久锁或注册残留。

指标不得包含其它连接的 operation、资源名、输入或错误正文。

## Creator 3.8.3/3.8.7 实机 soak

每个版本必须在独立 QA 工程中安装同一候选 Host/Core，并保存候选 SHA、精确 Creator 版本、工程标识摘要、开始/结束时间和机器配置。每版依次执行：

1. 30 分钟正常混合负载，覆盖持续读取、高频写、取消/超时与至少 100 资源的显式批次；
2. 10 分钟持续过载与带抖动退避重试，同时持续采样 status/cancel/metrics；
3. 对 100 资源批次和等价逐项顺序基线核对结果与后验；
4. 停止负载后等待 retention/扫描周期，确认队列、任务、证据、锁和注册状态回收。

验收要求无编辑器崩溃、未处理异常、永久锁、任务泄漏、资源覆盖或错误项目状态；control P95 不超过 1 秒；成功写入的 postflight 有效；项目日志无新增 error/warn。证据保存在 QA 工程的外部归档，不向本仓提交本机日志、绝对路径、凭据或项目内容。缺少真实 Bridge、绑定候选或完整时长时必须报告未验收，Node 压测不能替代该证据。

## 模拟验收

`npm run verify` 覆盖 10,000 次混合 hot/cold 读取、准入过载、控制容量、指标有界和功能回归。写压力测试执行 500 项写入，并将 100 项逐项基线与 4 组 25 项批次比较；同机验收门槛为批次吞吐至少 2 倍，同时 prepare 峰值不超过 4、writer 峰值等于 1。测试输出 `throughput-baseline:<json>` 与 `throughput-write-stress:<json>`，用于候选间回归比较。
