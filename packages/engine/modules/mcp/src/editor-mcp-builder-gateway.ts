import type {
    ContractPayload,
    EditorMcpThinLayerAvailability,
    IBuilderBuildMcpInput,
    IBuilderQueryDefaultConfigMcpInput,
    IBuilderQueryPlatformsMcpInput,
    IBuilderQuerySchemaMcpInput,
} from '@peanut/pod-protocol';
import type { IGrantedRuntimeClientSet } from '@peanut/pod-sdk';

import { EditorMcpBuilderCompletion } from './editor-mcp-builder-completion.js';
import { EditorMcpThinLayerAvailabilityMapper } from './editor-mcp-thin-layer-availability.js';
import type { IEditorMcpThinLayerAvailabilityInput } from './editor-mcp-thin-layer-availability.js';
import { EditorMcpLumen24Bridge } from './editor-mcp-lumen-24-bridge.js';
import { CompatibleUuid } from '@peanut/pod-engine/assets';
import { EditorMcpBuilderPostBuildHookRegistry } from './editor-mcp-builder-post-build-hooks.js';

/**
 * @description Builder MCP 结果（可能标记不可用）。
 */
export interface IEditorMcpBuilderResult {
    /**
     * @description 是否可用。
     */
    readonly available: boolean;
    /**
     * @description 说明。
     */
    readonly message: string;
    /**
     * @description Agent 可观测：live / fallback / refused。
     */
    readonly availability: EditorMcpThinLayerAvailability;
    /**
     * @description 可选数据。
     */
    readonly data?: unknown;
    /**
     * @description 构建是否成功（仅 builder.build 语义；查询类可省略）。
     */
    readonly success?: boolean;
    /**
     * @description 提交、执行与制品验收状态；只有 completed 表示完成。
     */
    readonly status?: 'busy' | 'accepted' | 'failed' | 'completed' | 'blocked';
    /**
     * @description 本次唯一构建任务标识。
     */
    readonly taskId?: string;
    /**
     * @description 仅完成验证后提供的实际制品绝对路径。
     */
    readonly artifacts?: readonly string[];
    /**
     * @description 可选日志/下一步排查提示。
     */
    readonly logHints?: readonly string[];
    /**
     * @description 建议下一步 MCP 调用。
     */
    readonly recommendedNext?: {
        readonly operation: string;
        readonly input: Record<string, unknown>;
    };
}

/**
 * @description 构建薄层网关：优先 Creator builder message；未暴露时 available:false。
 */
export class EditorMcpBuilderGateway {
    /**
     * @description 授权 runtime。
     */
    private readonly _runtime: IGrantedRuntimeClientSet;

    /**
     * @description 构造构建网关。
     * @param runtime 授权 runtime。
     */
    public constructor(runtime: IGrantedRuntimeClientSet) {
        this._runtime = runtime;
    }

    /**
     * @description 查询可用平台。
     * @param input 可选过滤。
     * @returns 结果。
     */
    public async queryPlatforms(input: IBuilderQueryPlatformsMcpInput): Promise<IEditorMcpBuilderResult> {
        const result = await this._requestFirst(
            [
                ['query-platform-config', []],
                ['query-tasks-info', []],
                ['query-tasks-info', [{ type: 'build' }]],
                ['query-all-builder', []],
                ['query-tasks', []],
                ['get-builder-list', []],
                ['query-build-options', []],
            ],
            'builder_query_platforms',
        );
        if (!result.available || input.filter == null || input.filter.trim().length === 0) {
            return result;
        }
        const filter = input.filter.trim().toLowerCase();
        const platforms = extractPlatformIds(result.data).filter((item) => item.toLowerCase().includes(filter));
        return {
            available: true,
            message: `${result.message}:filtered`,
            data: { platforms, raw: result.data },
            availability: result.availability,
        };
    }

