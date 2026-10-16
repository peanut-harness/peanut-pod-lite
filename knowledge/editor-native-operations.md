# 编辑器原生操作与验收

## 当前组件矩阵边界

2026-10-15任务5.1边界：展示场景与破坏性字段生命周期测试分离，后者只写`assets/components/_lifecycle/`副本；展示候选使用精确SDK完整预设，原生上下文不齐时明确待补。矩阵在finally核对展示文件不变，字段读回与实际呈现独立记账，99组件/795字段分母不变。公共scene.open需等待目标场景身份，已受理消息不因非空旧层次或超时而重复投递；原生字段读取也必须先核对Scene UUID，AssetDB与meta一致后才能打开。ParticleSystem嵌套纹理分块名按3.8.3/3.8.7原生JSON映射，曲线与渐变只读现代API，不用期望配方替代真实值。1d4579a完整verify1247项和官方候选校验通过；本轮Label在独立工具夹具下有单次实际呈现证据，其余矩阵、浏览器冷启动零诊断及新产品候选尚待复验，5.1仍未完成。只使用精确六项、一次性令牌与自有工程/PID，禁止all和重复开窗。

## 原生资源、调度与既有实机证据

- 旧 83 项 Creator 3.8.x 迁移验收按五个互斥域固定分母：Editor/Scene/Prefab 21、Asset read 15、Asset write 12、Preview/Builder/Reference 9、Lumen 26；legacy schema/readOnly/risk parity fixture 已覆盖旧 83 项，但不替代 Creator 实机证据。
- 2026-09-20 在 Creator 3.8.3 工程 `billiards-practice-clean` 完成当前 Host/Core pack 的真实 Bridge 验证：宿主与工程版本均为 3.8.3，Host/Core 产物身份与状态报告一致，`asset.writeText` 经 Hub 写租约完成 AssetDB settle、`.meta` 生成和 postflight 校验，随后经 destructive 租约删除且无残留；3.8.3 现纳入 verified/write-enabled 精确画像。
- Creator 3.8 实机报告同时记录宿主入口 SHA-256、打包 Host 目录包 digest、Lite CPM package digest/packedAt 与可选 Pro package digest；`query-status`、`host-status.json`、`smoke-results.json` 三方身份必须一致，旧报告不能冒充当前 release；live 脚本带 `--release-descriptor` 时再经 `CpmPackageStore.compareReleaseIdentity` 核对 descriptor。目录包 digest 规范按码元序拼接，校验端兼容旧 localeCompare 清单。
- Creator 3.x 新建 Prefab/Scene 已改为单一 AssetDB 原子创建状态机：目标与 sidecar/父目录先纳入资源闭包，Lumen 在内存生成主内容，父目录登记探针清理完成后才进入 commit 窗口，再通过 `create-asset` 或 Creator 原生 Prefab 发布器写入并确认真实 UUID、`.meta` 与子资源。pending、身份不一致、探针残留或新增日志 error/warn 均阻止成功；无法证明回滚时返回 `may_have_changed`。
- MCP 写调用默认进入进程内共享的项目调度器：同工程 Router 共享 AssetDB/editor writer 屏障，同资源按 FIFO 串行，不同资源的离线 Lumen 编辑与不同工程可以并行；多资源锁必须一次性原子预约，空锁集合降级为项目锁而不是绕锁。
- 当前资源规划已覆盖 operation 推导资源、copy/rename/首次创建目标、主资源和父目录 `.meta`、序列化引用、传递依赖及 UUID/子资源闭包。纯磁盘 copy/createFolder 使用注册探针与 refresh/settle；首次创建使用专用发布状态机，创建身份由唯一 postflight 消费。共享任务控制面提供 connection-scoped 状态/取消/证据、超时与幂等，成功还要求 `project.log` 增量零错误零警告。自动重试与跨调用批次事务仍待后续阶段，设计见 `docs/MCP-TASK-QUEUE-DESIGN.md`。
- MCP Hub 失败响应在兼容 `error` 字段外统一追加 `failure` v1：包含稳定 `code`、`category`、受控 `reason`、`retryable`、项目 `state` 与 `recommendedAction`；已入队写任务再附 `taskId/taskStatus/operation`。普通 JSON 与 NDJSON 流式响应使用同一结构。真实发布链路由 policy `CoreCocosMcpToolDefinitionCatalog` 生成契约，Creator 3.8 host 与 Hub summary 必须原样透传 `outputSchema/aiHandling`，registry 在注册时 fail-closed 校验其结构。一般写操作必须同时满足 `taskStatus=succeeded` 与 `postflight.verified=true`；`asset.writeText` 还要求 `result.ok=true`、`result.projectState=verified` 且每项 `result.files[*].status=verified`；状态为 `unknown`/`may_have_changed` 时 AI 必须先查询目标再决定是否重试，禁止盲目重放写入。
- Creator 宿主网关解包 Router `data` 时必须把 `taskId/taskStatus` 合并进公开结果，不能在 Core dispatcher 边界丢失任务证据。2026-09-19 在 Creator 3.8.7 工程 `D:\mcp-test` 使用 CPM `PackagingApp` 安装当前目录包后，保留 `assets/mcp-scheduler-live/ParallelA.ts` 与 `ParallelB.ts`：不同资源并发和同资源 FIFO 均返回独立成功任务 ID，最终内容分别为 `fifo-second` / `parallel`；`lumen.commit` 返回 `assetdb_registered`、两项真实 UUID/`.meta`，对应 `project.log` 增量为 0 字节、零 error/warn。
- 2026-09-21，AssetDB 原子创建候选在 Creator 3.8.3 与 3.8.7 通过 v2 实机矩阵：Host/Core digest 为 `5312e5db4c4287fc5f51294eb9758f828e36cb52df61428733405827c0b96e6b` / `68c6721913b494c5cfabe05ead19db00ec96074f48033a31d728ba856ddd645f`。Prefab/Scene 真实 UUID 与 `.meta`、同目标一成一败无覆盖、发布前取消零残留、创建任务唯一 `assetdb_settle` 与所有成功任务唯一 postflight 均通过；两端探针残留与日志增量均为零。报告摘要为 `db615d8ed8929ea5c7ccde93a19eef76e3ab54c27bdd0681633db7e650444850`（3.8.3）与 `30c2fcaa2de077cd2a26c8ed81add00d3b17a916c523d16ee8e2cc02e80daa1f`（3.8.7）。

