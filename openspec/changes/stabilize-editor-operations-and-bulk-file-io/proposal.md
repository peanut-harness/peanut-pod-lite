# Proposal

## Why

现有双版本长稳通过了资源调度、文本写入与 Prefab/Scene 原子创建，但缺少全量资源、组件属性和代码变更的实机闭环；3.8.7 启动和退出仍有原始警告。多文件写入已有 `asset.writeText.files`，缺少对应的公开内容读取，以及容量、冲突和逐文件结果契约。

## What Changes

- 按 Creator 3.8.3、3.8.7 的原生目录与 Lite schema 自动生成覆盖清单，覆盖资源生命周期、Inspector 属性、组件增删改与引用、TypeScript/JavaScript 内容修改、编译与重开；遗漏、缺夹具、跳过和未验证必须使全量验收失败。
- 有效操作要求原始日志零新增 warning/error、无未处理异常、真实 AssetDB 身份和引用正确；分别记录启动、操作、冷却和退出阶段，不增加过滤规则掩盖警告。
- 新增 `asset.readText`，支持单文件和有界多文件 UTF-8 内容读取，返回逐文件内容、字节数、摘要与 revision 一致性信息。
- 保持 `asset.writeText` 的原工具名和单文件/`files` 用法，补充全批预校验、资源闭包、容量上限、可选内容摘要前置条件、逐文件读回和失败状态；新建保持 AssetDB 发布、既有文件保持 UUID。
- **BREAKING**：原无独立容量限制的 `files` 输入改为有界请求；超限旧客户端需要按声明上限分片，不再允许无限数组或正文。
- 两版顺序运行同一新候选的全量矩阵、至少 100 文件分片批读写、30 分钟混合负载、10 分钟过载、冷却回收及正常退出。旧长稳证据只作基线。

## Capabilities

### New Capabilities

- `editor-operation-stability`: 全量资源、组件、代码及编辑器生命周期的零警告实机验收门禁。
- `bulk-text-file-io`: 项目资产源文本的有界多文件读取、写入、冲突检测、逐文件结果与保守失败状态。

### Modified Capabilities

- `mcp-write-task-execution`: 保持原 83 项工具与同步写入兼容，同时允许新增 `asset.readText`；业务目录变为 84 项，任务控制入口仍不算业务操作。

## Impact

影响 `packages/protocol`、Engine 的 policy/mcp/assets/lumen/runtime/kernel 边界、`creator-38` 宿主与验收脚本、相关文档与版本目录。原测试工程保持只读，继续使用隔离工程；真实日志、工程内容与设备路径不提交到产品仓。批量文本接口继续限于 `assets/`，二进制资源使用类型化导入/复制/Inspector 操作，不经 UTF-8 接口覆写。

## Non-goals

不修改 Creator 安装包，不扩展其它 Creator 补丁版本的写权限，不实现 Pro 付费执行、不签名上传或切换公开稳定版本。多文件提交不承诺 Creator 不支持的全批原子回滚；有效操作的零日志要求不撤销非法输入、无审批、超载等必要拒绝。
