import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'fs';
import type { Stats } from 'fs';
import { basename, dirname, join, posix, resolve } from 'path';

import { CocosUuidCodec } from './cocos-uuid-codec.js';
import { CompatibleUuid } from './compatible-uuid.js';
import { FileAssetDependencyIndex } from './file-asset-dependency-index.js';
import { SilentAssetCreateFolder } from './silent-asset-create-folder.js';
import { SilentAssetPathGuard } from './silent-asset-path-guard.js';

/**
 * @description 静默依赖闭包复制请求（磁盘为真源，不调会弹窗的 AssetDB 覆盖写入）。
 */
export interface ISilentAssetClosureCopyRequest {
    /**
     * @description Creator 工程根。
     */
    readonly projectRoot: string;

    /**
     * @description 种子资源相对路径（`assets/...`，可多选）。
     */
    readonly seedRelativePaths: readonly string[];

    /**
     * @description 复制产物根目录（`assets/...`）；闭包内相对布局会挂到该根下。
     */
    readonly targetDirectoryRelative: string;
}

/**
 * @description 单条路径映射与 uuid 映射结果。
 */
export interface ISilentAssetClosureCopyItem {
    /**
     * @description 源相对路径。
     */
    readonly fromPath: string;

    /**
     * @description 目标相对路径。
     */
    readonly toPath: string;

    /**
     * @description 源主 uuid；无 meta 时为空串。
     */
    readonly fromUuid: string;

    /**
     * @description 目标主 uuid；无 meta 时为空串。
     */
    readonly toUuid: string;
}

/**
 * @description 静默依赖闭包复制结果。
 */
export interface ISilentAssetClosureCopyResult {
    /**
     * @description 拓扑序（依赖在前）。
     */
    readonly order: readonly string[];

    /**
     * @description 每条复制项。
     */
    readonly items: readonly ISilentAssetClosureCopyItem[];

    /**
     * @description 标准/压缩/子资源 uuid → 新 uuid（含 `@suffix`）。
     */
    readonly uuidMap: Readonly<Record<string, string>>;

    /**
     * @description 未能纳入闭包的引用（仍写进副本，调用方可知）。
     */
    readonly unresolvedUuids: readonly string[];
}

/**
 * @description 按依赖闭包静默深拷贝资源：先基础依赖、再引用方；换新 uuid 并回写序列化引用。
 *
 * 不调用 `save-asset` / 覆盖导入等可能弹窗的路径；复制完成后由上层自行 `refresh-asset`。
 */
export class SilentAssetClosureCopy {
    /** @description 依赖图。 */
    private readonly _dependencyIndex: FileAssetDependencyIndex;

    /** @description UUID 编解码。 */
    private readonly _uuidCodec: CocosUuidCodec;

    /**
     * @description 创建复制器。
     * @param dependencyIndex 可选依赖索引。
     * @param uuidCodec 可选 UUID 编解码器。
     */
    public constructor(
        dependencyIndex: FileAssetDependencyIndex = new FileAssetDependencyIndex(),
        uuidCodec: CocosUuidCodec = new CocosUuidCodec(),
    ) {
        this._dependencyIndex = dependencyIndex;
        this._uuidCodec = uuidCodec;
    }