2026-10-15更新：4af673b/5ce3543均通过完整verify1251项及官方候选校验；5ce3543工程52份展示源首次真实导入SHA不变，19类资源原生加载通过。已有唯一IAB标签先停空白页、等真实目标场景就绪再恢复的流程，在这两次启动与有界刷新中没有新浏览器诊断，没有新开标签；不外推自动打开分支。4af673b截图确认Label/Button/ScrollView/RichText/ProgressBar；5ce3543另确认真实checker绑定后的Sprite呈现。

5ce3543的ParticleSystem独立campaign127字段、保存重开、移除重开及零诊断通过。其余campaign在Terrain绑定通用Unlit effect后触发detailMap0/UVScale四条警告而整体拒绝；60组件仅字段证据，SpriteRenderer.sortLayer/sortOrder缺失和ReflectionProbe.cubemap输入缺口保留，未执行行不删。六项撤销，自有PID1372正常退出；5.1不勾选。新修复将两版无原生排序成员的写入在修改前拒绝，Terrain用同版本完整effect及75项chunk摘要验证，副本改用任务专用名称；修复后的原生campaign尚未验收，须新的clean检查点候选。

4b07360完整verify1251项及官方候选通过；3.8.3真实导入52/52展示源不变、资源19/19、已有标签三次刷新安全核验通过。SpriteRenderer/Terrain独立campaign通过14字段读回及2项拒绝，保存/移除重开和零诊断通过。后续tail整轮在UIMeshRenderer缺ModelRenderer处拒绝，之前五组件只保留字段证据；六项已撤销，自有PID93018正常退出。两版新装配显式补同节点MeshRenderer/UITransform/Canvas，真实Mesh和Material在添加桥接器前绑定；Lumen精确放行官方载体组合并选择UI层，保留其它互斥拒绝。零字段组件增加保存重开及载体共享资源身份核对，展示候选新增SDK UI模型为53/55。新修改未进入候选、未完成实机或呈现验收，5.1仍未完成；不开all，不新建预览标签。

