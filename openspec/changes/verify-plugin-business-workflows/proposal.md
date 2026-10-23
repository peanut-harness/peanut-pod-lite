# Proposal

## Why

统一紧凑 UI 已交付，但字体生成、保存重开、发布导入及控制器真实绑定尚未完成业务验收。需要在当前已安装候选上执行完整链路，并修复由实际失败证据定位的直接问题。

## What Changes

- 验证 Lite Host A/B/C 独立性、同插件重复加载保留编辑状态及重新打开初始化。
- 依次验证 UI Prefab 规则持久化与控制器绑定、SDF 生成导入、SnowB 保存重开与发布导入。
- 仅修复已复现的直接阻断，保持现有签名、身份、路径与包边界检查；按源码构建并正式安装后复测。
- 分别记录未执行、失败、通过与限制；最终通过定向及完整验证后提交、推送、回读远端 SHA。

## Capabilities

### New Capabilities

- `plugin-business-workflows`: Lite 宿主承载已安装插件的完整业务流程验收契约。

### Modified Capabilities

无。

## Impact

Lite 拥有 Host、工作台和 Host Controller 适配；Pro 拥有 UI Prefab、SDF、SnowB 业务实现。跨仓只使用已有 panel bridge、服务请求及目录包契约，不修改 Pro 的 Lite 子模块。当前 change 由 Lite 记录宿主集成验收；若直接修复落到 Pro，须先满足该仓规划门禁。

沿用当前紧凑 UI。测试只使用既有 cocos-plugin-verify 工程中的独立命名资源及可恢复备份。正式发布、远程目录、账号收费、其他仓库实现和内核协议扩展不在范围；扩展前须取得授权。失败时保留输入及日志，可通过备份恢复测试数据与原安装包。
