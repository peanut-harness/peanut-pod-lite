import { existsSync, readFileSync } from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';

import { TiledMapImportSource } from './tiled-map-import-source';
import { BitmapFontImportSource } from './bitmap-font-import-source';

/**
 * @description 导入规划中的资产角色。
 */
export type AssetImportRole =
    | 'independent'
    | 'shared-dependency'
    | 'dependency'
    | 'top-level';

/**
 * @description 路径级资产种类（用于扩展名/同 stem 启发式）。
 */
export type AssetImportKind =
    | 'directory'
    | 'image'
    | 'spineAtlas'
    | 'spineData'
    | 'dragonBonesAtlas'
    | 'dragonBonesData'
    | 'bitmapFont'
    | 'bitmapFontAtlas'
    | 'modelFbx'
    | 'modelGltf'
    | 'modelGlb'
    | 'modelBuffer'
    | 'other';

/**
 * @description 分层计划中的单项。
 */
export interface IAssetImportPlanItem {
    /** @description 待导入的绝对或规范化路径。 */
    readonly source: string;
    /** @description 本项直接依赖的路径。 */
    readonly dependencies: readonly string[];
    /** @description 被多少其它源依赖。 */
    readonly dependentCount: number;
    /** @description 在依赖图中的角色。 */
    readonly role: AssetImportRole;
    /** @description 启发式种类。 */
    readonly kind: AssetImportKind;
}

/**
 * @description 依赖分层导入计划。
 */
export interface IAssetImportPlan {
    /** @description 层间串行、层内可并发的路径批次。 */
    readonly layers: readonly (readonly IAssetImportPlanItem[])[];
    /** @description 解析失败的依赖边。 */
    readonly missingDependencies: readonly {
        readonly source: string;
        readonly dependency: string;
    }[];
    /** @description 仍困在环中的路径。 */
    readonly cycles: readonly string[];
    /** @description 闭包展开后实际纳入计划的全部源路径。 */
    readonly expandedSources: readonly string[];
}

/**
 * @description 构建导入计划时的选项。
 */
export interface IAssetImportPlannerOptions {
    /** @description 调用方显式提供的依赖边。 */
    readonly dependencyMap?: Readonly<Record<string, readonly string[]>>;
    /**
     * @description 为 true 时从磁盘发现依赖并补全闭包（atlas 页、BMFont file、Spine/DragonBones 旁路文件）。
     */
    readonly expandClosure?: boolean;
}

/**
 * @description 按「无依赖 → 公共依赖 → 顶层」对一批资源路径做拓扑分层，并支持依赖闭包展开。
 */