    /**
     * @description 执行依赖闭包静默复制。
     * @param request 请求。
     * @returns 复制结果（含 uuid 映射与拓扑序）。
     */
    public copy(request: ISilentAssetClosureCopyRequest): ISilentAssetClosureCopyResult {
        const projectRoot = realpathSync(resolve(request.projectRoot));
        const seeds = request.seedRelativePaths.map((pathValue) => this._normalizeAssetPath(pathValue));
        const targetRoot = this._normalizeAssetPath(request.targetDirectoryRelative);
        if (!targetRoot.startsWith('assets/') && targetRoot !== 'assets') {
            throw new Error(`silent_copy_target_outside_assets:${targetRoot}`);
        }
        for (const seed of seeds) {
            if (!existsSync(join(projectRoot, seed))) {
                throw new Error(`silent_copy_seed_missing:${seed}`);
            }
        }

        for (const seed of seeds) {
            if (this._sourceStat(projectRoot, seed).isDirectory() && (targetRoot === seed || targetRoot.startsWith(`${seed}/`))) {
                throw new Error(`silent_copy_target_inside_source:${targetRoot}`);
            }
        }
        this._assertTargetAncestor(projectRoot, targetRoot);
        FileAssetDependencyIndex.invalidate(projectRoot);
        const { closurePaths, unresolvedUuids, refsByPath } = this._expandClosure(projectRoot, seeds);
        const order = this._topoSort(closurePaths, refsByPath);
        const pathMap = this._buildPathMap(order, targetRoot);
        for (const toPath of Object.values(pathMap)) {
            if (this._pathExists(join(projectRoot, toPath)) || this._pathExists(join(projectRoot, `${toPath}.meta`))) {
                throw new Error(`silent_copy_target_exists:${toPath}`);
            }
        }

        const uuidMap = new Map<string, string>();
        const sourceMetas = new Map<string, unknown>();
        for (const fromPath of order) {
            this._sourceStat(projectRoot, fromPath);
            const metaPath = `${fromPath}.meta`;
            if (this._pathExists(join(projectRoot, metaPath))) {
                if (!this._sourceStat(projectRoot, metaPath).isFile()) {
                    throw new Error(`silent_copy_meta_not_regular:${metaPath}`);
                }
                const meta: unknown = JSON.parse(readFileSync(join(projectRoot, metaPath), 'utf8'));
                sourceMetas.set(fromPath, meta);
                this._registerMetaUuidMappings(meta, uuidMap);
            }
        }
        new SilentAssetCreateFolder().ensureDirectoryMetas({
            projectRoot,
            relativePath: targetRoot,
        });

        const items: ISilentAssetClosureCopyItem[] = [];

        for (const fromPath of order) {
            const toPath = pathMap[fromPath];
            if (toPath == null) {
                throw new Error(`silent_copy_path_map_missing:${fromPath}`);
            }
            const fromAbsolute = join(projectRoot, fromPath);
            const toAbsolute = join(projectRoot, toPath);
            mkdirSync(dirname(toAbsolute), { recursive: true });
            if (this._sourceStat(projectRoot, fromPath).isDirectory()) {
                mkdirSync(toAbsolute);
            } else {
                copyFileSync(fromAbsolute, toAbsolute, constants.COPYFILE_EXCL);
            }

            const metaTo = `${toAbsolute}.meta`;
            let fromUuid = '';
            let toUuid = '';
            if (sourceMetas.has(fromPath)) {
                const metaJson = sourceMetas.get(fromPath);
                const remapped = this._remapJsonUuids(metaJson, uuidMap);
                writeFileSync(metaTo, `${JSON.stringify(remapped, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
                fromUuid = this._readMetaUuid(metaJson);
                toUuid = this._readMetaUuid(remapped);
            }

            if (this._isSerializedAsset(fromPath)) {
                const raw = readFileSync(toAbsolute, 'utf8');
                try {
                    const parsed = JSON.parse(raw) as unknown;
                    const remappedContent = this._remapJsonUuids(parsed, uuidMap);
                    writeFileSync(toAbsolute, `${JSON.stringify(remappedContent, null, 2)}\n`, 'utf8');
                } catch {
                    writeFileSync(toAbsolute, this._remapPlainTextUuids(raw, uuidMap), 'utf8');
                }
            }

            items.push({ fromPath, toPath, fromUuid, toUuid });
        }

        return {
            order,
            items,
            uuidMap: Object.fromEntries(uuidMap.entries()),
            unresolvedUuids: [...unresolvedUuids].sort(),
        };
    }

    /**
     * @description 展开种子的递归依赖闭包。
     * @param projectRoot 工程根。
     * @param seeds 种子路径。
     * @returns 闭包路径、未解析 uuid、路径依赖表。
     */
    private _expandClosure(
        projectRoot: string,
        seeds: readonly string[],
    ): {
        readonly closurePaths: readonly string[];
        readonly unresolvedUuids: ReadonlySet<string>;
        readonly refsByPath: ReadonlyMap<string, ReadonlySet<string>>;
    } {
        const closure = new Set<string>(seeds);
        const unresolved = new Set<string>();
        const refsByPath = new Map<string, Set<string>>();
        const queue = [...seeds];
        while (queue.length > 0) {
            const current = queue.shift();
            if (current == null) {
                break;
            }
            const metaPath = `${current}.meta`;
            if (this._pathExists(join(projectRoot, metaPath)) && !this._sourceStat(projectRoot, metaPath).isFile()) {
                throw new Error(`silent_copy_meta_not_regular:${metaPath}`);
            }
            if (this._sourceStat(projectRoot, current).isDirectory()) {
                refsByPath.set(current, new Set());
                for (const name of readdirSync(join(projectRoot, current)).sort()) {
                    if (name.endsWith('.meta')) {
                        continue;
                    }
                    const child = this._normalizeAssetPath(posix.join(current, name));
                    this._sourceStat(projectRoot, child);
                    if (!closure.has(child)) {
                        closure.add(child);
                        queue.push(child);
                    }
                }
                continue;
            }
            const result = this._dependencyIndex.query(projectRoot, {
                dbPath: `db://${current}`,
                direction: 'dependencies',
                refreshIndex: false,
            });
            const deps = new Set<string>();
            for (const dependency of result.dependencies) {
                const assetPath = dependency.dbPath.replace(/^db:\/\//u, '');
                deps.add(assetPath);
                if (!closure.has(assetPath)) {
                    closure.add(assetPath);
                    queue.push(assetPath);
                }
            }
            refsByPath.set(current, deps);
            for (const uuid of result.unresolvedUuids) {
                unresolved.add(uuid);
            }
        }
        return {
            closurePaths: [...closure],
            unresolvedUuids: unresolved,
            refsByPath,
        };
    }

    /**
     * @description 对闭包做拓扑排序（依赖在前）。
     * @param paths 闭包路径。
     * @param refsByPath 路径 → 依赖。
     * @returns 有序路径。
     */
    private _topoSort(
        paths: readonly string[],
        refsByPath: ReadonlyMap<string, ReadonlySet<string>>,
    ): readonly string[] {
        const pathSet = new Set(paths);
        const indegree = new Map<string, number>();
        const reverse = new Map<string, string[]>();
        for (const pathValue of paths) {
            indegree.set(pathValue, 0);
            reverse.set(pathValue, []);
        }
        for (const pathValue of paths) {
            for (const dependency of refsByPath.get(pathValue) ?? []) {
                if (!pathSet.has(dependency)) {
                    continue;
                }
                indegree.set(pathValue, (indegree.get(pathValue) ?? 0) + 1);
                reverse.get(dependency)?.push(pathValue);
            }
        }
        const queue = paths.filter((pathValue) => (indegree.get(pathValue) ?? 0) === 0).sort();
        const ordered: string[] = [];
        while (queue.length > 0) {
            const current = queue.shift();
            if (current == null) {
                break;
            }
            ordered.push(current);
            for (const next of reverse.get(current) ?? []) {
                const nextDegree = (indegree.get(next) ?? 0) - 1;
                indegree.set(next, nextDegree);
                if (nextDegree === 0) {
                    queue.push(next);
                    queue.sort();
                }
            }
        }
        if (ordered.length !== paths.length) {
            const remaining = paths.filter((pathValue) => !ordered.includes(pathValue)).sort();
            throw new Error(`silent_copy_dependency_cycle:${remaining.join(',')}`);
        }
        return ordered;
    }

    /**
     * @description 把闭包路径映射到目标根下，保留相对布局。
     * @param order 拓扑序。
     * @param targetRoot 目标根。
     * @returns from→to。
     */
    private _buildPathMap(order: readonly string[], targetRoot: string): Record<string, string> {
        const commonPrefix = this._commonDirectoryPrefix(order);
        const map: Record<string, string> = {};
        for (const fromPath of order) {
            const relativePart =
                commonPrefix.length > 0 && fromPath.startsWith(`${commonPrefix}/`)
                    ? fromPath.slice(commonPrefix.length + 1)
                    : basename(fromPath);
            map[fromPath] = this._normalizeAssetPath(posix.join(targetRoot, relativePart));
        }
        return map;
    }

    /**
     * @description 计算路径集合的公共目录前缀（posix）。
     * @param paths 路径。
     * @returns 公共前缀，可能为空串。
     */
    private _commonDirectoryPrefix(paths: readonly string[]): string {
        if (paths.length === 0) {
            return '';
        }
        const split = paths.map((pathValue) => pathValue.split('/'));
        const first = split[0];
        if (first == null) {
            return '';
        }
        const prefix: string[] = [];
        for (let index = 0; index < first.length - 1; index += 1) {
            const part = first[index];
            if (part == null) {
                break;
            }
            if (split.every((segments) => segments[index] === part)) {
                prefix.push(part);
            } else {
                break;
            }
        }
        return prefix.join('/');
    }

    /**
     * @description 为 meta 中出现的主/子 uuid 注册新旧映射（含压缩形式）。
     * @param metaJson meta 对象。
     * @param uuidMap 映射表。
     * @returns 无。
     */
    private _registerMetaUuidMappings(metaJson: unknown, uuidMap: Map<string, string>): void {
        if (metaJson == null || typeof metaJson !== 'object' || Array.isArray(metaJson)) {
            return;
        }
        const record = metaJson as Record<string, unknown>;
        const oldMain = typeof record.uuid === 'string' ? record.uuid : '';
        if (oldMain.length === 0) {
            return;
        }
        const newMain = CompatibleUuid.create();
        this._putUuidMapping(uuidMap, oldMain, newMain);
        const subMetas = record.subMetas;
        if (subMetas == null || typeof subMetas !== 'object' || Array.isArray(subMetas)) {
            return;
        }
        for (const [subKey, subValue] of Object.entries(subMetas)) {
            if (subValue == null || typeof subValue !== 'object' || Array.isArray(subValue)) {
                continue;
            }
            const subRecord = subValue as Record<string, unknown>;
            const oldSub =
                typeof subRecord.uuid === 'string' && subRecord.uuid.length > 0
                    ? subRecord.uuid
                    : `${oldMain}@${subKey}`;
            const suffix = oldSub.includes('@') ? oldSub.slice(oldSub.indexOf('@') + 1) : subKey;
            const newSub = `${newMain}@${suffix}`;
            this._putUuidMapping(uuidMap, oldSub, newSub);
        }
    }

    /**
     * @description 写入标准/无连字符/压缩三种形态的 uuid 映射。
     * @param uuidMap 映射表。
     * @param fromUuid 旧 uuid。
     * @param toUuid 新 uuid。
     * @returns 无。
     */
    private _putUuidMapping(uuidMap: Map<string, string>, fromUuid: string, toUuid: string): void {
        uuidMap.set(fromUuid, toUuid);
        try {
            const fromNormalized = this._uuidCodec.normalize(fromUuid);
            const toNormalized = this._uuidCodec.normalize(toUuid);
            uuidMap.set(fromNormalized, toNormalized);
            uuidMap.set(this._uuidCodec.compress(fromUuid), this._uuidCodec.compress(toUuid));
        } catch {
            // 非法 uuid 只保留原文映射。
        }
    }

    /**
     * @description 递归替换 JSON 中出现的已映射 uuid 字符串。
     * @param value JSON 值。
     * @param uuidMap 映射。
     * @returns 替换后的值。
     */
    private _remapJsonUuids(value: unknown, uuidMap: ReadonlyMap<string, string>): unknown {
        if (typeof value === 'string') {
            return this._remapOneString(value, uuidMap);
        }
        if (Array.isArray(value)) {
            return value.map((item) => this._remapJsonUuids(item, uuidMap));
        }
        if (value != null && typeof value === 'object') {
            const result: Record<string, unknown> = {};
            for (const [key, child] of Object.entries(value)) {
                result[key] = this._remapJsonUuids(child, uuidMap);
            }
            return result;
        }
        return value;
    }

    /**
     * @description 对非 JSON 文本做 uuid 子串替换（最长键优先）。
     * @param text 文本。
     * @param uuidMap 映射。
     * @returns 替换后文本。
     */
    private _remapPlainTextUuids(text: string, uuidMap: ReadonlyMap<string, string>): string {
        const keys = [...uuidMap.keys()].sort((left, right) => right.length - left.length);
        let result = text;
        for (const key of keys) {
            const mapped = uuidMap.get(key);
            if (mapped == null || key.length === 0) {
                continue;
            }
            result = result.split(key).join(mapped);
        }
        return result;
    }

    /**
     * @description 替换单个字符串：整串命中或内嵌 uuid。
     * @param value 原串。
     * @param uuidMap 映射。
     * @returns 新串。
     */
    private _remapOneString(value: string, uuidMap: ReadonlyMap<string, string>): string {
        const direct = uuidMap.get(value);
        if (direct != null) {
            return direct;
        }
        return this._remapPlainTextUuids(value, uuidMap);
    }

    /**
     * @description 读取 meta 主 uuid。
     * @param metaJson meta。
     * @returns uuid 或空串。
     */
    private _readMetaUuid(metaJson: unknown): string {
        if (metaJson == null || typeof metaJson !== 'object' || Array.isArray(metaJson)) {
            return '';
        }
        const uuid = (metaJson as Record<string, unknown>).uuid;
        return typeof uuid === 'string' ? uuid : '';
    }

    /**
     * @description 是否为可改写内部 `__uuid__` 的序列化资产。
     * @param relativePath 相对路径。
     * @returns 是否序列化资产。
     */
    private _isSerializedAsset(relativePath: string): boolean {
        const lower = relativePath.toLowerCase();
        return (
            lower.endsWith('.prefab') ||
            lower.endsWith('.scene') ||
            lower.endsWith('.mtl') ||
            lower.endsWith('.material') ||
            lower.endsWith('.anim') ||
            lower.endsWith('.json')
        );
    }

    /**
     * @description 规范化为 posix `assets/...` 相对路径。
     * @param pathValue 输入路径。
     * @returns 规范化路径。
     */
    private _normalizeAssetPath(pathValue: string): string {
        return new SilentAssetPathGuard().normalize(pathValue);
    }

    /**
     * @description 验证闭包只含工程内实际目录或普通文件，不跟随链接。
     * @param projectRoot 已解析的工程根。
     * @param relativePath 规范化后的资源路径。
     * @returns 实际磁盘类型。
     */
    private _sourceStat(projectRoot: string, relativePath: string): Stats {
        const absolute = join(projectRoot, relativePath);
        const value = lstatSync(absolute);
        if (value.isSymbolicLink() || (!value.isDirectory() && !value.isFile()) || realpathSync(absolute) !== absolute) {
            throw new Error(`silent_copy_source_not_regular:${relativePath}`);
        }
        return value;
    }

    /**
     * @description 拒绝指向其它物理位置的目标祖先，检查发生在创建前。
     * @param projectRoot 已解析的工程根。
     * @param target 目标相对路径。
     * @returns 无。
     */
    private _assertTargetAncestor(projectRoot: string, target: string): void {
        let absolute = join(projectRoot, target);
        while (!this._pathExists(absolute)) {
            absolute = dirname(absolute);
        }
        if (realpathSync(absolute) !== absolute || !lstatSync(absolute).isDirectory()) {
            throw new Error(`silent_copy_target_alias:${target}`);
        }
    }

    /**
     * @description 检查目录项本身是否存在，保留悬空链接并传播非 ENOENT 错误。
     * @param absolute 完整磁盘路径。
     * @returns 目录项是否存在。
     */
    private _pathExists(absolute: string): boolean {
        try {
            lstatSync(absolute);
            return true;
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return false;
            }
            throw error;
        }
    }
}
