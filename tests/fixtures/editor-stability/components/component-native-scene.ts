/**
 * @description 运行于目标 Creator 场景进程；返回纯 JSON，绝不传输引擎对象。
 */
class ComponentNativeScene {
    /**
     * @description 从真正的 assetManager 加载 AssetDB 已登记资源并读回原生类型。
     */
    public static async loadAsset(uuid: string): Promise<unknown> {
        const cc = require('cc');
        const asset = await new Promise<unknown>((resolve, reject) => {
            cc.assetManager.loadAny(uuid, (error: Error | null, value: unknown) => error ? reject(error) : resolve(value));
        });
        if (!asset || !cc.isValid(asset)) throw new Error('component_native_asset_invalid');
        return { uuid, actualUuid: Reflect.get(asset as object, '_uuid'), type: cc.js.getClassName(asset), valid: cc.isValid(asset) };
    }

    /**
     * @description 从当前真实场景读取节点、组件及已经实例化的物理后端。
     */
    public static snapshot(): unknown {
        const cc = require('cc'); const scene = cc.director.getScene();
        if (!scene) throw new Error('component_native_scene_missing');
        const nodes: unknown[] = [];
        const walk = (node: { name: string; uuid: string; children: unknown[]; getComponents: Function }, prefix: string): void => {
            const nodePath = `${prefix}/${node.name}`;
            nodes.push({ path: nodePath, uuid: node.uuid, components: node.getComponents(cc.Component).map((component: object) => ({
                type: cc.js.getClassName(component), uuid: Reflect.get(component, 'uuid'), valid: cc.isValid(component),
            })) });
            for (const child of node.children) walk(child as typeof node, nodePath);
        };
        walk(scene, '');
        const world3d = cc.PhysicsSystem?.instance?.physicsWorld;
        const world2d = cc.PhysicsSystem2D?.instance?.physicsWorld;
        return { sceneName: scene.name, sceneUuid: scene.uuid, nodes,
            physics3d: world3d ? { constructor: world3d.constructor.name } : null,
            physics2d: world2d ? { constructor: world2d.constructor.name } : null,
            pipelineConstructor: cc.director.root?.pipeline?.constructor?.name ?? null,
            usesCustomPipeline: cc.director.root?.usesCustomPipeline ?? null,
            customPipelineConstructor: cc.director.root?.customPipeline?.constructor?.name ?? null,
            customPipelineName: cc.macro.CUSTOM_PIPELINE_NAME };
    }
}

export const methods = { loadAsset: ComponentNativeScene.loadAsset, snapshot: ComponentNativeScene.snapshot };
