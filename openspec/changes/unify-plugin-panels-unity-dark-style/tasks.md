# Tasks

## 1. Lite 面板

- [x] 1.1 将 Plugin Host Controller 改为紧凑的炭灰工具面板，并让表单、按钮和状态区随停靠视口重排；通过静态资源构建及窄宽/矮高布局检查确认无页面横向溢出。

## 2. Pro 面板

- [x] 2.1 调整 UI Prefab 的规范源码，统一中性深灰色层级，并确保所有主要页面填充面板可用空间、长列表与编辑器内部滚动；运行该包的 build/pack 检查发行副本。
- [x] 2.2 调整 SDF Font 的表单、图集预览和结果区，使其在窄宽/矮高视口重排且可达；修正面板 runtime 与 WASM 的源码构建路径，并运行该包的 build/pack 检查发行副本。
- [x] 2.3 调整 SnowB BMFont 的主题与三栏工作区，使两侧设置和中央画布能适配较小停靠视口且保留可操作入口；运行该面板 build/pack 并检查构建结果。

## 3. 集成验收

- [x] 3.1 执行 Pro 与 Lite 的规定验证，并检查源码/打包产物差异只包含本次面板变更；`openspec validate unify-plugin-panels-unity-dark-style --type change --strict` 通过。

## 4. 已批准的实机集成补齐

- [x] 4.1 Creator Lite Host 装配可选的签名 Canvas 注册表，打包配置显式接收能力来源并把载荷纳入发行摘要；验证缺失载荷不阻断 Lite，完整载荷可用，签名/摘要不符被拒绝。
- [x] 4.2 构建并更新测试宿主，通过正式安装 API 安装 UI Prefab 与 SnowB，核对实际激活状态；保留旧失败证据，并执行受影响的完整验证。
- [x] 4.3 在真实 Creator 中逐个检查 SDF Font、UI Prefab、SnowB 和 Host Controller 的紧凑布局、窄宽/矮高适配、局部滚动及原有操作入口，保存实际截图；截图能力不可用时保持未完成。
- [x] 4.4 补齐 Host Controller 的 Lite A/B/C 槽位及真实宿主消息路由，验证槽位独立加载/关闭、身份与路径拒绝回归，并完成实机操作和截图。
- [x] 4.5 移除 UI Prefab 离线控制器绑定的 Lumen 内核运行时依赖，保留 MCP 与离线功能，补充序列化引用回归并通过现有包边界测试和受影响的完整验证。

2026-10-12 续验收：定向原生能力及宿主授权回归 3/3、含签名 Canvas 的完整 Lite verify 通过，末级宿主测试 27/27；Host/Core 与同一候选摘要匹配。四个插件均通过正式安装 API 激活，8 份安装 HTML/CSS 与发行副本一致。Host Controller 通过现有目录打包器生成 embedded/standalone 与要求的 libs 面板目录，并通过 package-layout 测试。历史安装拒绝保留，当前桌面控制/截图工具不可用，4.3 不勾选；此记录只证明安装与运行状态，不替代界面和业务操作验收。候选源码检查点 0d4e7aa，尚非远端交付。

同日桌面续验收已成功连接真实 Creator：UI Prefab 的“打开面板”报告 open-generated-plugin-panel 消息不存在。补齐静态通用 Creator 插件面板、已安装入口与调用方身份检查及原桥接转发；路由定向测试、严格 TypeScript 检查与面板 21/21 回归通过。首次完整 verify 发现 Node 擦除模式不支持构造函数参数属性，改为显式字段赋值后原失败 5 项重跑通过。正常退出以安装候选时桌面报告 Mac 锁定且自动解锁失败，等待用户手动解锁；4.3 仍未完成，不以源码修正代替真实点击、加载与截图验收。

入口修正后的最终完整 Lite verify 通过，末级宿主测试 28/28；发行包包含已注册的打开/刷新消息和实际渲染文件。候选源码为 bc5b8d4，原首次失败日志保留。当前测试 Creator 尚未更新到该入口候选，解锁后须正常退出、备份更新 Host、核对 Host/Core 发行身份、重开并激活插件，完成真实页面加载与布局检查。

