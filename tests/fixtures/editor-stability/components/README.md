# 组件输入配方与依赖审计

本目录属于任务 5.1。两版各保留 99 个策展组件与 795 个完整递归字段，包含现有公开 MeshRenderer 烘焙设置的 8 个子字段。`component-assembly-audit.json` 是来源和依赖审计；`component-field-fixtures.json` 是有效值、真实引用和错误类型的输入配方。字段、依赖缺失或原始摘要失配时拒绝生成，不使用空占位值。

`ComponentNativeSourceReader` 读取对应版本源码的 AST、导入别名、注册父类、`requireComponent`、编辑器类型标注和数值枚举，不执行引擎模块。装配顺序保留完整依赖闭包；缺声明、动态依赖、同名分支或依赖环阻止执行。Sorting2D 的抽象 UIRenderer 要求通过实际继承该类型的 Sprite 满足，不直接添加公共 API 已拒绝的抽象组件。

3.8.3 的 Sorting2D、UISkew 在安装源码中没有声明，仍保留全部字段和阻塞，不能据此标记原生不适用。来源分别为 364/366 个注册类、116/118 个组件声明；这些数字不是可挂载或实机通过数量，也不替代共享 inventory 中的动态注册及分支对照。

资源配方复用任务 4.1/4.2 已审计的真实输入与完整 SHA 闭包。mesh/skeleton 来自实际 glTF 子资源；不伪造输出文件或 AssetDB UUID。皮肤、骨架和动画名从源数据读取。VideoPlayer/WebView 的 URL 在本次隔离工程实际预览服务就绪后解析，不能猜端口或使用其它工程 URL。组件引用公开值保持既有 API 接受的路径字符串，装配类型单独记录。

物理后端、UI 场景、同源蒙皮层次、TiledMap 生成的内部组件及高质量渲染管线具有明确装配前置要求。这些要求尚须实际装配及原生端口验证；输入配方不等于完整原生夹具。5.1 当前保持未完成，`nativePassedRows` 始终为 0。

`ComponentSceneFixture` 现在从同版本已审计的官方 2D Scene 模板实际创建依赖、Canvas 下的 UI 节点、引用节点及事件控制器，并写入不需要原生资源身份的完整字段值。3.8.3 可生成53个场景，493个字段已写入；3.8.7 可生成55个场景，498个字段已写入。这是场景源的离线装配，没有执行 Creator 加载。

每版仍有39个字段等待真实资源导入或工程预览 URL。3.8.3 的46个组件／253个字段、3.8.7 的44个组件／249个字段受原生层次、后端或缺声明阻塞；两版各保留10个公共 API 预期拒绝字段（3.8.7含后端待验行）。全部795个字段均有明确状态，不删除阻塞行。独立图校验拒绝悬空 id、重复链接、双向父子关系或组件所属节点失配；定向测试覆盖场景保存、重开、移除组件后保存重开，以及 ScrollView 引用与真实事件控制器绑定。

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

序列化测试通过真实产品 API 添加依赖、写字段、保存、重开并拒绝错误类型。合计 1566 个字段用例成功保存/重开并拒绝错误类型；24 项明确分列为版本来源阻塞或现有公共持久化拒绝。测试的资源解析 UUID 和预览 URL 仅为 codec 单元测试合成输入，不是资产登记、原生加载、引用绑定或生命周期验收证据。

独立重新核对单版本的来源审计（资源目录必须指向对应实际安装包）：

```sh
node --import tsx tests/fixtures/editor-stability/components/component-catalog-command.mts \
  --creator-version 3.8.7 --creator-resources-root "$CREATOR_RESOURCES" --check
```

共享分母的遗漏已通过任务 1.2 修复。旧 coverage 草稿和原始报告保留；新矩阵保存于工作树 evidence。任务 5.3/6 的原生结果必须使用独立重算的新分母，不能将这里的输入配方或序列化读回升级为原生通过。

任务归属由 `ComponentTaskOwnership` 从所属工作空间的设备登记读取，并与宿主 `CODEX_THREAD_ID` 核对；要求原工作树、唯一 active 记录及 self-delivery 的三项 owner 一致。新工程使用当前 owner，启动、原生客户端、资源读取和关闭工具拒绝旧 owner 的工程或租约；不会因会话接管而收养旧实例。缺少会话身份或登记时，在启动和操作之前停止。