export class AssetImportPlanner {
    /**
     * @description 分析路径集合并生成可审查的导入分层计划。
     * @param sources 待导入路径列表。
     * @param options 可选显式依赖表与闭包展开。
     * @returns 分层计划；调用方应对 `cycles` / missing 决定是否拒绝执行。
     */
    public plan(
        sources: readonly string[],
        options: IAssetImportPlannerOptions = {},
    ): IAssetImportPlan {
        const seed = this._dedupeNormalized(sources);
        const orderedSources =
            options.expandClosure === true
                ? this._expandDependencyClosure(seed)
                : seed;
        if (orderedSources.length === 0) {
            return {
                layers: [],
                missingDependencies: [],
                cycles: [],
                expandedSources: [],
            };
        }
        const kinds = this._classifyKinds(orderedSources);
        const aliases = this._buildAliases(orderedSources);
        const uuidIndex = this._buildUuidIndex(orderedSources);
        const dependencies = new Map<string, Set<string>>();
        const missingDependencies: Array<{ source: string; dependency: string }> = [];

        for (const source of orderedSources) {
            const refs = new Set<string>();
            this._addHeuristicEdges(source, orderedSources, kinds, refs);
            for (const discovered of this._discoverFileDependencies(source)) {
                const normalized = this._normalize(discovered);
                if (aliases.has(normalized) && normalized !== source) {
                    refs.add(aliases.get(normalized) ?? normalized);
                } else if (!aliases.has(normalized) &&
                    (existsSync(normalized) || ['.plist', '.tmx', '.fnt'].includes(extname(source).toLowerCase()))) {
                    missingDependencies.push({ source, dependency: normalized });
                }
            }
            const explicit = this._readExplicit(source, options.dependencyMap ?? {});
            for (const dependency of explicit) {
                const resolved =
                    aliases.get(dependency) ??
                    aliases.get(this._normalize(dependency)) ??
                    uuidIndex.get(dependency);
                if (resolved != null && resolved !== source) {
                    refs.add(resolved);
                } else if (resolved == null) {
                    missingDependencies.push({ source, dependency });
                }
            }
            for (const uuid of this._readSerializedUuidReferences(source)) {
                const resolved = uuidIndex.get(uuid);
                if (resolved != null && resolved !== source) {
                    refs.add(resolved);
                } else if (resolved == null) {
                    missingDependencies.push({ source, dependency: uuid });
                }
            }
            dependencies.set(source, refs);
        }

        const dependentCounts = new Map(orderedSources.map((source) => [source, 0]));
        for (const refs of dependencies.values()) {
            for (const dependency of refs) {
                dependentCounts.set(dependency, (dependentCounts.get(dependency) ?? 0) + 1);
            }
        }

        const remaining = new Set(orderedSources);
        const layers: IAssetImportPlanItem[][] = [];
        while (remaining.size > 0) {
            const ready = orderedSources.filter(
                (source) =>
                    remaining.has(source) &&
                    [...(dependencies.get(source) ?? [])].every(
                        (dependency) => !remaining.has(dependency),
                    ),
            );
            if (ready.length === 0) {
                break;
            }
            ready.sort((left, right) => {
                const countDelta =
                    (dependentCounts.get(right) ?? 0) - (dependentCounts.get(left) ?? 0);
                if (countDelta !== 0) {
                    return countDelta;
                }
                return left.localeCompare(right);
            });
            layers.push(
                ready.map((source) => ({
                    source,
                    dependencies: [...(dependencies.get(source) ?? [])].sort(),
                    dependentCount: dependentCounts.get(source) ?? 0,
                    role: this._classifyRole(
                        dependencies.get(source)?.size ?? 0,
                        dependentCounts.get(source) ?? 0,
                    ),
                    kind: kinds.get(source) ?? 'other',
                })),
            );
            for (const source of ready) {
                remaining.delete(source);
            }
        }

        return {
            layers,
            missingDependencies: this._dedupeMissing(missingDependencies),
            cycles: orderedSources.filter((source) => remaining.has(source)),
            expandedSources: orderedSources,
        };
    }

    /**
     * @description 将分层计划展平为稳定执行顺序。
     * @param plan 已生成的计划。
     * @returns 层序展开后的路径列表。
     */
    public flatten(plan: IAssetImportPlan): readonly string[] {
        const out: string[] = [];
        for (const layer of plan.layers) {
            for (const item of layer) {
                out.push(item.source);
            }
        }
        return out;
    }

    /**
     * @description 断言一批源映射到目标目录时 basename 不冲突。
     * @param sources 源路径。
     * @param targetDbDirectory 目标 `db://assets/...` 目录。
     */
    public assertUniqueImportTargets(
        sources: readonly string[],
        targetDbDirectory: string,
    ): void {
        const owners = new Map<string, string>();
        for (const source of sources) {
            const targetDbPath = this.joinDbPath(targetDbDirectory, basename(source));
            const existing = owners.get(targetDbPath);
            if (existing != null && existing !== source) {
                throw new Error(
                    `asset_import_target_collision:${existing}|${source}->${targetDbPath}`,
                );
            }
            owners.set(targetDbPath, source);
        }
    }

