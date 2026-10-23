## Purpose

提供当前 Creator 编辑器视口的真实状态查询及经授权的相机聚焦、2D/3D和网格控制，让 AI 和用户能区分目标选中、消息受理与实际视口状态已验证，且不修改场景资产或场景相机组件。

## ADDED Requirements

### Requirement: Version-probed viewport observation
系统 SHALL 按精确宿主版本返回视口状态和逐字段查询、修改、验证能力，不支持的字段必须明确报告；不得以旧缓存代表手动修改后的状态。

#### Scenario: Manual mode change
- **WHEN** 用户手动切换视口模式后再次查询
- **THEN** 返回真实新状态；不可用接口明确报告不支持

### Requirement: Authorized verified viewport mutation
系统 SHALL 仅在已验证3.8.3或3.8.7宿主及有效本地审批租约下修改视口，并提供逐字段读回验证及部分失败；聚焦不能以选区改变代替。

#### Scenario: Focus target nodes
- **GIVEN** 当前场景中有明确UUID或无歧义路径的节点
- **WHEN** 授权聚焦目标
- **THEN** 取得相机或视锥等文本宿主证据才返回verified；仅受理返回accepted_unverified，不报告任务已验证成功

#### Scenario: Invalid version target or partial failure
- **WHEN** 版本未经验证、节点不存在/歧义/已删除，或某设置失败
- **THEN** 拒绝未经验证写入或精确报告失败字段，不盲目重放，不自动回滚其它成功字段

#### Scenario: Assets remain unchanged
- **WHEN** 聚焦或修改模式与网格完成
- **THEN** Scene/Prefab及meta源摘要和场景相机组件保持不变，不触发保存对话框
