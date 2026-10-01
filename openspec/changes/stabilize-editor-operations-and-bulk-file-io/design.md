# Design

## Context

动机见 `proposal.md`。只读核对已确认以下事实：

- `asset.writeText` 已有 `path/content` 与 `files`，允许 `.ts/.js` 等文本扩展；silent gateway 按文件提交后统一 commit，输入解析尚无独立文件数/正文上限、重复路径检查和摘要条件。
- `McpBatchCoordinator` 的显式批次要求 `managed_task` 写 operation，拒绝只读 operation；已有资源联合锁、project writer、revision、背压和保守失败模型可复用。
- Lumen `bundled/schema/assets.json` 登记 38 类独立资产，Prefab/Scene 为另两种层次资产；组件离线测试遍历 99 项 3.8.7 schema，只证明序列化与离线重开。TypeScript sidecar 支持源文本，JavaScript sidecar 主要编辑导入设置。
- 既有双版本长稳以 JSON 文本写和少量原子创建为核心，不是全类型矩阵。3.8.7 原始日志的命名与退出警告必须保留，退出堆栈尚不能证明由扩展引起。
- 原工程含 855 个 `.ts`、3 个 `.js`、12 个 Scene、14 个 Prefab，缺少不少资产种类的真实夹具；夹具缺失是需要补齐的验收缺口。

## Goals / Non-Goals

**Goals:** 用一份版本化覆盖清单连接公开能力、资产/组件 schema、真实夹具和验收证据；复用现有调度与审批边界实现有界批读及强化批写；只有当前候选完整通过才给出稳定结论。

**Non-Goals:** 不创建第二套调度器，不并发对同工程运行 GUI/headless，不编辑原工程或 Creator 安装包，不用屏蔽日志替代修复。源码批量 I/O 限于资产根内允许的 UTF-8 文件；二进制内容保持既有类型化资源操作。新能力不扩大其它版本写权限。

## Decisions

### 1. 从目录生成矩阵，并核对原生支持集合

增加纯数据 coverage manifest 与生成/校验工具，记录 Creator 版本、原生 importer 与组件目录摘要、Lite schema/operation 标识、适用操作、夹具及依赖、期望值、回读方式、日志阶段和状态。资源行覆盖 import/create、query/inspect、patch、copy/move/rename、refresh/reimport、delete；组件行覆盖 add/get/set/bind/remove/save/reopen 与每类公开字段。适用关系按原生 importer/组件要求明确声明，无法创建的媒体使用合法导入夹具。

原生目录与 Lite schema 的差异逐项解释。原生确实不存在的版本项可列为不适用；产品未支持或缺夹具的原生项记 gap，不算通过。固定种子选择字段有效值，读回采用语义值与身份检查，避免浮点值或 Creator 规范化导致伪失败。私有不可写字段用边界拒绝验证。

不采用手工列几个“代表种类”的烟测作为全量验收，避免目录新增后遗漏；也不对每个组件无依赖地生成空节点，物理、UI、骨骼和动画组件使用有效依赖装配。

### 2. 保留现有写入口，新增一个内容读入口

新增 `asset.readText` → `peanut.editor-mcp.asset-read-text`，输入严格二选一 `path` / `paths`。默认强一致；成功结果包含 `revision`、`consistent`、按输入顺序的 `files`，各项含 `path/status/content/byteCount/sha256`；分项失败不返回其内容，整体 `ok=false`。传输失败继续使用统一 failure 契约。

`asset.writeText` 保持名称、同步/异步行为、`written/createdDirectories/byteCount/transaction` 等结果字段，新增 `files` outcome。单文件可选 `expectedSha256`，批量每项可选同字段；值为 64 位十六进制摘要或 `absent`。省略保持旧语义，旧混合输入保持 `files` 优先。

不通过通用显式写批次伪装只读，也不新建重复 `files.write` 工具；原 83 项业务工具保留，新目录为 84 项业务操作，另含本地审批签发工具。同步更新生成的 profile、policy、catalog/schema、输出/AI 成功规则和文档中的计数断言。

### 3. 容量与路径校验集中定义

默认一次最多 32 文件、单文件 1 MiB、规范化请求和编码后响应各最多 4 MiB；单位为字节，输入上限也计 JSON 封装。配置在现有吞吐配置入口集中声明并注入，不散落环境变量读取；公开 schema、运行时硬检查和返回的容量说明一致。大于 32 文件的客户端按输入稳定分片，至少 100 文件验收使用多个有界请求，不宣称跨片事务。

归一化路径后核对目标平台大小写、真实父目录和 symlink 链；缺目标校验最近存在祖先，拒绝离开资产根和相同物理目标。读取前 stat 预算、实际读取后再次检查字节与 UTF-8 合法性，禁止 replacement character 静默替换。BOM、CRLF、空文件和 Unicode 保持原始内容与摘要。二进制 importer、目录、`.meta` 及未知编码不当作普通文本；结构化 Prefab/Scene/.meta 修改走既有类型化入口。

采用硬预算而非截断或无限分页正文，避免大批内容挤占 Bridge、任务结果保留与 RSS。超限旧用法是明确迁移点，不能称所有历史无界请求均兼容。

### 4. 读取的一致性明确区分受管写与外部写

批读复用 read admission、project writer barrier 与 revision。等待已受理 writer 后取得目标读取闭包，记录整个批次前后 revision、文件身份/stat 与内容摘要；与受管 writer 共享资源互斥，保证不会读取半写内容。遇到外部改变最多在声明预算内重新取完整批次；仍变化则返回冲突，不宣称稳定快照。文件系统无法为任意外部进程提供事务快照，此限制通过 `consistent` 与受控冲突暴露。

