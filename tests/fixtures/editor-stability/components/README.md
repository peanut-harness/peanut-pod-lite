# 组件输入配方与依赖审计

本目录属于任务 5.1。两版各保留 99 个策展组件与 795 个完整递归字段，包含现有公开 MeshRenderer 烘焙设置的 8 个子字段。`component-assembly-audit.json` 是来源和依赖审计；`component-field-fixtures.json` 是有效值、真实引用和错误类型的输入配方。字段、依赖缺失或原始摘要失配时拒绝生成，不使用空占位值。

`ComponentNativeSourceReader` 读取对应版本源码的 AST、导入别名、注册父类、`requireComponent`、编辑器类型标注和数值枚举，不执行引擎模块。装配顺序保留完整依赖闭包；缺声明、动态依赖、同名分支或依赖环阻止执行。Sorting2D 的抽象 UIRenderer 要求通过实际继承该类型的 Sprite 满足，不直接添加公共 API 已拒绝的抽象组件。

3.8.3 的 Sorting2D、UISkew 在安装源码中没有声明，仍保留全部字段和阻塞，不能据此标记原生不适用。来源分别为 364/366 个注册类、116/118 个组件声明；这些数字不是可挂载或实机通过数量，也不替代共享 inventory 中的动态注册及分支对照。

资源配方复用任务 4.1/4.2 已审计的真实输入与完整 SHA 闭包。mesh/skeleton 来自实际 glTF 子资源；不伪造输出文件或 AssetDB UUID。皮肤、骨架和动画名从源数据读取。VideoPlayer/WebView 的 URL 在本次隔离工程实际预览服务就绪后解析，不能猜端口或使用其它工程 URL。组件引用公开值保持既有 API 接受的路径字符串，装配类型单独记录。

物理后端、UI 场景、同源蒙皮层次、TiledMap 生成的内部组件及高质量渲染管线具有明确装配前置要求。这些要求尚须实际装配及原生端口验证；输入配方不等于完整原生夹具。5.1 当前保持未完成，`nativePassedRows` 始终为 0。

`ComponentSceneFixture` 现在从同版本已审计的官方 2D Scene 模板实际创建依赖、Canvas 下的 UI 节点、引用节点及事件控制器，并写入不需要原生资源身份的完整字段值。3.8.3 可生成53个场景，498个字段已写入；3.8.7 可生成55个场景，502个字段已写入。这是场景源的离线装配，没有执行 Creator 加载。

每版仍有39个字段等待真实资源导入或工程预览 URL。3.8.3 的46个组件／253个字段、3.8.7 的44个组件／249个字段受原生层次、后端或缺声明阻塞；每版另保留5个公共 API 预期拒绝字段。全部795个字段均有明确状态，不删除阻塞行。独立图校验拒绝悬空 id、重复链接、双向父子关系或组件所属节点失配；定向测试覆盖场景保存、重开、移除组件后保存重开，以及 ScrollView 引用与真实事件控制器绑定。

生成一次新的离线场景集（`--run-id` 必须是新的目录标识；已有产物不覆盖），再以同样参数追加 `--check`：

```sh
node --import tsx tests/fixtures/editor-stability/components/component-scene-command.mts \
  --creator-version 3.8.7 --creator-resources-root "$CREATOR_RESOURCES" --run-id task51-next
```

输出固定在本工作树 `evidence/task-5.1/<run-id>-<version>/`，包含实际 `.scene` 与逐字段报告。生成和检查都会独立重算实际安装包审计与795字段配方；检查同时重算保存字节摘要、依赖图与场景语义。新创作的 `_id` 可不同，其余场景链接和字段全部比较。没有 `.meta` 登记、资源 UUID 解析、原生层次初始化或后端运行证据时，不能称完整原生夹具或原生通过。

运行定向测试：

```sh
node --import tsx --test tests/fixtures/editor-stability/components/*.test.mts
```

序列化测试通过真实产品 API 添加依赖、写字段、保存、重开并拒绝错误类型。合计 1575 个字段用例成功保存/重开并拒绝错误类型；15 项明确分列为版本来源阻塞或现有公共持久化拒绝。测试的资源解析 UUID 和预览 URL 仅为 codec 单元测试合成输入，不是资产登记、原生加载、引用绑定或生命周期验收证据。

独立重新核对单版本的来源审计（资源目录必须指向对应实际安装包）：

```sh
node --import tsx tests/fixtures/editor-stability/components/component-catalog-command.mts \
  --creator-version 3.8.7 --creator-resources-root "$CREATOR_RESOURCES" --check
```

共享分母的遗漏已通过任务 1.2 修复。旧 coverage 草稿和原始报告保留；新矩阵保存于工作树 evidence。任务 5.3/6 的原生结果必须使用独立重算的新分母，不能将这里的输入配方或序列化读回升级为原生通过。