2026-10-12 解锁后实机续验：已更新通用插件工作台 Host，核对 Host/Core 发行摘要无差异；四个插件通过正式安装 API 加载成功。UI Prefab 实际打开且显示策略已加载，修正其旧蓝黑顶栏/详情表与过大标题间距；在常规窗口及约 660×450 的窄短窗口检查规则页，列表与详情分别滚动，详情标题固定，编辑/取消入口可用。实际截图保存于本任务可视化目录：ui-prefab-rules-compact-20261012.png、ui-prefab-rules-narrow-scroll-20261012.png。SDF Font 实际页面加载，表单可滚到生成按钮，截图 sdf-font-live-20261012.png；尚未完成其窄窗口验收。截图工具后续出现缩放/白边异常，重新连接明确报告 Mac 再次锁定且自动解锁失败。SnowB、Host Controller 与其余小窗口验证待续，4.3 保持未完成。

本次 Pro 完整 verify 与 UI Prefab 面板回归 3/3 通过，pack 构建完成，测试安装包所有 manifest 文件摘要匹配。test:package 的既有断言 packages/ui-prefab/tests/package-layout.test.mjs:21 失败（当前 bundle 包含 LumenPrefabDocument；本次 diff 未改 bundle），没有删除或放宽断言。原日志 /private/tmp/ui-prefab-compact-package-20261012.log 保留。正式 API 对活动插件的同版本更新报 no prior active version，记录为独立安装问题；正常退出、备份更新后重启，再通过正式 API 加载成功。未将该安装问题扩大为本轮内核变更。本轮尚未完成验收或远端交付。


2026-10-12 最终候选本机验收（替代上文的历史阻塞状态）：
- Pro 源码检查点 845a26e；Lite Host/Core 同源候选 d79097b。四个插件通过正式安装 API 激活，最新 UI Prefab 在 Host C 显示已同步的规则页。
- 4.3：UI Prefab 常规和约 660×450 视口的规则列表、固定详情标题及独立滚动已实测，编辑/取消可用；SDF 在约 560×400 视口重排并可滚到生成按钮和预览；SnowB 在约 560×400 视口保留单行紧凑工具栏，设置抽屉可滚到底；Host Controller 在约 400×328 视口仍显示输入、槽位和加载/关闭入口。实际截图位于本任务可视化目录，包含 ui-prefab-rules-narrow-scroll-20261012.png、sdf-font-small-verified-20261012.png、snowb-compact-small-20261012.png 和 host-controller-small-20261012.png。部分原生截图有白色捕获留边，不作为产品留白证据。
- 4.4：实机 A 加载 SnowB、B 加载 SDF，关闭 A 后 B 的 Slot-B-keep 输入仍保留，证据 host-a-snowb-loaded-20261012.png 与 host-b-input-kept-after-a-close-20261012.png；最终候选 C 加载 UI Prefab，证据 ui-prefab-final-host-c-20261012.png。无效槽位、停用插件、旧身份、路径逃逸、独立请求及关闭回归通过。重复加载同插件不刷新由自动测试验证，实机请求成功；C 最小化后暂未恢复到前台，因此未取得重复加载后 Slot-C-keep 的补充视觉证明。该名称只作为未保存编辑输入，没有保存策略。
- 4.5：离线绑定改为插件内窄 Cocos 序列化适配器，保留 MCP 优先与离线回退、节点/组件引用、按钮事件和资源刷新规划；原包边界断言保持。UI Prefab 93/93、包边界 1/1、SnowB 17/17 通过；Pro 完整 verify 与 Lite 完整 verify 通过，Lite 末级宿主 29/29。
- 最终日志：/private/tmp/ui-prefab-boundary-93-tests-20261012.log、/private/tmp/ui-prefab-boundary-final-package-20261012.log、/private/tmp/snowb-compact-tests-20261012.log、/private/tmp/pro-ui-boundary-final-verify-20261012.log、/private/tmp/lite-host-slots-focus-verify-20261012.log。旧失败日志保留。
- Core 安装期间误将只含归档的 release 目录作为目录包，已恢复正确解压目录、验证 manifest 与 Host/Core 描述符、重启并安装成功；该失败不再是当前阻塞。
- 本轮验收范围是插件 UI、原操作入口、宿主槽位与离线包边界；未执行真实字体发布/资源导入的完整业务链路。self-delivery，checkpoint owner 与 integration owner 均为当前任务。本机实现与安装验收完成，尚无远端回读证据，不宣称最终远端交付完成；GitHub Actions 未核实。
