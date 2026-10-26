# Spec Delta

## Purpose

为 PeanutPod 离线测试矩阵提供跨仓来源的可核对能力分母，使 Pro、Server 与 CPM 的公开目录、审阅记录及发行状态能按候选身份展示，同时阻止来源文件、历史测试或空清单被误算为当前产品验收。

## ADDED Requirements

### Requirement: Pro operations remain an independent source denominator

系统 SHALL 从调用方显式允许根读取 Pro 核心与高级操作目录，并按原始文件 SHA-256、仓库提交、目录版本和每个操作生成稳定能力项。系统 MUST 保留目录中没有用例映射的操作，不得以测试结果反推或缩小分母。

#### Scenario: Current Pro catalogs are bound
- **WHEN** 两个目录与候选仓库身份及声明摘要逐项一致
- **THEN** 核心和高级操作分别进入分母，重复或重叠项被显式拒绝或报告，不因目录存在而成为当前通过

#### Scenario: Catalog drift or missing root
- **WHEN** 目录字节变化、声明摘要不符或 Pro 根未提供
- **THEN** 漂移按既有引用规则拒绝，缺根标为来源缺口，旧目录项不得继续声明为当前完整分母

#### Scenario: New operation has no case
- **WHEN** 固定目录新增操作而输入未添加对应能力或用例
- **THEN** 报告保留新增操作为 unmapped，主线验收不能因此升级

### Requirement: Server route review binds implementation without host claims

系统 SHALL 仅接收带审阅者、限制和逐路由实现文件摘要引用的 Server 来源，并逐项核对当前可读字节。系统 MUST 将路由来源完整性、Actor 协议夹具和真实宿主验收分开表示。

#### Scenario: Reviewed route and implementation match
- **WHEN** 路由审阅记录、实现引用和候选 Server 提交可核对
- **THEN** 路由进入来源分母，并保留真实 Native 宿主、OIDC、PG 与 KMS 的未验证缺口

#### Scenario: Implementation missing or drifted
- **WHEN** 任一实现引用缺根、文件缺失或摘要改变
- **THEN** 对应来源不得宣称完整，不得把旧 VM/Node 测试升级为当前服务通过

### Requirement: CPM release manifest distinguishes source from availability

系统 SHALL 只读接收 CPM 公开 schema v2 清单，核对清单来源身份、渠道和有界发行项。系统 MUST 对空 stable `releases` 明确报告无可用公开发行，不得将来源完整或本地 bootstrap 测试计为成功安装。

#### Scenario: Empty stable manifest
- **WHEN** 当前 `releases.json` 的 stable 发行集合为空
- **THEN** 来源字节仍可被核对，公开安装可用性为 false，安装主线保持未验收

#### Scenario: Nonempty untrusted release
- **WHEN** 清单出现发行项但本工具没有固定信任锚签名、远端字节和独立安装回读的可信适配器
- **THEN** 发行仅作为待验证来源项展示，不被标为公开可用或产品通过

#### Scenario: Unsupported manifest or unsafe reference
- **WHEN** schema、渠道、字段、引用路径或文件边界不符合固定规则
- **THEN** 输入被拒绝或保留明确缺口，工具不执行安装器、不下载、不访问网络

### Requirement: Cross-product report keeps provenance and unfinished work visible

系统 SHALL 在稳定报告中分别列出来源完整性、未映射能力、未执行用例、证据状态和产品验收结果。系统 MUST 以相同候选与显式根重算出相同字节的 JSON/Markdown，不把来源绑定成功解释为主线完成。

#### Scenario: Three sources added to initial matrix
- **WHEN** Pro、Server、CPM 来源按候选快照接入，六条主线结果仍为空
- **THEN** 缺少来源仓库列表按实际绑定缩小，来源新增能力和 unmapped 仍可见，当前产品通过数保持零且 check-acceptance 返回未完成

#### Scenario: Historical proof is present
- **WHEN** 目录旁存在旧测试日志、旧变更回执或文档数字
- **THEN** 报告仅将其作为追踪入口或历史结果，不在没有受信原始证据适配器时计入当前通过
