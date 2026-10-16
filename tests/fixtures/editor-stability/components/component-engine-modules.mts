import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

/**
 * @description 任务隔离工程的有限模块上下文；不是MCP暴露档位。
 */
export type ComponentEngineContext = 'sorting' | 'post-process' | 'character-physx';

/**
 * @description 固定任务工程的精确引擎模块前置条件；不把组件存在和字段读回当作预览已启用排序。
 */
export class ComponentEngineModules {
    /**
     * @description 仅在未启动的新3.8.7矩阵工程暂存官方UI导出的单项排序配置，3.8.3保持原样。
     * @param project 新任务工程。
     * @param engine 精确内置SDK根。
     * @param version 已支持版本。
     * @param context 隔离工程的有限模块上下文。
     */
    public static stage(project: string, engine: string, version: string, context: ComponentEngineContext = 'sorting'): void {
        if (!this.needsSorting(version, context)) return;
        if (existsSync(join(dirname(project), 'creator-owned-start.json'))) throw new Error('component_engine_modules_project_already_started');
        const sdk = realpathSync(engine); const source = join(sdk, 'cc.config.json');
        if (realpathSync(source) !== source || this.record(JSON.parse(readFileSync(join(sdk, 'package.json'), 'utf8'))).version !== version)
            throw new Error('component_engine_modules_sdk_identity_invalid');
        const config = this.record(JSON.parse(readFileSync(source, 'utf8')));
        const feature = this.record(this.record(config.features)['sorting-2d']);
        if (!Array.isArray(feature.modules) || !feature.modules.includes('sorting-2d') ||
            !Array.isArray(feature.dependentModules) || !feature.dependentModules.includes('2d') ||
            this.record(feature.overrideConstants).USE_SORTING_2D !== true ||
            this.record(this.record(config.constants).USE_SORTING_2D).value !== false)
            throw new Error('component_engine_modules_sorting_sdk_contract_invalid');
        if (context === 'post-process') {
            const post = this.record(this.record(config.features)['custom-pipeline-post-process']);
            if (!Array.isArray(post.modules) || !post.modules.includes('custom-pipeline-post-process')
                || !Array.isArray(post.dependentModules) || !post.dependentModules.includes('custom-pipeline'))
                throw new Error('component_engine_modules_post_sdk_contract_invalid');
        }
        if (context === 'character-physx') {
            const physx = this.record(this.record(config.features)['physics-physx']);
            if (!Array.isArray(physx.modules) || !physx.modules.includes('physics-physx') || !physx.modules.includes('physics-framework')
                || this.record(this.record(config.constants).LOAD_PHYSX_MANUALLY).value !== false)
                throw new Error('component_engine_modules_physx_sdk_contract_invalid');
        }
        const path = this.projectSettings(project, true); const present = existsSync(path);
        // 官方空工程模板尚无engine.json；版本来自本任务同版官方UI导出的工程配置。
        const settings = present ? this.record(JSON.parse(readFileSync(path, 'utf8'))) : { __version__: '1.0.12' };
        if (Object.hasOwn(settings, 'modules')) throw new Error('component_engine_modules_existing_config_refused');
        if (context === 'post-process' && 'macroConfig' in settings && !isDeepStrictEqual(settings.macroConfig, {}))
            throw new Error('component_engine_modules_existing_macros_refused');
        writeFileSync(path, JSON.stringify({ ...settings,
            ...(context === 'post-process' ? { macroConfig: { CUSTOM_PIPELINE_NAME: 'Forward' } } : {}),
            modules: this.expected(context) }, null, 2) + '\n', { flag: present ? 'w' : 'wx' });
        this.assertProject(project, version, context);
    }

