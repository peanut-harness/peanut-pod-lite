import type {
    EditorMcpOperationId,
    IEditorMcpCapabilityDescriptor,
    IMcpAiHandlingGuidance,
    IMcpCapabilityDefinition,
    IMcpJsonSchema,
    LocalizedText,
} from '@peanut/pod-protocol';

const TOOL_NAME_PREFIX = 'peanut.editor-mcp.';

/**
 * @description 将稳定 operation 标识与其一级 MCP 工具名、精确 inputSchema 绑定的目录。
 * 每个 operation 直接暴露为一个带命名空间的一级工具，工具名由 operation 做确定性 camel→kebab 变换得到，
 * 供 AI 直接按工具调用，避免把 operation 藏进 payload 造成的路由拼错与「搜不到」。
 */
export class EditorMcpToolCatalog {
    /** @description operation 到其一级工具 inputSchema 的映射；键集合即权威 operation 全集。 */
    private readonly _schemas: ReadonlyMap<EditorMcpOperationId, IMcpJsonSchema>;
    /** @description 一级工具名到 operation 的反向映射，用于分发时解析。 */
    private readonly _operationByToolName: ReadonlyMap<string, EditorMcpOperationId>;

    /**
     * @description 构造目录并预计算 operation 与工具名的双向映射。
     */
    public constructor() {
        this._schemas = this._buildSchemas();
        const reverse = new Map<string, EditorMcpOperationId>();
        for (const operation of this._schemas.keys()) {
            reverse.set(this.toolName(operation), operation);
        }
        this._operationByToolName = reverse;
    }

    /**
     * @description 返回 operation 对应的一级工具名。
     * @param operation 稳定 operation 标识。
     * @returns 带 `peanut.editor-mcp.` 前缀的 kebab 工具名。
     */
    public toolName(operation: EditorMcpOperationId): string {
        const suffix = operation
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
            .replace(/\./g, '-')
            .toLowerCase();
        return `${TOOL_NAME_PREFIX}${suffix}`;
    }

    /**
     * @description 将一级工具名解析回 operation。
     * @param name 工具名。
     * @returns 命中的 operation；未知工具名返回 `null`。
     */
    public operationForToolName(name: string): EditorMcpOperationId | null {
        return this._operationByToolName.get(name) ?? null;
    }

    /**
     * @description 依据 router 公开的能力描述，构建每个 operation 的一级工具定义。
     * @param descriptors router 的稳定能力描述列表（提供 readOnly / risk / description 单一事实）。
     * @returns 每个 operation 一个的 MCP 工具定义列表。
     */
    public buildDefinitions(descriptors: readonly IEditorMcpCapabilityDescriptor[]): readonly IMcpCapabilityDefinition[] {
        return descriptors.map((descriptor) => {
            const inputSchema = this._schemas.get(descriptor.operation);
            if (inputSchema == null) {
                throw new Error(`editor_mcp_tool_schema_missing:${descriptor.operation}`);
            }
            const effectiveInputSchema = descriptor.readOnly ? inputSchema : this._withExecutionControl(inputSchema);
            return {
                name: this.toolName(descriptor.operation),
                description: this._descriptionWithAiContract(descriptor.description, descriptor.readOnly),
                category: 'cocos',
                inputSchema: effectiveInputSchema,
                ...(descriptor.readOnly ? {} : { outputSchema: this._writeOutputSchema() }),
                readOnly: descriptor.readOnly,
                risk: descriptor.risk,
                ...(descriptor.readOnly ? {} : { executionModel: 'managed_task' as const }),
                lane: descriptor.lane,
                aiHandling: this._aiHandling(descriptor.readOnly),
            };
        });
    }

    /**
     * @description 为工具说明追加 AI 可直接执行的成功判据与失败规则。
     * @param description 原始本地化能力说明。
     * @param readOnly 是否为只读工具。
     * @returns 包含统一调用规则的本地化说明。
     */
    private _descriptionWithAiContract(description: LocalizedText, readOnly: boolean): LocalizedText {
        const englishRule = readOnly
            ? ' Treat the call as successful only when response.ok=true. On response.ok=false, inspect failure.code, failure.category, and failure.recommendedAction.'
            : ' Accept success only when taskStatus=succeeded and postflight.verified=true. On failure inspect the structured failure object; when failure.state is unknown or may_have_changed, query the target state before retrying. Never retry a write blindly.';
        const chineseRule = readOnly
            ? ' 仅当 response.ok=true 时判定成功；response.ok=false 时必须读取 failure.code、failure.category 与 failure.recommendedAction。'
            : ' 仅当 taskStatus=succeeded 且 postflight.verified=true 时判定成功。失败时读取结构化 failure；failure.state 为 unknown 或 may_have_changed 时必须先查询目标状态再重试，禁止盲目重放写操作。';
        if (typeof description === 'string') {
            return `${description}${englishRule}`;
        }
        return {
            'en-US': `${description['en-US']}${englishRule}`,
            'zh-CN': `${description['zh-CN']}${chineseRule}`,
        };
    }