原生观测使用 `component-native-project.mts` 创建全新的任务工程，核对官方候选的双画像、载荷摘要和源码检查点，通过实际安装事务安装 Core。参数为 `--creator-version`、`--creator-app`、`--run-id`。源文件逐项校验 SHA；cube meta 必须配对在 HDR 副本旁，checker 的 SpriteFrame 导入选项来自精确 SDK，子资源由实际 importer 生成。源及旧报告保持原样。

在输出的 `project/` 内运行 `npm --ignore-scripts=false run creator`，保留 precreator/creator/postcreator。同版本已有其它工程时使用 macOS `open -na` 新实例，并记录实际 Creator PID；`open -W` 仅有启动器退出状态，不能据此宣称 Creator 的退出码为 0。本工程已有实例时拒绝重启，交回会话附着流程。所有二进制 stdout/stderr 和 project.log 完整保留。

`component-native-read.mts --project <隔离工程>` 每次重读私有描述符并核对 PID、启动时间、工程路径和 owner，分别等待 Host 注册和 AssetDB 导入，再按声明源核对资源的实际 UUID、类型和有效性。运行于场景进程的探针只提供资源加载、场景快照和后端观测，没有场景打开或任意消息执行入口。资源加载成功仍不等于组件字段写入、引用绑定、保存重开或零日志通过，`nativePassedRows` 保持 0。

`component-creator-close.mts --project <隔离工程>` 再次核对登记和原始启动身份，仅向该 PID 发正常退出请求并等待实际退出；没有全局退出或强杀接口。实际源码运行环境分别由健康回执记录，观测扩展按 Node 14 编译。

2026-10-14 实机结果：3.8.7 的20种资源均按声明源加载；3.8.3 为19种，HDR 的 cmft 子进程异常退出，TextureCube 阻塞。两版实际物理后端为 Bullet/Box2D；3.8.7 启用 Builtin 自定义管线，3.8.3 仍为 ForwardPipeline。每版9项 MCP 只读调用通过，目录仍仅40项只读能力。现有候选不支持用户授权的6项精确挂接，不能用 `all` 代替；具体缺口保存在 evidence 的挂接调查回执。两版均有原始诊断，尚未验收任何组件原生矩阵行。


2026-10-14后续实现为6项能力增加独立精确名单：通过已认证当前工程的MCP控制动作 `attachCapabilities` / `detachCapabilities` / `queryCapabilityAttachments`，提交 `projectPath`、`owner`、`capabilities` 和 `resourceRoots`。资源根仅允许 `assets/components`、`assets/fixtures`；默认公开档位保持read_only，未列出的写能力继续隐藏。项目名单保存在 `.peanut-ai/cocos-mcp-attachments.json`，没有令牌字段，不提交到仓库。

每次业务写入必须先签发单一operation和完整resources集合的一次性令牌；旧可复用短租约不能用于精确挂接。实际业务目标、声明资源、真实父目录和UUID的AssetDB源共同校验；受管任务在原writer窗口再次校验，并捕获受理代数，撤销重挂不能恢复旧任务。自动commit、无明确路径commit、全assets刷新、未解析的脚本别名和精确挂接的显式批次保持拒绝。UI计划执行须带 `approvalToken`，删除组件还须 `confirmDestructive=true`。

新实机阶段使用 `component-native-project.mts ... --sprite-roundtrip`，仅暂存本阶段Sprite/Texture2D与两个真实场景，保留完整资源分母20的说明；不重复触发已知3.8.3 HDR工具失败，也不把本分片计为全资源矩阵通过。候选必须与当前Git HEAD一致，原始510400c场景输入仅作已审计源，不能替代新候选身份。

在Host和导入完成后先运行 `component-native-read.mts --project <新工程>`，再执行 `component-native-roundtrip.mts --project <新工程>`。后者经真实MCP加UIOpacity、改opacity、改Sprite.grayscale并绑定实际SpriteFrame，逐步commit/preview.refresh，再使用scene.open进行原生重开和公开getter读回；移除UIOpacity后切换到控制场景再重开，核对组件消失、资源身份和落盘SHA。观测扩展只读，全部写通过6项受管能力。尚未执行或失败的回执不能计为原生通过。

预览安全暂停：旧矩阵逐字段调用preview.refresh导致重复open-terminal，原始日志和中断报告保留。矩阵的preview-refresh入口继续禁用，commit不再刷新浏览器。`component-preview-safety.mts --project <新工程>` 是独立安全分片：真实候选、浏览器标签只读计数、query不打开窗口及最多三次refresh均需核对；未知状态立即停止，不重放写入。

仅安全验收回执真实通过后才登记 `evidence/task-5.1/preview-safety-approved-<version>.json`。矩阵拒绝缺失或不匹配候选、Host/Core摘要的回执。`component-native-matrix.mts` 保留99组件/795字段分母，逐根字段验证避免别名覆盖，记录原生getter或有精确SDK源码证明的原生序列化槽；后端候选、Tiled源拥有层次、蒙皮和管线条件不会被暂存提升为原生通过。
