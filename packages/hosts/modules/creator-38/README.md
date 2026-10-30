# peanut-pod-lite-host

Creator **3.8.x** 原生扩展宿主。当前只有宿主与项目声明版本都精确为 **3.8.3** 或 **3.8.7** 时开放写操作，其它 3.8 版本只读。

发布产物以 Creator 3.8.3 自带的 Electron 13 / Node 14 为最低宿主基线：构建目标固定为 `node14`，移除
`node:` 内置模块前缀，并拒绝 `Object.hasOwn`、`String.prototype.replaceAll`、负索引 `Array.prototype.at`
和 `AbortSignal.timeout`。Creator 主进程未提供 `AbortController` 时，由 Core Hub 入口安装最小 polyfill。

账户请求在缺少全局 fetch 或 AbortController 时使用 Node HTTPS，不依赖 Core 初始化来提供网络传输。
账户请求总期限为默认 10 秒、可注入 1–30000 毫秒，覆盖完整响应体；响应上限 1 MiB，拒绝重定向，保持默认 TLS 校验。
退出、替换令牌或切换服务会使旧请求结果失效；切换规范 HTTPS 服务地址会清除旧令牌，同一地址保留会话。
现有入口是访问令牌登录，完整交互式登录仍需另行接入身份提供方；Node 协议测试不构成 Creator 面板或真实账户验收。

## JavaScript 边界

Creator 3.8 扩展入口要求 CommonJS JavaScript；`src/*.js` 与 `panel/*.js` 属于宿主协议代码，不是可迁移为浏览器 ESM 的通用业务源码。发布脚本使用 esbuild 将 Hosts、Engine 与 Protocol 打成自包含 CommonJS 产物，Electron 和 canvas 保持外部依赖。

Creator 3.8 的公开 `Editor.Package` 是扩展包查询门面，提供 `getPackages()` 等方法，不是内部 PackageManager 的 EventEmitter。宿主使用扩展 `load()` 完成后的单次 `getPackages({ name, enable: true })` 状态读回确认自身已启用；`unload()` 对称释放诊断。不要从扩展的 Node 模块作用域解析 Creator 应用内部的 `@editor/package`，也不要在 `Editor.Package` 上调用未公开的 `find/on/removeListener`。

## 打包

```bash
cd peanut-pod-lite
npm install
npm run pack --prefix packages/hosts/modules/creator-38
```

产物目录由根 `package.json` 的版本生成，例如
`packages/hosts/modules/creator-38/release/peanut-pod-lite-host-0.2.0/`。

安装到目标工程后必须重启 Creator；不能只执行 development reload。进程识别只接受精确匹配的 `--project` / `--path` 参数。
