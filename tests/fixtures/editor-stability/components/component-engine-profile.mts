import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @description 隔离验证工程显式选择内置引擎，不继承或修改用户的全局自定义引擎。
 */
export class ComponentEngineProfile {
    /**
     * @description 为全新工程写入窄范围本地配置，已有配置拒绝覆盖。
     * @param project 新隔离工程。
     * @param version 已支持的精确版本。
     */
    public static configure(project: string, version: string): void {
        const key = this.key(version);
        const directory = join(project, 'profiles/v2/packages');
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, 'engine.json'), JSON.stringify({ __version__: '1.0.9',
            engine: { [key]: { javascript: { builtin: true }, native: { builtin: true } } } }, null, 2) + '\n', { flag: 'wx' });
    }

    /**
     * @description 启动前和原生健康检查共用同一内置引擎门禁，未知或继承配置均拒绝。
     * @param value 本地配置或Profile读取的完整有效配置。
     * @param version 精确版本。
     */
    public static assertBuiltin(value: unknown, version: string): void {
        const record = (input: unknown): Record<string, unknown> => input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
        const selection = record(record(record(value).engine)[this.key(version)]);
        if (record(selection.javascript).builtin !== true || record(selection.native).builtin !== true) {
            throw new Error('component_native_builtin_engine_not_confirmed');
        }
    }

    /**
     * @description 只读本工程显式配置，不把全局默认当作已证明的内置引擎。
     * @param project 隔离工程。
     * @param version 精确版本。
     */
    public static assertProject(project: string, version: string): void {
        this.assertBuiltin(JSON.parse(readFileSync(join(project, 'profiles/v2/packages/engine.json'), 'utf8')), version);
    }

    /**
     * @description 将已支持版本映射到Creator配置键，拒绝未知版本。
     * @param version 精确版本。
     * @returns 配置中的版本键。
     */
    private static key(version: string): string {
        if (!['3.8.3', '3.8.7'].includes(version)) { throw new Error('component_native_engine_version_unsupported'); }
        return version.replaceAll('.', '');
    }
}
