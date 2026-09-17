/**
 * @description 资产写操作资源推导与授权集合：推导业务资源 ∪ 声明 resources，二者均须被 lease 覆盖。
 * 声明（input.resources / invocation.resourceIds）不得单独替换推导校验（堵住「口是心非」越权）。
 * 匹配策略 A：归一后精确 ⊆，无 parent/前缀覆盖。
 */
import { normalizeResourceKey, normalizeResourceKeys } from './normalize-resource-key.js';

const GENERIC_KEYS = Object.freeze([
    'paths',
    'sources',
    'targets',
    'dbPaths',
    'files',
    'path',
    'from',
    'to',
    'target',
    'targetDirectory',
    'uuid',
    'url',
    'prefabRelativePath',
    'assetRelativePath',
    'imagePath',
    'scenePath',
    'nodePath',
    'prefabPath',
    'parentPath',
    'scriptRelativePath',
    'platform',
] as const);

/** @description 按资产写 op 固定理想业务字段（不含声明用的 resources）。 */
const ASSET_OP_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    'asset.catalog.refresh': Object.freeze([] as string[]),
    'asset.createFolder': Object.freeze(['path']),
    'asset.delete': Object.freeze(['paths']),
    'asset.move': Object.freeze(['from', 'to']),
    'asset.copy': Object.freeze(['paths', 'targetDirectory']),
    'asset.import': Object.freeze(['sources', 'target']),
    'asset.rename': Object.freeze(['path']),
    'asset.writeText': Object.freeze(['path', 'files']),
    'asset.reimport': Object.freeze(['paths', 'path']),
    'asset.open': Object.freeze(['path', 'url', 'uuid']),
    'asset.ensureSpriteFramesBatch': Object.freeze(['dbPaths']),
    // replaceReferences：必须采 fromUuid/toUuid（+targets）；禁止默默回退整树 db://assets
    'asset.replaceReferences': Object.freeze(['fromUuid', 'toUuid', 'targets']),
});

/**
 * @description `asset.import` 允许从项目外读取源文件，但目标仍必须位于项目资产空间。
 */
const EXTERNAL_SOURCE_KEYS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
    'asset.import': new Set(['sources']),
});

/**
 * @description 从输入采集字符串资源键（支持 string[] 与 {path}[]）。
 * @param value 未校验值。
 * @param into 采集目标。
 * @returns 无返回值。
 */
function collectRaw(value: unknown, into: string[]): void {
    if (typeof value === 'string' && value.trim().length > 0) {
        into.push(value);
        return;
    }
    if (!Array.isArray(value)) {
        return;
    }
    for (const item of value) {
        if (typeof item === 'string') {
            collectRaw(item, into);
            continue;
        }
        if (typeof item === 'object' && item != null && 'path' in item) {
            collectRaw((item as { path: unknown }).path, into);
        }
    }
}

/**
 * @description 在调用宿主前拒绝资产写操作中的绝对目标路径和 `.`/`..` 逃逸段。
 * @param operation 稳定 operation
 * @param input 已通过 schema 校验的业务输入
 * @returns 路径安全时无返回；否则抛出稳定错误
 */
export class WriteResourceAuthorization {
    /**
     * @description 在调用宿主前拒绝资产写操作中的绝对目标路径和 `.`/`..` 逃逸段。
     * @param operation 稳定 operation
     * @param input 已通过 schema 校验的业务输入
     * @returns 路径安全时无返回；否则抛出稳定错误
     */
    public static assertSafePaths(
        operation: string,
        input: Readonly<Record<string, unknown>>,
    ): void {
        const assetKeys = ASSET_OP_KEYS[operation];
        if (assetKeys == null) {
            return;
        }
        const externalSourceKeys = EXTERNAL_SOURCE_KEYS[operation] ?? new Set<string>();
        for (const key of assetKeys) {
            if (externalSourceKeys.has(key)) {
                continue;
            }
            const values: string[] = [];
            collectRaw(input[key], values);
            for (const value of values) {
                if (isUnsafeProjectPath(value)) {
                    throw new Error(`core_cocos_mcp_execution_resource_path_invalid:${operation}:${key}`);
                }
            }
        }
    }
}