原生观测使用 `component-native-project.mts` 创建全新的任务工程，核对官方候选的双画像、载荷摘要和源码检查点，通过实际安装事务安装 Core。参数为 `--creator-version`、`--creator-app`、`--run-id`。源文件逐项校验 SHA；cube meta 必须配对在 HDR 副本旁，checker 的 SpriteFrame 导入选项来自精确 SDK，子资源由实际 importer 生成。源及旧报告保持原样。

3.8.7 可显式增加 `--metrics-diagnostics`，登记为有限布尔值并传入同版启动器已有的 `--metric`。SDK `source/launch.ts` 将该值传入 `Editor.Startup.__protected__.manager` 的 `outputMetricLog` 参数；只增加诊断输出，未证明能修复计时器错误。只读探针开启 `process.traceProcessWarnings` 并读取 `EditorExtends.Component` 的公开 EventEmitter 计数、阈值和回调名称，不修改监听器、阈值或 SDK。MCP 回执先记录产品返回状态，再执行原始日志门禁；后者失败仍使操作和 campaign 拒绝，不能以产品返回成功代替零诊断。

3.8.7 BlitScreen的4个字段改用独立全屏材质，effect身份和shader/pass字节绑定同版SDK的`pipeline/post-process/blit-screen`；通用standard网格材质在真实全屏通道已复现uniform-buffer错误，不能用于该字段。只有该组件配方变化，20类通用资源与99/795分母不变。首次暂存验证SDK及材质源摘要；原生导入后仍按来源唯一选择实际UUID。健康等待还要求SDK公开`scene:query-is-ready`为true，独立只读`scene-readiness`允许无Host基线先等场景就绪，避免早到snapshot自身制造scene_missing错误。

2026-10-16实机对照：c9a5b1c的113项组件回归、完整verify1256项和官方候选通过；真实专用材质UUID及启用列表、Forward/PostProcessBuilder、相机usePostProcess和全局PostProcess均确认。同条件standard材质出现2条GL错误，专用材质在激活、冷却及正常退出后为0。SDK计时器仍有4条原始错误、零警告，整轮nativeAcceptance仍false，未作图像或呈现验收；SDK监听器泄漏另在有界循环中复现并定位。自有18592正常关闭，六项撤销，不开all。

SDK诊断续查仅增加两个固定只读动作：`sdk-metrics-diagnostics`读取计时器起始Map、计时事件及固定SDK派发函数文本；`sdk-lifecycle-diagnostics`读取Component/Node/Facade固定生命周期方法文本。扩展每次加载追加一条计时缓存观测，不覆盖旧证据；不执行函数文本，不调用reset/register/释放方法，不导出其它统计事件或账号数据。所有观测仍经过原始日志门禁，不能据此将既有错误记作通过。

显式`--sdk-listener-compat`只为新登记3.8.7工程暂存独立SDK兼容扩展，原只读probe继续只读。SDK原方法每次init都bind新回调并覆盖旧引用；兼容层在再次注册前调用SDK配对unregister，仅释放该管理器自己保有的回调，保留其它监听器和原阈值。版本及3个原函数文本摘要必须精确匹配，已泄漏进程拒绝安装；卸载仅恢复自己的方法。原SDK方法回归已复现增长，修复后20次初始化保持一对并保留无关监听器；d7560ca实机10轮增删改保存重开、42次注册始终1/1，零MaxListeners警告，正常退出另有SDK WindowSender已销毁目标错误，整轮仍拒绝。这是明确登记的项目内运行时兼容，不能冒称未适配的SDK通过；不改安装包，也不修复或忽略计时器错误。健康回执须确认兼容扩展已实际装载。计时器观测还读取已缓存的固定SDK模块适配器源码，不加载新模块或导出统计数据。

另可显式启用`--sdk-timer-trace`，仅允许上述新登记3.8.7兼容工程。独立扩展透明包裹SDK唯一计时Map实例的set/has/get/delete/clear，原样返回API结果，记录真实输入、结果和调用栈；不补造start、不修改时间值、不捕获原API异常、不过滤日志，卸载恢复自己安装的方法。该观测与SDK方法/IPC只读探针分开，所有原始失败继续阻止整轮通过。