7e9290e获准20文件检查点完整verify1252项及官方候选通过，3.8.3资源19/19、展示首次导入53/53原始SHA不变、两次同标签刷新无新诊断。UI模型初轮材质歧义在打开前拒绝；新工具按冻结来源区分独立Material和glTF内嵌材质，同候选下独立UI模型生命周期、Mesh/sharedMaterials身份及零诊断验收通过，工具SHA另存。原展示与普通灯光对照均黑屏；SDK默认灯光层排除UI_2D，显式加入UI_2D的方向光对照截图确认灰色立方体可见，原53展示源未改。后续tail因Widget.target不是祖先而整体拒绝，9组件仅字段证据；VideoPlayer/WebView的项目静态URL缺口保留。六项撤销，自有PID89079正常关闭；新Widget配方选实际祖先Canvas，离线校验拒绝兄弟/自身引用。来源选择、灯光及Widget的新源码仍待新的检查点完整verify/候选和定向复验，3.8.7与5.1未完成，不开all，不新建预览标签。


2026-10-15后续：15文件批准已用于6e1aef5，完整verify1252项、官方打包及候选校验通过。3.8.3资源19/19、展示53/53原始SHA不变；UI模型和Widget定向campaign通过完整生命周期与18字段，tail通过10组件及66字段/1拒绝，整轮均零诊断。3.8.7资源20/20、展示55/55原始SHA不变；预防性停止含Sorting2D非法层输入的首轮并撤销六项后，新98项campaign执行零诊断，76组件完整通过、716字段及12预期拒绝；60前置阻塞、3读回差异、2待执行排序字段、2URL输入缺口完整保留在99/795分母。两版原始UI模型实际截图可见受光立方体，全程复用原标签，六项已撤销，自有PID82521/7077均正常关闭。

新源码修复精确版本AnimationController.graph/DragonBones.playTimes序列化槽和动画整补丁原子拒绝；ReflectionProbe.probeId由SDK注册表分配，保留目录但写前拒绝；Sorting2D使用真实默认层0。任务专用probe的原回环socket仅GET/HEAD服务两份固定SHA夹具，支持视频单段Range；认证只读查询返回真实端口URL，runner独立核对正文及候选/owner/run身份后才写入，令牌资源仍限定场景和夹具DB路径。拒绝路径/链接/字节替换、错误身份和重定向，不改MCP暴露档位或开启all。全部新修复仍待获准检查点、完整verify/候选及定向实机；URL字段通过不等于视频播放或WebView呈现通过，其余专门上下文仍开放，5.1不勾选，不推送或发布。


2026-10-15后续：21文件批准已用于13e46db，完整verify1256项、官方打包和候选校验通过。3.8.7资源20/20、展示55/55原始SHA不变；六类定向campaign通过34字段读回及1项拒绝，全部增删、保存/移除重开零诊断。3.8.3资源19/19、展示53/53原始SHA不变；五类定向campaign执行零诊断，4组件完整通过、31字段读回及1拒绝，ReflectionProbe.cubemap仍因TextureCube导入器缺口保留1输入阻塞。两版动画图和DragonBones旧读回差异消除；Sorting2D默认层及视频/WebView真实回环URL在适用版本通过。795字段完整分母及未选行均保留，未以定向结果替代完整矩阵。两版仅复用原标签各刷新一次，均existing-preview+reload-terminal且无新浏览器诊断；六项撤销，自有PID27479/74033正常关闭，其他会话不受影响。

