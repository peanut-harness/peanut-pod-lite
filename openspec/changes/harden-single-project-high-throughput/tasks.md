## 1. 基线与契约

- [ ] 1.1 [repo: peanut-pod-lite] [paths: test/**, docs/**] [serial] [owner: integration] 建立单工程高吞吐基线，覆盖队列增长、锁等待、任务保留、证据保留与当前读写吞吐；验收：固定种子压测可重复输出吞吐、P50/P95/P99、拒绝数、队列峰值和内存峰值，并证明现有 `npm run verify` 仍通过。
- [ ] 1.2 [repo: peanut-pod-lite] [paths: packages/protocol/**, test/**] [depends: 1.1] [serial] [owner: integration] 定义 admission、`throughput_overloaded`、项目 revision、batch、分项结果、保守项目状态和指标快照 DTO；验收：协议 schema/类型测试覆盖兼容输入、超限输入与未知字段行为。
- [ ] 1.3 [repo: peanut-pod-lite] [paths: packages/**, scripts/**, test/**] [depends: 1.2] [serial] [owner: integration] 为 83 项公开能力生成并校验成本分类与执行画像，保持 38 读、45 写/破坏性能力不漂移；验收：目录校验能发现缺失、重复或错误分类，完整能力计数测试通过。

## 2. 有界生命周期与准入控制

- [ ] 2.1 [repo: peanut-pod-lite] [paths: packages/**/task-*/**, packages/**/runtime/**, test/**] [depends: 1.2] [serial] [owner: runtime] 为任务、owner、task ID、幂等记录和证据索引增加完成回调与周期 GC；验收：空闲期也会清理过期状态，压力测试结束后外层映射回落到配置上限内。
- [ ] 2.2 [repo: peanut-pod-lite] [paths: packages/**/task-*/**, packages/**/evidence/**, test/**] [depends: 2.1] [serial] [owner: runtime] 实现按项目的保留任务硬上限以及单任务/批次证据条数和字节上限；验收：超过上限时按确定顺序裁剪且保留终态摘要，内存与查询响应保持有界。
- [ ] 2.3 [repo: peanut-pod-lite] [paths: packages/**/runtime/**, packages/**/mcp/**, test/**] [depends: 1.3, 2.2] [serial] [owner: runtime] 实现按连接、项目和成本类分层的有界准入与公平调度；验收：默认上限为连接执行中 8、连接等待 32、项目普通等待 64、轻读 8、重读 2、prepare 4、writer 1，且多连接测试不存在永久饥饿。
- [ ] 2.4 [repo: peanut-pod-lite] [paths: packages/**/mcp/**, packages/**/task-*/**, test/**] [depends: 2.3] [serial] [owner: integration] 将准入放在审批、任务创建和业务执行之前，并统一 overload 响应；验收：拒绝请求不创建任务、不占资源锁、不触发写入，返回 `category=overloaded`、`projectState=not_started` 与有界 `retryAfterMs`。
- [ ] 2.5 [repo: peanut-pod-lite] [paths: packages/**/metrics/**, packages/**/mcp/**, test/**] [depends: 2.4] [serial] [owner: observability] 提供隐私安全的固定窗口吞吐、延迟、队列、拒绝、合并、缓存和批次指标；验收：快照不含项目内容或参数值，计数与压测事件逐项一致。

## 3. 高频读取路径

- [ ] 3.1 [repo: peanut-pod-lite] [paths: packages/**/runtime/**, packages/**/bridge/**, test/**] [depends: 1.3, 2.4] [serial] [owner: read-path] 建立项目 revision 时钟，并在所有可观察写入、刷新和外部变更边界推进 revision；验收：写前后及外部变化模拟测试可确定地使旧读快照失效。
- [ ] 3.2 [repo: peanut-pod-lite] [paths: packages/**/runtime/**, packages/**/mcp/**, test/**] [depends: 3.1] [serial] [owner: read-path] 实现默认 10ms 的同键读合并和带 revision 的有界 LRU 快照缓存；验收：相同 revision 的并发等价读取只执行一次底层读取，参数、权限或 revision 不同不得误合并。
- [ ] 3.3 [repo: peanut-pod-lite] [paths: packages/**/mcp/**, packages/**/bridge/**, test/**] [depends: 3.2] [serial] [owner: read-path] 将读画像接入轻读/重读额度，并为强一致读取建立 writer barrier；验收：轻读可并行、重读受限、强一致读不会越过已接纳写入，83 项能力兼容性不变。
- [ ] 3.4 [repo: peanut-pod-lite] [paths: test/**, scripts/**] [depends: 3.3, 2.5] [serial] [owner: qa] 增加高频读、热点键、冷键、revision 抖动和多连接公平性测试；验收：模拟 10,000 次读取时队列与内存保持有界，无错误缓存命中、无未处理拒绝或残留锁。

## 4. 单写者批次流水线

- [ ] 4.1 [repo: peanut-pod-lite] [paths: packages/protocol/**, packages/**/mcp/**, test/**] [depends: 1.2, 2.4] [serial] [owner: batch] 新增显式批次控制协议和批次状态查询，不增加新的业务能力计数；验收：批次有独立 ID、每个分项保留任务 ID，旧客户端与 83 项公开能力目录保持兼容。
- [ ] 4.2 [repo: peanut-pod-lite] [paths: packages/**/planner/**, packages/**/task-*/**, test/**] [depends: 4.1, 1.3] [serial] [owner: batch] 实现批次 DAG、资源闭包、审批聚合、幂等校验与 union lock set 规划；验收：冲突、循环依赖、重复幂等键和越权分项在任何写入前失败。
- [ ] 4.3 [repo: peanut-pod-lite] [paths: packages/**/runtime/**, packages/**/planner/**, test/**] [depends: 4.2] [serial] [owner: batch] 实现有界 prepare 池和批次组装限制；验收：默认 prepare 并行度 4、每批最多 32 项、规范化输入最多 4 MiB，超限批次以 `not_started` 拒绝。
- [ ] 4.4 [repo: peanut-pod-lite] [paths: packages/**/runtime/**, packages/**/bridge/**, packages/**/evidence/**, test/**] [depends: 4.3, 3.1] [serial] [owner: batch] 在唯一项目 writer 中执行批次提交、共享 postflight、revision 推进和持久化 journal；验收：同工程任意时刻只有一个编辑器写者，每个批次只有一次 postflight，成功结果可回放审计。
- [ ] 4.5 [repo: peanut-pod-lite] [paths: packages/**/runtime/**, packages/**/task-*/**, test/**] [depends: 4.4] [serial] [owner: batch] 实现批次取消、回滚与 `unchanged`/`rolled_back`/`may_have_changed` 保守失败语义；验收：故障注入覆盖 prepare、首项写入、中段写入、postflight 和取消边界，系统不得把未知项目状态报告为成功或未变化。
- [ ] 4.6 [repo: peanut-pod-lite] [paths: packages/**/operations/**, packages/**/bridge/**, test/**] [depends: 4.5] [serial] [owner: operations] 为 Lumen、Asset、Scene/Prefab 等可批处理写操作接入批次适配器，并建立严格自动合批白名单；验收：不满足可交换性、回滚性或资源确定性的操作只能走显式批次或单任务路径。
- [ ] 4.7 [repo: peanut-pod-lite] [paths: packages/**/runtime/**, packages/**/mcp/**, test/**] [depends: 4.6] [serial] [owner: batch] 在特性开关后实现默认 10ms 自动微批，且只覆盖白名单中的相邻兼容请求；验收：关闭开关时行为完全等同现状，开启时不得跨权限主体、revision、资源冲突或因果边界合批。
- [ ] 4.8 [repo: peanut-pod-lite] [paths: packages/**/runtime/**, test/**] [depends: 4.7] [serial] [owner: runtime] 实现协作式时间切片与控制面优先级，安全切片之间目标间隔不超过 200ms；验收：不可逆提交不被强制中断，持续批量负载下 status/cancel/metrics 的 P95 响应不超过 1 秒。

## 5. 验证、发布基线与知识同步

- [ ] 5.1 [repo: peanut-pod-lite] [paths: test/**, scripts/**, docs/**] [depends: 3.4, 4.8] [serial] [owner: qa] 完成模拟 10,000 读、500 写、过载、重试和 100 资源批次对照压测；验收：合格批处理负载吞吐至少为逐项执行的 2 倍，队列、任务、证据与内存均不突破硬上限。
- [ ] 5.2 [repo: peanut-pod-lite] [paths: package.json, scripts/**, test/**, docs/**] [depends: 5.1] [serial] [owner: integration] 运行完整 `verify`、`pack`、能力目录与 OpenSpec strict validation；验收：全部命令退出码为 0，产物仍公开 83 项能力且 Pro 缺失/失败不阻断 Lite。
- [ ] 5.3 [repo: peanut-pod-lite] [paths: test/**, docs/**] [depends: 5.2] [parallel:creator-383] [owner: qa] 在 Creator 3.8.3 真实 Bridge 上执行 30 分钟正常负载与 10 分钟过载 soak；验收：无编辑器崩溃、未处理异常、永久锁、任务泄漏或错误项目状态，指标与日志已归档。
- [ ] 5.4 [repo: peanut-pod-lite] [paths: test/**, docs/**] [depends: 5.2] [parallel:creator-387] [owner: qa] 在 Creator 3.8.7 真实 Bridge 上执行 30 分钟正常负载与 10 分钟过载 soak；验收：无编辑器崩溃、未处理异常、永久锁、任务泄漏或错误项目状态，指标与日志已归档。
- [ ] 5.5 [repo: peanut-pod-lite] [paths: README.md, docs/**, openspec/**] [depends: 5.3, 5.4] [serial] [owner: integration] 更新吞吐调优、容量边界、故障语义、运维指标和版本验证文档，并按 Peanut Hub 流程同步知识；验收：文档默认值与实现一致，知识构建/check-sync 通过，最终分支已提交、推送并回读远端 SHA。