显式`--sdk-startup-timer-compat`要求同版监听器兼容工程，仅在实际SDK资产工作进程修复冷启动`_preStartDB`遗漏的worker-startup计时start；原始SDK`_startupDB`的end、动态`_startDB`路径和日志不变。安装前核验3.8.7、3个数据库方法及Metrics公开start的实机原文摘要；在真实数据库开始工作前调用一次SDK start，不合成时间、不重放启动、不缓存或抑制end。独立worker回执记录真实调用与PID，health必须确认internal/assets实际覆盖。`sdk-startup-timer-source.json`冻结实际SDK原方法；离线原SDK重放复现缺start，修复对照验证真实工作前start与原end配对、未知源码写前拒绝。工作进程只读观测仅取函数文本，renderer的缓存API是抛错桩，禁止调用。新修复尚待clean候选完整验证和实机，5.1未完成。

在输出的 `project/` 内运行 `npm --ignore-scripts=false run creator`，保留 precreator/creator/postcreator。macOS统一使用 `open -na` 的应用启动入口，捕获应用stdout/stderr并记录实际Creator PID；同工程已有进程时拒绝重复启动。`open -W` 仅有启动器退出状态，不能据此宣称 Creator 的退出码为 0。本工程已有实例时拒绝重启，交回会话附着流程。所有二进制 stdout/stderr 和 project.log 完整保留。

`component-native-read.mts --project <隔离工程>` 每次重读私有描述符并核对 PID、启动时间、工程路径和 owner，分别等待 Host 注册和 AssetDB 导入，再按声明源核对资源的实际 UUID、类型和有效性。运行于场景进程的探针只提供资源加载、场景快照和后端观测，没有场景打开或任意消息执行入口。资源加载成功仍不等于组件字段写入、引用绑定、保存重开或零日志通过，`nativePassedRows` 保持 0。

`component-creator-close.mts --project <隔离工程>` 再次核对登记和原始启动身份，仅向该 PID 发正常退出请求并等待实际退出；没有全局退出或强杀接口。实际源码运行环境分别由健康回执记录，观测扩展按 Node 14 编译。

2026-10-14 实机结果：3.8.7 的20种资源均按声明源加载；3.8.3 为19种，HDR 的 cmft 子进程异常退出，TextureCube 阻塞。两版实际物理后端为 Bullet/Box2D；3.8.7 启用 Builtin 自定义管线，3.8.3 仍为 ForwardPipeline。每版9项 MCP 只读调用通过，目录仍仅40项只读能力。现有候选不支持用户授权的6项精确挂接，不能用 `all` 代替；具体缺口保存在 evidence 的挂接调查回执。两版均有原始诊断，尚未验收任何组件原生矩阵行。


2026-10-14后续实现为6项能力增加独立精确名单：通过已认证当前工程的MCP控制动作 `attachCapabilities` / `detachCapabilities` / `queryCapabilityAttachments`，提交 `projectPath`、`owner`、`capabilities` 和 `resourceRoots`。资源根仅允许 `assets/components`、`assets/fixtures`；默认公开档位保持read_only，未列出的写能力继续隐藏。项目名单保存在 `.peanut-ai/cocos-mcp-attachments.json`，没有令牌字段，不提交到仓库。

每次业务写入必须先签发单一operation和完整resources集合的一次性令牌；旧可复用短租约不能用于精确挂接。实际业务目标、声明资源、真实父目录和UUID的AssetDB源共同校验；受管任务在原writer窗口再次校验，并捕获受理代数，撤销重挂不能恢复旧任务。自动commit、无明确路径commit、全assets刷新、未解析的脚本别名和精确挂接的显式批次保持拒绝。UI计划执行须带 `approvalToken`，删除组件还须 `confirmDestructive=true`。

新实机阶段使用 `component-native-project.mts ... --sprite-roundtrip`，仅暂存本阶段Sprite/Texture2D与两个真实场景，保留完整资源分母20的说明；不重复触发已知3.8.3 HDR工具失败，也不把本分片计为全资源矩阵通过。候选必须与当前Git HEAD一致，原始510400c场景输入仅作已审计源，不能替代新候选身份。