额外原标签呈现取证：原始Sorting2D显示默认小图案，但尺寸不足，未声明排序行为通过；WebView可变生命周期对照已真实加载HTML，DOM确认透明背景和黑字，黑色游戏背景上不可辨认，呈现拒绝；视频对照真实解码/播放16x16源，keepAspectRatio=true导致尺寸缩回很小。关闭该自动尺寸同步并显式480x320后，同一标签截图出现146.25x97.5蓝色视频画面，readyState4、paused=false、muted=true且无新诊断；只证明独立对照，原55展示源不变。现在修复HTML为大字高对比不透明页面，固定端点仅以精确内容SHA允许其style，不放宽脚本或任意内联样式；Sprite使用CUSTOM尺寸240，Sorting2D增加后创建红色order0与蓝色目标order1的真实排序对照。新源码仍待新的检查点、完整verify/候选和实际呈现复验；其他原生层次、后端及完整5.1未完成，不开all、不推送、不发布。


完整日志补查：13e46db的3.8.7整份工程日志无警告/错误；3.8.3在19:51:39正常退出的同一秒新增Electron GUEST_VIEW_MANAGER_CALL / Invalid guestInstanceId: 6，栈仅见Electron GuestView。其矩阵campaign零诊断证据保持，但整会话零错误验收不通过；根因尚未确定，不能宣称无害或已修好。物理退出事实和原始错误均保留，未重开该工程盲试、未改Creator安装包。关闭工具新增既有日志guard后验：即使进程正常退出也保留单独物理回执，并对退出期间新增诊断返回失败；延迟GuestView错误回归验证不重放关闭。这个门禁修复不等于SDK退出错误已解决，后续仍须安全定向复验。


2026-10-15后续：13文件批准已用于e90fb77，完整verify1256项、官方打包和候选校验通过。两版新工程资源分别20/20与19/19加载，展示55/55与53/53首次导入及末尾SHA均不变；WebView新URL的保存/移除重开定向campaign零诊断，795完整分母保留。两版原始Sprite截图确认240逻辑尺寸内容清晰可见；独立WebView生命周期对照截图确认WebView OK、64px深色文字和不透明浅色背景，浏览器无新诊断。原标签各仅一次existing-preview+reload-terminal刷新，未增窗口/标签。按先停放预览、切回自有Label、撤销六项并确认连接0和短暂安静的流程，两版自有PID49095/6412正常退出，关闭后验与整份工程日志均0警告/0错误。旧3.8.3 GuestView退出错误本轮未复现；根因仍未建立，不宣称SDK缺陷已普遍消除。

Sorting2D原始重叠对照在原生字段为蓝色order1/红色order0时仍显示红色，呈现拒绝；SDK源码确认USE_SORTING_2D默认false，sorting-2d模块覆盖为true，官方说明也要求在功能裁剪启用2D渲染排序（https://docs.cocos.com/creator/3.8/manual/zh/engine/rendering/sorting-2d.html）。仅对本任务3.8.7工程通过官方UI切换该项，取消额外动画实验功能提示，保留模块配置物化前后文件；相同未修改场景的原标签截图随后确认蓝色order1覆盖后创建红色order0，零新诊断。这是条件配置对照，不将原失败报告改为通过。

