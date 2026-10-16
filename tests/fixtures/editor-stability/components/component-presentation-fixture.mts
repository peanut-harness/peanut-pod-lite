import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';
import { LumenComponentPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/component-property.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { ComponentSceneIntegrity } from './component-scene-integrity.mts';
import type { ComponentFieldFixtures } from './component-field-fixtures.mts';
import type { IComponentSkinnedContext } from './component-skinned-hierarchy.mts';

/**
 * @description 已冻结的单组件字段与依赖配方。
 */
type ComponentRow = ReturnType<typeof ComponentFieldFixtures.create>['components'][number];

/**
 * @description 展示场景使用同版本SDK完整预设；不把字段测试值和移除后的空节点当作展示内容。
 */
export class ComponentPresentationFixture {
    /**
     * @description 在首次导入前配对SceneAsset文件名和Scene的meta身份，避免Creator导入器改写冻结场景。
     * @param document 已装配的展示场景。
     * @param project 尚未启动Creator的新隔离工程。
     * @param version 实际Creator版本。
     * @returns 无；保存后即可冻结原始文件摘要。
     */
    public static saveForNativeImport(document: LumenPrefabDocument, project: string, version: '3.8.3' | '3.8.7'): void {
        const asset = document.entries[0]; const scene = document.entries.find(entry => entry.__type__ === 'cc.Scene');
        if (asset?.__type__ !== 'cc.SceneAsset' || !scene) throw new Error('component_presentation_scene_required');
        const cocosVersion = LumenCocosVersion.parse(version);
        document.save(project, true, cocosVersion);
        const meta: unknown = JSON.parse(readFileSync(join(project, document.relativePath + '.meta'), 'utf8'));
        if (!meta || typeof meta !== 'object' || !('uuid' in meta) || typeof meta.uuid !== 'string'
            || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(meta.uuid)) throw new Error('component_presentation_meta_identity_invalid');
        asset._name = basename(document.relativePath, '.scene'); scene._id = meta.uuid;
        document.save(project, false, cocosVersion);
    }

    /**
     * @description 已在精确SDK路径核对的UI预设；未列出的类型不能猜测预设文件。
     */
    private static readonly _ui: Readonly<Record<string, string>> = {
        'cc.Label': 'Label', 'cc.RichText': 'RichText', 'cc.Sprite': 'Sprite', 'cc.Button': 'Button',
        'cc.Toggle': 'Toggle', 'cc.EditBox': 'EditBox', 'cc.Slider': 'Slider', 'cc.ProgressBar': 'ProgressBar',
        'cc.ScrollView': 'ScrollView', 'cc.PageView': 'pageView', 'cc.Layout': 'Layout', 'cc.Widget': 'Widget', 'cc.Mask': 'Mask',
    };
    /**
     * @description 用真实可见Label作为非渲染UI行为组件的观察载体。
     */
    private static readonly _uiCarriers = new Set(['cc.UITransform', 'cc.UIOpacity', 'cc.SafeArea', 'cc.BlockInputEvents',
        'cc.RenderRoot2D', 'cc.UIStaticBatch', 'cc.UISkew', 'cc.Sorting2D']);

    /**
     * @description 生成未经过破坏性字段写入的完整预设场景；复杂运行上下文缺失时拒绝伪造展示。
     * @param engine 实际精确版本SDK根。
     * @param version 实际Creator版本。
     * @param row 已审计组件及依赖闭包。
     * @param postProcessContext 是否暂存已登记后处理候选；仍须原生管线与呈现验收。
     * @param skinnedContext 已冻结真实导入层次的同源副本；仍须原生和呈现验收。
     * @returns 完整场景和来源，或明确待补条件；始终没有原生呈现通过状态。
     */
    public static create(engine: string, version: '3.8.3' | '3.8.7', row: ComponentRow, postProcessContext = false,
        skinnedContext: IComponentSkinnedContext | null = null) {
        if (postProcessContext && version !== '3.8.7') throw new Error('component_presentation_post_version_unverified');
        const type = row.componentType; const req = row.assemblyRequirements;
        const container = type === 'cc.UIStaticBatch';
        const uiModel = type === 'cc.UIMeshRenderer';
        const ui = this._ui[type] ?? (type === 'cc.Sorting2D' ? 'Sprite' : this._uiCarriers.has(type) ? 'Label' : null);
        const physics = req.physicsBackend != null;
        const cube = ['cc.MeshRenderer', 'cc.Sorting', 'cc.LODGroup'].includes(type) || physics || uiModel
            || postProcessContext && req.highQualityRenderPipeline;
        const reasons = [...row.dependencyPlan.blockers];
        if (!row.dependencyPlan.attachOrder.includes(type)) reasons.push('presentation-native-component-unavailable');
        if (req.highQualityRenderPipeline && !postProcessContext) reasons.push('presentation-active-pipeline-and-effect-context-required');
        if (req.sourceOwnedTiledComponent) reasons.push('presentation-native-tiled-hierarchy-required');
        if (req.importedSkinnedHierarchy && !skinnedContext) reasons.push('presentation-same-source-skinned-animation-required');
        if (!ui && !cube && type !== 'cc.Canvas' && !(req.importedSkinnedHierarchy && skinnedContext)) reasons.push('presentation-component-specific-content-required');
        if (reasons.length) return { status: 'presentation-context-pending' as const, componentType: type,
            reasons, nativePassed: false as const, rendered: false as const };
        const sources: { path: string; sha256: string }[] = [];
        const source = (relative: string): string => {
            const path = join(realpathSync(engine), 'editor/assets', relative);
            if (!realpathSync(path).startsWith(realpathSync(engine) + sep)) throw new Error('component_presentation_sdk_escape');
            sources.push({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
            return path;
        };
        const is2d = !!ui || req.physicsBackend === 'box2d' || type === 'cc.Canvas' || uiModel;
        const document = LumenPrefabDocument.cloneFromTemplate(`assets/components/${type}.scene`,
            source(`default_file_content/scene/${is2d ? 'scene-2d' : 'default'}.scene`), 'Root');
        document.setPropertySchema(new LumenComponentPropertySchema(LumenCocosVersion.parse(version)));
        const parent = is2d ? '/Root/Canvas' : '/Root';
        const modelRoot = req.importedSkinnedHierarchy && skinnedContext ? document.addChildFromTemplate(parent, skinnedContext.templatePath, 'Model') : null;
        if (modelRoot && skinnedContext) sources.push({ path: skinnedContext.templatePath, sha256: createHash('sha256').update(readFileSync(skinnedContext.templatePath)).digest('hex') });
        let targetPath: string;
        if (modelRoot) targetPath = type === 'cc.SkinnedMeshRenderer' ? modelRoot + '/Triangle' : modelRoot;
        else if (type === 'cc.Canvas') targetPath = parent;
        else if (container) targetPath = document.addChildFromSpec(parent, { name: 'Target', components: ['cc.UITransform'] });
        else targetPath = document.addChildFromTemplate(parent,
            source(`default_prefab/${is2d && !uiModel ? 'ui/' + (ui ?? 'Sprite') : '3d/Cube'}.prefab`), 'Target');
        if (uiModel) {
            const lightPath = document.addChildFromTemplate('/Root', source('default_prefab/light/Directional Light.prefab'), 'Main Light');
            const light = document.entries[document.findComponentIndex(document.findNodeIndex(lightPath), 'cc.DirectionalLight')];
            if (!light) throw new Error('component_presentation_light_missing');
            // SDK的Light.visibility序列化为_visibility；默认灯光排除UI_2D，桥接模型须显式加入该层。
            light._visibility = 33554432;
            document.attachBuiltinComponent(targetPath, 'cc.UITransform');
            document.setNodeProperty(targetPath, { layer: 33554432, scale: { x: 160, y: 160, z: 160 }, euler: { x: 15, y: 30, z: 0 } });
            document.setComponentProperty(targetPath, 'cc.UITransform', { width: 240, height: 240 });
        }
        for (const dependency of row.dependencyPlan.attachOrder) {
            const node = document.findNodeIndex(targetPath);
            if (!document.entries.some(entry => entry.__type__ === dependency &&
                (entry.node as { __id__?: unknown } | undefined)?.__id__ === node)) document.attachBuiltinComponent(targetPath, dependency);
        }
        document.findComponentIndex(document.findNodeIndex(targetPath), type);
        if (modelRoot) {
            document.setComponentProperty(modelRoot, 'cc.SkeletalAnimation', { playOnLoad: true, useBakedAnimation: false });
            if (type === 'cc.SkinnedMeshBatchRenderer') {
                const sourceRenderer = document.entries[document.findComponentIndex(document.findNodeIndex(modelRoot + '/Triangle'), 'cc.SkinnedMeshRenderer')];
                if (!sourceRenderer) throw new Error('component_presentation_skinned_source_missing');
                sourceRenderer._enabled = false;
            }
        }
        if (postProcessContext && req.highQualityRenderPipeline) {
            document.setComponentProperty(targetPath, 'cc.PostProcess', { global: true });
            const cameras = document.entries.filter(entry => entry.__type__ === 'cc.Camera');
            if (cameras.length !== 1 || !cameras[0]) throw new Error('component_presentation_post_camera_missing');
            // 同版SDK公开usePostProcess getter的序列化槽，默认false不会执行后处理passes。
            cameras[0]._usePostProcess = true;
        }
        if (type === 'cc.Sprite' || type === 'cc.Sorting2D') {
            const backdrop = type === 'cc.Sorting2D'
                ? document.addChildFromTemplate(parent, source('default_prefab/ui/Sprite.prefab'), 'SortingBackdrop') : null;
            for (const path of backdrop ? [targetPath, backdrop] : [targetPath]) {
                document.setComponentProperty(path, 'cc.Sprite', { sizeMode: 0,
                    color: path === backdrop ? { r: 255, g: 75, b: 85, a: 255 } : { r: 30, g: 130, b: 255, a: 255 } });
                document.setComponentProperty(path, 'cc.UITransform', { width: 240, height: 240 });
                if (type === 'cc.Sorting2D') {
                    if (path === backdrop) document.attachBuiltinComponent(path, type);
                    // 后创建的红色对照仍在order=1蓝色目标之下，才能验证真实排序而非仅看见单个Sprite。
                    document.setComponentProperty(path, type, { sortingLayer: 0, sortingOrder: path === backdrop ? 0 : 1 });
                }
            }
        }
        if (container || ['cc.Layout', 'cc.Widget', 'cc.Mask', 'cc.Canvas'].includes(type)) {
            document.addChildFromTemplate(targetPath, source('default_prefab/ui/Label.prefab'), 'VisibleLabel');
        }
        if (ui === 'Label' && !container) {
            document.setComponentProperty(targetPath, 'cc.UITransform', { width: 480, height: 96 });
            document.setComponentProperty(targetPath, 'cc.Label', { string: 'Task 5.1 - ' + type,
                useSystemFont: true, fontFamily: 'Arial', fontSize: 32, lineHeight: 40,
                color: { r: 255, g: 255, b: 255, a: 255 } });
        }
        ComponentSceneIntegrity.assert(document);
        return { status: 'authored-presentation-native-pending' as const, componentType: type, document, targetPath,
            sources, reasons: physics ? ['presentation-real-physics-behavior-required'] : ['presentation-real-render-required'],
            nativePassed: false as const, rendered: false as const };
    }
}