在Host和导入完成后先运行 `component-native-read.mts --project <新工程>`，再执行 `component-native-roundtrip.mts --project <新工程>`。后者经真实MCP加UIOpacity、改opacity、改Sprite.grayscale并绑定实际SpriteFrame，逐步commit/preview.refresh，再使用scene.open进行原生重开和公开getter读回；移除UIOpacity后切换到控制场景再重开，核对组件消失、资源身份和落盘SHA。观测扩展只读，全部写通过6项受管能力。尚未执行或失败的回执不能计为原生通过。

预览安全暂停：旧矩阵逐字段调用preview.refresh导致重复open-terminal，原始日志和中断报告保留。矩阵的preview-refresh入口继续禁用，commit不再刷新浏览器。`component-preview-safety.mts --project <新工程>` 是独立安全分片：真实候选、浏览器标签只读计数、query不打开窗口及最多三次refresh均需核对；未知状态立即停止，不重放写入。

仅安全验收回执真实通过后才登记 `evidence/task-5.1/preview-safety-approved-<version>.json`。矩阵拒绝缺失或不匹配候选、Host/Core摘要的回执。`component-native-matrix.mts` 保留99组件/795字段分母，逐根字段验证避免别名覆盖，记录原生getter或有精确SDK源码证明的原生序列化槽；后端候选、Tiled源拥有层次、蒙皮和管线条件不会被暂存提升为原生通过。

2026-10-15：b484e4 的内置浏览器有限验收完成3次真实MCP刷新，始终复用一个标签；仅证明已有连接页面的reload分支，Chrome原生窗口观测与自动打开分支仍未验收。随后矩阵处理43/99行，29行原生通过，因发现继承全局自定义引擎而暂停，六项已撤销；报告只归属于该实际运行环境，不能作为完整安装SDK验收。相关7个源码文件与SDK摘要一致，旧日志与失败行保留。

后续全新验证工程通过本地engine profile显式选择内置JavaScript和原生引擎；启动前和健康检查都拒绝缺失或非内置配置，不修改全局配置。EditBox五项扁平样式由源码及SHA证明的textLabel / placeholderLabel公开getter读取。Mask配方使用3模式和合法segments，重跑组件前先读取实际存在性，已移除组件不再盲目删除。Label.actualFontSize另列持久化拒绝后，离线codec用例为1573项写入保存重开、17项来源或持久化拒绝；两版分母仍各99/795。这些新增修复尚需新候选实机复验，5.1保持未完成。

警告根因修复：原生Camera.color/depth/stencil读取路径改为clearColor/clearDepth/clearStencil，ParticleSystem.enableCulling改为dataCulling。公开目录名和795字段分母保持原样；生成契约时同时核对版本源码SHA、目标类getter及replaceProperty对该类的实际转发声明，探针运行时也拒绝这四个旧getter。无法读取源码证明或现代getter时停止，不能静默回退旧getter。

`ComponentNativeLogGuard`把组件、资源、场景只读观测及整轮矩阵纳入project.log增量验收；日志必须存在、身份不变且未截断。读取后最多观察1000ms，按50ms只读轮询并要求连续200ms稳定，以捕获异步转发日志；此窗口不保证捕获任意更晚的外部事件。警告/错误、日志失去观测或执行异常立即停止，finally仅撤销精确六项挂接，不继续打开控制场景或执行下一组件。报告另记nativeFieldVerifiedComponents；只有整轮动作与日志后验均成功才计入nativeVerifiedComponents，原始失败行和旧日志不覆盖。新增保护尚待新候选实机复验。

拒绝字段保护：expectedWrite为reject-native-persistence或reject-version-gate时只保留字段行和拒绝原因，不调用原生getter；这避免UITransform.priority等已明确拒绝持久化的弃用字段产生探针警告。缺失或未知expectedWrite会在任何getter之前停止。分母仍为每版99组件/795字段。

2026-10-15实机复验：c30f60a候选通过完整verify（1243项）和官方候选校验；独立探针的上述拒绝字段修正另记源码SHA及差异，不冒充c30f60a的一部分。新3.8.3工程日志确认内置引擎，19种已暂存资源真实加载；9个已修复组件整轮通过88项字段读回及3项预期拒绝，project.log新增警告/错误均为0。同一IAB标签完成新候选最多3次刷新，未创建新标签；矩阵仍禁止preview-refresh。

