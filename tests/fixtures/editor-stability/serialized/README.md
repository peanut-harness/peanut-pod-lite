# 序列化资源夹具审计

本目录仅保存 task 4.1 的隔离输入、patch 与 coverage 行映射。`coverage-audit.json` 将 Creator 3.8.3 与 3.8.7 两份未变更草稿中的相关用例逐行列出；`fixture_mapped_static_only` 表示版本匹配的合法来源、显式依赖闭包、patch 和可检查读回规则齐备，绝不代表 Creator 原生导入或操作通过。

现有 Lumen bundle 的 Creator 3.8.3 Cube Prefab 与 `.meta` 原始 bytes 保留。它引用内置材质和 mesh 子资源，这 12 行仍为依赖未闭合的 candidate，不计完整映射；本轮不改其判定。

本轮仅收口 3.8.3 animationClip、animationGraph、animationMask。各自的资产和 `.meta` 与安装中的 `engine/editor/assets/default_file_content/` 来源逐字节一致；`3.8.3/animation-source-provenance.json` 保存 App/engine 版本与摘要、许可、原生类型注册和字段声明证据。AnimationMask 的类名通过 `CLASS_NAME_PREFIX_ANIM = 'cc.animation.'` 拼接；未以另一版源码替代。`CREATOR-ENGINE-LICENSE.md` 是安装中 MIT 许可的原始副本。

三类均为官方新建最小资产：Clip 没有轨道或事件；Graph 有一层和闭合的 Entry/Exit/Any 状态引用，无外部 UUID；Mask 没有关节或骨架引用。空列表来自官方模板，不是自行生成的占位文件，也不声称覆盖动画播放或骨架绑定。每类 10 行、合计 30 行具有静态完整映射。3.8.3 仍有 164/194 gap，3.8.7 保持原有 194/194 gap；全任务仍有 358/388 gap。

`inspector-patches.json` 记录真实公开字段输入；`animation-readback-rules.json` 给出各操作的类型、属性、UUID、登记和原始日志后验。冻结 `.meta` 中的 `imported:true` 是来源状态；其 `files` 为 importer 生成输出，不是夹具缺失的依赖。未来实机 staging 必须分配新根 UUID、重置导入状态，由 3.8.3 importer 生成输出，不得将安装模板 UUID 直接放入已有工程。

静态测试仅在临时目录通过现有 Lite 文档执行 patch、保存、重新读取及非法输入拒绝。执行：

```sh
TSX_TSCONFIG_PATH=tests/fixtures/editor-stability/serialized/animation-test-tsconfig.json \
  node --import tsx --test tests/fixtures/editor-stability/serialized/*.test.mts
```

测试配置仅把既有 assets 模块解析到其源码入口，以免测试要求在 owned paths 外生成 dist；没有 mock 产品 API。未启动 Creator，原生导入、Inspector 运行时和生命周期验收均待 task 4.3；不得把本目录结果写成共享 coverage 草稿中的通过状态。4.1 仍未完成。

## 本轮补充静态审计

以上 30/388 与 gap 数字属于原有审计基线。原 `coverage-audit.json`、动画来源、资产和 `.meta` 保持不变；本轮新增 `resource-fixtures.json`、`resource-coverage-audit.json` 与 `resource-readback-rules.json`，逐行补齐两版 15 类资产及其公开字段，共 388/388 静态映射。此结果只用于 task 4.1 的夹具验收，Creator 原生导入与 Inspector、生命周期验收仍属于后续任务，实机通过行数为 0。

`native-minimal/` 冻结同版本官方模板、MIT 许可及材质/shader 递归 include 依赖。Scene 使用官方 2D 模板，无外部 UUID；Prefab 使用官方最小节点模板，旧 Cube candidate 及其缺口保留。Flow/Stage 按各版本原生注册类的序列化默认值构造，patch 使用同版本 Stage 依赖。地形由既有产品 codec 生成完整 1×1 VERSION8 几何，并用独立二进制读取核对高度、法线、权重和图层；不采用 DEFAULT 空地形占位缓冲。

每份 `source-provenance.json` 绑定精确 App/engine 版本、声明摘要、公开字段摘录与原生 importer 布局。3.8.7 AnimationGraphVariant 有官方模板和类型声明，但冻结 ASAR 布局未列出独立 importer 模块，明确记为 `module_layout_absent_runtime_unverified`；不能据此推断原生支持或不适用，必须由后续实机任务核对。

所有测试仅在临时目录调用实际产品文档 API，检查 patch、save/reopen、根及自身子资源 identity、合法依赖和字段拒绝后无变更。旧测试迁为 `.mts` 以满足脚本格式门禁，内容 bytes 保持。命令沿用上面的 tsx 配置并以 `serialized/*.test.mts` 执行；不得将结果改写为共享 coverage 草稿的运行时通过。