    /**
     * @description 拒绝「源文件已是目标盘路径」的自导入（Creator：Source and destination must not be the same）。
     * @param sources 源绝对/相对路径。
     * @param targetDbDirectory 目标 `db://assets/...` 目录。
     * @param projectRoot 工程根；用于把 db 路径还原成磁盘路径。
     */
    public assertSourcesNotAlreadyAtTarget(
        sources: readonly string[],
        targetDbDirectory: string,
        projectRoot: string,
    ): void {
        const root = this._normalize(resolve(projectRoot));
        for (const source of sources) {
            const targetDbPath = this.joinDbPath(targetDbDirectory, basename(source));
            const relative = targetDbPath.replace(/^db:\/\//u, '');
            const targetFs = this._normalize(resolve(root, relative));
            const sourceFs = this._normalize(resolve(source));
            if (sourceFs === targetFs) {
                throw new Error(`asset_import_source_equals_target:${source}->${targetDbPath}`);
            }
        }
    }

    /**
     * @description 拼接目标 db 路径。
     * @param directory 目标目录。
     * @param fileName 文件名。
     * @returns `db://.../file` 路径。
     */
    public joinDbPath(directory: string, fileName: string): string {
        const trimmed = directory.replace(/\/+$/u, '');
        return `${trimmed}/${fileName}`;
    }

    /**
     * @description 从磁盘递归发现依赖并补全闭包。
     * @param initialSources 初始源。
     * @returns 展开后的有序路径。
     */
    private _expandDependencyClosure(initialSources: readonly string[]): readonly string[] {
        const result: string[] = [];
        const queued = [...initialSources];
        const seen = new Set<string>();
        while (queued.length > 0) {
            const raw = queued.shift();
            if (raw == null) {
                continue;
            }
            const source = this._normalize(resolve(raw));
            if (seen.has(source)) {
                continue;
            }
            seen.add(source);
            result.push(source);
            for (const dependency of this._discoverFileDependencies(source)) {
                const normalized = this._normalize(dependency);
                if (existsSync(normalized) && !seen.has(normalized)) {
                    queued.push(normalized);
                }
            }
        }
        return result;
    }

    /**
     * @description 按文件内容/旁路约定发现依赖路径。
     * @param source 源文件绝对路径。
     * @returns 依赖绝对路径列表。
     */
    private _discoverFileDependencies(source: string): readonly string[] {
        const extension = extname(source).toLowerCase();
        if (extension === '.atlas') {
            return this._readAtlasPages(source);
        }
        if (extension === '.tmx') {
            return TiledMapImportSource.images(source);
        }
        if (extension === '.plist') {
            return this._readSpriteAtlasPages(source);
        }
        if (extension === '.fnt') {
            return this._readBmFontPages(source);
        }
        if (extension === '.gltf') {
            return this._readGltfDependencies(source);
        }
        if (extension === '.skel') {
            const directory = dirname(source);
            const stem = basename(source, extension);
            return [join(directory, `${stem}.atlas`)];
        }
        if (extension === '.dbbin') {
            const directory = dirname(source);
            const stem = basename(source, extension);
            return [join(directory, `${stem}_tex.json`), join(directory, `${stem.replace(/_ske$/iu, '')}_tex.json`)];
        }
        if (extension !== '.json' && extension !== '.txt') {
            return [];
        }
        const document = this._readJsonObject(source);
        if (document == null) {
            return [];
        }
        const directory = dirname(source);
        const stem = basename(source, extension);
        const dependencies: string[] = [];
        if (document.skeleton != null && typeof document.skeleton === 'object') {
            dependencies.push(join(directory, `${stem}.atlas`));
        }
        const imagePath =
            typeof document.imagePath === 'string' ? document.imagePath : undefined;
        if (imagePath != null && imagePath.trim().length > 0) {
            dependencies.push(resolve(directory, imagePath));
        }
        const textureJson = join(
            directory,
            `${stem.replace(/_ske$/iu, '')}_tex.json`,
        );
        if (
            (Array.isArray(document.armature) || document.compatibleVersion != null) &&
            existsSync(textureJson)
        ) {
            dependencies.push(textureJson);
        }
        return dependencies;
    }

    /**
     * @description 读取 `.atlas` 中的贴图页文件名。
     * @param source atlas 路径。
     * @returns 贴图绝对路径。
     */
    private _readAtlasPages(source: string): readonly string[] {
        try {
            const directory = dirname(source);
            return readFileSync(source, 'utf8')
                .split(/\r?\n/u)
                .map((line) => line.trim())
                .filter((line) => /\.(png|jpe?g|webp)$/iu.test(line) && !line.includes(':'))
                .map((line) => resolve(directory, line));
        } catch {
            return [];
        }
    }

    /**
     * @description 从 SpriteAtlas XML 的 metadata 发现同目录贴图；不解析粒子 plist 或外部 DTD。
     * @param source 图集源文件路径。
     * @returns 去重后的贴图依赖；声明缺失文件交由导入前 missing 检查拒绝。
     */
    private _readSpriteAtlasPages(source: string): readonly string[] {
        if (!existsSync(source)) {
            return [];
        }
        const xml = readFileSync(source, 'utf8').replace(/<!--[\s\S]*?-->/gu, '');
        if (!/<key>\s*frames\s*<\/key>\s*<dict>/u.test(xml)) {
            return [];
        }
        const metadata = /<key>\s*metadata\s*<\/key>\s*<dict>([\s\S]*?)<\/dict>/u.exec(xml)?.[1];
        const matches = [...(metadata ?? '').matchAll(
            /<key>\s*(?:realTextureFileName|textureFileName)\s*<\/key>\s*<string>([^<]*)<\/string>/gu,
        )];
        if (matches.length === 0) {
            throw new Error(`asset_import_plist_texture_missing:${source}`);
        }
        const pages = matches.map((match) => {
            const name = this._decodePlistTextureName(match[1] ?? '');
            if (name.length === 0 || name === '.' || name === '..' ||
                /[/\\:\u0000-\u001f\u007f]/u.test(name) || basename(name) !== name) {
                throw new Error(`asset_import_plist_texture_path_invalid:${source}`);
            }
            return join(dirname(source), name);
        });
        return [...new Set(pages)];
    }

    /**
     * @description 只解码 XML 内建与数值文本实体一次，不展开自定义实体或外部引用。
     * @param value 原始文件名文本。
     * @returns 解码后的文件名；非法实体在任何原生操作前拒绝。
     */
    private _decodePlistTextureName(value: string): string {
        if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/u.test(value)) {
            throw new Error('asset_import_plist_entity_invalid');
        }
        const entities: Readonly<Record<string, string>> = {
            amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
        };
        return value.replace(/&([^;]+);/gu, (_match: string, entity: string): string => {
            const literal = entities[entity];
            if (literal != null) {
                return literal;
            }
            const point = entity.startsWith('#x')
                ? Number.parseInt(entity.slice(2), 16)
                : Number.parseInt(entity.slice(1), 10);
            if (!Number.isInteger(point) || point <= 0 || point > 0x10ffff ||
                (point >= 0xd800 && point <= 0xdfff)) {
                throw new Error('asset_import_plist_entity_invalid');
            }
            return String.fromCodePoint(point);
        });
    }

