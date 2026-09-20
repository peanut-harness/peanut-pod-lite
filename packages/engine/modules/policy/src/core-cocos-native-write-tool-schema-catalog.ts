import { CoreCocosNativeWriteCapabilityCatalog, type CoreCocosNativeWriteOperation } from './core-cocos-native-write-capability-catalog.js';
import type { ICoreMcpJsonSchema } from './core-cocos-mcp-read-tool-schema-catalog.js';

/**
 * @description 已完成精确入参迁移的 Cocos 原生写工具 schema，覆盖公开账本中的全部原生写入；每个会改变编辑器或项目状态的工具都携带本地审批字段。
 */
export class CoreCocosNativeWriteToolSchemaCatalog {
    private static readonly schemas: ReadonlyMap<CoreCocosNativeWriteOperation, ICoreMcpJsonSchema> = CoreCocosNativeWriteToolSchemaCatalog.buildSchemas();

    public find(operation: unknown): ICoreMcpJsonSchema | null {
        const capability = CoreCocosNativeWriteCapabilityCatalog.find(operation);
        return capability == null ? null : (CoreCocosNativeWriteToolSchemaCatalog.schemas.get(capability.operation) ?? null);
    }

    public operations(): readonly CoreCocosNativeWriteOperation[] {
        return Object.freeze([...CoreCocosNativeWriteToolSchemaCatalog.schemas.keys()]);
    }

