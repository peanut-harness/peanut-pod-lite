import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AssetMetaParser, FileAssetDependencyIndex } from '@peanut/pod-engine/assets';
import { normalizeResourceKey } from '@peanut/pod-engine/policy';

import type { IResourceOperationClosureSummary } from './resource-operation-contracts.js';

const MAX_CLOSURE_RESOURCES = 512;

/**
 * @description 从项目磁盘 catalog、序列化引用与 `.meta` 递归展开写任务资源闭包。
 */
export class ResourceOperationClosureResolver {
    /**
     * @description 磁盘依赖索引。
     */
    private readonly _dependencyIndex: FileAssetDependencyIndex;
    /**
     * @description Creator `.meta` 解析器。
     */
    private readonly _metaParser: AssetMetaParser;

    /**
     * @description 创建资源闭包解析器。
     * @param dependencyIndex 可注入磁盘依赖索引。
     * @param metaParser 可注入 `.meta` 解析器。
     */
    public constructor(
        dependencyIndex: FileAssetDependencyIndex = new FileAssetDependencyIndex(),
        metaParser: AssetMetaParser = new AssetMetaParser(),
    ) {
        this._dependencyIndex = dependencyIndex;
        this._metaParser = metaParser;
    }

    /**
     * @description 解析根资源的传递依赖、sidecar 与 UUID。
     * @param projectRoot 当前 Cocos 工程根。
     * @param rawResources operation 推导与输入补充资源。
     * @returns 不可变资源闭包摘要。
     */
    public resolve(projectRoot: string, rawResources: readonly string[]): IResourceOperationClosureSummary {
        const roots = new Set<string>();
        const dependencies = new Set<string>();
        const uuidKeys = new Set<string>();
        const sidecars = new Set<string>();
        const unresolvedUuids = new Set<string>();
        const pending: string[] = [];
        for (const rawResource of rawResources) {
            const normalized = normalizeResourceKey(rawResource);
            if (normalized.length === 0) {
                continue;
            }
            roots.add(normalized);
            pending.push(normalized);
        }

        const visited = new Set<string>();
        while (pending.length > 0) {
            if (visited.size >= MAX_CLOSURE_RESOURCES) {
                throw new Error(`resource_operation_closure_too_large:${MAX_CLOSURE_RESOURCES}`);
            }
            const resource = pending.shift();
            if (resource == null || visited.has(resource)) {
                continue;
            }
            visited.add(resource);
            if (resource.startsWith('uuid:')) {
                this._expandUuid(projectRoot, resource.slice('uuid:'.length), dependencies, uuidKeys, pending);
                continue;
            }
            if (!this._isAssetPath(resource) || resource === 'db://assets') {
                continue;
            }
            this._readMeta(projectRoot, resource, uuidKeys, sidecars);
            this._expandAssetDependencies(projectRoot, resource, dependencies, uuidKeys, unresolvedUuids, pending);
        }

        for (const unresolvedUuid of unresolvedUuids) {
            uuidKeys.add(`uuid:${unresolvedUuid}`);
        }
        return Object.freeze({
            roots: Object.freeze([...roots].sort()),
            dependencies: Object.freeze([...dependencies].sort()),
            uuidKeys: Object.freeze([...uuidKeys].sort()),
            sidecars: Object.freeze([...sidecars].sort()),
            unresolvedUuids: Object.freeze([...unresolvedUuids].sort()),
        });
    }

    /**
     * @description 从 UUID 反查项目资源并加入待展开队列。
     * @param projectRoot 当前工程根。
     * @param uuid 标准或压缩 UUID。
     * @param dependencies 依赖资源集合。
     * @param uuidKeys UUID 锁集合。
     * @param pending 待展开资源队列。
     * @returns 无返回值。
     */
    private _expandUuid(
        projectRoot: string,
        uuid: string,
        dependencies: Set<string>,
        uuidKeys: Set<string>,
        pending: string[],
    ): void {
        if (uuid.length === 0) {
            return;
        }
        uuidKeys.add(`uuid:${uuid}`);
        if (!existsSync(join(projectRoot, 'assets'))) {
            return;
        }
        try {
            const result = this._dependencyIndex.query(projectRoot, { uuid, direction: 'dependencies' });
            dependencies.add(result.target.dbPath);
            pending.push(result.target.dbPath);
        } catch (error: unknown) {
            if (!this._isUnavailableDependencyGraphError(error)) {
                throw error;
            }
        }
    }