    /**
     * @description 读取 BMFont `file=` 贴图引用。
     * @param source `.fnt` 路径。
     * @returns 贴图绝对路径。
     */
    private _readBmFontPages(source: string): readonly string[] {
        if (!existsSync(source)) { return []; }
        return [BitmapFontImportSource.read(source).image];
    }

    /**
     * @description 读取 glTF 外链 buffer / image 依赖。
     * @param source `.gltf` 路径。
     * @returns 依赖绝对路径。
     */
    private _readGltfDependencies(source: string): readonly string[] {
        const document = this._readJsonObject(source);
        if (document == null) {
            return [];
        }
        const directory = dirname(source);
        const dependencies: string[] = [];
        if (Array.isArray(document.buffers)) {
            for (const buffer of document.buffers) {
                if (buffer == null || typeof buffer !== 'object' || Array.isArray(buffer)) {
                    continue;
                }
                const uri = typeof buffer.uri === 'string' ? buffer.uri.trim() : '';
                if (uri.length > 0 && !uri.startsWith('data:')) {
                    dependencies.push(resolve(directory, uri));
                }
            }
        }
        if (Array.isArray(document.images)) {
            for (const image of document.images) {
                if (image == null || typeof image !== 'object' || Array.isArray(image)) {
                    continue;
                }
                const uri = typeof image.uri === 'string' ? image.uri.trim() : '';
                if (uri.length > 0 && !uri.startsWith('data:')) {
                    dependencies.push(resolve(directory, uri));
                }
            }
        }
        return dependencies;
    }

