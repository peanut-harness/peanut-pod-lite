# Task 4.2 媒体输入与依赖审计

本目录保存本 task 程序化原创的输入、来源版本、文件摘要、完整文件依赖闭包、两版 importer 布局差异和逐用例 gap。来源版本为 `peanut-task42-media/1.0.0`，原始像素、字形 A、正弦音、几何及关节动画、地图和纯色视频均由 `build-fixtures.py` 创建，没有复制第三方图像、字体或音视频载荷。格式规范的版本及链接、视频的实际 FFmpeg 编码器版本、每个文件的格式和 SHA-256 见 [catalog.json](catalog.json)。

| 输入 | 格式和有效载荷 | 文件依赖闭包 |
| --- | --- | --- |
| 图片 | PNG，8×8 RGBA 棋盘像素，完整 CRC/zlib 数据 | checker.png |
| 音频 | RIFF WAVE PCM，单声道 16-bit/8 kHz、1 秒 440 Hz | tone.wav |
| 模型 | glTF 2.0，三角形、法线、UV、材质贴图、单关节 skin、两关键帧位移动画 | triangle.gltf → triangle.bin、checker.png |
| 位图字体 | BMFont text，原创 A 字形和真实透明图片页 | one-glyph.fnt → glyph.png |
| 地图 | TMX/TSX 1.10，2×2 地图、有效 GID 和外部 tileset | two-by-two.tmx → one-tile.tsx → checker.png |
| 视频 | MP4/H.264，16×16 yuv420p、4 帧、1 秒 | blue.mp4 |
| Buffer | glTF accessor 真正使用的二进制几何/skin/动画数据 | triangle.bin；解释布局在 triangle.gltf |
| Bundle 目录候选 | 非空文件夹及有效 PNG | assets/bundle/checker.png；原生 Bundle metadata 尚缺 |

这些文件是标准格式候选；Creator 3.8.3/3.8.7 的精确版本来源/导入、AssetDB UUID/子资源、Inspector 值和原始日志证据均为空。文件解码、标准结构检查及文件引用闭包不能赋予原生导入或 operation 通过状态。`bundle-intent.json` 只记录待实施的 Inspector 设置，不伪造 `.meta`、UUID 或原生配置。

## 覆盖与缺口

[coverage-audit.json](coverage-audit.json) 对照未改动的版本化 inventory，记录 21 个媒体资产根、其全部资产字段，以及两版全部 importer 布局对照行。3.8.3 为 472 行，3.8.7 为 463 行，共 935 行；两版分别有 96 行关联标准格式候选，完整映射均为 0。每行仍为 `gap`，保留 `nativeResult: null`，不减少分母，不将跳过或静态文件标为通过。

| gap | 具体依赖 |
| --- | --- |
| `creator_version_bound_native_evidence_missing` | 每版当前运行的源/导入证据及版本绑定；标准输入的独立来源版本已在 catalog 保存 |
| `native_registration_and_raw_log_evidence_missing` | 真实 importer 注册、AssetDB 身份、相关阶段原日志 |
| `missing_type_specific_fixture_and_dependency_closure` | autoAtlas、cubeMap、DragonBones/atlas、labelAtlas、particle、Spine、spriteAtlas、TrueType 等专有或 importer 特定来源及完整依赖 |
| `gltf_contains_source_data_but_native_derived_asset_mapping_missing` | glTF 含 mesh、skin、材质和动画源数据，但 mesh、skeleton、instantiationAnimation/Material 的原生派生子资源映射尚缺 |
| `bundle_native_metadata_and_uuid_missing` | 两版 directory/Bundle 的原生 metadata、UUID、配置读回 |
| `native_inspector_value_and_reference_mapping_missing` | 全部媒体资产字段的同版 Inspector patch/读回和 UUID 引用装配 |

[importer-diff.json](importer-diff.json) 保留 3.8.3 的 110 项和 3.8.7 的 101 项模块布局：共同 101 项，3.8.3 独有 9 项，3.8.7 独有 0 项。差异包括 animation-graph-variant、meshSimplify、image 辅助模块及迁移/uv-unwrap；辅助和迁移模块保留在分母中，模块数量不能解释为支持的 importer 数量，也不能据另一版缺少模块认定不适用。