    /**
     * @description 查询构建选项 schema。
     * @param input 平台。
     * @returns 结果。
     */
    public async querySchema(input: IBuilderQuerySchemaMcpInput): Promise<IEditorMcpBuilderResult> {
        const platform = input.platform?.trim();
        const args = platform == null || platform.length === 0 ? [] : [platform];
        return this._requestFirst(
            [
                ['query-platform-config', []],
                ['query-tasks-info', []],
                ['query-bundle-config', []],
                ['query-build-options', args],
                ['query-options', args],
                ['query-build-config', args],
            ],
            'builder_query_schema',
        );
    }

    /**
     * @description 查询默认构建配置。
     * @param input 平台。
     * @returns 结果。
     */
    public async queryDefaultConfig(input: IBuilderQueryDefaultConfigMcpInput): Promise<IEditorMcpBuilderResult> {
        const platform = input.platform?.trim() ?? '';
        const resolved = await this._queryBuildOptionsTemplate(platform);
        if (resolved == null) {
            return this._finalize({
                available: false,
                message: 'builder_query_default_config_unavailable:no_executable_default_options',
            });
        }
        return this._finalize({
            available: true,
            message: `builder_query_default_config_ok:${resolved.messageName}`,
            data: resolved.options,
        });
    }

    /**
     * @description 触发构建（destructive）。
     * @param input 构建入参。
     * @returns 结果。
     */
    public async build(input: IBuilderBuildMcpInput): Promise<IEditorMcpBuilderResult> {
        const platform = input.platform.trim();
        const options = input.options ?? {};
        const taskOptions = await this._resolveBuildOptions(platform, options);
        const taskId = CompatibleUuid.create();
        taskOptions.taskId = taskId;
        const startedAt = Date.now();
        // 只提交一次；传输异常不能证明任务未创建，禁止盲目换接口重复构建。
        const raw = await this._requestFirst([['add-task', [taskOptions, false]]], 'builder_build');
        const enriched = await new EditorMcpBuilderCompletion(this._runtime).resolve(raw, taskId, platform, startedAt);
        if (enriched.status === 'completed' && enriched.success === true) {
            await EditorMcpBuilderPostBuildHookRegistry.notify(enriched, input);
        }
        return enriched;
    }

    /**
     * @description 解析 platforms 输入。
     * @param input 未校验输入。
     * @returns 输入。
     */
    public readPlatformsInput(input: ContractPayload | undefined): IBuilderQueryPlatformsMcpInput {
        const filter =
            input != null && typeof input.filter === 'string' && input.filter.trim().length > 0 ? input.filter.trim() : undefined;
        return filter == null ? {} : { filter };
    }

    /**
     * @description 解析 schema 输入。
     * @param input 未校验输入。
     * @returns 输入。
     */
    public readSchemaInput(input: ContractPayload | undefined): IBuilderQuerySchemaMcpInput {
        const platform =
            input != null && typeof input.platform === 'string' && input.platform.trim().length > 0 ? input.platform.trim() : undefined;
        return platform == null ? {} : { platform };
    }

    /**
     * @description 解析 defaultConfig 输入。
     * @param input 未校验输入。
     * @returns 输入。
     */
    public readDefaultConfigInput(input: ContractPayload | undefined): IBuilderQueryDefaultConfigMcpInput {
        return this.readSchemaInput(input);
    }

    /**
     * @description 解析 build 输入。
     * @param input 未校验输入。
     * @returns 输入。
     */
    public readBuildInput(input: ContractPayload | undefined): IBuilderBuildMcpInput {
        if (input == null || typeof input.platform !== 'string' || input.platform.trim().length === 0) {
            throw new Error('editor_mcp_builder_platform_required');
        }
        const options =
            input.options != null && typeof input.options === 'object' && !Array.isArray(input.options)
                ? (input.options as Readonly<Record<string, unknown>>)
                : undefined;
        return {
            platform: input.platform.trim(),
            ...(options == null ? {} : { options }),
        };
    }