    /**
     * @description 去重并规范化路径。
     * @param sources 原始路径。
     * @returns 规范化路径列表。
     */
    private _dedupeNormalized(sources: readonly string[]): readonly string[] {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const source of sources) {
            if (typeof source !== 'string') {
                continue;
            }
            const normalized = this._normalize(source);
            if (normalized.length === 0 || seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            out.push(normalized);
        }
        return out;
    }

    /**
     * @description 统一路径分隔符。
     * @param value 原始路径。
     * @returns 规范化路径。
     */
    private _normalize(value: string): string {
        return value.trim().replace(/\\/gu, '/');
    }

    /**
     * @description 建立路径别名索引。
     * @param sources 规范化路径。
     * @returns 别名映射。
     */
    private _buildAliases(sources: readonly string[]): Map<string, string> {
        const aliases = new Map<string, string>();
        for (const source of sources) {
            aliases.set(source, source);
            const base = basename(source);
            if (!aliases.has(base)) {
                aliases.set(base, source);
            }
        }
        return aliases;
    }

    /**
     * @description 从旁路 `.meta` 建立 uuid 索引。
     * @param sources 源路径。
     * @returns uuid → 源路径。
     */
    private _buildUuidIndex(sources: readonly string[]): Map<string, string> {
        const result = new Map<string, string>();
        for (const source of sources) {
            const metaPath = source.endsWith('.meta') ? source : `${source}.meta`;
            const meta = this._readJsonObject(metaPath);
            if (meta != null && typeof meta.uuid === 'string') {
                result.set(meta.uuid, source);
            }
        }
        return result;
    }

