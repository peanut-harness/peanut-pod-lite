import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ComponentTerrainEffect } from './component-terrain-effect.mts';
import type { IComponentResourceBinding } from './component-value-recipe.mts';

/**
 * @description 为组件引用复用已审计真实资源；不生成伪造 mesh、skeleton 或 AssetDB UUID。
 */
export class ComponentResourceBindings {
    /**
     * @description 绑定同版本的源闭包，所有摘要与实际文件独立重算后才返回。
     * @param repositoryRoot 当前产品树。
     * @param version 单一 Creator 版本。
     * @returns 原生类型到真实导入配方；AssetDB 身份必须在导入后重新取得。
     */
    public static create(repositoryRoot: string, version: '3.8.3' | '3.8.7'): Readonly<Record<string, IComponentResourceBinding>> {
        const root = realpathSync(repositoryRoot);
        const mediaRoot = 'tests/fixtures/editor-stability/media';
        const supplemental = JSON.parse(readFileSync(join(root, mediaRoot, 'supplemental-catalog.json'), 'utf8')) as {
            files: { path: string; sha256: string }[];
            versions: Record<string, { inputs: Record<string, { input: string; dependencyClosure: string[]; derivedSelector?: string }> }>;
        };
        const original = JSON.parse(readFileSync(join(root, mediaRoot, 'catalog.json'), 'utf8')) as { files: { path: string; sha256: string }[] };
        const hashes = new Map([...original.files, ...supplemental.files].map((file) => [file.path, file.sha256]));
        const inputs = supplemental.versions[version]?.inputs;
        if (!inputs) throw new Error('component_media_version_missing');
        const result: Record<string, IComponentResourceBinding> = {};
        const mediaTypes: Readonly<Record<string, string>> = {
            'cc.SpriteFrame': 'image', 'cc.Texture2D': 'image', 'cc.TextureCube': 'cubeMap',
            'cc.Mesh': 'mesh', 'cc.Skeleton': 'skeleton', 'cc.AudioClip': 'audio', 'cc.VideoClip': 'video',
            'cc.SpriteAtlas': 'spriteAtlas', 'cc.ParticleAsset': 'particle', 'cc.TTFFont': 'ttfFont',
            'cc.TiledMapAsset': 'tiledMap', 'sp.SkeletonData': 'spine',
            'dragonBones.DragonBonesAsset': 'dragonBones', 'dragonBones.DragonBonesAtlasAsset': 'dragonBonesAtlas',
        };
        for (const [nativeType, kind] of Object.entries(mediaTypes)) {
            const input = inputs[kind];
            if (!input || !input.dependencyClosure.includes(input.input)) throw new Error(`component_media_closure_missing:${kind}`);
            const sources = input.dependencyClosure.map((path) => {
                const expected = hashes.get(path);
                if (!expected) throw new Error(`component_media_hash_missing:${path}`);
                return this.source(root, `${mediaRoot}/${path}`, expected);
            });
            result[nativeType] = { nativeType, fixtureReference: `${mediaRoot}/supplemental-catalog.json#versions/${version}/inputs/${kind}`,
                sources, selector: input.derivedSelector ?? `原生导入后按 ${nativeType} 唯一选择根或子资源；类型及源数据必须匹配` };
        }
        const serialized = JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/serialized/resource-fixtures.json'), 'utf8')) as {
            fixtures: { id: string; creatorVersion: string; assetKind: string; files: { source: { path: string; sha256: string } }; dependencies: unknown[] }[];
        };
        const serializedTypes: Readonly<Record<string, string>> = { 'cc.Material': 'material', 'cc.PhysicsMaterial': 'physicsMaterial',
            'cc.AnimationClip': 'animationClip', 'cc.animation.AnimationGraph': 'animationGraph', 'cc.TerrainAsset': 'terrain' };
        for (const [nativeType, kind] of Object.entries(serializedTypes)) {
            const fixture = serialized.fixtures.find((fixture) => fixture.creatorVersion === version && fixture.assetKind === kind);
            if (!fixture) throw new Error(`component_serialized_fixture_missing:${nativeType}`);
            const records = new Map<string, string>();
            const visit = (value: unknown): void => {
                if (!value || typeof value !== 'object') return;
                if (Array.isArray(value)) { value.forEach(visit); return; }
                const record = value as Record<string, unknown>;
                if (typeof record.path === 'string' && typeof record.sha256 === 'string') {
                    const old = records.get(record.path);
                    if (old && old !== record.sha256) throw new Error('component_source_hash_conflict');
                    records.set(record.path, record.sha256);
                }
                Object.values(record).forEach(visit);
            };
            visit(fixture.files); visit(fixture.dependencies);
            if (!records.has(fixture.files.source.path)) throw new Error('component_serialized_closure_missing_source');
            result[nativeType] = { nativeType, fixtureReference: `tests/fixtures/editor-stability/serialized/resource-fixtures.json#${fixture.id}`,
                sources: [...records].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, hash]) => this.source(root, path, hash)),
                selector: `导入后读取 ${nativeType} 根身份；模板 UUID 必须在隔离 staging 重映射` };
        }
        result['cc.EffectAsset'] = ComponentTerrainEffect.binding(root, version);
        return result;
    }

    /**
     * @description 拒绝路径穿越、链接逃逸和过期摘要，源始终来自当前工作树夹具。
     */
    private static source(root: string, path: string, expected: string): { path: string; sha256: string } {
        if (!path.startsWith('tests/fixtures/editor-stability/') || path.split('/').some((part) => ['', '.', '..'].includes(part))
            || !/^[a-f0-9]{64}$/u.test(expected)) throw new Error('component_source_reference_invalid');
        const absolute = resolve(root, path);
        if (!realpathSync(absolute).startsWith(`${root}${sep}`) || realpathSync(absolute) !== absolute) throw new Error('component_source_link_escape');
        const hash = createHash('sha256').update(readFileSync(absolute)).digest('hex');
        if (hash !== expected) throw new Error(`component_source_hash_mismatch:${path}`);
        return { path, sha256: hash };
    }
}
