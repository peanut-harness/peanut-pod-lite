# Design

## Context

见 [proposal.md](proposal.md) 的动机。`cpm-install` 当前已经包含 schema v2 release manifest、Ed25519 验签、runtime manifest、摘要校验、受控 tar 解包和版本化安装目录，但 Bash/PowerShell 入口在解析 release 后仍固定退出 1，`releases.json` 为空，且信任锚依赖环境变量。Lite 已生成 Creator Host 与 `peanut.pod-lite` Core 目录包并在 3.8.3/3.8.7 验证，但打包版本仍分散在 manifest/脚本中，也没有可由公共 CPM 消费的产品发行索引。

规划工件保存在 Lite OpenSpec，但实现是跨仓交付：`cpm-install` 拥有公共 bootstrap/CLI 发行，Lite 拥有 Host/Core 构建与版本身份，`peanut-agent-qa` 拥有独立宿主验收，官网仅展示已验证入口。所有仓库均不得保存私钥或 Pro 私有载荷。

## Goals / Non-Goals

**Goals:**

- 建立从固定信任锚到 CPM CLI runtime，再到 Lite Host/Core 产品包的两层认证链。
- 让 Bash 和 PowerShell 在同一事务模型下完成首次安装、升级、失败清理与上一版本恢复。
- 统一 Lite Host/Core 的 release identity，使构建、产品清单、安装索引和 Creator `query-status` 可互相核对。
- 把 stable 发布拆成候选构建、签名审批、不可变上传、manifest 激活、公共端点回读和独立 QA 六个可审计阶段。

**Non-Goals:**

- 不在公开 `cpm-install` 仓库保存 Lite/Pro 二进制、账号凭据、授权策略或签名私钥。
- 不把 CPM 发布用于扩大 Creator 版本支持；首发写入仍只有 3.8.3 与 3.8.7。
- 不在本 change 实现 Pro 内容或订阅服务；只验证 Pro 缺失/失败不影响 Lite。
- 不把 GitHub tag、TLS、checksum 或本地 tarball 单独视为 release authenticity。

## Decisions

### 1. 使用分层签名与摘要，而不是让产品包复用 CLI 签名记录

公共 bootstrap 内置 CPM release Ed25519 公钥指纹/公钥，验证 CLI release manifest 的规范化字段；已验证的 CPM CLI 再验证产品 catalog 中的 Lite release 记录。每条产品记录绑定产品 id、版本、渠道、Host/Core URL、各自 SHA-256 与目录包 digest，并由独立用途的产品发布键签名。目录包自身的逐文件摘要继续由 Lite `CpmManifestValidator` 校验。

这样可以把“谁发布 CPM CLI”和“谁批准 Lite 产品候选”分离，并保留已有目录包完整性协议。备选方案是一个密钥签所有层级，但其爆炸半径过大；另一个方案是只依赖 HTTPS 与 SHA-256，但无法证明发布者身份。

签名 payload 必须采用固定字段顺序和 UTF-8 编码，并以测试向量锁定。私钥只通过受控 CI secret 或人工签名步骤提供；日志、artifact、缓存和 fork CI 不得获得私钥。公钥轮换需要双锚过渡 release，不能静默替换现有锚。

### 2. 发行物使用不可变、内容可回读的布局

CLI runtime 与产品包上传到带版本和摘要语义的不可变 HTTPS 路径；stable/beta manifest 只是可变指针，永不覆盖已发布版本字节。发布流程先上传候选并回读摘要，再签名/更新 manifest，最后从用户入口重新下载验证。

`cpm-install` 保持只存引导代码、公开清单和公钥；较大的 CLI/Product archive 由 release storage 承载。`get.peanut-harness.dev/cpm/` 提供引导脚本和清单，archive URL 可以指向同域或批准的 HTTPS release host，但必须受签名保护且禁止重定向、用户信息和 URL fragment。

### 3. Bootstrap 和产品安装共享 prepare/commit/verify/recover 事务模型

首次安装或升级按以下状态推进：

1. `resolved`：验签并固定 release identity；
2. `downloaded`：下载到唯一临时文件并验证 archive SHA-256；
3. `staged`：安全列举/解包，验证 runtime 或产品 manifest、文件集合与摘要；
4. `committed`：将不可变版本目录原子移入目标，并原子替换 current/installed 索引；
5. `verified`：运行版本查询或 Creator 宿主冒烟，写入不含秘密的 evidence；
6. `recovered`：任何失败清理本事务拥有的内容，并在可能时恢复旧指针。

事务 journal 只记录稳定身份、阶段和本事务拥有的路径，不记录 token、私钥或包内容。已有目标版本默认拒绝覆盖；只有摘要完全一致时可作为幂等成功。current 指针更新使用同目录临时文件与 rename，保留前一 snapshot 供恢复。若切换后无法证明恢复，返回 `may_have_changed`，不自动重试。

### 4. 公共脚本只负责安装并调用固定版本 CLI

