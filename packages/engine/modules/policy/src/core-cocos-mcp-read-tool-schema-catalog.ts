import { CoreTextFileIoContract } from './core-text-file-io-contract.js';
import { CoreCocosMcpCapabilityCatalog, type CoreCocosMcpOperation } from './core-cocos-mcp-capability-catalog.js';

/**
 * @description 面向 MCP 客户端公开的受限 JSON Schema 子集。
 */
export interface ICoreMcpJsonSchema {
    /** @description JSON 值类型。 */
    readonly type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
        | readonly ('object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null')[];
    /** @description 面向调用方的字段说明。 */
    readonly description?: string;
    /** @description 对象字段定义。 */
    readonly properties?: Readonly<Record<string, ICoreMcpJsonSchema>>;
    /** @description 必填对象字段。 */
    readonly required?: readonly string[];
    /** @description 是否允许未声明字段。 */
    readonly additionalProperties?: boolean;
    /** @description 数组元素定义。 */
    readonly items?: ICoreMcpJsonSchema;
    /** @description 字符串枚举值。 */
    readonly enum?: readonly string[];
    /**
     * @description 必须恰好匹配一个分支，用于互斥输入。
     */
    readonly oneOf?: readonly ICoreMcpJsonSchema[];
    /**
     * @description 数组的最少元素数。
     */
    readonly minItems?: number;
    /**
     * @description 数组的最多元素数。
     */
    readonly maxItems?: number;
    /**
     * @description 字符串必须匹配的受控正则表达式。
     */
    readonly pattern?: string;
}

/**
 * @description 已从旧 Editor MCP 迁入 Core 的资产只读工具 schema 目录。
 */
export class CoreCocosMcpReadToolSchemaCatalog {
    /** @description 已迁移的只读 asset operation schema。 */
    private static readonly schemas: ReadonlyMap<CoreCocosMcpOperation, ICoreMcpJsonSchema> =
        CoreCocosMcpReadToolSchemaCatalog.buildSchemas();

    /**
     * @description 查询已迁移 operation 的精确输入 schema。
     * @param operation 未信任的 operation 标识。
     * @returns schema 快照；尚未迁移的 Core operation 返回 null。
     */
    public find(operation: unknown): ICoreMcpJsonSchema | null {
        const capability = CoreCocosMcpCapabilityCatalog.find(operation);
        return capability == null ? null : (CoreCocosMcpReadToolSchemaCatalog.schemas.get(capability.operation) ?? null);
    }

    /**
     * @description 返回当前已迁移 schema 的 operation 列表。
     * @returns 不可变 operation 列表。
     */
    public operations(): readonly CoreCocosMcpOperation[] {
        return Object.freeze([...CoreCocosMcpReadToolSchemaCatalog.schemas.keys()]);
    }