    /**
     * @description 按扩展名与同 stem 共现分类。
     * @param sources 规范化路径。
     * @returns 路径到种类。
     */
    private _classifyKinds(sources: readonly string[]): Map<string, AssetImportKind> {
        const kinds = new Map<string, AssetImportKind>();
        const byStem = new Map<string, string[]>();
        for (const source of sources) {
            const lower = source.toLowerCase();
            if (!source.includes('.') && !source.endsWith('/')) {
                kinds.set(source, 'directory');
            } else if (lower.endsWith('.atlas')) {
                kinds.set(source, 'spineAtlas');
            } else if (lower.endsWith('.skel')) {
                kinds.set(source, 'spineData');
            } else if (lower.endsWith('.dbbin')) {
                kinds.set(source, 'dragonBonesData');
            } else if (lower.endsWith('_tex.json')) {
                kinds.set(source, 'dragonBonesAtlas');
            } else if (
                (lower.endsWith('.json') || lower.endsWith('.txt')) &&
                this._hasSibling(sources, source, '.atlas')
            ) {
                kinds.set(source, 'spineData');
            } else if (lower.endsWith('_ske.json')) {
                kinds.set(source, 'dragonBonesData');
            } else if (lower.endsWith('.fnt')) {
                kinds.set(source, 'bitmapFont');
            } else if (lower.endsWith('.fbx')) {
                kinds.set(source, 'modelFbx');
            } else if (lower.endsWith('.glb')) {
                kinds.set(source, 'modelGlb');
            } else if (lower.endsWith('.gltf')) {
                kinds.set(source, 'modelGltf');
            } else if (lower.endsWith('.bin')) {
                kinds.set(source, 'modelBuffer');
            } else if (/\.(png|jpg|jpeg|webp)$/iu.test(lower)) {
                kinds.set(source, 'image');
            } else {
                kinds.set(source, 'other');
            }
            const stemKey = this._stemKey(source);
            const bucket = byStem.get(stemKey) ?? [];
            bucket.push(source);
            byStem.set(stemKey, bucket);
        }
        for (const group of byStem.values()) {
            const hasFnt = group.some((pathValue) => pathValue.toLowerCase().endsWith('.fnt'));
            if (!hasFnt) {
                continue;
            }
            for (const pathValue of group) {
                if (/\.png$/iu.test(pathValue)) {
                    kinds.set(pathValue, 'bitmapFontAtlas');
                }
            }
        }
        return kinds;
    }

    /**
     * @description 按种类添加同 stem 启发式边。
     * @param source 当前路径。
     * @param sources 全量路径。
     * @param kinds 种类表。
     * @param refs 输出依赖集合。
     */
    private _addHeuristicEdges(
        source: string,
        sources: readonly string[],
        kinds: ReadonlyMap<string, AssetImportKind>,
        refs: Set<string>,
    ): void {
        const kind = kinds.get(source) ?? 'other';
        const directory = dirname(source);
        const stem = this._stem(source);
        if (kind === 'spineAtlas' || kind === 'dragonBonesAtlas') {
            for (const candidate of sources) {
                if (
                    kinds.get(candidate) === 'image' &&
                    dirname(candidate) === directory &&
                    this._stem(candidate) === stem
                ) {
                    refs.add(candidate);
                }
            }
            return;
        }
        if (kind === 'spineData') {
            for (const candidate of sources) {
                const candidateKind = kinds.get(candidate);
                if (
                    (candidateKind === 'spineAtlas' || candidateKind === 'image') &&
                    dirname(candidate) === directory &&
                    this._stem(candidate) === stem
                ) {
                    refs.add(candidate);
                }
            }
            return;
        }
        if (kind === 'dragonBonesData') {
            for (const candidate of sources) {
                const candidateKind = kinds.get(candidate);
                if (
                    candidateKind === 'dragonBonesAtlas' &&
                    dirname(candidate) === directory
                ) {
                    refs.add(candidate);
                }
            }
            return;
        }
        if (kind === 'bitmapFont') {
            for (const candidate of sources) {
                if (
                    kinds.get(candidate) === 'bitmapFontAtlas' &&
                    dirname(candidate) === directory &&
                    this._stem(candidate) === stem
                ) {
                    refs.add(candidate);
                }
            }
            if (directory.length > 0 && sources.includes(directory)) {
                refs.add(directory);
            }
            return;
        }
        if (kind === 'modelGltf') {
            for (const candidate of sources) {
                const candidateKind = kinds.get(candidate);
                if (
                    (candidateKind === 'image' || candidateKind === 'modelBuffer') &&
                    dirname(candidate) === directory
                ) {
                    refs.add(candidate);
                }
            }
        }
    }

    /**
     * @description 读取显式依赖表。
     * @param source 当前路径。
     * @param dependencyMap 显式依赖。
     * @returns 依赖标识。
     */
    private _readExplicit(
        source: string,
        dependencyMap: Readonly<Record<string, readonly string[]>>,
    ): readonly string[] {
        const direct = dependencyMap[source] ?? dependencyMap[basename(source)];
        if (direct == null) {
            return [];
        }
        return direct.filter((item) => typeof item === 'string' && item.trim().length > 0);
    }

