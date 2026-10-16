import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { ComponentSdkArchive } from './component-sdk-archive.mts';

/**
 * @description 在两版新隔离工程中提供各自SDK已核验的旧版空服务配置，由Creator自身迁移。
 */
export class ComponentServiceProfile {
    /**
     * @description 启动前精确核验本版SDK配置迁移实现，未知实现不能复用迁移输入。
     */
    public static assertSdk(root: string, resources: string, version: string): void {
        this.assertVersion(version);
        const proof: unknown = JSON.parse(readFileSync(join(root, `tests/fixtures/editor-stability/components/${version}/empty-service-config-provenance.json`), 'utf8'));
        const bytes = ComponentSdkArchive.read(resources, 'service-config');
        if (!proof || typeof proof !== 'object' || Reflect.get(proof, 'creatorVersion') !== version
            || Reflect.get(proof, 'source') !== 'app.asar/extension/cocos-service/utils/config.js'
            || Reflect.get(proof, 'sourceSha256') !== createHash('sha256').update(bytes).digest('hex'))
            throw new Error('component_service_sdk_source_mismatch');
    }
    /**
     * @description 不绑定账号或启用服务，不覆盖任何现有配置，也不通过运行时写接口改变Profile。
     * @param project 全新隔离工程。
     * @param version 已核验的精确SDK版本。
     */
    public static stage(project: string, version: string): void {
        this.assertVersion(version);
        const root = realpathSync(project); const settings = join(root, 'settings');
        if (lstatSync(settings).isSymbolicLink() || realpathSync(settings) !== settings)
            throw new Error('component_service_settings_link_refused');
        if (['library', 'temp', '.peanut-ai/component-probe.json'].some(path => existsSync(join(root, path)))
            || existsSync(join(dirname(root), 'creator-owned-start.json')))
            throw new Error('component_service_already_started');
        for (const path of ['service.json', 'v2/extensions/cocos-service.json', 'v2/packages/cocos-service.json']) {
            try { lstatSync(join(settings, path)); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
            throw new Error('component_service_existing_config_refused');
        }
        writeFileSync(join(settings, 'service.json'), JSON.stringify(this.legacy(), null, 2) + '\n', { flag: 'wx' });
        this.assertProject(root, version);
    }

    /**
     * @description 启动前核对完整迁移输入，防止把已有账号或服务带入隔离工程。
     * @param project 本次隔离工程。
     * @param version 精确SDK版本。
     */
    public static assertProject(project: string, version: string): void {
        this.assertVersion(version);
        if (!isDeepStrictEqual(JSON.parse(readFileSync(join(project, 'settings/service.json'), 'utf8')), this.legacy()))
            throw new Error('component_service_legacy_profile_mismatch');
    }

    /**
     * @description 只接受Creator实际迁移后的匹配配置、空服务列表和SDK迁移版本。
     * @param value 公开Profile只读查询的四项数据。
     * @param version 精确SDK版本。
     */
    public static assertActive(value: unknown, version: string): void {
        this.assertVersion(version);
        const legacy = this.legacy();
        if (!isDeepStrictEqual(value, { game: { app_id: 'UNKNOW', name: '', c_id: '0' },
            configs: legacy.configs, appConfigMaps: [{ app_id: 'UNKNOW', config_id: 'peanut-task51-offline' }], cscv: '2.0.0' }))
            throw new Error('component_service_active_profile_mismatch');
    }

    /**
     * @description 保留SDK updateConfigFile读取的原始字段，services为空意味着不启用任何云服务。
     * @returns 可独立序列化的迁移输入。
     */
    private static legacy(): { game: { app_id: string; name: string; cid: string }; configs: Record<string, unknown>[] } {
        return { game: { app_id: 'UNKNOW', name: '', cid: '0' }, configs: [{ app_id: 'UNKNOW',
            config_id: 'peanut-task51-offline', config_name: 'Default', config_remarks: 'Task 5.1 offline validation', services: [] }] };
    }

    /**
     * @description 只允许已分别验证实际迁移实现的两个精确版本。
     * @param version 精确SDK版本。
     */
    private static assertVersion(version: string): void {
        if (!['3.8.3', '3.8.7'].includes(version)) throw new Error('component_service_version_unverified');
    }
}
