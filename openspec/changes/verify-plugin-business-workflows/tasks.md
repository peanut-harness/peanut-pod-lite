# Tasks

本阶段由本次接手会话 self-delivery，checkpoint/integration owner 相同。外部测试工程只允许独立测试夹具与备份恢复；Pro 修复前须满足该仓规划门禁。所有步骤串行，共享 Creator 和安装状态。

## 1. 接管与准备

- [x] 1.1 `[peanut-pod-lite:openspec/changes/verify-plugin-business-workflows | depends:none | serial | owner:plugin-business-owner | requirements:plugin-business-workflows#独立槽位编辑 | non-goals:不改产品源码]` 核对总管接管、preflight 及主检出例外、远端基线、真实安装身份和工程备份；验收：设备证据记录实际结果，工程写入权限可用，备份可读取。

## 2. 槽位

- [x] 2.1 `[peanut-pod-lite:packages/hosts/modules/creator-38,apps/panel/plugin-host-controller | depends:1.1 | serial | owner:plugin-business-owner | requirements:plugin-business-workflows#独立槽位编辑 | non-goals:不重新设计UI或扩大权限]` 实机加载 A/B/C，未保存输入、关闭 A、重复加载 C、切换和重开；直接失败最小修复；验收：前后状态及请求证据，相关拒绝回归通过，测试编辑恢复。

## 3. UI Prefab

- [x] 3.1 `[peanut-pod-lite:packages/engine/modules/lumen,openspec/changes/verify-plugin-business-workflows | depends:2.1 | serial | owner:plugin-business-owner | requirements:plugin-business-workflows#规则与控制器可用 | non-goals:不在Lite实现Pro业务]` 验证独立规则保存重开、控制器生成、MCP与离线绑定、重复绑定和Creator导入；验收：规则回读一致、序列化引用和按钮事件正确、编译结果及边界拒绝有证据，完全相同按钮事件复绑仅保留一次；若需Pro修复先完成所属仓门禁。

## 4. SDF

- [x] 4.1 `[peanut-pod-lite:openspec/changes/verify-plugin-business-workflows | depends:3.1 | serial | owner:plugin-business-owner | requirements:plugin-business-workflows#SDF 生成导入 | non-goals:不增加新字体引擎]` 用有效字体短字符集验证支持的字段类型、生成预览保存回读、资源导入及窄短窗口；验收：有效图集和配置、Creator识别使用、错误状态准确。

## 5. SnowB

- [x] 5.1 `[peanut-pod-lite:packages/hosts/modules/creator-38,openspec/changes/verify-plugin-business-workflows | depends:4.1 | serial | owner:plugin-business-owner | requirements:plugin-business-workflows#SnowB 保存发布 | non-goals:不改公开内核协议或使用占位输出]` 新建、生成、保存、关闭重开、发布导入，复现后才补齐必要宿主适配；验收：工程数据保留、字体与纹理有效、Creator可用、提示与响应一致。

## 6. 验证与交付

- [ ] 6.1 `[peanut-pod-lite:packages/hosts/modules/creator-38,apps/panel/plugin-host-controller,openspec/changes/verify-plugin-business-workflows | depends:5.1 | serial | owner:plugin-business-owner | requirements:plugin-business-workflows#独立槽位编辑,plugin-business-workflows#规则与控制器可用,plugin-business-workflows#SDF 生成导入,plugin-business-workflows#SnowB 保存发布 | non-goals:不核验GitHub Actions或自动归档]` 完成受影响定向检查、build/pack与包边界检查、正式安装复测、完整verify、strict validate、diff及知识同步；验收：所有业务链路通过，提交推送后远端SHA与本地一致，回执明确未验证范围。
