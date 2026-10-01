# 版本化覆盖草稿

这两个 JSON 文件来自当前 Lite 策展目录、公开操作目录和对应 Creator 安装包的源码与 ASAR 头部。它们是待验收分母，不是运行时通过报告：全部目标为 `unverified`，全部用例为 `pending`，没有夹具或结果的项明确保留为空。

| Creator | 目标 | 必需用例 | importer 模块布局 | 原生组件声明 | 策展组件缺少声明 |
| --- | ---: | ---: | ---: | ---: | --- |
| 3.8.7 | 1,220 | 4,119 | 101 | 118 | 无 |
| 3.8.3 | 1,229 | 4,128 | 110 | 116 | `cc.Sorting2D`、`cc.UISkew` |

分母包括 38 类独立资产与 Prefab/Scene、99 个策展组件及其全部直接和已展开嵌套字段、节点字段、原生额外组件、84 个公开操作，以及 TypeScript/JavaScript 的单文件和批量读写、跨文件依赖、字段引用、编译、重开、预览。每个 importer 模块还有运行时注册对照项；布局保留辅助模块，其数量不能解释为支持的 importer 数量。抽象组件及同名声明分支保留在 inventory 中，后续需要当前版本的运行时证据确认适用性。

注册名称扫描识别直接装饰器、导入别名及命名空间写法，并只解析字符串、只读常量与有限模板组合，不执行源码。3.8.7 共解析 366 个注册名称，3.8.3 共解析 364 个；其中分别有 118/116 个可沿继承链确认的组件声明，不能把注册类总数解释为可挂载组件数。两版各有 4 个动态注册声明无法安全静态解析，它们的源码定位和独立运行时对照用例保留在分母中。

来源只保存版本化相对标识与摘要，不保存安装路径、源码正文或模块正文。`inventorySha256` 绑定完整分母，产品目录新增条目或来源变更会使旧清单失效。目录的文件存在性、继承声明或缺少声明都不能直接授权 `supported` 或 `not_applicable`。

在仓库根目录运行以下命令。`CREATOR_RESOURCES` 是所选版本安装包的 `Contents/Resources` 路径，`CREATOR_VERSION` 只能是 `3.8.3` 或 `3.8.7`。

```sh
node --import tsx tools/editor-stability/coverage-manifest-command.mts \
    --repository-root . \
    --creator-resources-root "$CREATOR_RESOURCES" \
    --creator-version "$CREATOR_VERSION" \
    --output-directory tests/fixtures/editor-stability/coverage \
    --check
```

去掉 `--check` 可在新的输出目录生成草稿。生成使用排他创建，已有文件不会被覆盖；更新基线应另存新证据并按任务授权审查。`--check` 重新读取当前安装包和产品目录，逐字核对输出，目录变化时失败。

`CoverageManifestValidator` 接受未知清单、独立重新读取的 inventory 和可信证据读取端口。它保留完整分母，拒绝缺项、重复、跳过、未知字段、无夹具、缺依赖闭包、读回规则不匹配、跨版本结果以及新增警告或错误。只有对应版本的 `runtime_catalog` 来源能确认原生可用性；不适用项也需真实原生结果和完整日志证据。端口必须独立解析实际夹具和原始验收结果，不能把清单的状态复制成证明。当前单元测试使用合成内存证明，仅验收校验器；真实夹具解析、运行时目录与原生日志证明由后续实机任务提供。
