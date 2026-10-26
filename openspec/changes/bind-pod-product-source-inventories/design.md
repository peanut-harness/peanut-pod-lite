# Design

## Context

见 `proposal.md`。前一变更 `add-pod-test-coverage-matrix` 已交付离线输入、独立分母、证据三轴和报告，但初始输入只固定 Lite 的策展索引；Pro、Server、CPM 在候选仓库表中出现却缺少各自的来源项，因此 `missingRepositories` 为三项。Pro 的 `catalog/core-operations.json` 有 84 项、`catalog/premium-operations.json` 有 15 项，两表当前无重叠。Server 账户 Actor 3.1/3.2 的真实宿主验收未完成。CPM 公共仓没有用于既有 `cpm-package` 适配器的 `package.json`；`releases.json` 为 schema v2、stable 渠道、空 `releases`。

## Goals / Non-Goals

**Goals:**

- 用已有 Pro 目录适配器和显式 Pro 根建立两份独立来源，不重新推断操作数。
- 将 Server 账户路由的人工审阅快照与实现文件 SHA 绑定，并保留迁移限制。
- 增加 CPM schema v2 的固定只读适配器，显式区分空 stable 清单与可用发行。
- 让初始报告显示真实跨仓分母和未映射项，保持六条主线零当前通过。

**Non-Goals:**

- 不完成 Server Native 宿主迁移，不运行真实账号、PG、OIDC 或 KMS。
- 不发布 CPM stable、不下载或安装产品、不运行 Creator、Pro 插件或输入命令。
- 不将 Pro 目录、Server VM 测试或 CPM 本地测试升级为产品通过；不修改外仓。

## Decisions

### 1. 固定来源类型而非通用文件扫描

Pro 直接用现有 `pro-core-catalog` / `pro-premium-catalog` 读入两个 JSON。初始输入新增各自 `sourceRef`、SHA、commit/tree 和显式根；导出的 99 个目录能力与 Lite 策展能力并存。当前只映射有实际主线定义的少量操作，其余保持 unmapped。这样新增操作自动暴露，避免手抄 84/15 或从测试数推断分母。

### 2. Server 使用 Lite 保存的审阅派生文件

`server-reviewed-routes` 的审阅 JSON 放在 Lite 的 `docs/testing/pod/`，`sourceRef` 指向 Lite 根，条目里的 `implementationRefs` 指向显式 Server 根。来源记录绑定候选 Server commit/tree，审阅文件自身另以 SHA 固定。条目至少覆盖账户 offer、subscription、checkout 的现有实现入口，限制字段明确指出 Actor VM 协议检查已存在、Native 宿主/HTTP/真实依赖仍未验收。任何实现引用漂移使该审阅过期。审阅记录是来源分母，不是服务运行证据。

### 3. CPM 读取真实公开 schema v2 清单

新增 `cpm-release-manifest-v2` 固定适配器，解析 `releases.json` 的 schemaVersion、channel、publicKey 和 releases 的受限结构。空 stable 清单产生一个“公开发行状态”来源项并标记 `available:false`；它不产生“安装通过”。非空发行项仅展示待验发行身份，在没有签名/远端/独立安装验证适配器时保持 unverified。现有 `cpm-package` 适配器继续服务真正含 `package.json` 的输入，不伪造公共仓文件。

### 4. 保持候选身份和报告语义

初始输入继续冻结 3.8.3/3.8.7 与四仓 commit/tree；添加 Pro、Server、CPM 来源摘要后重跑 validate/report/check-acceptance。分母完整性只表示来源审阅完整；99 个 Pro 操作中的未映射项使映射完整性仍为 false。报告保留原始量、不适用量、适用分母和三轴计数，当前通过仍为零。所有引用沿用 `PodCoverageInputReader` 的有界、禁 symlink、摘要核验规则。

## Risks / Trade-offs

- [Server 人工审阅会过期] → 逐实现文件摘要与候选提交绑定，漂移即拒绝完整性；保存审阅者和限制。
- [空 CPM 清单被误读为可安装] → 来源完整与发行可用分字段，空 stable 明确 false；签名和远端回读留给发行变更。
- [Pro 99 项大量 unmapped] → 保留逐项目录缺口，不为提高百分比创建无判据用例。
- [跨仓快照随其它任务变化] → 每项以已核对 commit/tree 和 SHA 固定，当前根字节变动需重新审阅，不在本变更中修改外仓。

## Migration Plan

先扩 CPM 固定适配器与负向测试，再建立 Server 审阅派生文件并核对实现引用，随后将三仓来源接入初始输入和报告。每步通过对应定向测试后推进；最终运行 Lite 必需完整验证、OpenSpec strict、差异检查和 scoped RAG。回退仅撤回新增适配器与输入快照，不迁移产品数据或历史结果。代码交付与产品验收分别记录；只有普通集成、推送和独立远端 SHA 回读完成才标为 remote-verified。
