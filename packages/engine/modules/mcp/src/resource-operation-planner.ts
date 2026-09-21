import { resolve } from 'node:path';
import { platform } from 'node:process';

import { extractWriteResources, normalizeResourceKey } from '@peanut/pod-engine/policy';

import type { IResourceOperationTaskPlan } from './resource-operation-contracts.js';
import { ResourceOperationClosureResolver } from './resource-operation-closure-resolver.js';

const PROJECT_FALLBACK_RESOURCE = 'resource:project';

/**
 * @description 从 operation 输入生成跨 Router 一致的项目级资源调度计划。
 */
export class ResourceOperationPlanner {
    /**
     * @description 磁盘依赖、sidecar 与 UUID 闭包解析器。
     */
    private readonly _closureResolver: ResourceOperationClosureResolver;

    /**
     * @description 创建资源规划器。
     * @param closureResolver 可注入资源闭包解析器。
     */
    public constructor(closureResolver: ResourceOperationClosureResolver = new ResourceOperationClosureResolver()) {
        this._closureResolver = closureResolver;
    }

    /**
     * @description 生成写任务的项目键、资源闭包与 writer 需求。
     * @param projectRoot 当前 Cocos 工程根目录。
     * @param operation 稳定 MCP operation。
     * @param input 已校验业务输入。
     * @returns 可直接交给共享调度器的不可变计划。
     */
    public plan(
        projectRoot: string,
        operation: string,
        input: Readonly<Record<string, unknown>> | null | undefined,
    ): IResourceOperationTaskPlan {
        const safeInput = input ?? {};
        const requiresProjectWriter = this._requiresProjectWriter(operation, safeInput);
        const creationTarget = this._deriveCreationTarget(operation, safeInput);
        const includeAssetSidecars = requiresProjectWriter || operation === 'lumen.scaffold' || creationTarget != null;
        const derivedResources = [
            ...extractWriteResources(operation, safeInput),
            ...this._deriveDestinationResources(operation, safeInput),
            ...this._deriveUuidResources(safeInput),
        ];
        const closure = this._closureResolver.resolve(projectRoot, derivedResources);
        const resourceKeys = new Set<string>();
        for (const resource of [...closure.roots, ...closure.dependencies]) {
            this._addResourceClosure(resourceKeys, resource, includeAssetSidecars);
        }
        for (const sidecar of closure.sidecars) {
            resourceKeys.add(`resource:${this._normalizeResource(sidecar)}`);
        }
        for (const uuidKey of closure.uuidKeys) {
            resourceKeys.add(`resource:${this._normalizeResource(uuidKey)}`);
        }
        if (creationTarget != null) {
            this._addCreationClosure(resourceKeys, creationTarget);
        }
        if (resourceKeys.size === 0) {
            resourceKeys.add(PROJECT_FALLBACK_RESOURCE);
        }
        return Object.freeze({
            projectKey: this.normalizeProjectKey(projectRoot),
            operation,
            resourceKeys: Object.freeze([...resourceKeys].sort()),
            requiresProjectWriter,
            closure,
            ...(creationTarget == null ? {} : { workerManagedCommitWindow: true }),
        });
    }

    /**
     * @description 识别必须走 AssetDB 首次创建屏障的 Prefab / Scene 目标。
     * @param operation operation。
     * @param input 已校验输入。
     * @returns 创建目标或 null。
     */
    private _deriveCreationTarget(
        operation: string,
        input: Readonly<Record<string, unknown>>,
    ): string | null {
        if (operation === 'prefab.createFromNode') {
            return this._readString(input.prefabPath);
        }
        if (operation !== 'lumen.scaffold' || input.reset === true) {
            return null;
        }
        const target = this._readString(input.prefabRelativePath) ?? this._readString(input.assetRelativePath);
        if (target == null || !/\.(?:prefab|scene)$/iu.test(target)) {
            return null;
        }
        return target;
    }

    /**
     * @description 将首次创建目标、主 sidecar、父目录和父目录 sidecar 纳入同一资源集合。
     * @param into 资源集合。
     * @param targetValue 创建目标。
     */
    private _addCreationClosure(into: Set<string>, targetValue: string): void {
        const target = this._normalizeResource(targetValue);
        if (!this._isAssetPath(target) || target === 'db://assets') {
            return;
        }
        const assetPath = target.slice('db://'.length);
        const parent = this._parentPath(assetPath) || 'assets';
        into.add(`resource:${target}`);
        into.add(`resource:${target}.meta`);
        into.add(`directory:${parent}`);
        if (parent !== 'assets') {
            into.add(`resource:db://${parent}.meta`);
        }
    }

    /**
     * @description 将工程路径归一为当前平台稳定的隔离键。
     * @param projectRoot 当前 Cocos 工程根目录。
     * @returns 去除尾斜杠后的绝对工程键。
     */
    public normalizeProjectKey(projectRoot: string): string {
        const normalized = resolve(projectRoot).replace(/\\/gu, '/').replace(/\/+$/u, '');
        return platform === 'win32' ? normalized.toLowerCase() : normalized;
    }

    /**
     * @description 补齐仅靠通用字段无法推导的目标资源。
     * @param operation 稳定 MCP operation。
     * @param input 已校验业务输入。
     * @returns 目标文件或目录资源列表。
     */
    private _deriveDestinationResources(
        operation: string,
        input: Readonly<Record<string, unknown>>,
    ): readonly string[] {
        if (operation === 'asset.copy') {
            const targetDirectory = this._readString(input.targetDirectory);
            if (targetDirectory == null) {
                return Object.freeze([]);
            }
            return Object.freeze(
                this._readPathList(input.paths).map((source) => `${targetDirectory.replace(/\/+$/u, '')}/${this._baseName(source)}`),
            );
        }
        if (operation === 'asset.rename') {
            const source = this._readString(input.path);
            const newName = this._readString(input.newName);
            if (source == null || newName == null) {
                return Object.freeze([]);
            }
            const parent = this._parentPath(source);
            return Object.freeze([parent.length > 0 ? `${parent}/${newName}` : newName]);
        }
        return Object.freeze([]);
    }