非默认值对照进一步复现ParticleSystem.dataCulling设置true后原生仍为false，落盘_dataCulling=true但SDK实际读取enableCulling。已恢复隔离夹具的false状态，后续版本适配统一写入enableCulling；该新增产品修复仍须新候选实机true/false对照，不能把默认false读回当作它已经通过。5.1保持未完成。

后续剩余矩阵在ParticleSystem2D处因粒子plist引用的SpriteFrame不存在而停止，六项挂接已撤销；停止前27组件只保留字段证据，整轮拒绝。根因是粒子相邻checker.png首次导入没有预置SpriteFrame选项，实际仅生成Texture2D，而plist元数据引用了缺失的SpriteFrame。原始日志、UUID和失败报告保留。ComponentSpriteImport现在为主图片及粒子相邻图片从精确SDK派生导入选项，子资源仍由实际importer生成。ComponentNativeAssetLoader先检查AssetDB登记，再加载ParticleAsset、实际绑定的SpriteFrame及该依赖本身。资源检查遇到缺失或失败立即停止，矩阵挂接前要求同候选、同进程、全部暂存类型和粒子依赖均有原生加载证据。

ParticleSystem2D独立字段配方改为custom=true，因为两版SDK的_applyFile在custom=false时会以plist覆盖参数和spriteFrame；这保留全部字段，不能视为custom=false模式也已独立验收。新3.8.3隔离工程已生成真实粒子SpriteFrame，19种暂存资源及粒子依赖通过原生加载。该轮仍使用c30f60a产品候选，未提交的独立工具与夹具变更另记源码SHA，不包含待构建的dataCulling产品修复。

剩余分片在Sorting处因缺少ModelRenderer和无效排序层停止，新增1条warn及2条error，整轮拒绝；此前41组件只保留字段证据。新夹具显式先装配源码证明的MeshRenderer，在矩阵写入前绑定实际已加载Mesh，排序层采用SDK内置default ID 0；这属于运行时装配要求，不伪造requireComponent装饰器。新矩阵遇到旧契约缺少载体要求时在打开场景前拒绝。PointLight.intensity/size、RangedDirectionalLight.intensity及仅3.8.3的SafeArea.symmetric缺少原生成员，新增写前拒绝并保留字段、错误类型和未知版本回归；新增产品边界仍待新候选实机验证。

Sorting补充实机对照在原实例内先修复待提交内容，再保存重开：真实MeshRenderer绑定已加载Mesh，sortingLayer=0、sortingOrder=1原生读回正确，移除重开通过，新增日志warn/error均为0。粒子custom=false补充对照也验证plist参数和实际SpriteFrame绑定，保存与移除重开通过，新增日志warn/error均为0；首次补充脚本因comp-add额外参数被入口拒绝、未写组件，原拒绝证据保留，修正参数后的B对照另存。旧Sorting失败整轮与41组件字段证据不升级为通过。

中途失败的报告同样保留完整分母：ComponentNativeMatrixReport为尚未遍历的组件补not-executed及逐字段pending，processedComponents仍是实际已记录行数，失败组件和原始日志后验不变。旧失败报告保留，另存complete-reassessment推导报告，不能把补齐状态当作新增执行或验收。

2026-10-15：用户指出Label等场景为空。旧生命周期脚本在移除重开后留下空目标，不能作为展示场景；旧Label初始字体开关为false但字体为空，SDK的onEnable会回退系统字体，因此不能单凭这一配置断言黑屏原因。新生成器将字段/移除测试放到`assets/components/_lifecycle/`副本，根目录展示场景使用实际同版本SDK的完整预设，保留Canvas、相机、UI尺寸、渲染组件及控件子树。矩阵拒绝旧布局，并在finally核对展示文件摘要；报告中的字段验收不包含实际呈现通过。两版SDK分别装配52/54份展示候选，47/45项保留专门内容、后端或原生层次待补条件，不用空节点替代。

1d4579a候选已完成完整verify（1247项）和官方打包/候选校验。新3.8.3展示工程使用同一候选与单独记录SHA的独立工具、夹具；Label真实原生字段、Canvas相机引用、相机可见层及正布局尺寸通过，用户仅授权的一次截图确认实际文字显示。只复用IAB标签1并刷新一次，没有创建标签；原生Label核验新增warn/error均为0。切换工程期间浏览器保留两条早于显式刷新的启动错误，整段浏览器过程不能宣称零错误，后续冷启动须单独复验。之前全矩阵因手动切场景在RigidBody处停止，45组件仅保留字段证据，整轮拒绝；99/795分母完整，5.1仍未完成。

