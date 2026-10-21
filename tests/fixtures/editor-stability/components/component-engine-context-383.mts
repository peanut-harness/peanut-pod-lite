import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ComponentSdkArchive } from './component-sdk-archive.mts';

type Context = 'post-process' | 'character-physx';

/**
 * @description 3.8.3独立SDK模块格式；仅在新登记工程改变已证明的单项管线或物理后端。
 */
export class ComponentEngineContext383 {
    /**
     * @description 核对六项引擎源及SDK manifest；只写启动前的新工程配置，不改安装包或全局设置。
     */
    public static stage(project: string, engine: string, path: string, context: Context): void {
        const proof = this.proof();
        for (const source of proof.sdkSources) {
            const file = join(realpathSync(engine), source.path);
            if (realpathSync(file) !== file || createHash('sha256').update(readFileSync(file)).digest('hex') !== source.sha256)
                throw new Error('component_engine_383_sdk_source_mismatch');
        }
        const manifest = ComponentSdkArchive.read(resolve(engine, '../../..'), 'engine-profile');
        if (createHash('sha256').update(manifest).digest('hex') !== proof.sdkEngineManifest.sha256)
            throw new Error('component_engine_383_manifest_mismatch');
        if (['library', 'temp', '.peanut-ai/component-probe.json'].some(name => existsSync(join(project, name)))
            || existsSync(join(dirname(project), 'creator-owned-start.json'))) throw new Error('component_engine_383_project_already_started');
        const exists = existsSync(path); const settings = exists ? this.record(JSON.parse(readFileSync(path, 'utf8'))) : {};
        if (Object.hasOwn(settings, 'modules') || ('macroConfig' in settings && !isDeepStrictEqual(settings.macroConfig, {})))
            throw new Error('component_engine_383_existing_config_refused');
        writeFileSync(path, JSON.stringify({ ...settings, __version__: settings.__version__ ?? proof.sdkEngineManifest.packageVersion,
            modules: this.expected(context), macroConfig: this.macros(context, false) }, null, 2) + '\n', { flag: exists ? 'w' : 'wx' });
    }

    /**
     * @description 3.8.3默认配置直接使用cache/includeModules；不引入3.8.7的configs或sorting-2d。
     */
    public static expected(context: Context): Record<string, unknown> {
        const modules = structuredClone(this.proof().sourceModules); const cache = this.record(modules.cache);
        const included = modules.includeModules;
        if (!Array.isArray(included) || 'configs' in modules || 'sorting-2d' in cache || included.includes('sorting-2d')
            || this.record(cache['custom-pipeline'])._value !== false || this.record(cache.physics)._option !== 'physics-ammo'
            || this.record(cache['physics-physx'])._value !== false) throw new Error('component_engine_383_source_profile_invalid');
        if (context === 'post-process') {
            cache['custom-pipeline'] = { ...this.record(cache['custom-pipeline']), _value: true };
            modules.includeModules = [...included, 'custom-pipeline'].sort();
        } else if (context === 'character-physx') {
            cache.physics = { ...this.record(cache.physics), _option: 'physics-physx' };
            cache['physics-ammo'] = { ...this.record(cache['physics-ammo']), _value: false };
            cache['physics-physx'] = { ...this.record(cache['physics-physx']), _value: true };
            modules.includeModules = included.filter(name => name !== 'physics-ammo').concat('physics-physx').sort();
        } else throw new Error('component_engine_383_context_invalid');
        modules.cache = cache; return modules;
    }

    /**
     * @description 实际SDK导出的宏默认值；3.8.3后处理注册名为Custom，PhysX保留默认空管线名。
     */
    public static macros(context: Context, active: boolean): Record<string, unknown> {
        const overrides = context === 'post-process' ? { CUSTOM_PIPELINE_NAME: 'Custom' } : {};
        if (!['post-process', 'character-physx'].includes(context)) throw new Error('component_engine_383_context_invalid');
        return active ? { ...this.proof().macroDefaults, ...overrides } : overrides;
    }

    /**
     * @description 启动前配置与实际Editor.Profile读回分别使用相同精确期望，额外模块或宏立即拒绝。
     */
    public static assert(value: unknown, context: Context, kind: 'modules' | 'macros' | 'active-macros'): void {
        const expected = kind === 'modules' ? this.expected(context) : this.macros(context, kind === 'active-macros');
        if (!isDeepStrictEqual(value, expected)) throw new Error('component_engine_383_' + kind + '_mismatch');
    }

    /**
     * @description 只接受精确版本、SDK摘要及原生来源字段，不把冻结来源当新上下文的实机通过。
     */
    private static proof(): { sourceModules: Record<string, unknown>; macroDefaults: Record<string, unknown>;
        sdkSources: { path: string; sha256: string }[]; sdkEngineManifest: { sha256: string; packageVersion: string } } {
        const value = JSON.parse(readFileSync(new URL('./3.8.3/engine-context-provenance.json', import.meta.url), 'utf8'));
        if (value.creatorVersion !== '3.8.3' || value.sdkSources?.length !== 6 || value.supportedPostPipelineName !== 'Custom'
            || value.sdkEngineManifest?.packageVersion !== '1.0.9' || value.newContextsNativeAcceptance !== false
            || value.sdkSources.some((s: { path: string; sha256: string }) => !/^[a-f0-9]{64}$/u.test(s.sha256)
                || s.path.split('/').some(part => ['', '.', '..'].includes(part)) || s.path.includes('\\')))
            throw new Error('component_engine_383_provenance_invalid');
        return value;
    }

    /**
     * @description 对外部JSON收窄普通记录，拒绝数组或空值。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_engine_383_record_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