新夹具工具将官方UI导出配置冻结为3.8.7精确模块档案，并显式使用官方默认配置键；保持PhysX、XR、实验动画和其他原本关闭的选项关闭，不改变MCP暴露档位。仅在新矩阵工程暂存，拒绝已启动工程、已有配置、链接、错误SDK功能契约及额外模块/后端/加载标志变化；3.8.3不加未知模块。外层npm preflight及原生读客户端均校验落盘配置；health改用公开Editor.Profile.getProject读回项目模块（https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/profile），不使用全局编辑器配置替代。90项夹具、严格类型及源码规范通过，实际SDK离线装配检查通过；新档案和Profile有效配置门禁仍待新的clean检查点、完整verify/候选及原生呈现复验，其余原生拥有层次、后端及完整5.1未完成，不开all、不推送、不发布。


2026-10-15后续：13文件批准已用于8045b84，完整verify1256项、官方打包和候选校验通过。首次真实空模板暂存于启动前失败：3.8.7官方empty-quality只有project.json，没有settings/v2/packages/engine.json，原工具误要求文件预先存在；未启动Creator，失败日志保留。新修复仅允许在真实原始父目录内首次排他创建同版官方UI配置，继续拒绝已有modules、已启动工程、目录/文件/悬空链接；不添加未知模块或放宽六项权限。92项组件夹具、严格类型与源码规范通过，使用实际SDK/完整空模板的第二个全新离线暂存成功，包安装出现未签名本地候选既有package_signature_missing提示，不作原生日志零警告证明。当前新增工具尚未提交，须新clean检查点、完整verify/候选及新工程原生Profile读回和Sorting2D实际排序复验；旧失败目录保留且不重用，5.1仍未完成，不开all、不推送或发布。

2026-10-16：空模板5文件获准提交0f8e3fd，完整verify1256项及官方pack/候选校验通过。接管后原生工具改从设备登记读取当前独占owner并核对CODEX_THREAD_ID、原工作树与分支及三项self-delivery归属；旧工程/租约仍拒绝，不能据接管关闭旧实例。该工具迁移尚待新检查点与实机复验，5.1保持未完成，不开all、不推送或发布。

2026-10-16原生续验：dde82cd的3.8.7新工程初次有效Profile比对因额外物化graphics拒绝；磁盘和其余选择未变。独立校验修复严格接纳仅由冻结选择推导的graphics两项，拒绝缺失、额外字段和其它管线/模块变化；工具SHA与初始失败保留。同一自有PID完成20/20资源加载及Sorting2D生命周期和2字段保存/移除重开，新增warn/error为0。唯一IAB页一次MCP刷新复用连接、无新增标签或浏览器诊断；实际遮挡仍受Hub禁止截图约束，未声明呈现通过；剩余5.1未完成。

2026-10-16续验准备：867811c完整verify1256项及官方pack/候选通过。dde82cd实机Sorting2D campaign的2字段、增删及保存/移除重开通过，但正常关闭自有PID6537后，整段原始stdout严格扫描发现3项Config file error与24项trackTimeEnd失败，整会话仍拒绝；stderr和project.log无此诊断，不用局部增量代替全渠道验收。用户单次Sorting2D截图授权尚未使用，唯一IAB标签已停泊空白。新增3.8.7精确后处理上下文，只开启custom-pipeline-post-process及Forward宏；8份实际SDK离线场景已装配，需原生Forward/PostProcessBuilder证据后才解除阻塞，99/795分母不变。新隔离工程通过SDK支持的旧版空服务配置迁移避免缺配置，公开Profile只读核验；受限VM执行原方法重现失败和空services迁移，不算实机通过。macOS改用应用启动入口保留双原始日志验证计时器问题。新源已过101项夹具与定向严格检查，仍待clean检查点完整verify/候选及冷启动、单次截图和后处理实机；5.1不勾选，不开all、不推送或发布。

后处理相机门禁：同版SDK的Camera.usePostProcess默认false；新展示源显式写入其已审计序列化槽，并在原生快照只读核对公开getter及全局PostProcess，避免只有组件而未启用效果。f158519的完整verify1256项通过，此相机补齐仍需新检查点及实机。

