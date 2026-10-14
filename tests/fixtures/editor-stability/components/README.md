# 组件输入配方与依赖审计

本目录属于任务 5.1。两版各保留 99 个策展组件与 795 个完整递归字段，包含现有公开 MeshRenderer 烘焙设置的 8 个子字段。`component-assembly-audit.json` 是来源和依赖审计；`component-field-fixtures.json` 是有效值、真实引用和错误类型的输入配方。字段、依赖缺失或原始摘要失配时拒绝生成，不使用空占位值。

`ComponentNativeSourceReader` 读取对应版本源码的 AST、导入别名、注册父类、`requireComponent`、编辑器类型标注和数值枚举，不执行引擎模块。装配顺序保留完整依赖闭包；缺声明、动态依赖、同名分支或依赖环阻止执行。Sorting2D 的抽象 UIRenderer 要求通过实际继承该类型的 Sprite 满足，不直接添加公共 API 已拒绝的抽象组件。

3.8.3 的 Sorting2D、UISkew 在安装源码中没有声明，仍保留全部字段和阻塞，不能据此标记原生不适用。来源分别为 364/366 个注册类、116/118 个组件声明；这些数字不是可挂载或实机通过数量，也不替代共享 inventory 中的动态注册及分支对照。

资源配方复用任务 4.1/4.2 已审计的真实输入与完整 SHA 闭包。mesh/skeleton 来自实际 glTF 子资源；不伪造输出文件或 AssetDB UUID。皮肤、骨架和动画名从源数据读取。VideoPlayer/WebView 的 URL 在本次隔离工程实际预览服务就绪后解析，不能猜端口或使用其它工程 URL。组件引用公开值保持既有 API 接受的路径字符串，装配类型单独记录。

物理后端、UI 场景、同源蒙皮层次、TiledMap 生成的内部组件及高质量渲染管线具有明确装配前置要求。这些要求尚须实际装配及原生端口验证；输入配方不等于完整原生夹具。5.1 当前保持未完成，`nativePassedRows` 始终为 0。

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
