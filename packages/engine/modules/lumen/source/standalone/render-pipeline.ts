import { LumenJsonAssetIo } from '../io/json-asset';
import { LumenCocosVersion } from '../schema/cocos-version';
import { LumenStandaloneInspectQuery } from './inspect-query';

/**
 * @description Render Pipeline 流快照。
 */
export interface ILumenRenderPipelineFlowInspect {
    /** @description 流下标。 */
    readonly index: number;
    /** @description 流类型或 `uuid`。 */
    readonly type: string;
    /** @description 流名。 */
    readonly name: string;
    /** @description 优先级。 */
    readonly priority: number;
    /** @description 内嵌 stage 数量。 */
    readonly stageCount: number;
    /** @description uuid 引用；内嵌流时为 `null`。 */
    readonly uuid: string | null;
}

/**
 * @description Render Pipeline Inspector 快照。不克隆 dump 树 UI。
 */
export interface ILumenRenderPipelineInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'renderPipeline';
    /** @description `_name`。 */
    readonly name: string;
    /** @description `_tag`；Forward 模板可能没有。 */
    readonly tag: number | null;
    /** @description 头 `__type__`。 */
    readonly type: string;
    /** @description 流列表。 */
    readonly flows: readonly ILumenRenderPipelineFlowInspect[];
}

/**
 * @description `.rpp` 文档：空管线或 Forward 模板；只改名/tag/流名与优先级。
 */
export class LumenRenderPipelineDocument {
    /** @description 读写辅助。 */
    private readonly _io = new LumenJsonAssetIo();

    /** @description 项目相对路径。 */
    private readonly _relativePath: string;

    /** @description 单对象形态。 */
    private _record: Record<string, unknown> | null;

    /** @description 数组形态（Forward 等）。 */
    private _entries: Record<string, unknown>[] | null;

    /**
     * @description 从对象或数组创建文档。
     * @param relativePath 相对路径
     * @param record 单对象；数组形态时为 `null`
     * @param entries 数组；单对象形态时为 `null`
     */
    public constructor(
        relativePath: string,
        record: Record<string, unknown> | null,
        entries: Record<string, unknown>[] | null,
    ) {
        this._relativePath = relativePath;
        this._record = record;
        this._entries = entries;
    }

    /**
     * @description 相对项目根路径。
     * @returns 路径
     */
    public get relativePath(): string {
        return this._relativePath;
    }

    /**
     * @description 资产种类。
     * @returns `renderPipeline`
     */
    public get kind(): 'renderPipeline' {
        return 'renderPipeline';
    }

    /**
     * @description 创建空管线或 Forward 模板。
     * @param relativePath 相对路径
     * @param name 名称
     * @param template `empty` 或 `forward`
     * @returns 文档
     */
    public static createEmpty(
        relativePath: string,
        name: string,
        template: string = 'empty',
    ): LumenRenderPipelineDocument {
        if (template === 'forward') {
            return new LumenRenderPipelineDocument(relativePath, null, [
                {
                    __type__: 'ForwardPipeline',
                    _name: name.trim(),
                    _flows: [{ __id__: 1 }],
                    renderTextures: [],
                },
                {
                    __type__: 'ForwardFlow',
                    _name: 'ForwardFlow',
                    _priority: 0,
                    _material: null,
                    _stages: [{ __id__: 2 }],
                },
                {
                    __type__: 'ForwardStage',
                    _name: 'ForwardStage',
                    _priority: 0,
                    frameBuffer: '',
                    renderQueues: [{ __id__: 3 }, { __id__: 4 }],
                },
                {
                    __type__: 'RenderQueueDesc',
                    isTransparent: false,
                    sortMode: 0,
                    stages: ['default'],
                },
                {
                    __type__: 'RenderQueueDesc',
                    isTransparent: true,
                    sortMode: 1,
                    stages: ['default', 'planarShadow'],
                },
            ]);
        }
        if (template !== 'empty') {
            throw new Error(`lumen_render_pipeline_template_unknown:${template}`);
        }
        return new LumenRenderPipelineDocument(
            relativePath,
            {
                __type__: 'cc.RenderPipeline',
                _name: name.trim(),
                _objFlags: 0,
                _native: '',
                _tag: 0,
                _flows: [],
            },
            null,
        );
    }