    /**
     * @description 展开单个资产的正向依赖。
     * @param projectRoot 当前工程根。
     * @param dbPath 当前资产 db 路径。
     * @param dependencies 依赖资源集合。
     * @param uuidKeys UUID 锁集合。
     * @param unresolvedUuids 未解析 UUID 集合。
     * @param pending 待展开资源队列。
     * @returns 无返回值。
     */
    private _expandAssetDependencies(
        projectRoot: string,
        dbPath: string,
        dependencies: Set<string>,
        uuidKeys: Set<string>,
        unresolvedUuids: Set<string>,
        pending: string[],
    ): void {
        if (!existsSync(join(projectRoot, 'assets'))) {
            return;
        }
        try {
            const result = this._dependencyIndex.query(projectRoot, {
                dbPath,
                direction: 'dependencies',
                expand: ['materialTextures'],
            });
            uuidKeys.add(`uuid:${result.target.uuid}`);
            for (const dependency of result.dependencies) {
                dependencies.add(dependency.dbPath);
                uuidKeys.add(`uuid:${dependency.uuid}`);
                pending.push(dependency.dbPath);
            }
            for (const unresolvedUuid of result.unresolvedUuids) {
                unresolvedUuids.add(unresolvedUuid);
            }
        } catch (error: unknown) {
            if (!this._isUnavailableDependencyGraphError(error)) {
                throw error;
            }
        }
    }

    /**
     * @description 读取资产 `.meta` 的主资源与子资源 UUID。
     * @param projectRoot 当前工程根。
     * @param dbPath 当前资产 db 路径。
     * @param uuidKeys UUID 锁集合。
     * @param sidecars sidecar 集合。
     * @returns 无返回值。
     */
    private _readMeta(projectRoot: string, dbPath: string, uuidKeys: Set<string>, sidecars: Set<string>): void {
        const assetPath = dbPath.slice('db://'.length);
        const metaPath = `${assetPath}.meta`;
        const absoluteMetaPath = join(projectRoot, metaPath);
        if (!existsSync(absoluteMetaPath)) {
            return;
        }
        sidecars.add(`db://${metaPath}`);
        const rawText = readFileSync(absoluteMetaPath, 'utf8');
        try {
            const parsed = this._metaParser.parse(rawText, metaPath);
            uuidKeys.add(`uuid:${parsed.uuid}`);
            for (const subMeta of parsed.subMetas) {
                uuidKeys.add(`uuid:${subMeta.uuid}`);
            }
        } catch {
            this._readLenientMetaUuids(rawText, uuidKeys);
        }
    }

    /**
     * @description 修复类操作遇到不完整 meta 时只提取可辨认 UUID，不阻断后续恢复。
     * @param rawText meta 原文。
     * @param uuidKeys UUID 锁集合。
     * @returns 无返回值。
     */
    private _readLenientMetaUuids(rawText: string, uuidKeys: Set<string>): void {
        let parsed: unknown;
        try {
            parsed = JSON.parse(rawText) as unknown;
        } catch {
            return;
        }
        this._collectUuidValues(parsed, uuidKeys, 0);
    }

    /**
     * @description 递归提取不完整 meta 中的 uuid 字段。
     * @param value 当前节点。
     * @param uuidKeys UUID 锁集合。
     * @param depth 当前深度。
     * @returns 无返回值。
     */
    private _collectUuidValues(value: unknown, uuidKeys: Set<string>, depth: number): void {
        if (depth > 8 || value == null || typeof value !== 'object') {
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                this._collectUuidValues(item, uuidKeys, depth + 1);
            }
            return;
        }
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (key === 'uuid' && typeof child === 'string' && child.trim().length > 0) {
                uuidKeys.add(`uuid:${child.trim()}`);
            }
            this._collectUuidValues(child, uuidKeys, depth + 1);
        }
    }

    /**
     * @description 判断资源是否属于 Cocos AssetDB 空间。
     * @param resource 已归一资源。
     * @returns 位于 `db://assets` 时返回 true。
     */
    private _isAssetPath(resource: string): boolean {
        return resource === 'db://assets' || resource.startsWith('db://assets/');
    }

    /**
     * @description 判断依赖索引是否因新建、待修复或尚未登记资源而暂不可用。
     * @param error 未知异常。
     * @returns 可退化为已知资源闭包并由执行/登记阶段继续校验时返回 true。
     */
    private _isUnavailableDependencyGraphError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error);
        return (
            message.startsWith('asset_not_found:') ||
            message.startsWith('asset_uuid_not_found:') ||
            message.startsWith('meta_') ||
            message.startsWith('ENOENT:')
        );
    }
}
