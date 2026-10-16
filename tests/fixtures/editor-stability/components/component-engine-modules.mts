import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

/**
 * @description 固定任务工程的精确引擎模块前置条件；不把组件存在和字段读回当作预览已启用排序。
 */
export class ComponentEngineModules {
    /**
     * @description 仅在未启动的新3.8.7矩阵工程暂存官方UI导出的单项排序配置，3.8.3保持原样。
     * @param project 新任务工程。
     * @param engine 精确内置SDK根。
     * @param version 已支持版本。
     */
    public static stage(project: string, engine: string, version: string): void {
        if (!this.needsSorting(version)) return;
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
        const path = this.projectSettings(project, true); const present = existsSync(path);
        // 官方空工程模板尚无engine.json；版本来自本任务同版官方UI导出的工程配置。
        const settings = present ? this.record(JSON.parse(readFileSync(path, 'utf8'))) : { __version__: '1.0.12' };
        if (Object.hasOwn(settings, 'modules')) throw new Error('component_engine_modules_existing_config_refused');
        writeFileSync(path, JSON.stringify({ ...settings, modules: this.expected() }, null, 2) + '\n', { flag: present ? 'w' : 'wx' });
        this.assertProject(project, version);
    }

    /**
     * @description 启动前与原生客户端读取同一份显式项目配置，拒绝缺失、链接和额外模块/后端变更。
     * @param project 已登记任务工程。
     * @param version 实际Creator版本。
     */
    public static assertProject(project: string, version: string): void {
        if (!this.needsSorting(version)) return;
        const settings = this.record(JSON.parse(readFileSync(this.projectSettings(project), 'utf8')));
        if (!isDeepStrictEqual(settings.modules, this.expected())) throw new Error('component_engine_modules_project_profile_mismatch');
    }

    /**
     * @description 验证公开Editor.Profile.getProject读回的有效模块选择，不接受全局editor配置替代。
     * @param value 当前工程有效modules配置。
     * @param version 实际Creator版本。
     */
    public static assertActive(value: unknown, version: string): void {
        if (!this.needsSorting(version)) return;
        const modules = this.expected();
        const cache = this.record(this.record(this.record(modules.configs).defaultConfig).cache);
        // 同版实际getProject额外物化graphics；只接受从冻结选择推导的精确两项，不能忽略任意字段。
        const graphics = { pipeline: this.record(cache['render-pipeline'])._option,
            'custom-pipeline-post-process': this.record(cache['custom-pipeline-post-process'])._value };
        if (!isDeepStrictEqual(value, { ...modules, graphics })) throw new Error('component_engine_modules_active_profile_mismatch');
    }

    /**
     * @description 版本精确门控，不向缺少Sorting2D的3.8.3添加未知模块。
     * @param version 实际Creator版本。
     * @returns 是否需要排序模块前置条件。
     */
    private static needsSorting(version: string): boolean {
        if (!['3.8.3', '3.8.7'].includes(version)) throw new Error('component_engine_modules_version_unsupported');
        return version === '3.8.7';
    }

    /**
     * @description 固定官方UI导出的模块配置，并显式选择官方默认配置键；不提供启用全部的接口。
     * @returns 冻结配置。
     */
    private static expected(): Record<string, unknown> {
        const source = this.record(JSON.parse(readFileSync(new URL('./3.8.7/engine-modules-sorting2d.json', import.meta.url), 'utf8')));
        if (source.creatorVersion !== '3.8.7') throw new Error('component_engine_modules_fixture_version_invalid');
        const modules = this.record(source.modules); const config = this.record(this.record(modules.configs).defaultConfig);
        if (modules.globalConfigKey !== 'defaultConfig' || !Array.isArray(config.includeModules) ||
            !config.includeModules.includes('sorting-2d') || this.record(this.record(config.cache)['sorting-2d'])._value !== true)
            throw new Error('component_engine_modules_fixture_invalid');
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