2026-10-16实机收尾：8ae0192完整verify1256项、官方pack/候选通过；同一自有3.8.7 PID50275完成20/20资源加载。Creator公开Profile补齐11项SDK默认宏，磁盘仅保存覆盖项；独立校验按同版macro.ts逐项核对，初次拒绝、原生快照和工具SHA均保留。唯一获准Sorting2D截图确认蓝色order1覆盖后创建红色order0；两字段及完整生命周期观测通过，单次授权已用完，未新增标签。后处理首轮23/24字段读回，BlitScreen.activeMaterials在onLoad按enabled materials重建，补真实启用材质原子上下文后其4字段重验通过；8类后处理共24字段及8份展示的实际Main Camera.usePostProcess/global PostProcess上下文已观测，原展示源不变。

整会话仍拒绝：完整stdout有212条SDK trackTimeEnd错误，stderr有1条SSL及6条uniform-buffer WebGL错误、2条MaxListenersExceededWarning和1条trace提示；project.log没有这些诊断。旧campaign的accepted只覆盖当时project.log增量，不能作全渠道验收，字段观测不升级为后处理呈现通过。新门禁在campaign开始前扫描全部原始来源，逐MCP动作与只读观测同时检查stdout/stderr/启动器及project.log，识别类型化Node警告、异步诊断、缺失/链接/轮换/截断/前缀改写；不忽略SDK消息，也不能重取游标跳过启动错误。已关闭会话的离线回放在0次MCP/0组件前拒绝219错误与3警告，保留99/795完整分母。110项组件回归、严格类型及源码规范通过；新源须clean检查点完整verify/候选，不用关闭的旧实例假装新候选实机。六项已撤销，退回Label后仅正常关闭自有PID50275，启动器退出0不等于Creator退出码0；唯一IAB标签停泊空白。5.1仍未完成，后处理呈现、原始诊断及角色控制器/蒙皮/Tiled专门上下文仍待解决；不勾选、不推送、不发布、不开all。

2026-10-16无Host/Core只读对照：代码检查点4b797c3完整verify1256/1256、110项组件回归及官方pack/候选通过后，在新的登记工程首次启动前移除Host/Core，保留同版SDK、精确后处理配置、原始Bloom场景和只读探针；公开Host查询明确不存在，实际Forward/PostProcessBuilder、Main Camera.usePostProcess及全局PostProcess均确认。未调用MCP写、未开预览或截图，场景SHA不变；正常关闭自有PID59543后，五个原始来源仍有2条SDK asset-db启动计时器错误，零警告。本单场景冷启动未复现循环中的GPU/监听器问题，不能据此判定其归因；不将该对照记作产品候选原生通过。最终进程核对仅余原先两个3.8.3工程，自有50275/59543均消失。当前零诊断门禁阻止继续有效campaign；5.1保持未完成，先解决/定位原始诊断，再补角色控制器、蒙皮和Tiled上下文，禁止忽略SDK错误。此后仅更新文档，源码/配置不变，复用4b797c3完整验证；知识另做scoped同步并交sync。

2026-10-16诊断续查：加入3.8.7同版启动器已有的metric输出开关、Node警告堆栈与ComponentManager只读监听器观测；不修改SDK、监听器阈值或日志门禁。SDK源码显示metrics同步末尾reset，缺少起始时间时打印trackTimeEnd失败，但尚未证明根因。111项组件回归通过；下一步为新clean候选的单变量冷启动对照，当前仅为诊断准备，不宣称GPU/监听器/SDK错误已修复，5.1仍未完成。