4af673b候选通过完整verify（1251项）及官方打包/候选校验，3.8.3真实资源加载19/19。新工程的52份展示场景首次导入只发生SceneAsset名称和Scene ID两项身份规范化；逐份逆变换后原始SHA完全一致，原始暂存报告保留。生成器修复为启动前创建meta并配对文件名和UUID，随后才冻结摘要；矩阵继续严格比较原始文件，禁止把任意导入变化当成允许差异。修复的首次原生导入不变性仍须新检查点工程验证，不能由离线测试提升为通过。

4af673b实机核验始终复用IAB标签1：先停到空白页，等待19项资源加载及Label真实场景就绪后恢复，观测到实际文字；三次MCP刷新均返回existing-preview+reload-terminal，标签数不变，本次浏览器启动和刷新未记录新warn/error。Button、ScrollView、RichText和ProgressBar随后各自原生打开并通过截图确认可见内容。该证据仅覆盖当前已有连接的预览与这些控件的呈现，不代表自动打开分支、全部组件行为或5.1完整矩阵通过。

后续操作顺序：先确认唯一已绑定的本任务预览标签；切换自有Creator工程前将该标签暂留空白页，正常关闭且只关闭租约对应PID。新工程必须走最外层`npm run creator`，等宿主、AssetDB/meta场景UUID一致、场景脚本和目标原生场景就绪后，再用同一标签恢复已观测的预览URL。存在标签时禁止调用浏览器打开路径；独立预览刷新有明确次数上限。不能观察窗口/连接时停止，不把未知当作零，也不重复刷新或重放打开。

新增场景门禁在已受理打开后只读等待目标UUID，不因层次非空或等待未结束再次投递打开；兼容实际Lite返回的UUID字符串和完整宿主快照对象。原生字段探针在访问节点/getter前核对目标Scene UUID。ParticleSystem纹理分块序列化采用精确版本原生JSON别名；曲线/渐变探针从现代`spline.keyframes()`及`gradient.colorKeys/alphaKeys`读取实际数据，禁止已废弃curve getter和以配方值代替实际值。上述新产品改动尚未进入官方候选，需新批准的clean检查点后构建并复验。

2026-10-15，5ce3543：完整verify1251项及官方打包/候选校验通过，新3.8.3工程52/52展示文件首次真实导入SHA完全不变，资源19/19加载通过；三次已有预览刷新无新标签或诊断。ParticleSystem独立campaign的127/127字段、增删、保存重开和零诊断验收通过；真实checker SpriteFrame绑定、保存重开后截图确认棋盘显示。

其余矩阵在Terrain处因4条detailMap0/UVScale警告停止并撤销六项，整个campaign拒绝；60组件仅保留字段证据，SpriteRenderer两项排序字段getter缺失、ReflectionProbe.cubemap缺TextureCube输入。99/795分母与所有未执行行保留，52展示源未改；自有PID1372已正常关闭。不能把这60项计为整轮通过。新修复为两版SpriteRenderer无原生成员的排序字段写前拒绝，并保持目录；Terrain引用改为同版本SDK完整effect副本，任务专用名称防覆盖全局SDK注册，启动前校验源、meta及75项传递builtin chunk。新源的原生零警告及剩余分片仍待新的clean检查点候选验证，不复用旧campaign为通过。

2026-10-15，4b07360：批准的21文件本地检查点完成完整verify1251项、官方打包及候选校验；3.8.3新工程52/52展示源真实导入不变、19/19资源加载、三次已有预览刷新均通过。SpriteRenderer/Terrain独立修复campaign通过14个原生读回字段和2项预期拒绝，增删及保存/移除重开均通过，新增warn/error为0。后续tail campaign在UIMeshRenderer加载时发现同节点缺少ModelRenderer，产生两项warning日志分类和一次MCP postflight失败而整体拒绝；先前五组件仅字段证据，不升级为验收通过。六项已撤销，自有PID93018正常关闭，原预览标签停泊，不重启已知有缺陷工程。