    /**
     * @description 构造 AI 调用处理的机器可读规则。
     * @param readOnly 是否为只读工具。
     * @returns 稳定调用规则。
     */
    private _aiHandling(readOnly: boolean): IMcpAiHandlingGuidance {
        return Object.freeze({
            schemaVersion: 1,
            successSignals: Object.freeze(
                readOnly
                    ? ['response.ok=true']
                    : ['response.ok=true', 'result.taskStatus=succeeded', 'result.postflight.verified=true'],
            ),
            failureField: 'failure',
            unknownStateAction: 'query_before_retry',
            blindRetryAllowed: false,
        });
    }

    /**
     * @description 构造所有写工具共享的最小成功输出 schema。
     * @returns 要求任务与日志验收信号的输出 schema。
     */
    private _writeOutputSchema(): IMcpJsonSchema {
        return {
            type: 'object',
            properties: {
                taskId: this._string('稳定任务标识。'),
                taskStatus: this._enum(['queued', 'succeeded'], '异步受理返回 queued，默认同步成功返回 succeeded。'),
                postflight: this._object(
                    { verified: this._boolean('project.log 增量验收是否通过。') },
                    ['verified'],
                    true,
                ),
            },
            required: ['taskId', 'taskStatus'],
            additionalProperties: true,
        };
    }

    /** @description 为写工具 schema 统一追加 execution 控制对象。 */
    private _withExecutionControl(schema: IMcpJsonSchema): IMcpJsonSchema {
        return {
            ...schema,
            properties: {
                ...(schema.properties ?? {}),
                execution: this._object({
                    mode: this._enum(['sync', 'async'], '默认 sync；仅显式 async 才提前返回 queued。'),
                    idempotencyKey: this._string('同 owner、工程和 capability 范围内的幂等键。'),
                    timeoutMs: this._integer('受控超时毫秒数，范围 1–1800000。'),
                }),
            },
        };
    }