    /**
     * @description 合并调用方选项与 Creator 模板，不合成制品证据。
     * @param platform 平台编号。
     * @param options 调用方选项。
     * @returns 提交给 add-task 的选项。
     */
    private async _resolveBuildOptions(platform: string, options: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
        const merged: Record<string, unknown> = { ...options, platform };
        const message = this._runtime.message;
        if (message != null) {
            try {
                await message.request('builder', 'query-worker-ready');
            } catch {
                try {
                    await message.request('builder', 'open', 'default');
                } catch {
                    // ignore
                }
            }
            const resolved = await this._queryBuildOptionsTemplate(platform);
            if (resolved != null) {
                for (const [key, value] of Object.entries(resolved.options)) {
                    if (!(key in merged) && value != null) {
                        merged[key] = value;
                    }
                }
            }
        }
        if (typeof merged.buildPath !== 'string' || merged.buildPath.trim().length === 0) {
            // Creator convention relative build root — not an invented absolute artifact path.
            merged.buildPath = 'project://build';
        }
        if (typeof options.debug !== 'boolean') {
            merged.debug = false;
        }
        if (typeof merged.outputName !== 'string' || merged.outputName.trim().length === 0) {
            merged.outputName = platform;
        }
        if (typeof merged.taskName !== 'string' || merged.taskName.trim().length === 0) {
            merged.taskName = platform;
        }
        if (
            (platform === 'web-desktop' || platform === 'web-mobile') &&
            (typeof merged.mainBundleCompressionType !== 'string' || merged.mainBundleCompressionType.trim().length === 0)
        ) {
            merged.mainBundleCompressionType = 'merge_dep';
        }
        return merged;
    }

    /**
     * @description Query Creator messages until one yields executable build options.
     * @param platform Target platform; empty means Creator-wide defaults.
     * @returns Resolved options and source message, or null.
     */
    private async _queryBuildOptionsTemplate(
        platform: string,
    ): Promise<{ readonly messageName: string; readonly options: Record<string, unknown> } | null> {
        const message = this._runtime.message;
        if (message == null) {
            return null;
        }
        const platformArgs = platform.length === 0 ? [] : [platform];
        const candidates: readonly (readonly [string, readonly unknown[]])[] = [
            ['query-default-config', platformArgs],
            ['get-default-build-options', platformArgs],
            ['query-build-options', platformArgs],
            ['query-tasks-info', []],
        ];
        for (const [messageName, args] of candidates) {
            try {
                const rawTemplate = await message.request('builder', messageName, ...args);
                const template = pickBuildOptionsTemplate(rawTemplate, platform);
                if (template != null) {
                    return { messageName, options: template };
                }
            } catch {
                // optional Creator message
            }
        }
        return null;
    }

    /**
     * @description 尝试已知消息并保留可诊断响应。
     * @param candidates 候选消息。
     * @param label 响应前缀。
     * @returns 薄层结果。
     */
    private async _requestFirst(
        candidates: readonly (readonly [string, readonly unknown[]])[],
        label: string,
    ): Promise<IEditorMcpBuilderResult> {
        if (EditorMcpLumen24Bridge.isCreator2x()) {
            return this._finalize({
                available: false,
                message: `${label}_unavailable:creator2x:builder_ipc_not_ported`,
            });
        }
        const message = this._runtime.message;
        if (message == null) {
            return this._finalize({
                available: false,
                message: `${label}_unavailable:runtime_message_missing`,
            });
        }
        const errors: string[] = [];
        for (const [name, args] of candidates) {
            try {
                const data = await message.request('builder', name, ...args);
                return this._finalize({
                    available: true,
                    message: `${label}_ok:${name}`,
                    data,
                });
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                errors.push(`${name}:${detail.replace(/\s+/gu, ' ').slice(0, 160)}`);
            }
        }
        return this._finalize({
            available: false,
            message:
                errors.length === 0
                    ? `${label}_unavailable:no_supported_message`
                    : `${label}_unavailable:no_supported_message:${errors.slice(0, 4).join('|')}`,
            ...(errors.length > 0 ? { logHints: errors.slice(0, 6) } : {}),
        });
    }