UIMeshRenderer两版SDK均继承Component且未声明requireComponent，onLoad却要求同节点ModelRenderer。新夹具显式在Canvas下先装配UITransform和MeshRenderer，再加载桥接器；原生矩阵写入真实已加载Mesh及Material后添加目标。Lumen修正桥接器与MeshRenderer/ParticleSystem的精确兼容组合及UI层选择，仍拒绝其它互斥组合或额外第三个渲染器。零公开字段组件也须实际添加、保存、切场景重开、确认存在，再移除并保存重开；UI模型另从公开modelComponent/mesh/sharedMaterials getter核对真实载体和源资源身份，不触发material/materials的实例创建getter。展示场景新增同版本SDK完整Cube、Canvas相机、UI层与可见尺寸，两版展示候选变为53/55；这些新修改尚未构建为候选或通过原生呈现，5.1保持未完成。

2026-10-15，7e9290e：获准20文件本地检查点完成完整verify1252项及官方打包/候选校验，新3.8.3实例PID89079真实加载19/19类资源、首次导入53/53展示源SHA不变，两次已有预览刷新均复用原标签且无新诊断。首个UI模型campaign在打开目标前因同工程两份Material歧义而安全拒绝，零诊断；新验证工具按冻结源路径选择独立default.mtl，排除glTF内嵌材质，并与普通字段共用严格选择器。工具SHA单独保存，产品包仍为7e9290e，当前新夹具源码未提交。修正后的UI模型独立campaign验收通过：同节点MeshRenderer真实Mesh及共享Material身份、添加、保存切场景重开、移除保存重开均通过，新增warn/error为0，53展示源不变；零公开字段不跳过生命周期。

UI模型原展示截图为黑屏；新增普通方向光对照仍黑屏。实际SDK默认Light.visibility排除UI_2D，使用同版本SDK Directional Light并明确visibility=UI_2D后，独立对照截图显示具有明暗面的灰色立方体，浏览器无新诊断、标签新增0。使用公开commit明确导入对照后才打开，未放宽场景身份门禁。三个对照与失败记录全部保留；实际呈现证据绑定7e9290e产品与独立记录SHA的新夹具，不宣称当前未提交源码已通过完整verify或新候选验收。原53份展示源未改。

随后20项tail分片在Widget.target指向兄弟节点时触发SDK祖先约束错误，整个campaign拒绝；9组件仅保留字段证据，不升级为通过。VideoPlayer.remoteURL与WebView.url仍缺项目内已验证静态URL，保留原生输入缺口，不填猜测地址；其余未执行行仍保留99/795分母。六项撤销，自有PID89079正常关闭，原预览标签停泊。新Widget配方使用实际祖先Canvas，独立结构校验在原生打开前拒绝兄弟/自身target，覆盖两版回归；此项实际复验、新完整verify/候选、剩余上下文和3.8.7仍待完成。

2026-10-16：接管工具检查点dde82cd完整verify1256项、96项组件回归及官方候选通过。新3.8.7工程初次health因有效Profile额外物化graphics而在写前拒绝；磁盘档案与其它有效选择完全一致。校验器分别严格核对磁盘原档案与有效快照；有效graphics两项必须逐项等于冻结cache选择，缺失、未知字段、管线和后处理变化均拒绝，不忽略该对象。同一自有实例20/20资源加载与Sorting2D定向增删、字段保存及移除重开通过，campaign新增warn/error为0；独立工具源码SHA与初始失败另存，不把新工具当作dde82cd已提交内容。唯一IAB页一次真实MCP刷新返回existing-preview+reload-terminal，新增标签0、浏览器诊断0；实际排序遮挡仍待用户对截图限制给出例外，5.1保持未完成。

2026-10-16续验配置：3.8.7矩阵可显式追加 `--post-process`，在冻结Sorting2D档案上只启用custom-pipeline-post-process，并选择SDK实际注册的Forward宏；不启用PhysX、XR或其它功能。只读原生快照必须同时证明usesCustomPipeline、Forward与PostProcessBuilder，才能释放8项后处理上下文阻塞。相应8份展示包含同版完整3D场景、模型及全局PostProcess；离线装配不算原生或呈现通过，99/795分母保持不变。3.8.3拒绝此未证明配置。