    /**
     * @description 构建 operation 到精确 inputSchema 的映射。
     * @returns 覆盖全部 operation 的 schema 映射。
     */
    private _buildSchemas(): ReadonlyMap<EditorMcpOperationId, IMcpJsonSchema> {
        const map = new Map<EditorMcpOperationId, IMcpJsonSchema>();

        map.set('editor.queryVersion', this._empty());
        map.set('editor.queryProject', this._empty());
        map.set('editor.querySelection', this._empty());
        map.set(
            'editor.setSelection',
            this._object({
                paths: this._stringArray('节点路径列表（优先）。'),
                ids: this._stringArray('节点 uuid / id 列表。'),
                clear: this._boolean('为 true 时清空选区。'),
                ...this._writeControl(),
            }),
        );

        map.set(
            'asset.queryInfo',
            this._object({
                pathOrUuid: this._string('资源路径或 UUID。'),
                paths: this._stringArray('批量路径列表。'),
                uuids: this._stringArray('批量 UUID 列表。'),
            }),
        );
        map.set('asset.catalog.summary', this._empty());
        map.set(
            'asset.catalog.lookup',
            this._object({
                uuid: this._string('精确 UUID；提供时忽略其它过滤条件。'),
                type: this._string('类型分桶，如 script/prefab/spriteFrame。'),
                name: this._string('文件名子串。'),
                path: this._string('路径子串。'),
                limit: this._integer('返回条数上限（默认 20，最大 50）。'),
            }),
        );
        map.set('asset.catalog.refresh', this._object(this._writeControl()));
        map.set(
            'asset.importPlan',
            this._object(
                {
                    sources: this._stringArray('待分析的源文件路径列表。'),
                    dependencyMap: this._freeObject('显式依赖表。'),
                    expandClosure: this._boolean('是否从磁盘展开依赖闭包；默认 true。'),
                },
                ['sources'],
            ),
        );
        map.set(
            'asset.import',
            this._object(
                {
                    sources: this._stringArray('待导入的源文件路径列表。'),
                    target: this._string('目标 db://assets/... 目录。'),
                    mode: this._string('覆盖模式；override 等价 overwrite:true。'),
                    overwrite: this._boolean('是否覆盖已有资源（destructive）。'),
                    dependencyMap: this._freeObject('显式依赖表。'),
                    concurrency: this._integer('层内并发度（1–8）。'),
                    refreshAfter: this._boolean('层后是否刷新并等待 AssetDB；默认 true。'),
                    allowMissingDependencies: this._boolean('是否允许缺失依赖继续；默认 false。'),
                    expandClosure: this._boolean('是否展开依赖闭包；默认 true。'),
                    planId: this._string('asset.importPlan 返回的 planId；受管模式建议提供。'),
                    ...this._writeControl(),
                },
                ['sources', 'target'],
            ),
        );
        map.set('asset.managedStatus', this._object({ targets: this._stringArray('目标 db://assets/... 路径列表。') }, ['targets']));
        map.set(
            'asset.queryDependencies',
            this._object({
                dbPath: this._string('db://assets/... 路径。'),
                uuid: this._string('标准或压缩 uuid。'),
                direction: this._enum(['dependencies', 'dependents', 'both'], '查询方向。'),
                refreshIndex: this._boolean('是否强制重建索引。'),
                expand: this._stringArray('依赖展开；目前支持 materialTextures（材质→贴图二跳）。'),
            }),
        );
        map.set(
            'asset.replaceReferences',
            this._object(
                {
                    fromUuid: this._string('被替换 uuid（可带 @sub）。'),
                    toUuid: this._string('目标 uuid（可带 @sub）。'),
                    pathContains: this._string('路径子串过滤。'),
                    dryRun: this._boolean('只报告不写盘。'),
                    allowMissingTarget: this._boolean('允许目标 uuid 不在 catalog。'),
                    refreshIndex: this._boolean('强制重建依赖索引。'),
                    ...this._writeControl(),
                },
                ['fromUuid', 'toUuid'],
            ),
        );
        map.set(
            'asset.waitReady',
            this._object({
                timeoutMs: this._integer('最长等待毫秒；默认 1500。'),
                intervalMs: this._integer('轮询间隔毫秒；默认 40。'),
                throwOnTimeout: this._boolean('超时是否抛错；默认 false。'),
            }),
        );
        map.set(
            'asset.scanMissingReferences',
            this._object({
                pathContains: this._string('路径子串过滤。'),
                type: this._string('类型分桶过滤。'),
                limit: this._integer('返回条数上限（默认 50，最大 200）。'),
                refreshIndex: this._boolean('是否强制重建索引。'),
            }),
        );
        map.set(
            'asset.findReferencingNodes',
            this._object({
                uuid: this._string('目标资源 uuid；missingOnly 时可省略或作二次筛选。'),
                missingOnly: this._boolean('为 true 时只返回引用 unresolved uuid 的节点。'),
                assetPath: this._string('限定 Prefab/Scene 路径。'),
                nodeNameContains: this._string('按节点名称子串二次筛选。'),
                nodePathContains: this._string('按节点路径子串二次筛选。'),
                limit: this._integer('返回条数上限（默认 50，最大 200）。'),
            }),
        );
        map.set(
            'asset.resolve',
            this._object({
                uuid: this._string('标准或压缩 uuid。'),
                path: this._string('db:// 或相对路径。'),
                url: this._string('与 path 同义的 url。'),
            }),
        );
        map.set(
            'asset.search',
            this._object(
                {
                    mode: this._enum(
                        ['name', 'uuid', 'path', 'type', 'dependencies', 'dependents', 'missing', 'bundle'],
                        '搜索模式；type 时 query 为 scene/prefab 等分桶。',
                    ),
                    query: this._string('查询文本（name/path/bundle/type）或 uuid。'),
                    path: this._string('依赖查询目标 path。'),
                    uuid: this._string('依赖查询目标 uuid。'),
                    pathContains: this._string('路径子串过滤（文件夹范围，如 assets/ui）。'),
                    limit: this._integer('返回条数上限（默认 20，最大 50）。'),
                },
                ['mode'],
            ),
        );
        map.set(
            'asset.auditUnmanagedWrites',
            this._object({
                pathContains: this._string('路径子串过滤。'),
                modifiedSince: this._string('仅报告该 ISO 时间之后修改的文件。'),
                limit: this._integer('返回条数上限（默认 50，最大 200）。'),
                includeGit: this._boolean('为 true 时尽力附加 git status --porcelain assets。'),
            }),
        );
        map.set(
            'asset.queryPropertySchema',
            this._object({
                uuid: this._string('标准或压缩 uuid。'),
                path: this._string('db:// 或相对路径。'),
                url: this._string('与 path 同义的 url。'),
            }),
        );
        map.set(
            'asset.queryInheritance',
            this._object({
                uuid: this._string('标准或压缩 uuid。'),
                path: this._string('db:// 或相对路径。'),
                url: this._string('与 path 同义的 url。'),
            }),
        );
        map.set(
            'asset.queryCompatibleTypes',
            this._object({
                typeName: this._string('显式类型名，如 SpriteFrame / cc.Node。'),
                scriptRelativePath: this._string('脚本相对路径；与 field 联用。'),
                field: this._string('脚本字段名。'),
                uuid: this._string('资源 uuid。'),
                path: this._string('资源 path。'),
                url: this._string('与 path 同义。'),
                limit: this._integer('catalog 命中上限。'),
            }),
        );
        map.set(
            'asset.open',
            this._object({
                uuid: this._string('标准或压缩 uuid。'),
                path: this._string('db:// 或相对路径。'),
                url: this._string('与 path 同义。'),
                ...this._writeControl(),
            }),
        );
        map.set(
            'asset.copy',
            this._object(
                {
                    paths: this._stringArray('待复制资源相对路径列表（种子；依赖闭包会一并复制并换新 uuid）。'),
                    targetDirectory: this._string('复制产物根目录（db://assets/... 或工程相对路径）。'),
                    ...this._writeControl(),
                },
                ['paths', 'targetDirectory'],
            ),
        );
        map.set(
            'asset.move',
            this._object(
                {
                    from: this._string('源相对路径（文件或文件夹）。'),
                    to: this._string('目标相对路径；不得已存在。'),
                    ...this._writeControl(),
                },
                ['from', 'to'],
            ),
        );
        map.set(
            'asset.rename',
            this._object(
                {
                    path: this._string('待重命名资源相对路径（文件或文件夹）。'),
                    newName: this._string('新文件/文件夹名（不含路径分隔符）。'),
                    ...this._writeControl(),
                },
                ['path', 'newName'],
            ),
        );
        map.set(
            'asset.createFolder',
            this._object(
                {
                    path: this._string('待创建文件夹相对路径；缺失的父目录会一并创建。'),
                    ...this._writeControl(),
                },
                ['path'],
            ),
        );
        map.set(
            'asset.delete',
            this._object(
                {
                    paths: this._stringArray('待删除资源相对路径列表（文件或文件夹，递归）。'),
                    ...this._writeControl(),
                },
                ['paths'],
            ),
        );
        map.set(
            'asset.reimport',
            this._object({
                paths: this._stringArray('可选相对路径列表；省略则刷新 db://assets。'),
                path: this._string('单路径别名；会并入 paths。'),
                ...this._writeControl(),
            }),
        );
        map.set(
            'asset.writeText',
            this._object({
                path: this._string('单文件相对路径（assets/...）；与 files 二选一。'),
                content: this._string('单文件 UTF-8 内容；与 path 成对。'),
                files: {
                    type: 'array',
                    description: '批量文本文件；提供时忽略 path/content。',
                    items: this._object(
                        {
                            path: this._string('相对路径（assets/...）。'),
                            content: this._string('UTF-8 文本。'),
                        },
                        ['path', 'content'],
                    ),
                },
                ...this._writeControl(),
            }),
        );
        map.set(
            'asset.ensureSpriteFramesBatch',
            this._object(
                {
                    dbPaths: this._stringArray('db://assets/... 或 assets/... 的 PNG 路径列表。'),
                    refreshRoot: this._string('可选批量刷新根；省略则逐项 refresh-asset 并等待就绪。'),
                    ...this._writeControl(),
                },
                ['dbPaths'],
            ),
        );

        map.set('scene.getCurrent', this._empty());
        map.set(
            'scene.getHierarchy',
            this._object({
                includeEditorNodes: this._boolean('是否包含编辑器内部节点；默认 false。'),
            }),
        );
        map.set('scene.queryCurrentEditorResource', this._empty());
        map.set(
            'scene.restoreEditorResource',
            this._object({
                uuid: this._string('资源 uuid；与 url 至少一个，或都省略表示恢复「当前」。'),
                url: this._string('资源 url / db 路径。'),
                ...this._writeControl(),
            }),
        );
        map.set(
            'scene.resolvePrefabRootUuid',
            this._object({
                rootName: this._string('根节点名；省略时从 prefabRelativePath 推导。'),
                prefabRelativePath: this._string('Prefab 相对路径，用于推导根名。'),
                timeoutMs: this._number('等待超时毫秒；默认 10000。'),
            }),
        );
        map.set(
            'scene.open',
            this._object(
                {
                    path: this._string('场景 db:// 或项目相对路径。'),
                    ...this._writeControl(),
                },
                ['path'],
            ),
        );
        map.set(
            'scene.save',
            this._object({
                path: this._string('可选场景路径；省略时保存当前打开场景。'),
                ...this._writeControl(),
            }),
        );
        map.set(
            'scene.reload',
            this._object({
                soft: this._boolean('是否软重载；默认 true。'),
                ...this._writeControl(),
            }),
        );
        map.set(
            'scene.queryNode',
            this._object(
                {
                    path: this._string('节点路径或节点名。'),
                    includeEditorNodes: this._boolean('是否包含编辑器内部节点；默认 false。'),
                },
                ['path'],
            ),
        );
        map.set(
            'scene.focusNode',
            this._object(
                {
                    path: this._string('节点路径或 uuid。'),
                    ...this._writeControl(),
                },
                ['path'],
            ),
        );
        map.set(
            'scene.createNode',
            this._object({
                parentPath: this._string('父节点路径；省略时挂场景根。'),
                name: this._string('节点名。'),
                type: this._string('类型提示：empty / Camera / Light 等。'),
                ...this._writeControl(),
            }),
        );
        map.set(
            'prefab.createFromNode',
            this._object(
                {
                    nodePath: this._string('源节点路径或 uuid。'),
                    prefabPath: this._string('目标 Prefab db://assets/.../*.prefab。'),
                    ...this._writeControl(),
                },
                ['nodePath', 'prefabPath'],
            ),
        );
        map.set(
            'prefab.apply',
            this._object(
                {
                    nodePath: this._string('实例根节点路径或 uuid。'),
                    ...this._writeControl(),
                },
                ['nodePath'],
            ),
        );
        map.set(
            'prefab.revert',
            this._object(
                {
                    nodePath: this._string('实例根节点路径或 uuid。'),
                    ...this._writeControl(),
                },
                ['nodePath'],
            ),
        );
        map.set(
            'prefab.unpack',
            this._object(
                {
                    nodePath: this._string('实例根节点路径或 uuid。'),
                    ...this._writeControl(),
                },
                ['nodePath'],
            ),
        );
        map.set(
            'prefab.unlink',
            this._object(
                {
                    nodePath: this._string('实例根节点路径或 uuid。'),
                    ...this._writeControl(),
                },
                ['nodePath'],
            ),
        );
        map.set(
            'prefab.getInfo',
            this._object(
                {
                    pathOrUuid: this._string('Prefab 路径 / uuid，或实例节点 path。'),
                },
                ['pathOrUuid'],
            ),
        );

        map.set('preview.query', this._object({ platform: this._string('预留平台提示，如 browser。') }));
        map.set(
            'preview.refresh',
            this._object({
                refreshAssets: this._boolean('是否同时请求 AssetDB refresh；默认 true。'),
                ...this._writeControl(),
            }),
        );
        map.set(
            'preview.queryErrors',
            this._object({
                limit: this._integer('返回条数上限；默认 50。'),
                contains: this._string('错误行关键字过滤（大小写不敏感）。'),
                sinceOffset: this._integer('仅返回 project.log 该字节偏移之后的新增错误；用上次返回的 logOffset。'),
            }),
        );
        map.set('builder.queryPlatforms', this._object({ filter: this._string('可选平台名子串过滤。') }));
        map.set(
            'builder.querySchema',
            this._object({
                platform: this._string('平台 id；省略时返回通用 schema。'),
            }),
        );
        map.set('builder.queryDefaultConfig', this._object({ platform: this._string('平台 id。') }));
        map.set(
            'builder.build',
            this._object(
                {
                    platform: this._string('平台 id（如 web-desktop）。'),
                    options: this._freeObject('可选构建配置覆盖（透传 Creator）。'),
                    ...this._writeControl(),
                },
                ['platform'],
            ),
        );

        this._addLumenReadSchemas(map);
        this._addLumenWriteSchemas(map);
        return map;
    }