    /**
     * @description 从磁盘打开 `.rpp`。
     * @param projectRoot 项目根
     * @param relativePath 相对路径
     * @returns 文档
     */
    public static open(projectRoot: string, relativePath: string): LumenRenderPipelineDocument {
        const io = new LumenJsonAssetIo();
        const parsed = io.readJsonValue(
            projectRoot,
            relativePath,
            'lumen_render_pipeline_missing',
            'lumen_render_pipeline_json_corrupt',
        );
        if (Array.isArray(parsed)) {
            const entries = io.readEntries(
                projectRoot,
                relativePath,
                ['cc.RenderPipeline', 'ForwardPipeline'],
                'lumen_render_pipeline_missing',
                'lumen_render_pipeline_json_corrupt',
            );
            return new LumenRenderPipelineDocument(relativePath, null, entries);
        }
        if (parsed == null || typeof parsed !== 'object') {
            throw new Error(`lumen_render_pipeline_json_corrupt:${relativePath}`);
        }
        const record = parsed as Record<string, unknown>;
        if (record.__type__ !== 'cc.RenderPipeline' && record.__type__ !== 'ForwardPipeline') {
            throw new Error(`lumen_render_pipeline_json_corrupt:${relativePath}`);
        }
        return new LumenRenderPipelineDocument(relativePath, record, null);
    }

    /**
     * @description 读取类型、tag 与流摘要。
     * @param query Pipeline 不接受查询键
     * @returns 快照
     */
    public inspect(query?: Readonly<Record<string, unknown>>): ILumenRenderPipelineInspect {
        LumenStandaloneInspectQuery.rejectIfPresent(query, 'renderPipeline');
        const header = this._header();
        const typeName = typeof header.__type__ === 'string' ? header.__type__ : 'cc.RenderPipeline';
        return {
            path: this._relativePath,
            kind: 'renderPipeline',
            name: typeof header._name === 'string' ? header._name : '',
            tag: typeof header._tag === 'number' && Number.isFinite(header._tag) ? header._tag : null,
            type: typeName,
            flows: this._readFlows(),
        };
    }

    /**
     * @description 写入名称、tag、流名/优先级，或对象形态的 flow uuid 列表。
     * @param patch `name` / `tag` / `flows` / `flowUuids`
     */
    public applyPatch(patch: Readonly<Record<string, unknown>>): void {
        this._assertOnlyFields(patch, ['name', 'tag', 'flows', 'flowUuids'], 'renderPipeline');
        const header = this._header();
        if (patch.name !== undefined) {
            if (typeof patch.name !== 'string') {
                throw new Error('lumen_render_pipeline_property_type:name:string');
            }
            header._name = patch.name;
        }
        if (patch.tag !== undefined) {
            if (typeof patch.tag !== 'number' || !Number.isInteger(patch.tag) || patch.tag < 0) {
                throw new Error('lumen_render_pipeline_property_type:tag:integer');
            }
            header._tag = patch.tag;
        }
        if (patch.flowUuids !== undefined) {
            this._patchFlowUuids(header, patch.flowUuids);
        }
        if (patch.flows !== undefined) {
            this._patchFlows(patch.flows);
        }
    }

    /**
     * @description 在内存中序列化原生源，由AssetDB首次创建并分配meta。
     * @returns 完整原生JSON源。
     */
    public serializeNativeSource(): string {
        return `${JSON.stringify(this._entries ?? this._record, null, 2)}\n`;
    }

    /**
     * @description 写回磁盘与最小 meta。
     * @param projectRoot 项目根
     * @param writeMetaIfMissing 缺少 meta 时是否创建
     */
    public save(
        projectRoot: string,
        writeMetaIfMissing: boolean = true,
        cocosVersion: LumenCocosVersion = LumenCocosVersion.DEFAULT,
    ): void {
        if (this._entries != null) {
            this._io.writeEntries(
                projectRoot,
                this._relativePath,
                this._entries,
                'render-pipeline',
                writeMetaIfMissing,
                cocosVersion,
            );
            return;
        }
        if (this._record == null) {
            throw new Error(`lumen_render_pipeline_json_corrupt:${this._relativePath}`);
        }
        this._io.writeRecord(
            projectRoot,
            this._relativePath,
            this._record,
            'render-pipeline',
            writeMetaIfMissing,
            cocosVersion,
        );
    }

    /**
     * @description 读取头对象。
     * @returns 头
     */
    private _header(): Record<string, unknown> {
        if (this._record != null) {
            return this._record;
        }
        const header = this._entries?.[0];
        if (header == null) {
            throw new Error(`lumen_render_pipeline_json_corrupt:${this._relativePath}`);
        }
        return header;
    }