    /**
     * @description 为构建薄层结果附加 availability。
     * @param result 原始结果片段。
     * @returns 完整构建结果。
     */
    private _finalize(result: IEditorMcpThinLayerAvailabilityInput & Partial<IEditorMcpBuilderResult>): IEditorMcpBuilderResult {
        return EditorMcpThinLayerAvailabilityMapper.attach(result);
    }
}

/**
 * @description Walk builder response payloads for artifact/output path hints.
 * @param raw Raw Creator builder response.
 * @returns Deduped path list (forward-slash normalized).
 * @oopException Pure helper
 */
export function extractArtifactHints(raw: unknown): string[] {
    const out: string[] = [];
    const PATH_KEYS = new Set([
        'output',
        'outputPath',
        'outputDir',
        'outputDirectory',
        'dest',
        'destPath',
        'buildPath',
        'buildDir',
        'buildDest',
        'outDir',
        'outdir',
        'artifacts',
        'artifact',
        'path',
        'paths',
        'file',
        'filePath',
        'resultPath',
        'packagePath',
        'cachePath',
        'logPath',
        'buildLogPath',
        'outputName',
        'buildFolder',
        'buildFolderRelative',
        'nativeDir',
        'projectName',
        'taskId',
        'logFile',
        'buildLog',
        'logDest',
        'taskName',
    ]);
    const looksLikePath = (trimmed: string): boolean => {
        if (trimmed.length < 2) {
            return false;
        }
        if (
            /^(?:web-desktop|web-mobile|android|ios|ohos|windows|mac|linux|wechatgame|bytedance|huawei|alipay|taobao|oppo|vivo|xiaomi|baidu)$/iu.test(
                trimmed,
            )
        ) {
            // Creator sometimes returns bare platform id; map to deterministic build/<platform>
            return false;
        }
        if (!(trimmed.includes('/') || trimmed.includes('\\'))) {
            return false;
        }
        if (
            /(?:^|[\\/])(?:build|dist|output|out|publish|native|android|ios|ohos|web-desktop|web-mobile)(?:[\\/]|$)/iu.test(trimmed) ||
            /\.(zip|apk|ipa|exe|html|js|wasm|pak|appx|hap|aab)$/iu.test(trimmed) ||
            /[A-Za-z]:[\\/]/.test(trimmed) ||
            trimmed.startsWith('db://')
        ) {
            return true;
        }
        return false;
    };
    const visit = (value: unknown, depth: number, parentKey: string | null): void => {
        if (value == null || depth > 6) {
            return;
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (looksLikePath(trimmed) || (parentKey != null && PATH_KEYS.has(parentKey) && trimmed.length > 0)) {
                if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.startsWith('db://')) {
                    out.push(trimmed.replace(/\\/gu, '/'));
                }
            }
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                visit(item, depth + 1, parentKey);
            }
            return;
        }
        if (typeof value === 'object') {
            const record = value as Record<string, unknown>;
            for (const [key, child] of Object.entries(record)) {
                if (PATH_KEYS.has(key) || /path|dest|output|artifact|build/iu.test(key)) {
                    visit(child, depth + 1, key);
                } else if (depth < 3) {
                    visit(child, depth + 1, key);
                }
            }
        }
    };
    visit(raw, 0, null);
    return [...new Set(out)].slice(0, 40);
}

/**
 * @description 从 builder 原始结果尽力提取平台 id。
 * @param raw 原始数据。
 * @returns 平台 id 列表。
 * @oopException 纯解析。
 */