`install.sh` 与 `install.ps1` 负责前置条件检查、取得 bootstrap 模块、验证并安装 CPM CLI、调用安装后 `version --json`，然后清理临时内容。它们不直接解析或安装 Lite 产品包，也不拼接项目的 `installed.json`。产品安装由已验证 CLI 的显式命令完成，例如对项目路径执行 Lite install/upgrade/repair；这避免两套安装器在安全和恢复语义上漂移。

正常用户不需要提供信任锚环境变量。测试可保留显式本地 manifest/archive 注入，但只有在测试模式与本地路径同时满足时启用，且不得成为公共 HTTPS 路径的降级开关。

### 5. Lite 生成单一 release identity 并输出机器可消费描述

Lite 根版本驱动 Core manifest、Creator Host package 版本与 release 目录名；打包结果额外生成 release descriptor，记录源 commit、版本、Host/Core archive 名、SHA-256、目录包 digest、支持画像和构建时间。descriptor 本身不声明“已发布”，只作为产品 catalog 签名输入。

打包必须可重复校验：同一 source/version 的语义载荷与目录包 digest 一致；时间戳、压缩元数据或绝对路径不得进入被比较的语义身份。Host 与 Core 版本或来源不一致时发布任务失败。已有 `query-status.artifacts` 继续作为 Creator 端实际加载身份，并与 descriptor/catalog 做闭环核对。

### 6. 发布采用两阶段激活与独立证据门禁

候选阶段在各自仓库完成测试并输出只读 artifact/evidence；集成阶段固定所有 SHA/digest，运行 Bash/PowerShell 干净安装、升级和破坏性负向 fixture，再在 Creator 3.8.3 与 3.8.7 执行 Host/Core 激活矩阵。`peanut-agent-qa` 从公共候选端点重新下载，不读取相邻工作区或构建目录。

只有证据矩阵完整时签名审批任务才能生成非空 stable entry。manifest 激活后必须从 `get.peanut-harness.dev` 回读脚本、清单和 archive，并重复最小干净安装。任一步失败则不改 stable；若已切换 manifest，则恢复上一经验证 manifest 或空列表。Git commit/push 成功本身不代表发布完成。

### 7. 跨仓集成顺序保持单一 owner

交付图按 `cpm-install` 安全 runtime、Lite release identity、产品安装器、QA/发布激活四段推进。各仓可在独立 worktree 开发，但共享 schema 与最终 SHA 由 integration owner 串行冻结；不得由多个 lane 同时改 `releases.json`、产品 catalog 或 Hub `sync.json`。最终提交顺序先合并不可激活的代码和空 manifest，再上传/验收候选，最后单独提交已签名 stable manifest 与公开文档。

## Risks / Trade-offs

- [引导脚本通过 HTTPS 下载验证代码，TLS 端点被错误配置可能替换 bootstrap] → 脚本内固定信任锚，release runtime 必须验签；部署回读同时校验脚本摘要，后续可再引入更小的内嵌验证器。
- [跨平台 tar/权限语义不同] → runtime manifest 不依赖 Unix mode 作为身份；Windows 与 macOS/Linux 分别运行真实安装 fixture，入口由 Node 调用而非假设可执行位。
- [签名 payload 序列化漂移导致客户端拒绝] → 固定字段序与测试向量，release signer 和 verifier 共享版本化协议 fixture，不签任意 JSON 文本。
- [跨仓版本冻结增加发布操作成本] → descriptor/catalog 自动校验 commit、版本和 digest；integration owner 只接受不可变 artifact，不从邻仓现场重建。
- [回滚可能遇到 Creator 进程占用扩展目录] → 安装前检查目标工程未被 Creator 占用；无法证明安全关闭时拒绝 commit，切换后失败则报告保守状态并停止自动重试。
- [首个 stable release 缺乏上一版本可回退] → manifest 激活前使用 beta/candidate 端点完成全矩阵；首发失败恢复为空 manifest 和无 current 的干净状态。

## Migration Plan

1. 在 `cpm-install` 合入固定信任锚、runtime builder/CLI、完整负向测试与仍为空的 `releases.json`；公共入口继续 fail-closed。
2. 在 Lite 统一版本源并生成 Host/Core release descriptor，验证既有 3.8.3/3.8.7 候选身份不漂移。
3. 实现 CPM 产品 catalog 与 Lite install/upgrade/repair 事务，在本地签名 fixture 和临时工程完成端到端测试。
4. 构建不可变 CPM CLI 与 Lite Host/Core 候选，上传 candidate/beta 路径并回读摘要；不更新 stable。
5. 运行 Bash/PowerShell、失败恢复、Creator 双版本与 `peanut-agent-qa` 独立验收，冻结 evidence manifest。
6. 通过受控签名步骤生成 stable entries，原子发布 manifest；从公共域回读并重复最小安装。
7. 更新官网、Lite 安装文档和 Hub 知识。若发布后验证失败，恢复上一 stable manifest；首发则恢复空列表，使公共入口重新 fail-closed。