    /**
     * @description 读取流摘要。
     * @returns 流列表
     */
    private _readFlows(): ILumenRenderPipelineFlowInspect[] {
        const raw = this._header()._flows;
        if (!Array.isArray(raw)) {
            return [];
        }
        const flows: ILumenRenderPipelineFlowInspect[] = [];
        for (let index = 0; index < raw.length; index += 1) {
            const uuid = this._io.readUuid(raw[index]);
            if (uuid != null) {
                flows.push({
                    index,
                    type: 'uuid',
                    name: '',
                    priority: 0,
                    stageCount: 0,
                    uuid,
                });
                continue;
            }
            const flow =
                this._entries != null
                    ? this._io.resolveMutableEntry(this._entries, raw[index])
                    : raw[index] != null && typeof raw[index] === 'object' && !Array.isArray(raw[index])
                      ? (raw[index] as Record<string, unknown>)
                      : null;
            if (flow == null) {
                continue;
            }
            const stages = Array.isArray(flow._stages) ? flow._stages.length : 0;
            flows.push({
                index,
                type: typeof flow.__type__ === 'string' ? flow.__type__ : '',
                name: typeof flow._name === 'string' ? flow._name : '',
                priority: typeof flow._priority === 'number' && Number.isFinite(flow._priority) ? flow._priority : 0,
                stageCount: stages,
                uuid: null,
            });
        }
        return flows;
    }

    /**
     * @description 仅对象形态可整表替换 flow uuid。
     * @param header 头
     * @param value uuid 数组
     */
    private _patchFlowUuids(header: Record<string, unknown>, value: unknown): void {
        if (this._entries != null) {
            throw new Error('lumen_render_pipeline_property_not_editable:flowUuids:array_pipeline');
        }
        if (!Array.isArray(value)) {
            throw new Error('lumen_render_pipeline_property_type:flowUuids:array');
        }
        const encoded: Array<Record<string, unknown>> = [];
        for (let index = 0; index < value.length; index += 1) {
            const item = value[index];
            if (typeof item !== 'string' || item.trim().length === 0) {
                throw new Error(`lumen_render_pipeline_property_type:flowUuids[${index}]:uuid`);
            }
            encoded.push({ __uuid__: item.trim() });
        }
        header._flows = encoded;
    }

    /**
     * @description 按 index 改流名或优先级。
     * @param value 流补丁列表
     */
    private _patchFlows(value: unknown): void {
        if (!Array.isArray(value)) {
            throw new Error('lumen_render_pipeline_property_type:flows:array');
        }
        const raw = this._header()._flows;
        if (!Array.isArray(raw)) {
            throw new Error('lumen_render_pipeline_property_type:flows:missing');
        }
        for (let itemIndex = 0; itemIndex < value.length; itemIndex += 1) {
            const item = value[itemIndex];
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_render_pipeline_property_type:flows[${itemIndex}]:object`);
            }
            const patch = item as Record<string, unknown>;
            this._assertOnlyFields(patch, ['index', 'name', 'priority'], `flows[${itemIndex}]`);
            if (typeof patch.index !== 'number' || !Number.isInteger(patch.index) || patch.index < 0) {
                throw new Error(`lumen_render_pipeline_property_type:flows[${itemIndex}].index:integer`);
            }
            const uuid = this._io.readUuid(raw[patch.index]);
            if (uuid != null) {
                throw new Error(`lumen_render_pipeline_property_not_editable:flows[${itemIndex}]:uuid_flow`);
            }
            const flow =
                this._entries != null
                    ? this._io.resolveMutableEntry(this._entries, raw[patch.index])
                    : null;
            if (flow == null) {
                throw new Error(`lumen_render_pipeline_property_range:flows[${itemIndex}].index:missing`);
            }
            if (patch.name !== undefined) {
                if (typeof patch.name !== 'string') {
                    throw new Error(`lumen_render_pipeline_property_type:flows[${itemIndex}].name:string`);
                }
                flow._name = patch.name;
            }
            if (patch.priority !== undefined) {
                if (typeof patch.priority !== 'number' || !Number.isInteger(patch.priority)) {
                    throw new Error(`lumen_render_pipeline_property_type:flows[${itemIndex}].priority:integer`);
                }
                flow._priority = patch.priority;
            }
        }
    }

    /**
     * @description 拒绝不在白名单内的补丁字段。
     * @param value 补丁
     * @param allowed 允许字段
     * @param scope 分组
     */
    private _assertOnlyFields(
        value: Readonly<Record<string, unknown>>,
        allowed: readonly string[],
        scope: string,
    ): void {
        const allowedSet = new Set(allowed);
        for (const key of Object.keys(value)) {
            if (!allowedSet.has(key)) {
                throw new Error(
                    `lumen_render_pipeline_property_not_editable:${scope}.${key}:allowed=${allowed.join(',')}`,
                );
            }
        }
    }
}