/**
 * @description 判断应留在项目资产空间的路径是否为绝对路径或包含导航逃逸段。
 * @param value 未信任路径
 */
function isUnsafeProjectPath(value: string): boolean {
    const normalized = value.trim().replace(/\\/gu, '/');
    if (normalized.length === 0) {
        return false;
    }
    if (normalized.startsWith('/') || /^[a-z]:\//iu.test(normalized)) {
        return true;
    }
    const path = normalized.startsWith('db://') ? normalized.slice('db://'.length) : normalized;
    return path.split('/').some((segment) => segment === '.' || segment === '..');
}

/**
 * @description 按 operation 推导业务资源集（不含 input.resources 声明）。
 * @param operation 稳定 operation。
 * @param input 已校验或原始业务输入。
 * @returns 归一后的业务资源列表；无有效资源时可能为空（调用方 fail-closed）。
 */
export function extractWriteResources(
    operation: string,
    input: Readonly<Record<string, unknown>>,
): readonly string[] {
    const collected: string[] = [];
    const assetKeys = ASSET_OP_KEYS[operation];
    if (assetKeys != null) {
        for (const key of assetKeys) {
            collectRaw(input[key], collected);
        }
        if (collected.length > 0) {
            return normalizeResourceKeys(collected);
        }
        // 显式整库哨兵：仅 refresh / 无 path 的 reimport 允许
        if (operation === 'asset.catalog.refresh' || operation === 'asset.reimport') {
            return Object.freeze(['db://assets']);
        }
        // replaceReferences 等：禁止回退整树
        return Object.freeze([]);
    }

    for (const key of GENERIC_KEYS) {
        collectRaw(input[key], collected);
    }
    if (collected.length > 0) {
        return normalizeResourceKeys(collected);
    }
    const domain = operation.split('.')[0] ?? operation;
    if (domain === 'scene') {
        return Object.freeze(['scene:active']);
    }
    if (domain === 'asset' || domain === 'lumen' || domain === 'prefab') {
        return Object.freeze(['db://assets']);
    }
    if (domain === 'preview') {
        return Object.freeze(['preview']);
    }
    if (domain === 'builder') {
        return Object.freeze(['builder']);
    }
    if (domain === 'reference') {
        return Object.freeze(['reference']);
    }
    return Object.freeze(['editor']);
}

/**
 * @description 读取调用方声明的 resources（input.resources 或 Hub resourceIds）。
 * @param input 业务输入。
 * @param invocationResourceIds Hub 传入的 resourceIds。
 * @returns 归一后的声明集合。
 */
export function readDeclaredResources(
    input: Readonly<Record<string, unknown>>,
    invocationResourceIds?: readonly string[] | null,
): readonly string[] {
    if (invocationResourceIds != null && invocationResourceIds.length > 0) {
        return normalizeResourceKeys([...invocationResourceIds]);
    }
    const raw = input.resources;
    const collected: string[] = [];
    collectRaw(raw, collected);
    return normalizeResourceKeys(collected);
}

/**
 * @description 最终授权资源集 = 推导业务资源 ∪ 声明 resources。
 * 二者均须 ⊆ lease；声明不得替换掉推导。
 * @param operation 稳定 operation。
 * @param input 业务输入。
 * @param invocationResourceIds Hub resourceIds。
 * @returns 归一后的授权校验集合（空则 dispatcher fail-closed）。
 */
export function resolveAuthorizedResources(
    operation: string,
    input: Readonly<Record<string, unknown>>,
    invocationResourceIds?: readonly string[] | null,
): readonly string[] {
    const derived = extractWriteResources(operation, input);
    const declared = readDeclaredResources(input, invocationResourceIds);
    if (declared.length === 0) {
        return derived;
    }
    return normalizeResourceKeys([...derived, ...declared]);
}

/**
 * @description 单键归一（再导出，便于 host/测试与文档对齐）。
 */
export { normalizeResourceKey, normalizeResourceKeys };