function extractPlatformIds(raw: unknown): string[] {
    if (raw == null) {
        return [];
    }
    if (Array.isArray(raw)) {
        return raw
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }
                if (item != null && typeof item === 'object' && !Array.isArray(item)) {
                    const record = item as Record<string, unknown>;
                    if (typeof record.platform === 'string') {
                        return record.platform;
                    }
                    if (typeof record.id === 'string') {
                        return record.id;
                    }
                    if (typeof record.name === 'string') {
                        return record.name;
                    }
                }
                return '';
            })
            .filter((item) => item.length > 0);
    }
    if (typeof raw === 'object') {
        const record = raw as Record<string, unknown>;
        if (Array.isArray(record.order)) {
            return record.order.filter((item): item is string => typeof item === 'string' && item.length > 0);
        }
        if (record.config != null && typeof record.config === 'object' && !Array.isArray(record.config)) {
            return Object.keys(record.config as Record<string, unknown>);
        }
        if (Array.isArray(record.platforms)) {
            return extractPlatformIds(record.platforms);
        }
        if (Array.isArray(record.list)) {
            return extractPlatformIds(record.list);
        }
        if (Array.isArray(record.tasks)) {
            return extractPlatformIds(record.tasks);
        }
        return Object.keys(record);
    }
    return [];
}

/**
 * @description Pick build options template from Creator default-config or task payloads.
 * @param raw Creator builder payload.
 * @param platform Target platform.
 * @returns Template options or null.
 * @oopException Pure helper
 */
function pickBuildOptionsTemplate(raw: unknown, platform: string): Record<string, unknown> | null {
    if (raw == null || typeof raw !== 'object') {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const direct = pickDirectBuildOptions(record, platform);
    if (direct != null) {
        return direct;
    }
    const lists: unknown[] = [];
    if (Array.isArray(record.list)) {
        lists.push(...record.list);
    }
    if (record.queue != null && typeof record.queue === 'object') {
        lists.push(...Object.values(record.queue as Record<string, unknown>));
    }
    const platformLower = platform.toLowerCase();
    for (const item of lists) {
        if (item == null || typeof item !== 'object' || Array.isArray(item)) {
            continue;
        }
        const task = item as Record<string, unknown>;
        const options =
            task.options != null && typeof task.options === 'object' && !Array.isArray(task.options)
                ? (task.options as Record<string, unknown>)
                : task.rawOptions != null && typeof task.rawOptions === 'object' && !Array.isArray(task.rawOptions)
                  ? (task.rawOptions as Record<string, unknown>)
                  : null;
        if (options == null) {
            continue;
        }
        const optionPlatform = typeof options.platform === 'string' ? options.platform.toLowerCase() : '';
        if (optionPlatform === platformLower || optionPlatform.length === 0) {
            return { ...options, platform };
        }
    }
    for (const item of lists) {
        if (item == null || typeof item !== 'object' || Array.isArray(item)) {
            continue;
        }
        const task = item as Record<string, unknown>;
        if (task.options != null && typeof task.options === 'object' && !Array.isArray(task.options)) {
            return { ...(task.options as Record<string, unknown>), platform };
        }
    }
    return null;
}

/**
 * @description Read a direct build-options object from common Creator response wrappers.
 * @param record Creator response record.
 * @param platform Target platform.
 * @returns Direct options or null.
 * @oopException Pure helper
 */
function pickDirectBuildOptions(record: Record<string, unknown>, platform: string): Record<string, unknown> | null {
    for (const key of ['options', 'rawOptions', 'config', 'defaultConfig', 'buildOptions']) {
        const value = record[key];
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            continue;
        }
        const candidate = value as Record<string, unknown>;
        const platformValue = candidate[platform];
        if (platformValue != null && typeof platformValue === 'object' && !Array.isArray(platformValue)) {
            return { ...(platformValue as Record<string, unknown>), platform };
        }
        if (looksLikeBuildOptions(candidate)) {
            return { ...candidate, platform };
        }
    }
    return looksLikeBuildOptions(record) ? { ...record, platform } : null;
}

/**
 * @description Decide whether an object contains executable build options rather than platform schema metadata.
 * @param value Candidate record.
 * @returns Whether the record looks like build options.
 * @oopException Pure helper
 */
function looksLikeBuildOptions(value: Readonly<Record<string, unknown>>): boolean {
    return ['platform', 'buildPath', 'outputName', 'taskName', 'mainBundleCompressionType', 'scenes', 'debug'].some(
        (key) => key in value,
    );
}
