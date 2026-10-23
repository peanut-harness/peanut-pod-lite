import { readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { IComponentResourceBinding } from './component-value-recipe.mts';

/**
 * @description 为Terrain选取版本精确的完整效果，并在启动前验证实际SDK的全部内置chunk依赖。
 */
export class ComponentTerrainEffect {
    /**
     * @description Terrain材质更新会无条件或按模式写入的属性，通用Unlit效果不具备此契约。
     */
    private static readonly _properties = ['UVScale', 'metallic', 'roughness', 'weightMap',
        'detailMap0', 'detailMap1', 'detailMap2', 'detailMap3', 'normalMap0', 'normalMap1', 'normalMap2', 'normalMap3'];

    /**
     * @description 从冻结的同版本SDK副本取得真实导入输入，不猜测资源UUID。
     * @param root 产品工作树。
     * @param version 精确Creator版本。
     * @returns 带源摘要及语义约束的效果绑定。
     */
    public static binding(root: string, version: string): IComponentResourceBinding {
        const provenance = this.provenance(root, version);
        const sources = provenance.files.map(row => {
            const path = this.text(row.path); const expected = this.text(row.sha256);
            const base = `tests/fixtures/editor-stability/components/${version}/terrain-effect/`;
            if (![base + 'task51-terrain.effect', base + 'task51-terrain.effect.meta'].includes(path)) throw new Error('component_terrain_effect_source_invalid');
            this.verify(root, path, expected);
            return { path, sha256: expected };
        });
        if (new Set(sources.map(source => source.path)).size !== 2) throw new Error('component_terrain_effect_source_pair_missing');
        const source = sources.find(source => source.path.endsWith('.effect'));
        if (!source) throw new Error('component_terrain_effect_source_missing');
        const header = readFileSync(join(root, source.path), 'utf8').split('CCProgram')[0] ?? '';
        if (this._properties.some(name => !new RegExp('\\b' + name + '\\s*:').test(header))) throw new Error('component_terrain_effect_properties_missing');
        return { nativeType: 'cc.EffectAsset', fixtureReference: `tests/fixtures/editor-stability/components/${version}/terrain-effect/source-provenance.json`,
            sources, selector: '实际导入同版本builtin-terrain效果；完整Terrain属性与SDK shader chunk须一致，UUID只从AssetDB读取' };
    }

    /**
     * @description 原生工程启动前逐项核对效果、meta和所有传递builtin chunk，SDK漂移时停止。
     * @param root 产品工作树。
     * @param engine 实际SDK引擎根。
     * @param version 精确Creator版本。
     * @returns 无；任何源或SDK依赖不一致均抛错。
     */
    public static assertSdk(root: string, engine: string, version: string): void {
        this.binding(root, version);
        const provenance = this.provenance(root, version);
        if (this.record(JSON.parse(readFileSync(join(engine, 'package.json'), 'utf8'))).version !== version) throw new Error('component_terrain_effect_sdk_version_mismatch');
        for (const row of provenance.files) {
            const path = this.text(row.sdkPath);
            if (!['editor/assets/effects/builtin-terrain.effect', 'editor/assets/effects/builtin-terrain.effect.meta'].includes(path)) throw new Error('component_terrain_effect_sdk_source_invalid');
            this.verify(engine, path, this.text(row.sha256));
        }
        for (const row of provenance.chunks) {
            const path = this.text(row.path);
            if (!path.startsWith('editor/assets/chunks/') || !path.endsWith('.chunk')) throw new Error('component_terrain_effect_chunk_path_invalid');
            this.verify(engine, path, this.text(row.sha256));
        }
        const source = readFileSync(join(engine, 'editor/assets/effects/builtin-terrain.effect'), 'utf8');
        const local = new Set([...source.matchAll(/CCProgram\s+([A-Za-z0-9_/-]+)\s*%\{/gu)].map(match => match[1]));
        const pending = this.includes(source); const visited = new Set<string>();
        const declared = new Set(provenance.chunks.map(row => this.text(row.path)));
        while (pending.length) {
            const name = pending.pop();
            if (!name || local.has(name)) continue;
            const path = `editor/assets/chunks/${name}.chunk`;
            if (visited.has(path)) continue;
            if (!declared.has(path)) throw new Error('component_terrain_effect_chunk_closure_missing');
            visited.add(path);
            pending.push(...this.includes(readFileSync(join(engine, path), 'utf8')));
        }
        if (visited.size !== declared.size) throw new Error('component_terrain_effect_chunk_closure_extra');
    }

    /**
     * @description 排除SDK注释示例中的伪include，仅遍历实际GLSL依赖。
     * @param source 已校验摘要的实际效果或chunk源码。
     * @returns 实际include名字。
     */
    private static includes(source: string): string[] {
        const active = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
        return [...active.matchAll(/#include\s*<([^>]+)>/gu)].map(match => match[1] ?? '');
    }

    /**
     * @description 只接受精确版本、完整源对及有界且不重复的chunk清单。
     * @param root 产品工作树。
     * @param version 精确版本。
     * @returns 经结构校验的来源清单。
     */
    private static provenance(root: string, version: string) {
        if (!['3.8.3', '3.8.7'].includes(version)) throw new Error('component_terrain_effect_version_unsupported');
        const path = join(realpathSync(root), `tests/fixtures/editor-stability/components/${version}/terrain-effect/source-provenance.json`);
        if (realpathSync(path) !== path) throw new Error('component_terrain_effect_provenance_link');
        const value = this.record(JSON.parse(readFileSync(path, 'utf8')));
        const files = this.rows(value.files); const chunks = this.rows(value.sdkChunks);
        if (value.schemaVersion !== 1 || value.creatorVersion !== version || files.length !== 2 || chunks.length < 1 || chunks.length > 128
            || new Set(chunks.map(row => this.text(row.path))).size !== chunks.length) throw new Error('component_terrain_effect_provenance_invalid');
        return { files, chunks };
    }

    /**
     * @description 拒绝路径穿越、符号链接和摘要漂移，不改变安装SDK或夹具。
     * @param root 允许的实际根。
     * @param path 根内相对路径。
     * @param expected 预期SHA256。
     * @returns 无；失败即停止。
     */
    private static verify(root: string, path: string, expected: string): void {
        if (path.split('/').some(part => ['', '.', '..'].includes(part)) || !/^[a-f0-9]{64}$/u.test(expected)) throw new Error('component_terrain_effect_reference_invalid');
        const base = realpathSync(root); const absolute = join(base, path);
        if (!realpathSync(absolute).startsWith(base + sep) || realpathSync(absolute) !== absolute) throw new Error('component_terrain_effect_link_escape');
        if (createHash('sha256').update(readFileSync(absolute)).digest('hex') !== expected) throw new Error('component_terrain_effect_hash_mismatch:' + path);
    }

    /**
     * @description 校验JSON对象，不借类型断言信任外部结构。
     * @param value 未受信JSON值。
     * @returns 普通字段映射。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_terrain_effect_object_required');
        return Object.fromEntries(Object.entries(value));
    }

    /**
     * @description 校验有序JSON对象清单。
     * @param value 未受信JSON值。
     * @returns 对象清单。
     */
    private static rows(value: unknown): Record<string, unknown>[] {
        if (!Array.isArray(value)) throw new Error('component_terrain_effect_rows_required');
        return value.map(row => this.record(row));
    }

    /**
     * @description 拒绝空串和非字符串的来源字段。
     * @param value 未受信JSON字段。
     * @returns 非空字符串。
     */
    private static text(value: unknown): string {
        if (typeof value !== 'string' || !value) throw new Error('component_terrain_effect_string_required');
        return value;
    }
}
