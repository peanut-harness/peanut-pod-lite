# peanut-pod-lite-host

Creator **3.8.x** 原生扩展宿主。当前只有宿主与项目声明版本都精确为 **3.8.3** 或 **3.8.7** 时开放写操作，其它 3.8 版本只读。

发布产物以 Creator 3.8.3 自带的 Electron 13 / Node 14 为最低宿主基线：构建目标固定为 `node14`，移除
`node:` 内置模块前缀，并拒绝 `Object.hasOwn`、`String.prototype.replaceAll`、负索引 `Array.prototype.at`
和 `AbortSignal.timeout`。Creator 主进程未提供 `AbortController` 时，由 Core Hub 入口安装最小 polyfill。

## JavaScript 边界

Creator 3.8 扩展入口要求 CommonJS JavaScript；`src/*.js` 与 `panel/*.js` 属于宿主协议代码，不是可迁移为浏览器 ESM 的通用业务源码。发布脚本使用 esbuild 将 Hosts、Engine 与 Protocol 打成自包含 CommonJS 产物，Electron 和 canvas 保持外部依赖。

## 打包

```bash
cd peanut-pod-lite
npm install
npm run pack --prefix packages/hosts/modules/creator-38
```

产物目录由根 `package.json` 的版本生成，例如
`packages/hosts/modules/creator-38/release/peanut-pod-lite-host-0.2.0/`。

安装到目标工程后必须重启 Creator；不能只执行 development reload。进程识别只接受精确匹配的 `--project` / `--path` 参数。