    /**
     * @description 从任意深度输入中提取名字包含 `uuid` 的新绑定引用。
     * @param input 已校验业务输入。
     * @returns `uuid:<value>` 资源列表。
     */
    private _deriveUuidResources(input: Readonly<Record<string, unknown>>): readonly string[] {
        const uuidResources = new Set<string>();
        this._collectUuidFields(input, uuidResources, 0);
        return Object.freeze([...uuidResources].sort());
    }

    /**
     * @description 递归采集 UUID 字段，防止新引用尚未写入磁盘时漏锁。
     * @param value 当前输入节点。
     * @param into UUID 资源集合。
     * @param depth 当前递归深度。
     * @returns 无返回值。
     */
    private _collectUuidFields(value: unknown, into: Set<string>, depth: number): void {
        if (depth > 8 || value == null || typeof value !== 'object') {
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                this._collectUuidFields(item, into, depth + 1);
            }
            return;
        }
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (/uuid/iu.test(key) && typeof child === 'string' && child.trim().length > 0) {
                into.add(`uuid:${child.trim()}`);
            }
            this._collectUuidFields(child, into, depth + 1);
        }
    }

    /**
     * @description 将文件资源扩展为文件、meta 与父目录闭包。
     * @param into 目标资源键集合。
     * @param rawResource 原始业务资源。
     * @param includeAssetSidecars 是否纳入 meta 与父目录。
     * @returns 无返回值。
     */
    private _addResourceClosure(into: Set<string>, rawResource: string, includeAssetSidecars: boolean): void {
        const normalized = this._normalizeResource(rawResource);
        if (normalized.length === 0) {
            return;
        }
        into.add(`resource:${normalized}`);
        if (!includeAssetSidecars || !this._isAssetPath(normalized)) {
            return;
        }
        const assetPath = normalized.slice('db://'.length);
        if (this._looksLikeFile(assetPath)) {
            into.add(`resource:db://${assetPath}.meta`);
        }
        const parent = this._parentPath(assetPath);
        into.add(`directory:${parent.length > 0 ? parent : 'assets'}`);
    }

    /**
     * @description 判断操作是否必须通过工程唯一 writer 串行提交。
     * @param operation 稳定 MCP operation。
     * @param input 已校验业务输入。
     * @returns AssetDB/editor 状态写返回 true；纯 Lumen 文档编辑返回 false。
     */
    private _requiresProjectWriter(operation: string, input: Readonly<Record<string, unknown>>): boolean {
        if (!operation.startsWith('lumen.')) {
            return true;
        }
        if (operation === 'lumen.commit' || operation === 'lumen.refresh') {
            return true;
        }
        return input.autoCommit === true;
    }

    /**
     * @description 归一业务资源并按当前平台文件系统语义处理大小写。
     * @param value 原始业务资源。
     * @returns 调度器资源键主体。
     */
    private _normalizeResource(value: string): string {
        const normalized = normalizeResourceKey(value).replace(/\\/gu, '/');
        return platform === 'win32' ? normalized.toLowerCase() : normalized;
    }

    /**
     * @description 判断资源是否位于 Cocos AssetDB 空间。
     * @param value 已归一资源。
     * @returns 位于 db://assets 时返回 true。
     */
    private _isAssetPath(value: string): boolean {
        return value === 'db://assets' || value.startsWith('db://assets/');
    }

    /**
     * @description 用末段扩展名判断资源是文件而不是目录。
     * @param value 已归一资产路径。
     * @returns 末段包含扩展名时返回 true。
     */
    private _looksLikeFile(value: string): boolean {
        return this._baseName(value).includes('.');
    }

    /**
     * @description 提取路径末段。
     * @param value 路径。
     * @returns 路径末段。
     */
    private _baseName(value: string): string {
        const normalized = value.replace(/\\/gu, '/').replace(/\/+$/u, '');
        const slash = normalized.lastIndexOf('/');
        return slash >= 0 ? normalized.slice(slash + 1) : normalized;
    }

    /**
     * @description 提取路径父目录。
     * @param value 路径。
     * @returns 无父目录时返回空串。
     */
    private _parentPath(value: string): string {
        const normalized = value.replace(/\\/gu, '/').replace(/\/+$/u, '');
        const slash = normalized.lastIndexOf('/');
        return slash >= 0 ? normalized.slice(0, slash) : '';
    }

    /**
     * @description 从未知值读取非空字符串。
     * @param value 未知输入。
     * @returns 非空字符串或 null。
     */
    private _readString(value: unknown): string | null {
        return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
    }

    /**
     * @description 从字符串数组或含 path 字段对象数组读取路径。
     * @param value 未知输入。
     * @returns 有效路径列表。
     */
    private _readPathList(value: unknown): readonly string[] {
        if (!Array.isArray(value)) {
            return Object.freeze([]);
        }
        const paths: string[] = [];
        for (const item of value) {
            const direct = this._readString(item);
            if (direct != null) {
                paths.push(direct);
                continue;
            }
            if (typeof item === 'object' && item != null && 'path' in item) {
                const nested = this._readString(item.path);
                if (nested != null) {
                    paths.push(nested);
                }
            }
        }
        return Object.freeze(paths);
    }
}