    /**
     * @description 追加 lumen 只读 operation 的 schema。
     * @param map 目标 schema 映射。
     * @returns 无返回值。
     */
    private _addLumenReadSchemas(map: Map<EditorMcpOperationId, IMcpJsonSchema>): void {
        map.set(
            'lumen.schema',
            this._object({
                type: this._string('组件类型，如 cc.Label；省略时返回清单。'),
                cocosVersion: this._string('可选 Creator 版本覆盖。'),
            }),
        );
        map.set('lumen.templates', this._object({ cocosVersion: this._string('可选 Creator 版本覆盖。') }));
        map.set(
            'lumen.tree',
            this._object({
                prefabRelativePath: this._assetPath(),
                assetRelativePath: this._assetPathAlias(),
                cocosVersion: this._string('可选 Creator 版本覆盖。'),
            }),
        );
        map.set(
            'lumen.inspect',
            this._object({
                prefabRelativePath: this._assetPath(),
                assetRelativePath: this._assetPathAlias(),
                nodePath: this._string('节点路径，如 /Root/Title，必须以 / 开头；独立资产可省略。'),
                region: this._freeObject('仅 .terrain：顶点盒或本地圆区域。'),
                cocosVersion: this._string('可选 Creator 版本覆盖。'),
            }),
        );
        map.set(
            'lumen.validateRefs',
            this._object({
                prefabRelativePath: this._assetPath(),
                assetRelativePath: this._assetPathAlias(),
            }),
        );
        map.set(
            'lumen.cocosInfo',
            this._object({
                engineRoot: this._string('可选引擎根或 cc.d.ts 路径（可为绝对路径）。'),
                cocosVersion: this._string('可选 Creator 版本覆盖。'),
                gapOffset: this._integer('缺口列表起始偏移；缺省 0。'),
                gapLimit: this._integer('缺口列表每页条数；缺省 40，最大 200。'),
            }),
        );
        map.set(
            'lumen.compileRecipe',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    rootName: this._string('空壳根节点名。'),
                    mode: this._enum(['replaceRoot', 'appendChildren'], 'replaceRoot 替换根；appendChildren 挂到空根下。'),
                    recipe: this._freeObject('replaceRoot 的根配方。'),
                    recipes: this._array('appendChildren 的同级子配方列表。'),
                    rootContentSize: this._wh('appendChildren 时空根 contentSize。'),
                    rootAnchorPoint: this._xy('appendChildren 时空根 anchorPoint。'),
                },
                ['prefabRelativePath', 'rootName', 'mode'],
            ),
        );
    }

    /**
     * @description 追加 lumen 写盘 operation 的 schema。
     * @param map 目标 schema 映射。
     * @returns 无返回值。
     */
    private _addLumenWriteSchemas(map: Map<EditorMcpOperationId, IMcpJsonSchema>): void {
        map.set(
            'lumen.scaffold',
            this._object({
                prefabRelativePath: this._assetPath(),
                assetRelativePath: this._assetPathAlias(),
                rootName: this._string('根节点名。'),
                template: this._string('模板 id，如 empty / ui/Label / standard / forward。'),
                cocosVersion: this._string('可选 Creator 版本覆盖。'),
                autoCommit: this._autoCommit(),
                reset: this._boolean('目标已存在时先删源文件与 .meta 再重建；默认 false。'),
                ...this._writeControl(),
            }),
        );
        map.set('lumen.structure', {
            type: 'object',
            properties: {
                prefabRelativePath: this._assetPath(),
                parentPath: this._nodePath('父节点路径，必须以 / 开头。'),
                cocosVersion: this._string('可选 Creator 版本覆盖。'),
                autoCommit: this._autoCommit(),
                ...this._writeControl(),
            },
            required: ['prefabRelativePath', 'parentPath', 'recipe'],
            // recipe 可为对象或数组，受限 schema 子集无法表达联合类型；
            // 这里放开顶层 additionalProperties，presence 由 required 保证，形状由 gateway 深校验。
            additionalProperties: true,
        });
        map.set(
            'lumen.nodeAdd',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    parentPath: this._nodePath('父节点路径，必须以 / 开头。'),
                    template: this._string('模板 id。'),
                    name: this._string('可选子节点名。'),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'parentPath', 'template'],
            ),
        );
        map.set(
            'lumen.nodeRm',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    nodePath: this._nodePath('要删除的节点路径，必须以 / 开头。'),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'nodePath'],
            ),
        );
        map.set(
            'lumen.nodeRename',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    nodePath: this._nodePath('节点路径，必须以 / 开头。'),
                    name: this._string('新名称。'),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'nodePath', 'name'],
            ),
        );
        map.set(
            'lumen.nodeReorder',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    parentPath: this._nodePath('父节点路径，必须以 / 开头。'),
                    childName: this._string('子节点名。'),
                    index: this._integer('目标下标（从 0 起）。'),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'parentPath', 'childName', 'index'],
            ),
        );
        map.set(
            'lumen.compAdd',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    nodePath: this._nodePath('节点路径，必须以 / 开头。'),
                    builtinType: this._string('内置组件类型；与 scriptName 二选一。'),
                    scriptName: this._string('脚本：assets/.../*.ts 路径或文件名（catalog）；多脚本同名时勿只用 @ccclass。'),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'nodePath'],
            ),
        );
        map.set(
            'lumen.compRm',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    nodePath: this._nodePath('节点路径，必须以 / 开头。'),
                    componentType: this._string('组件类型：cc.* 内置名、脚本路径/文件名/uuid，或 lumen-schema 返回的 compressedUuid。'),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'nodePath', 'componentType'],
            ),
        );
        map.set(
            'lumen.compSet',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    nodePath: this._nodePath('节点路径，必须以 / 开头。'),
                    componentType: this._string('组件类型：cc.* 内置名、脚本路径/文件名/uuid，或 lumen-schema 返回的 compressedUuid。'),
                    props: this._freeObject('白名单内的组件属性补丁对象。'),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'nodePath', 'componentType', 'props'],
            ),
        );
        map.set(
            'lumen.assetSet',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    assetRelativePath: this._assetPathAlias(),
                    props: this._freeObject('独立资产 Inspector 字段补丁对象。'),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['props'],
            ),
        );
        map.set(
            'lumen.nodeSet',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    nodePath: this._nodePath('节点路径，必须以 / 开头。'),
                    props: this._freeObject('节点属性补丁对象。'),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'nodePath', 'props'],
            ),
        );
        map.set(
            'lumen.bindClick',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    buttonNodePath: this._nodePath('Button 节点路径，必须以 / 开头。'),
                    targetNodePath: this._nodePath('目标节点路径，必须以 / 开头。'),
                    component: this._string('脚本：assets/.../*.ts、文件名、uuid，或工程内唯一的 @ccclass 类名（非首选）。'),
                    handler: this._string('回调方法名。'),
                    customEventData: this._string('自定义事件数据。'),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'buttonNodePath', 'targetNodePath', 'component', 'handler'],
            ),
        );
        map.set(
            'lumen.bindSprite',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    nodePath: this._nodePath('Sprite 节点路径，必须以 / 开头。'),
                    spriteFrameUuid: this._string('SpriteFrame uuid。'),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'nodePath', 'spriteFrameUuid'],
            ),
        );
        map.set(
            'lumen.bindSpriteBatch',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    assetRelativePath: this._assetPathAlias(),
                    bindings: this._array('绑定项列表，元素含 nodePath 与 spriteFrameUuid。'),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'bindings'],
            ),
        );
        map.set(
            'lumen.bindRef',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    assetRelativePath: this._assetPathAlias(),
                    nodePath: this._nodePath('持有字段的节点路径。'),
                    componentType: this._string('组件类型：cc.* 内置名、脚本路径/文件名/uuid，或 lumen-schema 返回的 compressedUuid。'),
                    field: this._string('字段名。'),
                    nodeRef: this._string('节点引用路径；与 componentRef 二选一。'),
                    componentRef: this._freeObject(
                        '组件引用 { nodePath: "/Root/Label", type: "cc.Label" }；与 nodeRef 二选一。内部写入节点路径。',
                    ),
                    cocosVersion: this._string('可选 Creator 版本覆盖。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'nodePath', 'componentType', 'field'],
            ),
        );
        map.set(
            'lumen.bindController',
            this._object(
                {
                    prefabRelativePath: this._assetPath(),
                    scriptRelativePath: this._string('控制器脚本项目相对路径，如 assets/ui/Panel.ts。'),
                    className: this._string('脚本类名。'),
                    propertyBindings: this._freeObject('属性名 -> 节点路径（/ 开头）或节点名。'),
                    propertyComponents: this._freeObject('属性名 -> cc 组件类型，如 cc.Label。'),
                    buttonEvents: this._array('按钮点击绑定：nodeName、nodePath、handler。'),
                    autoCommit: this._autoCommit(),
                    ...this._writeControl(),
                },
                ['prefabRelativePath', 'scriptRelativePath', 'className', 'propertyBindings'],
            ),
        );
        map.set(
            'lumen.refresh',
            this._object({
                paths: this._stringArray('可选项目相对路径列表；省略则刷新 db://assets。'),
                prefabRelativePath: this._assetPathAlias(),
                assetRelativePath: this._assetPathAlias(),
                ...this._writeControl(),
            }),
        );
        map.set(
            'lumen.commit',
            this._object({
                paths: this._stringArray('可选项目相对路径列表；省略则刷新 db://assets。'),
                prefabRelativePath: this._assetPathAlias(),
                assetRelativePath: this._assetPathAlias(),
                ...this._writeControl(),
            }),
        );
        map.set(
            'lumen.lodRecalcBounds',
            this._object({
                nodePath: this._string('可选节点路径。'),
                prefabRelativePath: this._assetPathAlias(),
                assetRelativePath: this._assetPathAlias(),
            }),
        );
        map.set(
            'reference.queryImage',
            this._object({
                scenePath: this._string('可选场景路径（当前拒绝）。'),
            }),
        );
        map.set(
            'reference.setImage',
            this._object(
                {
                    imagePath: this._string('Required image path (absolute / assets-relative / db://).'),
                    scenePath: this._string('Optional scene path hint.'),
                    opacity: this._number('Optional opacity (0-1 or 0-100).'),
                    x: this._number('Optional X offset (set-image-data).'),
                    y: this._number('Optional Y offset (set-image-data).'),
                    sx: this._number('Optional X scale (set-image-data).'),
                    sy: this._number('Optional Y scale (set-image-data).'),
                    visible: { type: 'boolean', description: 'Optional; false maps to opacity 0.' },
                    ...this._writeControl(),
                },
                ['imagePath'],
            ),
        );
    }

    /**
     * @description 构建仅接受空对象的 schema（无参 operation）。
     * @returns 空对象 schema。
     */
    private _empty(): IMcpJsonSchema {
        return { type: 'object', properties: {}, additionalProperties: false };
    }

    /**
     * @description 构建拒绝未声明字段的对象 schema。
     * @param properties 字段 schema 映射。
     * @param required 必填字段列表。
     * @returns 对象 schema。
     */
    private _object(
        properties: Readonly<Record<string, IMcpJsonSchema>>,
        required: readonly string[] = [],
        additionalProperties = false,
    ): IMcpJsonSchema {
        return required.length > 0
            ? { type: 'object', properties, required, additionalProperties }
            : { type: 'object', properties, additionalProperties };
    }

    /**
     * @description 写盘 operation 通用控制字段（供 Hub 审批消费）。
     * @returns 控制字段 schema 片段。
     */
    private _writeControl(): Readonly<Record<string, IMcpJsonSchema>> {
        return {
            confirmDestructive: this._boolean('destructive 操作必须显式传 true。'),
            approvalId: this._string('本地审批租约 ID（与 approvalToken 等价）。'),
            approvalToken: this._string('批次审批令牌 / 本地租约 token（与 approvalId 等价；双传时优先 approvalId）。'),
            resources: this._stringArray('本次授权资源集合。'),
        };
    }

    /**
     * @description 构建字符串字段 schema。
     * @param description 字段说明。
     * @returns 字符串 schema。
     */
    private _string(description: string): IMcpJsonSchema {
        return { type: 'string', description };
    }

    /**
     * @description 构建字符串枚举 schema。
     * @param values 允许值。
     * @param description 字段说明。
     * @returns 枚举 schema。
     */
    private _enum(values: readonly string[], description: string): IMcpJsonSchema {
        return { type: 'string', enum: values, description };
    }

    /**
     * @description 构建布尔字段 schema。
     * @param description 字段说明。
     * @returns 布尔 schema。
     */
    private _boolean(description: string): IMcpJsonSchema {
        return { type: 'boolean', description };
    }

    /**
     * @description 构建整数字段 schema。
     * @param description 字段说明。
     * @returns 整数 schema。
     */
    private _integer(description: string): IMcpJsonSchema {
        return { type: 'integer', description };
    }

    /**
     * @description 构建数值字段 schema。
     * @param description 字段说明。
     * @returns 数值 schema。
     */
    private _number(description: string): IMcpJsonSchema {
        return { type: 'number', description };
    }

    /**
     * @description 构建字符串数组字段 schema。
     * @param description 字段说明。
     * @returns 数组 schema。
     */
    private _stringArray(description: string): IMcpJsonSchema {
        return { type: 'array', items: { type: 'string' }, description };
    }

    /**
     * @description 构建元素不受约束的数组字段 schema。
     * @param description 字段说明。
     * @returns 数组 schema。
     */
    private _array(description: string): IMcpJsonSchema {
        return { type: 'array', description };
    }

    /**
     * @description 构建自由对象字段 schema（形状由深层校验保证）。
     * @param description 字段说明。
     * @returns 自由对象 schema。
     */
    private _freeObject(description: string): IMcpJsonSchema {
        return { type: 'object', additionalProperties: true, description };
    }

    /**
     * @description 构建 `{ width, height }` 对象字段 schema。
     * @param description 字段说明。
     * @returns 宽高对象 schema。
     */
    private _wh(description: string): IMcpJsonSchema {
        return {
            type: 'object',
            properties: { width: { type: 'number' }, height: { type: 'number' } },
            additionalProperties: false,
            description,
        };
    }

    /**
     * @description 构建 `{ x, y }` 对象字段 schema。
     * @param description 字段说明。
     * @returns 坐标对象 schema。
     */
    private _xy(description: string): IMcpJsonSchema {
        return {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            additionalProperties: false,
            description,
        };
    }

    /**
     * @description 构建资产主路径字段 schema。
     * @returns 项目相对路径 schema。
     */
    private _assetPath(): IMcpJsonSchema {
        return this._string('项目相对路径；禁止绝对路径与 ..；也可用 assetRelativePath 别名。');
    }

    /**
     * @description 构建资产路径别名字段 schema。
     * @returns 项目相对路径别名 schema。
     */
    private _assetPathAlias(): IMcpJsonSchema {
        return this._string('prefabRelativePath 的别名；二者同时提供时必须相等。');
    }

    /**
     * @description 构建节点路径字段 schema。
     * @param description 字段说明。
     * @returns 节点路径 schema。
     */
    private _nodePath(description: string): IMcpJsonSchema {
        return this._string(description);
    }

    /**
     * @description 构建 autoCommit 字段 schema。
     * @returns autoCommit schema。
     */
    private _autoCommit(): IMcpJsonSchema {
        return this._boolean('为 true 时写盘后自动执行 lumen.commit。');
    }
}
