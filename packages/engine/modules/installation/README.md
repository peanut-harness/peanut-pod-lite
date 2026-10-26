# @peanut/pod-engine/installation

`@peanut/pod-engine/installation` 负责插件包的打包、结构检查、安装规划、安装、升级、回滚和修复。

插件目录由 `SignedPluginCatalogVerifier` 验签后才能用于远程安装；`RemotePackageDownloader` 将归档写入调用方指定的隔离暂存区，并校验 SHA-256、大小和重定向策略。下载器不负责选择生产信任锚或写安装索引，索引只由 `PluginManagerApp` 的安装事务维护。Creator Host 会在 Pro 包触达下载器前检查最新服务端权益。当前仓库没有配置生产插件目录 URL/信任锚，验收目录仅用于隔离测试。

## 职责

- `pack`
- `inspect`
- `planInstall`
- `install`
- `upgrade`
- `uninstall`
- `repair`
- Pod 目录包 manifest、SHA-256 完整性与签名协议
- 项目活动索引与目录包的严格只读核验

## 公共入口

统一从包根导入：

```typescript
import { PackagingApp } from '@peanut/pod-engine/installation';
```

Pro 等外部消费者生成或校验 Pod 目录包时，从同一子路径导入自有协议 API：

```typescript
import {
    DirectoryPackageIntegrityProtocol,
    DirectoryPackageManifestValidator,
    PodSigningProtocol,
    ProjectPackageStore,
    type IDirectoryPackageFileRecord,
} from '@peanut/pod-engine/installation';
```

纯协议 API 处理规范化路径、摘要记录、最小 manifest 与固定字段签名；`ProjectPackageStore.resolveVerifiedActivePackage(pluginId, required)` 则只读核验项目索引、全部包载荷与活动身份，返回已验证入口或明确错误。未知、重复或损坏的索引不再视为空仓，修复前也不会清理旧工程的中断材料。正常安装与更新继续由 `PackagingApp` 的事务入口执行。

旧 `Cpm*` 导出暂为历史消费者提供字节兼容别名；Pod 新生产调用统一使用上述自有名称。现有 `peanut-plugins/installed.json` schema v2 与旧诊断资料不因 API 改名而自动重写。Pro 构建器与 Host 将按本变更后续任务切换，过渡期间保留别名。

跨仓发行签名使用
[`docs/signing-protocol-v1.md`](docs/signing-protocol-v1.md) 中的固定字段顺序。
`PodSigningProtocol` 校验 Pod 产品身份与远程插件目录；历史 CPM CLI 向量仅用于兼容测试。产品签名与目录签名继续使用不同的生产信任锚。

## 最小示例

```typescript
import type { IPluginManifest } from '@peanut/pod-protocol';
import { PackagingApp } from '@peanut/pod-engine/installation';

const packagingApp = new PackagingApp();
const manifest: IPluginManifest = {
    id: 'readme.packaging.plugin',
    version: '0.1.0',
    kind: 'tooling-plugin',
    displayName: 'README Packaging Plugin',
    main: './index.js',
    engines: {
        host: '^0.1.0',
    },
    activation: {
        autoActivate: false,
        events: [],
    },
    permissions: {},
};

const packResult = await packagingApp.pack('plugins/readme-packaging', manifest);
const installPlan = await packagingApp.planInstall(packResult.packagePath);
const installResult = await packagingApp.install(packResult.packagePath);
```

## 验证

```bash
npm run --workspace @peanut/pod-engine/installation typecheck
npm run --workspace @peanut/pod-engine/installation test
npm run --workspace @peanut/pod-engine/installation smoke
```

## 最小运行时导出器

仓库内的 Node 构建任务可复用 [minimal-runtime-exporter.mjs](scripts/minimal-runtime-exporter.mjs)，将多个构建目录复制为最小运行时目录，并自动生成 `runtime.manifest.json`（文件摘要、体积、跳过原因）。调用方负责声明各目录的保留规则；工具本身不绑定 SnowB、Vite 或 Cocos。

```javascript
import { exportMinimalRuntime } from '../@peanut/pod-engine/installation/scripts/minimal-runtime-exporter.mjs';

await exportMinimalRuntime({
    outputDirectory: 'release/minimal-runtime',
    sources: [
        {
            sourceDirectory: 'dist',
            targetDirectory: 'runtime',
            getSkipReason: (relativePath) => (relativePath.endsWith('.map') ? 'source_map' : null),
        },
    ],
    metadata: { profile: 'release' },
});
```

目录包的运行时入口固定为根目录 `<plugin-id>.bundle.js`，避免仅含一个文件的 `sources/` 目录。单面板插件统一使用 `panels/{embedded,standalone}`：两者都是完整模板，分别提供 `index.html`、`index.js`、`index.css`。Vite bundle、worker、wasm 等共用运行时资源放入 `libs/<panel-id>/`，两个模板均从此加载；宿主只加载 `panels/embedded/index.html`。Node 打包脚本可调用 [panel-package-layout.mjs](scripts/panel-package-layout.mjs) 的 `createPanelPackageLayout` 与 `createPanelTemplateAssets`；TypeScript 代码可通过 `PanelPackageLayout` 计算并校验相同路径。

## 边界

- 允许依赖 `@peanut/pod-protocol`
- 不接管插件激活、grant 注入和 panel 生命周期
- `runtime` 与 `plugin-manager` 通过其公共 API 对接，不应反向塞入宿主状态
