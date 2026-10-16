import { ComponentNativeFieldReader } from './component-native-field-reader';
import { ComponentNativeAssetLoader } from './component-native-asset-loader';
import { ComponentSdkDiagnostics } from './component-sdk-diagnostics';
import { ComponentNativeTiledContext } from './component-native-tiled-context';

/**
 * @description 运行于目标 Creator 场景进程；返回纯 JSON，绝不传输引擎对象。
 */
class ComponentNativeScene {
    /**
     * @description 从真正的 assetManager 加载 AssetDB 已登记资源并读回原生类型。
     */
    public static async loadAsset(uuid: string, dependencies: readonly string[]): Promise<unknown> {
        const cc = require('cc');
        return ComponentNativeAssetLoader.load(uuid, dependencies, {
            load: (id) => new Promise((resolve, reject) => {
                cc.assetManager.loadAny(id, (error: Error | null, value: unknown) => error ? reject(error) : resolve(value));
            }), valid: asset => cc.isValid(asset), type: asset => cc.js.getClassName(asset),
        });
    }

    /**
     * @description 从当前真实场景读取节点、组件及已经实例化的物理后端。
     */
    public static snapshot(): unknown {
        Reflect.set(process, 'traceProcessWarnings', true);
        const cc = require('cc'); const scene = cc.director.getScene();
        if (!scene) throw new Error('component_native_scene_missing');
        const nodes: unknown[] = [];
        const walk = (node: { name: string; uuid: string; children: unknown[]; getComponents: Function }, prefix: string): void => {
            const nodePath = `${prefix}/${node.name}`;
            nodes.push({ path: nodePath, uuid: node.uuid, components: node.getComponents(cc.Component).map((component: object) => ({
                type: cc.js.getClassName(component), uuid: Reflect.get(component, 'uuid'), valid: cc.isValid(component),
                observed: ComponentNativeScene.observe(component),
            })) });
            for (const child of node.children) walk(child as typeof node, nodePath);
        };
        walk(scene, '');
        const world3d = cc.PhysicsSystem?.instance?.physicsWorld;
        const world2d = cc.PhysicsSystem2D?.instance?.physicsWorld;
        const builder = typeof cc.rendering?.getCustomPipeline === 'function'
            ? cc.rendering.getCustomPipeline(cc.macro.CUSTOM_PIPELINE_NAME) : null;
        const manager = Reflect.get(globalThis, 'EditorExtends')?.Component;
        const componentManagerListeners = typeof manager?.listenerCount === 'function' && typeof manager?.getMaxListeners === 'function'
            ? { max: manager.getMaxListeners(), add: manager.listenerCount('add'), remove: manager.listenerCount('remove'),
                callbackNames: ['add', 'remove'].map(event => ({ event, names: typeof manager.rawListeners === 'function'
                    ? manager.rawListeners(event).map((listener: Function) => listener.name) : null })) } : null;
        return { sceneName: scene.name, sceneUuid: scene.uuid, nodes, warningStacksEnabled: Reflect.get(process, 'traceProcessWarnings') === true,
            componentManagerListeners,
            physics3d: world3d ? { constructor: world3d.constructor.name } : null,
            physics2d: world2d ? { constructor: world2d.constructor.name } : null,
            pipelineConstructor: cc.director.root?.pipeline?.constructor?.name ?? null,
            usesCustomPipeline: cc.director.root?.usesCustomPipeline ?? null,
            customPipelineConstructor: cc.director.root?.customPipeline?.constructor?.name ?? null,
            postProcessBuilderConstructor: builder?.constructor?.name ?? null,
            customPipelineName: cc.macro.CUSTOM_PIPELINE_NAME };
    }

    /**
     * @description 读取Sprite、UIOpacity和UI模型载体的公开getter，返回纯JSON身份与值，不创建材质实例。
     * @param component 当前原生组件。
     * @returns 有界字段观测或null。
     */
    private static observe(component: object): unknown {
        const cc = require('cc');
        const type = cc.js.getClassName(component);
        if (['cc.TiledMap', 'cc.TiledLayer', 'cc.TiledObjectGroup', 'cc.TiledTile', 'cc.TiledUserNodeData'].includes(type))
            return ComponentNativeTiledContext.read(component);
        if (type === 'cc.Camera') return { enabled: Reflect.get(component, 'enabled'), usePostProcess: Reflect.get(component, 'usePostProcess') };
        if (type === 'cc.PostProcess') return { enabled: Reflect.get(component, 'enabled'), global: Reflect.get(component, 'global') };
        if (type === 'cc.UIOpacity') return { opacity: Reflect.get(component, 'opacity') };
        if (type === 'cc.UIMeshRenderer') {
            const model: unknown = Reflect.get(component, 'modelComponent');
            if (!model || typeof model !== 'object') return { modelPresent: false };
            const mesh: unknown = Reflect.get(model, 'mesh'); const materials: unknown = Reflect.get(model, 'sharedMaterials');
            const asset = (value: unknown): unknown => value && typeof value === 'object'
                ? { uuid: Reflect.get(value, '_uuid'), type: cc.js.getClassName(value), valid: cc.isValid(value) } : null;
            return { modelPresent: true, modelType: cc.js.getClassName(model), modelValid: cc.isValid(model),
                modelNodeMatches: Reflect.get(model, 'node') === Reflect.get(component, 'node'),
                modelEnabled: Reflect.get(model, 'enabled'), mesh: asset(mesh),
                sharedMaterials: Array.isArray(materials) ? materials.map(asset) : null };
        }
        if (type !== 'cc.Sprite') return null;
        const frame = Reflect.get(component, 'spriteFrame'); const color = Reflect.get(component, 'color');
        return { grayscale: Reflect.get(component, 'grayscale'), color: color ? { r: color.r, g: color.g, b: color.b, a: color.a } : null,
            spriteFrame: frame ? { uuid: frame._uuid, type: cc.js.getClassName(frame), valid: cc.isValid(frame) } : null };
    }
}

export const methods = { loadAsset: ComponentNativeScene.loadAsset, snapshot: ComponentNativeScene.snapshot,
    sdkLifecycleDiagnostics: () => ({ ...ComponentSdkDiagnostics.lifecycle(Reflect.get(globalThis, 'cce')) as object,
        metricsAdapters: ComponentSdkDiagnostics.adapters(require.cache), timerRoutes: ComponentSdkDiagnostics.timerRoutes(require.cache, null) }),
    fields: (nodeSuffix: string, componentType: string, expectedSceneUuid: string) => ComponentNativeFieldReader.read(nodeSuffix, componentType, expectedSceneUuid) };