    /**
     * @description 启动前与原生客户端读取同一份显式项目配置，拒绝缺失、链接和额外模块/后端变更。
     * @param project 已登记任务工程。
     * @param version 实际Creator版本。
     * @param context 登记的有限模块上下文。
     */
    public static assertProject(project: string, version: string, context: ComponentEngineContext = 'sorting'): void {
        if (!this.needsSorting(version, context)) return;
        const settings = this.record(JSON.parse(readFileSync(this.projectSettings(project), 'utf8')));
        if (!isDeepStrictEqual(settings.modules, this.expected(context))) throw new Error('component_engine_modules_project_profile_mismatch');
        this.assertMacros(settings.macroConfig, version, context);
    }

    /**
     * @description 验证公开Editor.Profile.getProject读回的有效模块选择，不接受全局editor配置替代。
     * @param value 当前工程有效modules配置。
     * @param version 实际Creator版本。
     * @param context 登记的有限模块上下文。
     */
    public static assertActive(value: unknown, version: string, context: ComponentEngineContext = 'sorting'): void {
        if (!this.needsSorting(version, context)) return;
        const modules = this.expected(context);
        const cache = this.record(this.record(this.record(modules.configs).defaultConfig).cache);
        // 同版实际getProject额外物化graphics；只接受从冻结选择推导的精确两项，不能忽略任意字段。
        const graphics = { pipeline: this.record(cache['render-pipeline'])._option,
            'custom-pipeline-post-process': this.record(cache['custom-pipeline-post-process'])._value };
        if (!isDeepStrictEqual(value, { ...modules, graphics })) throw new Error('component_engine_modules_active_profile_mismatch');
    }

    /**
     * @description 后处理必须选择同版SDK实际注册的Forward；原排序上下文不接纳额外宏。
     * @param value 磁盘或公开项目Profile读取的宏配置。
     * @param version 实际版本。
     * @param context 登记上下文。
     */
    public static assertMacros(value: unknown, version: string, context: ComponentEngineContext = 'sorting'): void {
        if (!this.needsSorting(version, context)) return;
        if (context !== 'post-process' && value === undefined) return;
        const expected = context === 'post-process' ? { CUSTOM_PIPELINE_NAME: 'Forward' } : {};
        if (!isDeepStrictEqual(value, expected)) throw new Error('component_engine_modules_macro_profile_mismatch');
    }

    /**
     * @description 有效Profile会补齐同版SDK宏默认值；逐项精确比较，磁盘覆盖项仍单独核验。
     * @param value 公开Profile读回的完整宏配置。
     * @param version 实际版本。
     * @param context 登记上下文。
     */
    public static assertActiveMacros(value: unknown, version: string, context: ComponentEngineContext = 'sorting'): void {
        if (!this.needsSorting(version, context)) return;
        const fixture = this.record(JSON.parse(readFileSync(new URL('./3.8.7/engine-macro-defaults.json', import.meta.url), 'utf8')));
        if (fixture.creatorVersion !== version) throw new Error('component_engine_macro_fixture_version_invalid');
        const expected = { ...this.record(fixture.macroConfig), CUSTOM_PIPELINE_NAME: context === 'post-process' ? 'Forward' : 'Builtin' };
        if (!isDeepStrictEqual(value, expected)) throw new Error('component_engine_modules_active_macro_profile_mismatch');
    }

    /**
     * @description 只接受已声明的上下文；旧登记未提供时保持原排序上下文。
     * @param value 登记或CLI中的上下文。
     * @returns 校验后的上下文。
     */
    public static context(value: unknown): ComponentEngineContext {
        if (value === undefined || value === 'sorting') return 'sorting';
        if (value === 'post-process' || value === 'character-physx') return value;
        throw new Error('component_engine_modules_context_invalid');
    }

    /**
     * @description 版本精确门控，不向缺少Sorting2D的3.8.3添加未知模块。
     * @param version 实际Creator版本。
     * @param context 有限模块上下文。
     * @returns 是否需要排序模块前置条件。
     */
    private static needsSorting(version: string, context: ComponentEngineContext): boolean {
        this.context(context);
        if (!['3.8.3', '3.8.7'].includes(version)) throw new Error('component_engine_modules_version_unsupported');
        if (context === 'post-process' && version !== '3.8.7') throw new Error('component_engine_modules_post_version_unverified');
        if (context === 'character-physx' && version !== '3.8.7') throw new Error('component_engine_modules_physx_version_unverified');
        return version === '3.8.7';
    }

