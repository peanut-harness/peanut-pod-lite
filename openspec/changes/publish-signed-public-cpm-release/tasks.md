# Tasks

## 1. 冻结发行协议与基线

- [x] 1.1 `[repo: cpm-install] [paths: release-manifest.mjs, runtime-manifest.mjs, bootstrap.mjs, install.sh, install.ps1, tests/**] [depends: none] [serial] [owner: coordinator]` 记录当前空 manifest、脚本 exit 1、已有 Ed25519/runtime 校验和原子安装正负行为，补齐不会修改真实用户目录的基线 fixture；以仓库测试通过并保存稳定错误码清单验收。
- [x] 1.2 `[repo: cpm-install + peanut-pod-lite] [paths: protocol fixtures/schema docs] [depends: 1.1] [serial] [owner: coordinator]` 定义 CLI release 与 Lite product catalog 的规范化签名 payload、固定字段顺序、渠道、不可变版本和双锚轮换规则，提交跨仓共享测试向量但不提交私钥；以两仓 verifier 对同一向量给出一致结果、篡改任一受签字段均失败验收。
- [x] 1.3 `[repo: peanut-pod-lite] [paths: package.json, packages/engine/modules/creator-plugin/**manifest**, packages/hosts/modules/creator-38/package.json, scripts/**, tests/**] [depends: 1.2] [serial] [owner: coordinator]` 统一 Lite release version/source identity，定义 Host/Core release descriptor schema 与兼容画像字段，消除脚本内独立硬编码版本；以生成检查证明 Host、Core、目录名与 descriptor 版本一致且现有 83/45 catalog 不漂移验收。

## 2. 完成公共 CPM runtime 与原子引导安装

- [x] 2.1 `[repo: cpm-install] [paths: release-manifest.mjs, trust-anchor*, tests/release-manifest*] [depends: 1.2] [serial] [owner: coordinator]` 将正常公共路径绑定到固定 Ed25519 信任锚，保留仅测试可用的本地注入并实现双锚过渡校验；以缺锚、换锚、坏签名、字段篡改、重复版本和合法轮换测试验收。
- [x] 2.2 `[repo: cpm-install] [paths: cli/**, scripts/**, runtime-manifest.mjs, tests/**] [depends: 1.2] [parallel: cpm-runtime] [owner: cpm-runtime]` 构建最小跨平台 CPM CLI runtime 与确定性 `runtime.manifest.json`，实现 `version --json` 和稳定入口，不包含产品包、密钥或邻仓路径；以 archive 逐文件摘要、迁址运行、Bash/Windows Node 冒烟和秘密扫描验收。
- [x] 2.3 `[repo: cpm-install] [paths: bootstrap.mjs, transaction/journal modules, tests/bootstrap*] [depends: 2.1, 2.2] [serial] [owner: coordinator]` 完成 `resolved -> downloaded -> staged -> committed -> verified/recovered` 事务、同版本幂等、current snapshot 与失败恢复，拒绝路径逃逸、链接、特殊/隐藏/清单外文件；以首次安装、升级、每阶段故障注入和零暂存残留测试验收。
- [x] 2.4 `[repo: cpm-install] [paths: install.sh, install.ps1, tests/install*] [depends: 2.3] [serial] [owner: coordinator]` 让 Bash/PowerShell 入口实际安装已验证 CLI、执行 `version --json` 并返回结构化身份，移除固定失败占位但在空/坏 manifest 时继续零修改失败关闭；以 shell fixture、PowerShell fixture、空 manifest 和已安装升级测试验收。

## 3. 产出并安装经过认证的 Lite 产品包

- [x] 3.1 `[repo: peanut-pod-lite] [paths: scripts/pack-directory-plugin.mjs, packages/engine/modules/creator-plugin/scripts/pack-plugin.mjs, packages/hosts/modules/creator-38/scripts/pack-host.mjs, tools/**, tests/**] [depends: 1.3] [parallel: lite-artifacts] [owner: lite-artifacts]` 生成 Host/Core archive 与 release descriptor，固定语义身份且排除绝对路径和非确定时间/压缩元数据影响；以相同 source/version 双构建的 descriptor、目录包 digest 和 archive 文件清单一致验收。
- [x] 3.2 `[repo: cpm-install] [paths: product-catalog*, cli/**, tests/product-catalog*] [depends: 1.2, 3.1] [serial] [owner: coordinator]` 实现签名 Lite product catalog 的解析、固定产品信任锚、Host/Core 双 archive 摘要与目录包 digest 绑定，拒绝重定向、身份混搭和版本覆盖；以合法 catalog、逐字段篡改、Host/Core 交叉候选及重复版本测试验收。
- [ ] 3.3 `[repo: cpm-install] [paths: cli/**install**, transaction/**, tests/product-install*] [depends: 2.3, 3.2] [serial] [owner: coordinator]` 实现显式 Lite `install/upgrade/repair` 项目命令，检查 Creator 未占用工程，原子提交 Host 扩展、Core 不可变版本目录和 schema v2 活动索引；以干净安装、同版本幂等、升级、校验前失败 unchanged、切换后恢复与 `may_have_changed` fixture 验收。
- [ ] 3.4 `[repo: peanut-pod-lite + cpm-install] [paths: packages/engine/modules/installation/**, packages/hosts/modules/creator-38/**, cross-repo fixtures] [depends: 3.3] [serial] [owner: coordinator]` 对齐 CPM 安装结果与 Lite `ProjectPackageStore`/Host 加载契约，确保 `query-status.artifacts` 可核对 descriptor/catalog，且 Pro 缺失或失败只影响独立状态；以安装后加载、身份错配拒绝、Pro absent/failed 和修复路径集成测试验收。