    /**
     * @description 构建迁移批次的精确 schema 映射。
     * @returns 不可变 schema 映射。
     */
    private static buildSchemas(): ReadonlyMap<CoreCocosMcpOperation, ICoreMcpJsonSchema> {
        const schemas = new Map<CoreCocosMcpOperation, ICoreMcpJsonSchema>();
        schemas.set('editor.queryVersion', this.empty());
        schemas.set('editor.queryProject', this.empty());
        schemas.set('editor.querySelection', this.empty());

        schemas.set(
            'asset.queryInfo',
            this.object({
                pathOrUuid: this.string('资源路径或 UUID。'),
                paths: this.stringArray('批量路径列表。'),
                uuids: this.stringArray('批量 UUID 列表。'),
            }),
        );
        schemas.set('asset.readText', CoreTextFileIoContract.readInputSchema());
        schemas.set('asset.catalog.summary', this.empty());
        schemas.set(
            'asset.catalog.lookup',
            this.object({
                uuid: this.string('精确 UUID；提供时忽略其它过滤条件。'),
                type: this.string('类型分桶，如 script/prefab/spriteFrame。'),
                name: this.string('文件名子串。'),
                path: this.string('路径子串。'),
                limit: this.integer('返回条数上限（默认 20，最大 50）。'),
            }),
        );
        schemas.set(
            'asset.importPlan',
            this.object(
                {
                    sources: this.stringArray('待分析的源文件路径列表。'),
                    dependencyMap: this.freeObject('显式依赖表。'),
                    expandClosure: this.boolean('是否从磁盘展开依赖闭包；默认 true。'),
                },
                ['sources'],
            ),
        );
        schemas.set(
            'asset.managedStatus',
            this.object({ targets: this.stringArray('目标 db://assets/... 路径列表。') }, ['targets']),
        );
        schemas.set(
            'asset.queryDependencies',
            this.object({
                dbPath: this.string('db://assets/... 路径。'),
                uuid: this.string('标准或压缩 uuid。'),
                direction: this.enum(['dependencies', 'dependents', 'both'], '查询方向。'),
                refreshIndex: this.boolean('是否强制重建索引。'),
                expand: this.stringArray('依赖展开；目前支持 materialTextures（材质→贴图二跳）。'),
            }),
        );
        schemas.set(
            'asset.waitReady',
            this.object({
                timeoutMs: this.integer('最长等待毫秒；默认 1500。'),
                intervalMs: this.integer('轮询间隔毫秒；默认 40。'),
                throwOnTimeout: this.boolean('超时是否抛错；默认 false。'),
            }),
        );
        schemas.set(
            'asset.scanMissingReferences',
            this.object({
                pathContains: this.string('路径子串过滤。'),
                type: this.string('类型分桶过滤。'),
                limit: this.integer('返回条数上限（默认 50，最大 200）。'),
                refreshIndex: this.boolean('是否强制重建索引。'),
            }),
        );
        schemas.set(
            'asset.findReferencingNodes',
            this.object({
                uuid: this.string('目标资源 uuid；missingOnly 时可省略或作二次筛选。'),
                missingOnly: this.boolean('为 true 时只返回引用 unresolved uuid 的节点。'),
                assetPath: this.string('限定 Prefab/Scene 路径。'),
                nodeNameContains: this.string('按节点名称子串二次筛选。'),
                nodePathContains: this.string('按节点路径子串二次筛选。'),
                limit: this.integer('返回条数上限（默认 50，最大 200）。'),
            }),
        );
        schemas.set(
            'asset.resolve',
            this.object({
                uuid: this.string('标准或压缩 uuid。'),
                path: this.string('db:// 或相对路径。'),
                url: this.string('与 path 同义的 url。'),
            }),
        );
        schemas.set(
            'asset.search',
            this.object(
                {
                    mode: this.enum(['name', 'uuid', 'path', 'type', 'dependencies', 'dependents', 'missing', 'bundle'], '搜索模式。'),
                    query: this.string('查询文本（name/path/bundle/type）或 uuid。'),
                    path: this.string('依赖查询目标 path。'),
                    uuid: this.string('依赖查询目标 uuid。'),
                    pathContains: this.string('路径子串过滤（文件夹范围，如 assets/ui）。'),
                    limit: this.integer('返回条数上限（默认 20，最大 50）。'),
                },
                ['mode'],
            ),
        );
        schemas.set(
            'asset.auditUnmanagedWrites',
            this.object({
                pathContains: this.string('路径子串过滤。'),
                modifiedSince: this.string('仅报告该 ISO 时间之后修改的文件。'),
                limit: this.integer('返回条数上限（默认 50，最大 200）。'),
                includeGit: this.boolean('为 true 时尽力附加 git status --porcelain assets。'),
            }),
        );
        schemas.set(
            'asset.queryPropertySchema',
            this.object({
                uuid: this.string('标准或压缩 uuid。'),
                path: this.string('db:// 或相对路径。'),
                url: this.string('与 path 同义的 url。'),
            }),
        );
        schemas.set(
            'asset.queryInheritance',
            this.object({
                uuid: this.string('标准或压缩 uuid。'),
                path: this.string('db:// 或相对路径。'),
                url: this.string('与 path 同义的 url。'),
            }),
        );
        schemas.set(
            'asset.queryCompatibleTypes',
            this.object({
                typeName: this.string('显式类型名，如 SpriteFrame / cc.Node。'),
                scriptRelativePath: this.string('脚本相对路径；与 field 联用。'),
                field: this.string('脚本字段名。'),
                uuid: this.string('资源 uuid。'),
                path: this.string('资源 path。'),
                url: this.string('与 path 同义。'),
                limit: this.integer('catalog 命中上限。'),
            }),
        );

        schemas.set('scene.getCurrent', this.empty());
        schemas.set(
            'scene.getHierarchy',
            this.object({
                includeEditorNodes: this.boolean('是否包含编辑器内部节点；默认 false。'),
            }),
        );
        schemas.set('scene.queryCurrentEditorResource', this.empty());
        schemas.set(
            'scene.resolvePrefabRootUuid',
            this.object({
                rootName: this.string('根节点名；省略时从 prefabRelativePath 推导。'),
                prefabRelativePath: this.string('Prefab 相对路径，用于推导根名。'),
                timeoutMs: this.number('等待超时毫秒；默认 10000。'),
            }),
        );
        schemas.set(
            'scene.queryNode',
            this.object(
                {
                    path: this.string('节点路径或节点名。'),
                    includeEditorNodes: this.boolean('是否包含编辑器内部节点；默认 false。'),
                },
                ['path'],
            ),
        );
        schemas.set(
            'prefab.getInfo',
            this.object(
                {
                    pathOrUuid: this.string('Prefab 路径 / uuid，或实例节点 path。'),
                },
                ['pathOrUuid'],
            ),
        );

        schemas.set(
            'preview.query',
            this.object({
                platform: this.string('预留平台提示，如 browser。'),
            }),
        );
        schemas.set(
            'preview.queryErrors',
            this.object({
                limit: this.integer('返回条数上限；默认 50。'),
                contains: this.string('错误行关键字过滤（大小写不敏感）。'),
                sinceOffset: this.integer('仅返回 project.log 该字节偏移之后的新增错误；用上次返回的 logOffset。'),
            }),
        );

        schemas.set(
            'builder.queryPlatforms',
            this.object({
                filter: this.string('可选平台名子串过滤。'),
            }),
        );
        schemas.set(
            'builder.querySchema',
            this.object({
                platform: this.string('平台 id；省略时返回通用 schema。'),
            }),
        );
        schemas.set(
            'builder.queryDefaultConfig',
            this.object({
                platform: this.string('平台 id。'),
            }),
        );

        schemas.set(
            'lumen.schema',
            this.object({
                type: this.string('组件类型，如 cc.Label；省略时返回清单。'),
                cocosVersion: this.string('可选 Creator 版本覆盖。'),
            }),
        );
        schemas.set(
            'lumen.templates',
            this.object({
                cocosVersion: this.string('可选 Creator 版本覆盖。'),
            }),
        );
        schemas.set(
            'lumen.tree',
            this.object({
                prefabRelativePath: this.string('项目相对路径；禁止绝对路径与 ..；也可用 assetRelativePath 别名。'),
                assetRelativePath: this.string('prefabRelativePath 的别名；二者同时提供时必须相等。'),
                cocosVersion: this.string('可选 Creator 版本覆盖。'),
            }),
        );
        schemas.set(
            'lumen.inspect',
            this.object({
                prefabRelativePath: this.string('项目相对路径；禁止绝对路径与 ..；也可用 assetRelativePath 别名。'),
                assetRelativePath: this.string('prefabRelativePath 的别名；二者同时提供时必须相等。'),
                nodePath: this.string('节点路径，如 /Root/Title，必须以 / 开头；独立资产可省略。'),
                region: this.freeObject('仅 .terrain：顶点盒或本地圆区域。'),
                cocosVersion: this.string('可选 Creator 版本覆盖。'),
            }),
        );
        schemas.set(
            'lumen.validateRefs',
            this.object({
                prefabRelativePath: this.string('项目相对路径；禁止绝对路径与 ..；也可用 assetRelativePath 别名。'),
                assetRelativePath: this.string('prefabRelativePath 的别名；二者同时提供时必须相等。'),
            }),
        );
        schemas.set(
            'lumen.cocosInfo',
            this.object({
                engineRoot: this.string('可选引擎根或 cc.d.ts 路径（可为绝对路径）。'),
                cocosVersion: this.string('可选 Creator 版本覆盖。'),
                gapOffset: this.integer('缺口列表起始偏移；缺省 0。'),
                gapLimit: this.integer('缺口列表每页条数；缺省 40，最大 200。'),
            }),
        );
        schemas.set(
            'lumen.compileRecipe',
            this.object(
                {
                    prefabRelativePath: this.string('项目相对 Prefab 路径；禁止绝对路径与 ..。'),
                    rootName: this.string('空壳根节点名。'),
                    mode: this.enum(['replaceRoot', 'appendChildren'], 'replaceRoot 替换根；appendChildren 挂到空根下。'),
                    recipe: this.freeObject('replaceRoot 的根配方。'),
                    recipes: this.array('appendChildren 的同级子配方列表。'),
                    rootContentSize: this.xy('appendChildren 时空根 contentSize。', 'width', 'height'),
                    rootAnchorPoint: this.xy('appendChildren 时空根 anchorPoint。', 'x', 'y'),
                },
                ['prefabRelativePath', 'rootName', 'mode'],
            ),
        );
        schemas.set(
            'lumen.lodRecalcBounds',
            this.object({
                nodePath: this.string('可选节点路径。'),
                prefabRelativePath: this.string('prefabRelativePath；也可用 assetRelativePath 别名。'),
                assetRelativePath: this.string('prefabRelativePath 的别名。'),
            }),
        );
        schemas.set(
            'reference.queryImage',
            this.object({
                scenePath: this.string('可选场景路径（当前拒绝）。'),
            }),
        );
        return schemas;
    }