    /**
     * @description 固定官方UI导出的模块配置，并显式选择官方默认配置键；不提供启用全部的接口。
     * @param context 有限上下文；后处理只增补源码证明的单项功能。
     * @returns 冻结配置。
     */
    private static expected(context: ComponentEngineContext): Record<string, unknown> {
        const source = this.record(JSON.parse(readFileSync(new URL('./3.8.7/engine-modules-sorting2d.json', import.meta.url), 'utf8')));
        if (source.creatorVersion !== '3.8.7') throw new Error('component_engine_modules_fixture_version_invalid');
        const modules = this.record(source.modules); const config = this.record(this.record(modules.configs).defaultConfig);
        if (modules.globalConfigKey !== 'defaultConfig' || !Array.isArray(config.includeModules) ||
            !config.includeModules.includes('sorting-2d') || this.record(this.record(config.cache)['sorting-2d'])._value !== true)
            throw new Error('component_engine_modules_fixture_invalid');
        if (context === 'post-process') {
            const cache = this.record(config.cache); const post = this.record(cache['custom-pipeline-post-process']);
            if (post._value !== false) throw new Error('component_engine_modules_fixture_invalid');
            config.cache = { ...cache, 'custom-pipeline-post-process': { ...post, _value: true } };
            config.includeModules = [...config.includeModules, 'custom-pipeline-post-process'].sort();
            modules.configs = { ...this.record(modules.configs), defaultConfig: config };
            modules.graphics = { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': true };
        }
        if (context === 'character-physx') {
            const cache = this.record(config.cache); const physics = this.record(cache.physics);
            const bullet = this.record(cache['physics-ammo']); const physx = this.record(cache['physics-physx']);
            const flags = this.record(config.flags);
            if (physics._option !== 'physics-ammo' || physics._value !== true || bullet._value !== true || physx._value !== false
                || this.record(physx._flags).LOAD_PHYSX_MANUALLY !== false || flags.LOAD_BULLET_MANUALLY !== false)
                throw new Error('component_engine_modules_physx_fixture_invalid');
            config.cache = { ...cache, physics: { ...physics, _option: 'physics-physx' },
                'physics-ammo': { ...bullet, _value: false }, 'physics-physx': { ...physx, _value: true } };
            delete flags.LOAD_BULLET_MANUALLY; config.flags = { ...flags, LOAD_PHYSX_MANUALLY: false };
            const included = config.includeModules;
            if (!Array.isArray(included)) throw new Error('component_engine_modules_physx_fixture_invalid');
            config.includeModules = included.filter((name: unknown) => name !== 'physics-ammo').concat('physics-physx').sort();
            modules.configs = { ...this.record(modules.configs), defaultConfig: config };
        }
        return modules;
    }

    /**
     * @description 只读写工程内原始配置文件；首次创建仍核对父目录，拒绝目录、文件及悬空符号链接。
     * @param project 实际工程。
     * @param allowMissing 是否允许官方空模板尚未创建的文件。
     * @returns 经真实路径核对的设置文件。
     */
    private static projectSettings(project: string, allowMissing = false): string {
        const path = join(realpathSync(project), 'settings/v2/packages/engine.json');
        if (realpathSync(dirname(path)) !== dirname(path)) throw new Error('component_engine_modules_settings_link');
        const stat = lstatSync(path, { throwIfNoEntry: false });
        if (stat && (!stat.isFile() || realpathSync(path) !== path)) throw new Error('component_engine_modules_settings_link');
        if (!stat && !allowMissing) throw new Error('component_engine_modules_settings_missing');
        return path;
    }

    /**
     * @description 将不可信JSON限制为普通键值记录。
     * @param value JSON值。
     * @returns 普通对象副本。
     */
    private static record(value: unknown): Record<string, unknown> {
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
    }
}