不把跨 revision 的单文件缓存拼成一批。内容只向当前调用方返回，日志、共享 metrics 和 task evidence 只保存摘要。结果传输及保留受容量上限约束，读取无需本地写审批。

### 5. 全批准备与 writer 内重验，结果逐项可核验

`asset.writeText` 的 prepare 阶段先校验所有输入、容量、目标、预期摘要、审批资源范围与动态风险，规划主文件、父目录、`.meta`、引用和编译依赖的闭包；不得在 prepare 补目录 meta 或写暂存到资产目录。取得联合闭包与唯一 writer 后，在第一项变更前重验全部摘要和路径身份。

新文件沿 AssetDB-owned create 路径，先确认父目录登记再发布；已有文件走保持身份的内容更新。最终合并 refresh/settle，唯一 postflight 对所有文件读回摘要、UUID/meta 与编译就绪并检查原始日志。分项状态区分 `verified/written_unverified/failed/not_started`，写完但整体 postflight 失败不能称 verified。

任何中途故障记录已写、当前和未写项以及可查询摘要，返回 `may_have_changed`；只有完整恢复及原始身份/内容后验均证明时才用 `rolled_back`。不强制实现全批回滚，不删除不确定恢复材料。幂等摘要包括所有内容与前置条件；commit 前取消不写，commit 内保留现有安全拒绝边界。

### 6. 代码验收使用真实编译与原生组件

代码夹具含基础 TypeScript/JavaScript 模块、`cc.Component`、序列化字段与跨文件 import。先静态检查已知语法/依赖前置条件，再由受管写发布；结合 AssetDB 与实际 Creator 编译/加载证据等待就绪，重开绑定组件核对类型/字段/引用，再对有效代码场景执行必要预览加载。仅文本摘要相同不够。

任意用户程序无法仅凭语法校验保证运行行为；有效夹具、未知行为失败和产品错误分别记录。故障注入在独立失败恢复 campaign 记录预期诊断，不用于零警告成功 campaign；最终有效全量矩阵与长稳仍要求所有原始阶段零新增警告错误。

### 7. 先复现生命周期，再按归属修复

新隔离副本采用 Creator 接受的名称，保留受管 `npm run creator` 入口和 hooks。退出警告至少以 3.8.7 最小隔离工程、不带 Lite 与带当前 Lite 的 normal quit 对照；保存 PID、项目、启动与退出时间、原始 stack。仅在证明扩展归属后修复扩展 timer/subscription、pending request、task drain 或卸载顺序；若由 Creator 自身触发，寻找原生受支持的关闭顺序并复测，不改安装包也不豁免。

原始项目日志和进程 stdout/stderr均留存并交叉核对，独立 raw validator 不依赖现有 postflight 噪声过滤器。分类可辅助诊断，但不得抹掉计数。无法消除的原生 warning 是本目标实际阻塞，不能将全量任务打勾。

### 8. DAG、所有权与验收顺序

共享协议、目录/schema、manifest、生成物、Git index、知识同步与最终打包由 checkpoint owner 串行持有。DAG 为契约与覆盖清单 → 生命周期诊断 / bulk I/O / 资源夹具 / 组件代码夹具 → 集成 → 新候选 → 两版顺序全量验收与长稳 → 本地 checkpoint → integration owner 远端交付。

契约确定后，bulk I/O 实现与纯数据夹具 lane 可有独立 owned paths；只有收到逐 task packet、确认至少两条安全 ready lane 且无共享可变状态时才评估临时子 Agent。所有实机、安装、性能测量及共享构建串行。规划阶段不分派实现 Agent。

定向验收采用实际根工作区脚本和源测试文件，不沿用 README 中已失效的内部 workspace 名。最终先生成并构建、pack Core prerequisite，再运行 canonical verify/pack；必要产物顺序显式记录。既有 669 测试和旧候选不能替代新 tree 检查。

## Risks / Trade-offs

- [原生目录超出当前策展 schema 或真实媒体缺失] → 差异清单必须显示；补合法最小夹具与类型契约，未补齐时全量失败，不缩小分母。
- [组件依赖或 3.8 补丁差异产生错误] → 按实际版本声明生成依赖装配和字段范围，未支持版本保持既有拒绝。
- [32 文件和正文上限影响旧无界调用] → 明确迁移和分片示例；分片结果分别可查，不声称整批事务。
- [外部编辑在 stat 与读写之间发生] → writer 内重验、资源互斥、读前后快照与有界冲突；不保证任意外部进程之间的文件系统事务。
- [组件或脚本导入发出延迟日志] → 等待实际编译、AssetDB settle 与后续观察，最后重开及冷却，原始日志按阶段保留。
- [退出警告来自 Creator 内部] → 最小工程复现并寻找支持的退出路径；无法根治时保持本项失败，报告具体边界。
- [有效全量测试持续时间较长] → 先定向矩阵收敛，再在最终制品上各跑一次完整实机和长稳；改候选则重绑重跑相关验收。

## Migration Plan

审阅本变更后按 task id 登记源码/测试 owned paths 与 checkpoint 权，保留当前发布变更和旧报告。实现仅在登记 worktree，原工程只读。增加新 read tool 并同步目录，旧 write 客户端对超限输入分片；按新候选装到全新隔离副本，两版依次验收。失败回到源码修复并生成新 digest，保留所有旧失败原始证据。验收完成后更新知识卡及 sync、提交 checkpoint；远端回读由 integration owner 完成，之后才称代码交付完成。该流程不触发公开 CPM 发布。