    private static buildSchemas(): ReadonlyMap<CoreCocosNativeWriteOperation, ICoreMcpJsonSchema> {
        const schemas = new Map<CoreCocosNativeWriteOperation, ICoreMcpJsonSchema>();
        const control = (): Readonly<Record<string, ICoreMcpJsonSchema>> => ({ approvalId: this.string('本地审批租约 ID（与 approvalToken 等价，指向同一 McpApprovalLeaseStore 租约）。'), approvalToken: this.string('本地审批租约 token（与 approvalId 等价；双传时优先 approvalId）。'), confirmDestructive: this.boolean('破坏性写确认（Hub/Lite 对齐；risk=destructive 时需为 true）。'), resources: this.stringArray('可选声明资源；宿主仍从业务字段推导，最终授权=推导∪声明且均须⊆lease（归一后精确匹配，无前缀；assets↔db://assets）'), execution: this.object({ mode: this.enum(['sync', 'async'], '默认 sync；仅显式 async 提前返回 queued。'), idempotencyKey: this.string('同 owner、工程与 capability 范围内的幂等键。'), timeoutMs: this.integer('受控超时毫秒数。') }) });
        schemas.set('editor.setSelection', this.object({ paths: this.stringArray('节点路径列表（优先）。'), ids: this.stringArray('节点 uuid / id 列表。'), clear: this.boolean('为 true 时清空选区。'), ...control() }));
        schemas.set('asset.catalog.refresh', this.object(control()));
        schemas.set('asset.import', this.object({ sources: this.stringArray('待导入的源文件路径列表。'), target: this.string('目标 db://assets/... 目录。'), mode: this.string('覆盖模式；override 等价 overwrite:true。'), overwrite: this.boolean('是否覆盖已有资源（destructive）。'), dependencyMap: this.freeObject('显式依赖表。'), concurrency: this.integer('层内并发度（1–8）。'), refreshAfter: this.boolean('层后是否刷新并等待 AssetDB；默认 true。'), allowMissingDependencies: this.boolean('是否允许缺失依赖继续；默认 false。'), expandClosure: this.boolean('是否展开依赖闭包；默认 true。'), planId: this.string('asset.importPlan 返回的 planId；受管模式建议提供。'), ...control() }, ['sources', 'target']));
        schemas.set('asset.replaceReferences', this.object({ fromUuid: this.string('被替换 uuid（可带 @sub）。'), toUuid: this.string('目标 uuid（可带 @sub）。'), pathContains: this.string('路径子串过滤。'), dryRun: this.boolean('只报告不写盘。'), allowMissingTarget: this.boolean('允许目标 uuid 不在 catalog。'), refreshIndex: this.boolean('强制重建依赖索引。'), ...control() }, ['fromUuid', 'toUuid']));
        schemas.set('asset.open', this.object({ uuid: this.string('标准或压缩 uuid。'), path: this.string('db:// 或相对路径。'), url: this.string('与 path 同义。'), ...control() }));
        schemas.set('asset.copy', this.object({ paths: this.stringArray('待复制资源相对路径列表（种子；依赖闭包会一并复制并换新 uuid）。'), targetDirectory: this.string('复制产物根目录（db://assets/... 或工程相对路径）。'), ...control() }, ['paths', 'targetDirectory']));
        schemas.set('asset.move', this.object({ from: this.string('源相对路径（文件或文件夹）。'), to: this.string('目标相对路径；不得已存在。'), ...control() }, ['from', 'to']));
        schemas.set('asset.rename', this.object({ path: this.string('待重命名资源相对路径（文件或文件夹）。'), newName: this.string('新文件/文件夹名（不含路径分隔符）。'), ...control() }, ['path', 'newName']));
        schemas.set('asset.createFolder', this.object({ path: this.string('待创建文件夹相对路径；缺失的父目录会一并创建。'), ...control() }, ['path']));
        schemas.set('asset.delete', this.object({ paths: this.stringArray('待删除资源相对路径列表（文件或文件夹，递归）。'), ...control() }, ['paths']));
        schemas.set('asset.reimport', this.object({ paths: this.stringArray('可选相对路径列表；省略则刷新 db://assets。'), path: this.string('单路径别名；会并入 paths。'), ...control() }));
        schemas.set('asset.writeText', this.object({ path: this.string('单文件相对路径（assets/...）；与 files 二选一。'), content: this.string('单文件 UTF-8 内容；与 path 成对。'), files: { type: 'array', description: '批量文本文件；提供时忽略 path/content。', items: this.object({ path: this.string('相对路径（assets/...）。'), content: this.string('UTF-8 文本。') }, ['path', 'content']) }, ...control() }));
        schemas.set('asset.ensureSpriteFramesBatch', this.object({ dbPaths: this.stringArray('db://assets/... 或 assets/... 的 PNG 路径列表。'), refreshRoot: this.string('可选批量刷新根；省略则逐项 refresh-asset 并等待就绪。'), ...control() }, ['dbPaths']));
        schemas.set('scene.restoreEditorResource', this.object({ uuid: this.string('资源 uuid；与 url 至少一个，或都省略表示恢复「当前」。'), url: this.string('资源 url / db 路径。'), ...control() }));
        schemas.set('scene.open', this.object({ path: this.string('场景 db:// 或项目相对路径。'), ...control() }, ['path']));
        schemas.set('scene.save', this.object({ path: this.string('可选场景路径；省略时保存当前打开场景。'), ...control() }));
        schemas.set('scene.reload', this.object({ soft: this.boolean('是否软重载；默认 true。'), ...control() }));
        schemas.set('scene.focusNode', this.object({ path: this.string('节点路径或 uuid。'), ...control() }, ['path']));
        schemas.set('scene.createNode', this.object({ parentPath: this.string('父节点路径；省略时挂场景根。'), name: this.string('节点名。'), type: this.string('类型提示：empty / Camera / Light 等。'), ...control() }));
        schemas.set('prefab.createFromNode', this.object({ nodePath: this.string('源节点路径或 uuid。'), prefabPath: this.string('目标 Prefab db://assets/.../*.prefab。'), ...control() }, ['nodePath', 'prefabPath']));
        schemas.set('prefab.apply', this.object({ nodePath: this.string('实例根节点路径或 uuid。'), ...control() }, ['nodePath']));
        schemas.set('prefab.revert', this.object({ nodePath: this.string('实例根节点路径或 uuid。'), ...control() }, ['nodePath']));
        schemas.set('prefab.unpack', this.object({ nodePath: this.string('实例根节点路径或 uuid。'), ...control() }, ['nodePath']));
        schemas.set('prefab.unlink', this.object({ nodePath: this.string('实例根节点路径或 uuid。'), ...control() }, ['nodePath']));
        schemas.set('preview.refresh', this.object({ refreshAssets: this.boolean('是否同时请求 AssetDB refresh；默认 true。'), ...control() }));
        schemas.set('builder.build', this.object({ platform: this.string('平台 id（如 web-desktop）。'), options: this.freeObject('可选构建配置覆盖（透传 Creator）。'), ...control() }, ['platform']));
        const prefabPath = (): ICoreMcpJsonSchema => this.string('项目相对路径；禁止绝对路径与 ..；也可用 assetRelativePath 别名。');
        const assetAlias = (): ICoreMcpJsonSchema => this.string('prefabRelativePath 的别名；二者同时提供时必须相等。');
        const nodePath = (description: string): ICoreMcpJsonSchema => this.string(description);
        const autoCommit = (): ICoreMcpJsonSchema => this.boolean('为 true 时写盘后自动执行 lumen.commit。');
        schemas.set('lumen.scaffold', this.object({ prefabRelativePath: prefabPath(), assetRelativePath: assetAlias(), rootName: this.string('根节点名。'), template: this.string('模板 id，如 empty / ui/Label / standard / forward。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), reset: this.boolean('目标已存在时先删源文件与 .meta 再重建；默认 false。'), ...control() }));
        schemas.set('lumen.structure', Object.freeze({ type: 'object', properties: Object.freeze({ prefabRelativePath: prefabPath(), parentPath: nodePath('父节点路径，必须以 / 开头。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }), required: Object.freeze(['prefabRelativePath', 'parentPath', 'recipe']), additionalProperties: true }));
        schemas.set('lumen.nodeAdd', this.object({ prefabRelativePath: prefabPath(), parentPath: nodePath('父节点路径，必须以 / 开头。'), template: this.string('模板 id。'), name: this.string('可选子节点名。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'parentPath', 'template']));
        schemas.set('lumen.nodeRm', this.object({ prefabRelativePath: prefabPath(), nodePath: nodePath('要删除的节点路径，必须以 / 开头。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'nodePath']));
        schemas.set('lumen.nodeRename', this.object({ prefabRelativePath: prefabPath(), nodePath: nodePath('节点路径，必须以 / 开头。'), name: this.string('新名称。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'nodePath', 'name']));
        schemas.set('lumen.nodeReorder', this.object({ prefabRelativePath: prefabPath(), parentPath: nodePath('父节点路径，必须以 / 开头。'), childName: this.string('子节点名。'), index: this.integer('目标下标（从 0 起）。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'parentPath', 'childName', 'index']));
        schemas.set('lumen.compAdd', this.object({ prefabRelativePath: prefabPath(), nodePath: nodePath('节点路径，必须以 / 开头。'), builtinType: this.string('内置组件类型；与 scriptName 二选一。'), scriptName: this.string('脚本路径或文件名。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'nodePath']));
        schemas.set('lumen.compRm', this.object({ prefabRelativePath: prefabPath(), nodePath: nodePath('节点路径，必须以 / 开头。'), componentType: this.string('组件类型。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'nodePath', 'componentType']));
        schemas.set('lumen.compSet', this.object({ prefabRelativePath: prefabPath(), nodePath: nodePath('节点路径，必须以 / 开头。'), componentType: this.string('组件类型。'), props: this.freeObject('白名单内的组件属性补丁对象。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'nodePath', 'componentType', 'props']));
        schemas.set('lumen.assetSet', this.object({ prefabRelativePath: prefabPath(), assetRelativePath: assetAlias(), props: this.freeObject('独立资产 Inspector 字段补丁对象。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['props']));
        schemas.set('lumen.nodeSet', this.object({ prefabRelativePath: prefabPath(), nodePath: nodePath('节点路径，必须以 / 开头。'), props: this.freeObject('节点属性补丁对象。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'nodePath', 'props']));
        schemas.set('lumen.bindClick', this.object({ prefabRelativePath: prefabPath(), buttonNodePath: nodePath('Button 节点路径，必须以 / 开头。'), targetNodePath: nodePath('目标节点路径，必须以 / 开头。'), component: this.string('脚本路径、文件名、uuid 或唯一 @ccclass。'), handler: this.string('回调方法名。'), customEventData: this.string('自定义事件数据。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'buttonNodePath', 'targetNodePath', 'component', 'handler']));
        schemas.set('lumen.bindSprite', this.object({ prefabRelativePath: prefabPath(), nodePath: nodePath('Sprite 节点路径，必须以 / 开头。'), spriteFrameUuid: this.string('SpriteFrame uuid。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'nodePath', 'spriteFrameUuid']));
        schemas.set('lumen.bindSpriteBatch', this.object({ prefabRelativePath: prefabPath(), assetRelativePath: assetAlias(), bindings: this.array('绑定项列表，元素含 nodePath 与 spriteFrameUuid。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'bindings']));
        schemas.set('lumen.bindRef', this.object({ prefabRelativePath: prefabPath(), assetRelativePath: assetAlias(), nodePath: nodePath('持有字段的节点路径。'), componentType: this.string('组件类型。'), field: this.string('字段名。'), nodeRef: this.string('节点引用路径；与 componentRef 二选一。'), componentRef: this.freeObject('组件引用 { nodePath, type }；与 nodeRef 二选一。'), cocosVersion: this.string('可选 Creator 版本覆盖。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'nodePath', 'componentType', 'field']));
        schemas.set('lumen.bindController', this.object({ prefabRelativePath: prefabPath(), scriptRelativePath: this.string('控制器脚本项目相对路径。'), className: this.string('脚本类名。'), propertyBindings: this.freeObject('属性名 -> 节点路径或节点名。'), propertyComponents: this.freeObject('属性名 -> cc 组件类型。'), buttonEvents: this.array('按钮点击绑定列表。'), autoCommit: autoCommit(), ...control() }, ['prefabRelativePath', 'scriptRelativePath', 'className', 'propertyBindings']));
        schemas.set('lumen.refresh', this.object({ paths: this.stringArray('可选项目相对路径列表；省略则刷新 db://assets。'), prefabRelativePath: assetAlias(), assetRelativePath: assetAlias(), ...control() }));
        schemas.set('lumen.commit', this.object({ paths: this.stringArray('可选项目相对路径列表；省略则刷新 db://assets。'), prefabRelativePath: assetAlias(), assetRelativePath: assetAlias(), ...control() }));
        schemas.set('reference.setImage', this.object({ imagePath: this.string('Required image path (absolute / assets-relative / db://).'), scenePath: this.string('Optional scene path hint.'), opacity: this.number('Optional opacity (0-1 or 0-100).'), x: this.number('Optional X offset.'), y: this.number('Optional Y offset.'), sx: this.number('Optional X scale.'), sy: this.number('Optional Y scale.'), visible: this.boolean('Optional; false maps to opacity 0.'), ...control() }, ['imagePath']));
        return schemas;
    }

    private static object(properties: Readonly<Record<string, ICoreMcpJsonSchema>>, required: readonly string[] = []): ICoreMcpJsonSchema { return Object.freeze({ type: 'object', properties: Object.freeze({ ...properties }), required: Object.freeze([...required]), additionalProperties: false }); }
    private static string(description: string): ICoreMcpJsonSchema { return Object.freeze({ type: 'string', description }); }
    private static integer(description: string): ICoreMcpJsonSchema { return Object.freeze({ type: 'integer', description }); }
    private static number(description: string): ICoreMcpJsonSchema { return Object.freeze({ type: 'number', description }); }
    private static boolean(description: string): ICoreMcpJsonSchema { return Object.freeze({ type: 'boolean', description }); }
    private static enum(values: readonly string[], description: string): ICoreMcpJsonSchema { return Object.freeze({ type: 'string', enum: Object.freeze([...values]), description }); }
    private static stringArray(description: string): ICoreMcpJsonSchema { return Object.freeze({ type: 'array', description, items: this.string('字符串值。') }); }
    private static array(description: string): ICoreMcpJsonSchema { return Object.freeze({ type: 'array', description }); }
    private static freeObject(description: string): ICoreMcpJsonSchema { return Object.freeze({ type: 'object', description, additionalProperties: true }); }
}