    /**
     * @description 创建拒绝额外字段的空对象 schema。
     * @returns 空对象 schema。
     */
    private static empty(): ICoreMcpJsonSchema {
        return Object.freeze({ type: 'object', properties: Object.freeze({}), additionalProperties: false });
    }

    /**
     * @description 创建拒绝额外字段的对象 schema。
     * @param properties 字段 schema。
     * @param required 必填字段。
     * @returns 对象 schema。
     */
    private static object(properties: Readonly<Record<string, ICoreMcpJsonSchema>>, required: readonly string[] = []): ICoreMcpJsonSchema {
        return Object.freeze({
            type: 'object',
            properties: Object.freeze({ ...properties }),
            required: Object.freeze([...required]),
            additionalProperties: false,
        });
    }

    /**
     * @description 创建字符串 schema。
     * @param description 面向调用方的说明。
     * @returns 字符串 schema。
     */
    private static string(description: string): ICoreMcpJsonSchema {
        return Object.freeze({ type: 'string', description });
    }

    /**
     * @description 创建整数 schema。
     * @param description 面向调用方的说明。
     * @returns 整数 schema。
     */
    private static integer(description: string): ICoreMcpJsonSchema {
        return Object.freeze({ type: 'integer', description });
    }

    /**
     * @description 创建数字 schema。
     * @param description 面向调用方的说明。
     * @returns 数字 schema。
     */
    private static number(description: string): ICoreMcpJsonSchema {
        return Object.freeze({ type: 'number', description });
    }