## 静态检查

在仓库根目录执行：

```sh
python3 -B tests/fixtures/editor-stability/media/test_media_fixtures.py
```

9 项检查核对所有文件摘要和源版本、独立解析完整依赖闭包、PNG CRC/像素、PCM 样本、glTF accessor/几何/skin/动画/材质引用、BMFont 图片页/字形边界、TMX/TSX/GID、FFprobe 视频参数和 FFmpeg 完整解码、两版逐行分母与 importer 集合差异。负面检查拒绝损坏/截断 PNG、越界 glTF accessor、缺依赖及路径逃逸。

输入可通过 `python3 -B tests/fixtures/editor-stability/media/build-fixtures.py` 在本目录重新生成，须具备 Python 3、FFmpeg（libx264）及 FFprobe。生成会记录实际编码器版本并更新摘要，编码日志写 `/private/tmp/pod-lite-task42-encode.log`；不读取或修改旧 Creator campaign。

4.2 保持未完成。继续验收需要两版真实 importer/UUID 证据、缺失类型的可追溯源输入及依赖、Bundle 原生 metadata、各字段读回规则与结果。该依赖应由后续登记提供，本 task 未运行 Creator。

## 本轮补充与当前源码对照

上面的 gap 与 935 行是保留的旧审计基线。新增 `supplemental-catalog.json` 为全部 21 类媒体资产提供合法源输入、版本来源及闭包：原创 TrueType A 字形、单骨骼 Spine JSON/atlas 和 DragonBones JSON/atlas、真实 PNG 页、SpriteAtlas/Particle plist、完整 RGBE HDR，以及两版官方 AutoAtlas/LabelAtlas 源与 metadata 模板。原 PNG/WAVE/glTF/BMFont/TMX/MP4 及旧审计 bytes 未改。

Mesh、Skeleton、InstantiationAnimation/Material 精确指向已有 glTF 的 primitive、skin、animation、material 数据；不制造伪二进制派生文件。CubeMap 使用真实 16×8 RGBE 源及同版本安装模板的 texture-cube metadata 来源。Bundle 记录原生创建及真实 metadata 查询后的设置步骤；LabelAtlas 的官方源是零字节 marker，资源数据由 metadata 和真实字形图片提供，后续必须绑定原生 SpriteFrame UUID。全部模板 UUID 都是冻结来源，不能作为本 change 的 AssetDB 结果，也不能直接复用到实机工程。

`current-source-drift.json` 保留当前重算与旧分母的区别：两版 `audio.downloadMode` 现为只读，删除旧 set/reject_invalid 并新增 reject_write；源码与安装集合摘要也已变。旧共享草稿仍为 4128/4119 全量用例，当前重算为 4127/4118；其同步未在本包范围内完成。补充媒体 scope 为 3.8.3 的 471 行与 3.8.7 的 462 行，共 933 行，其中每版 361 行映射合法源/闭包，余下 110/101 行保留 native importer 注册待验。序列化 194/194 用例集合不变。绝不将旧分母、静态映射或标准解析判为实机通过。

新增独立格式检查：`python3 -B tests/fixtures/editor-stability/media/test_supplemental_fixtures.py`。它读取完整 TrueType 表 checksum/cmap/字形和度量、128 个实际 RGBE 像素、骨骼/slot/region/动画及 atlas 依赖、plist、glTF 派生数据、模板配置、缺文件/逃逸拒绝及当前差异。两版自带的明文 DragonBones 数据解析库可在 Node 中运行 `node --import tsx tests/fixtures/editor-stability/media/native-media-parse.mts /private/tmp/task42-dragonbones.json`；这只解析数据，没有 Creator/importer 执行。未复制其库到仓库。

生成原创 TrueType 需要 fontTools 4.66.1；本轮仅装入 `/private/tmp` 的工具依赖，不改根 package/lockfile。`build_supplemental_fixtures.py` 读取精确版本的安装源和已有 `current-source-drift.json`，不覆盖旧资产或共享草稿。原检查 9/9、新增检查 10/10 及两版 DragonBones 数据 parser 通过；4.2 的离线夹具/闭包验收齐备。原生登记、全部字段/UUID 读回及 raw 日志仍由后续任务执行，runtime passed 始终为 0。