新3.8.7隔离项目额外暂存SDK `cocos-service.updateConfigFile`支持的 `settings/service.json`：未绑定游戏、固定本地配置和空services，由Creator自身迁移；运行时仅通过公开Profile读取game/configs/appConfigMaps/cscv，并精确核对迁移结果。拒绝已有配置、链接与已启动工程，不修改安装包或全局配置。受限VM直接执行同版SDK原始迁移/读取方法，证实缺配置时重现Config file error，迁移后enabledServices为空；此证据不是实机通过。

上一轮dde82cd的Sorting2D生命周期和2字段读回通过，但关闭后完整原始stdout严格扫描发现27项诊断：3项缺失服务配置及24项SDK trackTimeEnd失败。campaign的project.log增量为零不能替代整会话原始日志验收；该整会话仍拒绝。自有PID6537已正常关闭，六项已撤销；唯一IAB标签停泊空白，用户允许的单次Sorting2D截图尚未使用。新冷启动通过macOS应用入口验证计时器诊断来源，原始失败不覆盖、不筛除。

后处理相机门禁：同版SDK的Camera.usePostProcess默认false；新展示源显式写入其已审计序列化槽，并在原生快照只读核对公开getter及全局PostProcess，避免只有组件而未启用效果。f158519的完整verify1256项通过，此相机补齐仍需新检查点及实机。

2026-10-16实机收尾：8ae0192完整verify1256项、官方pack/候选通过；同一自有3.8.7 PID50275完成20/20资源加载。Creator公开Profile补齐11项SDK默认宏，磁盘仅保存覆盖项；独立校验按同版macro.ts逐项核对，初次拒绝、原生快照和工具SHA均保留。唯一获准Sorting2D截图确认蓝色order1覆盖后创建红色order0；两字段及完整生命周期观测通过，单次授权已用完，未新增标签。后处理首轮23/24字段读回，BlitScreen.activeMaterials在onLoad按enabled materials重建，补真实启用材质原子上下文后其4字段重验通过；8类后处理共24字段及8份展示的实际Main Camera.usePostProcess/global PostProcess上下文已观测，原展示源不变。

整会话仍拒绝：完整stdout有212条SDK trackTimeEnd错误，stderr有1条SSL及6条uniform-buffer WebGL错误、2条MaxListenersExceededWarning和1条trace提示；project.log没有这些诊断。旧campaign的accepted只覆盖当时project.log增量，不能作全渠道验收，字段观测不升级为后处理呈现通过。新门禁在campaign开始前扫描全部原始来源，逐MCP动作与只读观测同时检查stdout/stderr/启动器及project.log，识别类型化Node警告、异步诊断、缺失/链接/轮换/截断/前缀改写；不忽略SDK消息，也不能重取游标跳过启动错误。已关闭会话的离线回放在0次MCP/0组件前拒绝219错误与3警告，保留99/795完整分母。110项组件回归、严格类型及源码规范通过；新源须clean检查点完整verify/候选，不用关闭的旧实例假装新候选实机。六项已撤销，退回Label后仅正常关闭自有PID50275，启动器退出0不等于Creator退出码0；唯一IAB标签停泊空白。5.1仍未完成，后处理呈现、原始诊断及角色控制器/蒙皮/Tiled专门上下文仍待解决；不勾选、不推送、不发布、不开all。

2026-10-16无Host/Core只读对照：代码检查点4b797c3完整verify1256/1256、110项组件回归及官方pack/候选通过后，在新的登记工程首次启动前移除Host/Core，保留同版SDK、精确后处理配置、原始Bloom场景和只读探针；公开Host查询明确不存在，实际Forward/PostProcessBuilder、Main Camera.usePostProcess及全局PostProcess均确认。未调用MCP写、未开预览或截图，场景SHA不变；正常关闭自有PID59543后，五个原始来源仍有2条SDK asset-db启动计时器错误，零警告。本单场景冷启动未复现循环中的GPU/监听器问题，不能据此判定其归因；不将该对照记作产品候选原生通过。最终进程核对仅余原先两个3.8.3工程，自有50275/59543均消失。当前零诊断门禁阻止继续有效campaign；5.1保持未完成，先解决/定位原始诊断，再补角色控制器、蒙皮和Tiled上下文，禁止忽略SDK错误。此后仅更新文档，源码/配置不变，复用4b797c3完整验证；知识另做scoped同步并交sync。