    /**
     * @description 创建布尔 schema。
     * @param description 面向调用方的说明。
     * @returns 布尔 schema。
     */
    private static boolean(description: string): ICoreMcpJsonSchema {
        return Object.freeze({ type: 'boolean', description });
    }

    /**
     * @description 创建字符串数组 schema。
     * @param description 面向调用方的说明。
     * @returns 字符串数组 schema。
     */
    private static stringArray(description: string): ICoreMcpJsonSchema {
        return Object.freeze({ type: 'array', description, items: this.string('字符串值。') });
    }

    /**
     * @description 创建允许额外字段的自由对象 schema；具体形状由宿主深层校验。
     * @param description 面向调用方的说明。
     * @returns 自由对象 schema。
     */
    private static freeObject(description: string): ICoreMcpJsonSchema {
        return Object.freeze({ type: 'object', description, additionalProperties: true });
    }

    private static array(description: string): ICoreMcpJsonSchema {
        return Object.freeze({ type: 'array', description });
    }

    private static xy(description: string, first: string, second: string): ICoreMcpJsonSchema {
        return this.object({ [first]: this.number('数值。'), [second]: this.number('数值。') });
    }

    /**
     * @description 创建字符串枚举 schema。
     * @param values 允许的枚举值。
     * @param description 面向调用方的说明。
     * @returns 枚举 schema。
     */
    private static enum(values: readonly string[], description: string): ICoreMcpJsonSchema {
        return Object.freeze({ type: 'string', description, enum: Object.freeze([...values]) });
    }
}