## 4. 建立受控构建、签名与候选发布门禁

- [ ] 4.1 `[repo: cpm-install] [paths: release scripts/workflows, policy docs, tests/**] [depends: 2.4, 3.2] [serial] [owner: coordinator]` 建立 CLI runtime 构建、SBOM/许可证清单、不可变上传、回读摘要和受控 Ed25519 签名流程，确保 fork/普通 CI 无法读取私钥且日志/artifact 不泄密；以无密钥 dry-run、临时测试键签名、secret scan 和重复版本拒绝验收。
- [ ] 4.2 `[repo: peanut-pod-lite] [paths: release scripts/workflows, docs/INSTALLATION.md, tests/**] [depends: 3.1, 3.4] [serial] [owner: coordinator]` 建立 Lite Host/Core 候选构建、descriptor 校验、双 Creator profile 声明和产品 catalog 签名输入输出，发布过程只消费已验证 artifact 而不从邻仓现场重建；以 `npm run verify`、`npm run pack`、候选摘要回读和私钥缺失 fail-closed 验收。
- [ ] 4.3 `[repo: cpm-install + peanut-pod-lite] [paths: candidate release storage/evidence manifests] [depends: 4.1, 4.2] [serial] [owner: integration]` 上传不可变 candidate/beta CLI 与 Host/Core archive，冻结所有 URL、SHA、目录包 digest、source commit 与签名输入，但保持 stable manifest 不变；以从候选 HTTPS 端点回读全部字节并与 evidence manifest 完全一致验收。

## 5. 完成跨平台与 Creator 独立验收

- [ ] 5.1 `[repo: cpm-install] [paths: tests/e2e/**, release evidence] [depends: 4.3] [parallel: bootstrap-e2e] [owner: bootstrap-e2e]` 在干净 macOS/Linux Bash 与 Windows PowerShell 环境运行首次安装、升级、坏签名、坏摘要、恶意 archive、断点故障和恢复矩阵；以每个平台 current 身份正确、旧版本可恢复、失败路径零暂存残留验收。
- [ ] 5.2 `[repo: peanut-pod-lite + cpm-install] [paths: packages/hosts/modules/creator-38/scripts/**, release evidence] [depends: 4.3] [parallel: creator-e2e] [owner: creator-e2e]` 仅通过候选 CPM 对 Creator 3.8.3 与 3.8.7 干净工程安装 Lite，运行只读、审批写入和原子创建矩阵，证明 Host/Core/catalog 身份一致、83/45 能力不漂移、Pro 缺失不阻塞且日志零新增 error/warn。
- [ ] 5.3 `[repo: peanut-agent-qa] [paths: CPM independent-host workflow/evidence] [depends: 5.1, 5.2] [serial] [owner: independent-qa]` 从公开候选端点独立下载，不读取相邻 checkout 或本地 build，复验 CLI 安装、Lite 激活、失败恢复和证据脱敏；以仓外报告绑定同一 CLI/Host/Core digest 且无 token/私钥验收。

## 6. 激活 stable、回读并收口知识

- [ ] 6.1 `[repo: cpm-install] [paths: releases.json, signed product catalog, public endpoint evidence] [depends: 5.3] [serial] [owner: integration]` 通过受控审批生成首个非空 stable CLI/product entries，原子发布 manifest，并从 `get.peanut-harness.dev` 回读脚本、清单和所有 archive 后重复最小 Bash/PowerShell/Lite 安装；以远端字节与冻结 evidence 一致、安装零退出验收，失败则恢复上一 stable 或空 manifest。
- [ ] 6.2 `[repo: peanut-harness.github.io + peanut-pod-lite + cpm-install] [paths: public install docs, README.md, docs/INSTALLATION.md, knowledge/**] [depends: 6.1] [serial] [owner: integration]` 将公共文档从“尚未发布”切换为已验证安装命令、支持版本、失败恢复和安全边界，不宣传未验证平台或 Pro 能力；以链接检查、公开命令从干净环境成功及文档状态与 manifest 一致验收。
- [ ] 6.3 `[repo: peanut-pod-lite + cpm-install + peanut-agent-qa + peanut-hub] [paths: openspec/**, knowledge/**, knowledge/sync.json] [depends: 6.2] [serial] [owner: integration]` 执行各仓完整验证、OpenSpec strict validation、Hub RAG build/check-sync、Git 提交推送与远端 SHA 回读，归档最终 release/evidence 身份并确认无 `.rag/`、私钥、token 或未相关改动进入提交。
