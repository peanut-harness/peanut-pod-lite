# Tasks

## 1. 固定契约

- [x] 1.1 `[peanut-pod-lite] [paths: openspec/changes/add-log-diagnostics-and-viewport-control/**] [depends: none] [serial] [owner: coordinator] [requirements: log-diagnostics#Bounded project log observation, viewport-control#Authorized verified viewport mutation] [non-goals: 不扩展计划范围]` 将已批准计划落盘并通过 openspec validate --strict；完整读取全部artifact后apply。；验收：执行本项所列测试/探测并保留退出码与结果，全部场景有证据才勾选。

## 2. 日志诊断先行

- [x] 2.1 `[peanut-pod-lite] [paths: packages/engine/modules/runtime/src/cocos/foundation/editor-resource/**, packages/engine/modules/runtime/tests/**] [depends: 1.1] [serial] [owner: coordinator] [requirements: log-diagnostics#Bounded project log observation, log-diagnostics#Generation-bound safe continuation] [non-goals: 不改变postflight判定]` 实现有界日志读取和游标身份，测试大文件、UTF-8、半行、轮转、替换、容量和失败。；验收：执行本项所列测试/探测并保留退出码与结果，全部场景有证据才勾选。
- [x] 2.2 `[peanut-pod-lite] [paths: packages/protocol/**, packages/engine/modules/policy/**, packages/engine/modules/mcp/**] [depends: 2.1] [serial] [owner: coordinator] [requirements: log-diagnostics#Bounded project log observation, log-diagnostics#Generation-bound safe continuation] [non-goals: 不添加任意文件读取]` 注册 diagnostics.queryLogs 并验证真实Router路径、schema与旧错误查询回归。；验收：执行本项所列测试/探测并保留退出码与结果，全部场景有证据才勾选。
- [x] 2.3 `[peanut-pod-lite] [paths: docs/**, openspec/changes/add-log-diagnostics-and-viewport-control/evidence/**] [depends: 2.2] [serial] [owner: coordinator] [requirements: log-diagnostics#Bounded project log observation, log-diagnostics#Generation-bound safe continuation] [non-goals: 不使用截图]` 在指定QA工程核对真实project.log读取与关键词上下文，记录定向测试、宿主版本与证据；通过后开始视口。；验收：执行本项所列测试/探测并保留退出码与结果，全部场景有证据才勾选。

## 3. 视口控制

- [x] 3.1 `[peanut-pod-lite] [paths: packages/hosts/**, openspec/changes/add-log-diagnostics-and-viewport-control/evidence/**] [depends: 2.3] [serial] [owner: coordinator] [requirements: viewport-control#Version-probed viewport observation, viewport-control#Authorized verified viewport mutation] [non-goals: 不猜测API]` 3.8.3/3.8.7只读消息探测，冻结字段、写入与验证能力矩阵。；验收：执行本项所列测试/探测并保留退出码与结果，全部场景有证据才勾选。证据：evidence/viewport-api-matrix.json；两版已安装包声明核对通过，含模式/网格消息、聚焦消息及场景脚本相机只读回执。
- [x] 3.2 `[peanut-pod-lite] [paths: packages/protocol/**, packages/engine/modules/policy/**, packages/engine/modules/runtime/**, packages/engine/modules/mcp/**, packages/hosts/**] [depends: 3.1] [serial] [owner: coordinator] [requirements: viewport-control#Version-probed viewport observation, viewport-control#Authorized verified viewport mutation] [non-goals: 不实现Gizmo或相机组件修改]` 依次实现queryState、focusNodes、setState；测试租约、版本、歧义节点、部分失败和未验证回执。；验收：执行本项所列测试/探测并保留退出码与结果，全部场景有证据才勾选。证据：evidence/viewport-unit-stage.json；最终定向集合21项全通过。
- [x] 3.3 `[peanut-pod-lite] [paths: openspec/changes/add-log-diagnostics-and-viewport-control/evidence/**] [depends: 3.2] [serial] [owner: coordinator] [requirements: viewport-control#Version-probed viewport observation, viewport-control#Authorized verified viewport mutation] [non-goals: 不以选区当聚焦]` 双版实机验证手动状态更新、单/多节点聚焦、模式网格和资产摘要不变。；验收：执行本项所列测试/探测并保留退出码与结果，全部场景有证据才勾选。证据：evidence/viewport-native-stage.json；Creator 3.8.3/3.8.7状态切换、恢复及聚焦验证通过，资产摘要与选区不变。

## 4. 集成与交付

- [ ] 4.1 `[peanut-pod-lite] [paths: docs/**, README.md, openspec/changes/add-log-diagnostics-and-viewport-control/**] [depends: 3.3] [serial] [owner: coordinator] [requirements: log-diagnostics#Bounded project log observation, viewport-control#Authorized verified viewport mutation] [non-goals: 不发布正式版本]` 更新文档，运行联合流程、OpenSpec strict、npm run verify、npm run pack及知识同步，提交推送并回读目标SHA，保留未完成证据。；验收：执行本项所列测试/探测并保留退出码与结果，全部场景有证据才勾选。