    /**
     * @description 读取序列化文档中的 `__uuid__` 引用。
     * @param source 源路径。
     * @returns uuid 列表。
     */
    private _readSerializedUuidReferences(source: string): readonly string[] {
        if (source.endsWith('.meta')) {
            return [];
        }
        const document = this._readJsonValue(source);
        if (document == null) {
            return [];
        }
        const refs = new Set<string>();
        this._visit(document, (record) => {
            if (typeof record.__uuid__ === 'string') {
                refs.add(record.__uuid__);
            }
        });
        return [...refs];
    }

    /**
     * @description 划分角色。
     * @param dependencyCount 出边数。
     * @param dependentCount 被引用数。
     * @returns 角色。
     */
    private _classifyRole(dependencyCount: number, dependentCount: number): AssetImportRole {
        if (dependencyCount === 0 && dependentCount === 0) {
            return 'independent';
        }
        if (dependentCount > 1) {
            return 'shared-dependency';
        }
        if (dependentCount > 0) {
            return 'dependency';
        }
        return 'top-level';
    }

    /**
     * @description 是否存在指定扩展名兄弟文件。
     * @param sources 全量。
     * @param source 当前。
     * @param extension 扩展名。
     * @returns 是否存在。
     */
    private _hasSibling(
        sources: readonly string[],
        source: string,
        extension: string,
    ): boolean {
        const directory = dirname(source);
        const stem = this._stem(source);
        const needle = join(directory, `${stem}${extension}`).replace(/\\/gu, '/').toLowerCase();
        return sources.some((candidate) => candidate.toLowerCase() === needle);
    }

    /**
     * @description 去掉扩展名的 stem。
     * @param pathValue 路径。
     * @returns stem。
     */
    private _stem(pathValue: string): string {
        const base = basename(pathValue);
        const index = base.lastIndexOf('.');
        return index < 0 ? base : base.slice(0, index);
    }

    /**
     * @description 同目录 stem 键。
     * @param pathValue 路径。
     * @returns 键。
     */
    private _stemKey(pathValue: string): string {
        return `${dirname(pathValue)}/${this._stem(pathValue)}`;
    }

    /**
     * @description 读取 JSON 对象。
     * @param filePath 路径。
     * @returns 对象或 `undefined`。
     */
    private _readJsonObject(filePath: string): Record<string, unknown> | undefined {
        const value = this._readJsonValue(filePath);
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            return undefined;
        }
        return value as Record<string, unknown>;
    }

    /**
     * @description 读取 JSON 值。
     * @param filePath 路径。
     * @returns 解析值或 `undefined`。
     */
    private _readJsonValue(filePath: string): unknown {
        try {
            return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
        } catch {
            return undefined;
        }
    }

    /**
     * @description 深度遍历对象。
     * @param value 值。
     * @param visitor 访问器。
     */
    private _visit(
        value: unknown,
        visitor: (record: Record<string, unknown>) => void,
    ): void {
        if (value == null || typeof value !== 'object') {
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                this._visit(item, visitor);
            }
            return;
        }
        const record = value as Record<string, unknown>;
        visitor(record);
        for (const item of Object.values(record)) {
            this._visit(item, visitor);
        }
    }

    /**
     * @description 缺失依赖去重。
     * @param items 列表。
     * @returns 去重结果。
     */
    private _dedupeMissing(
        items: readonly { source: string; dependency: string }[],
    ): Array<{ source: string; dependency: string }> {
        const seen = new Set<string>();
        const out: Array<{ source: string; dependency: string }> = [];
        for (const item of items) {
            const key = `${item.source}\0${item.dependency}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            out.push(item);
        }
        return out;
    }
}
