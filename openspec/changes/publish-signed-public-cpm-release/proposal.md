# Proposal

## Why

Lite 已能产出并实机验证 Creator Host 与 Core CPM 目录包，但公共 `cpm-install` 仍以空 release manifest 和失败关闭脚本拒绝安装，用户无法从公开入口获得可认证、可回滚的正式发行。现在需要把已有 Ed25519 清单、摘要校验和原子解包骨架接成真实发布闭环，使 Lite 的“可构建”状态升级为“可安全分发与安装”。

## What Changes

- 在 `cpm-install` 发布不可变的跨平台 CPM CLI runtime archive，并以固定信任锚验证 stable/beta release manifest 中的 Ed25519 签名、HTTPS 地址和 SHA-256；私钥、产品私有包与凭据不得进入公开仓库或发行物。
- 将 Bash/PowerShell 引导脚本从占位拒绝切换为真实原子安装：校验 release、下载 runtime、拒绝路径逃逸/链接/额外文件、切换 current 指针并在失败时清理或恢复上一可用版本。
- 为 Lite 建立版本一致、可重复校验的 Host/Core 发布输入和 CPM 消费契约；远端产品包必须经过发行真实性与目录包完整性两层校验，禁止把本地 tarball、手工复制或仅有 TLS 下载视为正式发行证据。
- 提供显式项目安装命令，将 Creator Host 与 `peanut.pod-lite` Core 安装到既定项目布局；Pro 缺失或安装失败不得阻塞 Lite Core 的安装、激活和回滚。
- 建立发布前门禁与独立验收：负向签名/摘要/归档安全测试、干净安装、升级、失败恢复、Creator 3.8.3/3.8.7 激活与身份一致性，以及 `peanut-agent-qa` 的仓外宿主证据。
- 更新公开安装文档和发布状态；只有全部门禁与线上 HTTPS 端点回读通过后，才允许将 `releases.json` 从空列表切换为非空 stable 发行。

## Capabilities

### New Capabilities

- `signed-cpm-distribution`: 定义公共 CPM CLI 的签名发行、固定信任锚、原子引导安装、Lite Host/Core 产品安装、升级回滚和独立发布验收契约。

### Modified Capabilities

- 无。

## Impact

- **Repositories:** `cpm-install`（公共引导、release manifest、CLI runtime 与发布门禁）、`peanut-pod-lite`（Host/Core 可发布输入、版本身份与 Creator 验收）、`peanut-agent-qa`（独立安装/激活证据）、`peanut-harness.github.io`（公开安装入口与状态文档）、`peanut-hub`（边界和知识同步）。
- **Public surfaces:** `https://get.peanut-harness.dev/cpm/` 下的引导脚本、manifest、runtime archive，以及 CPM CLI 的项目安装/升级命令。
- **Security boundary:** Ed25519 私钥仅存在于受控签名环境；公开仓仅保存公钥/信任锚和签名结果。发布失败、身份不一致或任一证据缺失时继续 fail-closed。
- **Compatibility:** 支持 Bash 环境与 Windows PowerShell；Lite 首批写入能力仍只按已验证的 Creator 3.8.3/3.8.7 开放，其它版本画像不因 CPM 发布而扩大。
