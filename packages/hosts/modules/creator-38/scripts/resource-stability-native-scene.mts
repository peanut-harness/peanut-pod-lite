import { ResourceStabilityNativeRuntime } from './resource-stability-native-runtime.mts';
/**
 * @description Creator 场景进程固定只读入口；只加载已由主进程核对 namespace 的根 UUID。
 */
class ResourceStabilityNativeScene {
    /**
     * @description 原生 assetManager.loadAny/isValid/getClassName 真实观测；不接受代码、消息或字段写入。
     */
    public static async loadIdentity(uuid: string): Promise<{ actualUuid: string; type: string; valid: boolean; dependencies: readonly string[]; semantic: Record<string, unknown> }> {
        if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(uuid)) throw new Error('resource_native_scene_uuid_invalid');
        const cc = require('cc') as { assetManager: { dependUtil: { getDeps: (uuid: string) => readonly string[] }; loadAny: (uuid: string,
            callback: (error: Error | null, value: unknown) => void) => void }; isValid: (value: unknown) => boolean;
            js: { getClassName: (value: unknown) => string } };
        const asset = await new Promise<unknown>((resolve, reject) => cc.assetManager.loadAny(uuid,
            (error, value) => error ? reject(error) : resolve(value)));
        if (!asset || typeof asset !== 'object' || Reflect.get(asset, '_uuid') !== uuid || !cc.isValid(asset)) {
            throw new Error('resource_native_scene_asset_invalid');
        }
        const type = cc.js.getClassName(asset);
        const semantic = ResourceStabilityNativeRuntime.supports(type) ? { ...ResourceStabilityNativeRuntime.read(asset, type), type } : { type };
        return { actualUuid: String(Reflect.get(asset, '_uuid')), type, valid: true,
            dependencies: [...cc.assetManager.dependUtil.getDeps(uuid)], semantic };
    }
}

export const methods = { loadIdentity: ResourceStabilityNativeScene.loadIdentity };
