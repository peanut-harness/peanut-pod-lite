# @peanut/pod-engine/kernel

`@peanut/pod-engine/kernel` 是插件系统的业务主包，承载插件治理、host shell、hot reload 和 builtin plugin-manager panel 逻辑。

## 当前定位

- 这是主逻辑包，不是编辑器壳
- builtin plugin-manager panel 的模块、contracts 与 i18n 由本包管理
- `@peanut/pod-panel` 是所有面板静态资产的唯一源码源头，并负责 Cocos 编辑器壳层

## 推荐导入

```typescript
import { PluginManagerApp, PluginManagerHostShell } from '@peanut/pod-engine/kernel';
```

## 当前包含

- 插件治理与 runtime/panel bridge 主链路
- builtin plugin-manager panel module
- plugin-manager panel browser UI / contracts / i18n
- 面板业务控制器与宿主桥接

HTTP body reader 借用调用方的 `AsyncIterable`，仅显式调用既有 `iterator.next()`；超限或非法分块时保留原错误，不通过 `for await` 的提前结束动作销毁 IncomingMessage。实际 HTTP 层仍负责原安全拒绝 JSON、`connection: close` 和正常连接清理。文本完整编码请求上限 4 MiB、其它请求 128 KiB、UTF-8 原字节核对及原 schema/授权/owner/writer/取消语义保持；不采用 Node 14 无法支持的新增 iterator 选项。固定 Content-Length 与 chunked 的真实本机 HTTP 回归独立检查原拒绝码、监听 PID 和正常停止端口闭合；输入协议 unit 控制仅证明借用职责，不作 native 证明。Node 25 的离线结果仍不能外推 Creator、Node 14、全矩阵或 soak，必须另绑定新正式 Host/Core 实机。