2026-10-16诊断实证：897920d完整verify1256/1256、111项组件回归、官方pack/候选通过。新的无Host/Core单变量metric冷启动仍有2条SDK asset-db计时器错误；首次早到snapshot另造2条scene_missing（全保留），导入完成后场景观测成功。PID60227正常关闭。带Lite有界诊断PID66461：12次纯场景打开监听器稳定1/1；组件保存重开循环增长并越过10，警告堆栈指向SDK CompManager.registerCompMgrEvents→NodeManager.initWithScene。提前commit或全部写入时机的两种对照均未阻止增长，未修改阈值或移除监听器。8个默认后处理场景没有GL错误；仅将BlitScreen设为当前通用standard材质后即复现2条uniform-buffer错误。完整关闭后114条原始错误、2条警告，全部诊断运行明确拒绝验收。新修复只为Blit的4字段提供同版专用全屏材质和冻结SDK证明，并用公开query-is-ready等待场景就绪；20类资源和99/795分母不变，113项组件回归及定向严格检查通过，尚待clean新候选实机。SDK计时器及监听器仍未修复，5.1不勾选，不过滤、不改SDK、不开all、不发布或推送。

2026-10-16 GPU修复复验：clean c9a5b1c完整verify1256/1256、113项组件回归、严格类型、源码规范、OpenSpec及scoped RAG通过，官方pack/候选通过。新登记工程18592实际加载专用Blit材质f6fe05ae-a1ef-463d-9dda-0135ad98bd54，启用材质列表、Forward/PostProcessBuilder、相机usePostProcess与global PostProcess均读回确认；相同standard材质曾触发2条GL错误，专用材质激活、冷却和物理退出后GL为0。全部六项已撤销，仅正常关闭自有18592；完整5来源仍有4条SDK计时器错误、零警告，故整轮验收仍false，未新增预览或截图，也未宣称后处理实际呈现通过。SDK计时器和CompManager/NodeManager监听器增长仍未修复，不能忽略或调整阈值；当前5.1禁止改Creator安装包，后续角色控制器2、蒙皮3、源拥有Tiled4原生上下文仍受零日志门禁阻塞。5.1保持未完成，不推送、不发布、不开all。此后仅更新验收文档，复用源码/配置未变的c9a5b1c完整验证。

2026-10-16 SDK续查：bd8a7c7只读原生观测确认protected reset仅重置队列、不清空起始Map，排除先前猜测；SDK CompManager.init每次重新bind并覆盖旧引用，unregister只能释放最后一对。项目内显式sdk-listener-compat兼容修复已实现，严格核对3.8.7及3个原方法摘要，注册前通过SDK原配对方法只释放自身旧回调，保留其它监听器及阈值；真实SDK原方法离线故障对照和20轮幂等回归通过，117项组件回归及定向类型通过，待新clean候选实机。独立probe不调用SDK修改接口，继续只读提取已缓存计时适配器；SDK安装包、原工程和旧证据不变，计时器错误未修复，5.1不勾选。自有只读诊断实例已正常关闭，整段仍2条SDK原始错误、零警告。

2026-10-16 工作进程计时续查：真实IPC确认资产库worker-startup标签只有end，无显式value；9次显式打开加首次启动对应10次SDK打开，未发现重复投递。hierarchy存在同名重叠计时，main-window:ready只有首次start后多次end。NodeManager原方法自行配对unregister，无需修改。按官方programming清单与EditorMethodModule声明，隔离诊断扩展使用asset-db.script、global-hook函数名和load/unload/methods；首次路径误填与顶层导出错误均已修正。SDK随后实际装载脚本，但其renderer getTrackTimeStartMap/getTrackInfoList是存在却抛Renderer is not supported的桩，造成新增探针失败；对应12cedca工程正常关闭，完整5来源4错误/5条分类警告均保留，未作验收。新观测严格只读worker真实启动方法与计时函数文本，绝不调用renderer缓存API，不新增通用执行。此前三个自有诊断实例均正常退出，证据见sdk-timer-ipc-387-20261016-5d94522、sdk-worker-387-20261016-f529c1f、sdk-worker-hook-387-20261016-e1c9e19、sdk-worker-module-387-20261016-12cedca；5.1仍未完成。
