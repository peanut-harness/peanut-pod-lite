import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';
import { LumenComponentPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/component-property.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { ComponentSceneIntegrity } from './component-scene-integrity.mts';
import type { ComponentFieldFixtures } from './component-field-fixtures.mts';

/**
 * @description 已冻结的单组件字段与依赖配方。
 */
type ComponentRow = ReturnType<typeof ComponentFieldFixtures.create>['components'][number];

/**
 * @description 展示场景使用同版本SDK完整预设；不把字段测试值和移除后的空节点当作展示内容。
 */
export class ComponentPresentationFixture {
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
     * @returns 完整场景和来源，或明确待补条件；始终没有原生呈现通过状态。
     */
    public static create(engine: string, version: '3.8.3' | '3.8.7', row: ComponentRow) {
        const type = row.componentType; const req = row.assemblyRequirements;
        const container = type === 'cc.UIStaticBatch';
        const ui = this._ui[type] ?? (type === 'cc.Sorting2D' ? 'Sprite' : this._uiCarriers.has(type) ? 'Label' : null);
        const physics = req.physicsBackend != null;
        const cube = ['cc.MeshRenderer', 'cc.Sorting', 'cc.LODGroup'].includes(type) || physics;
        const reasons = [...row.dependencyPlan.blockers];
        if (!row.dependencyPlan.attachOrder.includes(type)) reasons.push('presentation-native-component-unavailable');
        if (req.highQualityRenderPipeline) reasons.push('presentation-active-pipeline-and-effect-context-required');
        if (req.sourceOwnedTiledComponent) reasons.push('presentation-native-tiled-hierarchy-required');
        if (req.importedSkinnedHierarchy) reasons.push('presentation-same-source-skinned-animation-required');
        if (!ui && !cube && type !== 'cc.Canvas') reasons.push('presentation-component-specific-content-required');
        if (reasons.length) return { status: 'presentation-context-pending' as const, componentType: type,
            reasons, nativePassed: false as const, rendered: false as const };
        const sources: { path: string; sha256: string }[] = [];
        const source = (relative: string): string => {
            const path = join(realpathSync(engine), 'editor/assets', relative);
            if (!realpathSync(path).startsWith(realpathSync(engine) + sep)) throw new Error('component_presentation_sdk_escape');
            sources.push({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
            return path;
        };
        const is2d = !!ui || req.physicsBackend === 'box2d' || type === 'cc.Canvas';
        const document = LumenPrefabDocument.cloneFromTemplate(`assets/components/${type}.scene`,
            source(`default_file_content/scene/${is2d ? 'scene-2d' : 'default'}.scene`), 'Root');
        document.setPropertySchema(new LumenComponentPropertySchema(LumenCocosVersion.parse(version)));
        const parent = is2d ? '/Root/Canvas' : '/Root';
        const targetPath = type === 'cc.Canvas' ? parent : container ? document.addChildFromSpec(parent, { name: 'Target', components: ['cc.UITransform'] }) : document.addChildFromTemplate(parent,
            source(`default_prefab/${is2d ? 'ui/' + (ui ?? 'Sprite') : '3d/Cube'}.prefab`), 'Target');
        for (const dependency of row.dependencyPlan.attachOrder) {
            const node = document.findNodeIndex(targetPath);
            if (!document.entries.some(entry => entry.__type__ === dependency &&
                (entry.node as { __id__?: unknown } | undefined)?.__id__ === node)) document.attachBuiltinComponent(targetPath, dependency);
        }
        document.findComponentIndex(document.findNodeIndex(targetPath), type);
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
