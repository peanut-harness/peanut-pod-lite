import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { LumenComponentPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/component-property.ts';
import type { ComponentFieldFixtures } from './component-field-fixtures.mts';
import type { IComponentNativeDeclaration } from './component-native-source-reader.mts';
import type { IComponentValueRecipe } from './component-value-recipe.mts';
import { ComponentDependencyPlanner } from './component-dependency-plan.mts';
import { ComponentSceneIntegrity } from './component-scene-integrity.mts';
import { ComponentAssemblyRequirements } from './component-assembly-requirements.mts';

/**
 * @description 与已生成字段矩阵相同的单组件输入。
 */
type ComponentFixtureRow = ReturnType<typeof ComponentFieldFixtures.create>['components'][number];

/**
 * @description 用同版本官方场景模板实际装配依赖、UI 层次和引用节点；不伪造资产导入身份。
 */
export class ComponentSceneFixture {
    /**
     * @description 对可离线装配的条目创建可保存场景，原生拥有的层次和后端缺证时明确阻止装配。
     * @param root 本工作树。
     * @param version 精确 Creator 版本。
     * @param row 当前组件字段配方。
     * @param declarations 同版本声明和 requireComponent 证明。
     * @param stageBackendCandidates 仅暂存后端待验候选；不解除原生验收要求。
     * @returns 实际场景或完整阻塞原因；没有原生通过状态。
     */
    public static create(root: string, version: '3.8.3' | '3.8.7', row: ComponentFixtureRow,
        declarations: readonly IComponentNativeDeclaration[], stageBackendCandidates = false) {
        const plan = ComponentDependencyPlanner.create(row.componentType, declarations, row.dependencyProviders);
        if (JSON.stringify(plan) !== JSON.stringify(row.dependencyPlan)) throw new Error('component_scene_dependency_plan_stale');
        const requirements = ComponentAssemblyRequirements.create(row.componentType, declarations.find((item) => item.type === row.componentType));
        if (JSON.stringify(requirements) !== JSON.stringify(row.assemblyRequirements)) throw new Error('component_scene_requirements_stale');
        const blockers = [...plan.blockers];
        if (requirements.sourceOwnedTiledComponent) blockers.push('source-owned-tiled-not-initialized');
        if (requirements.importedSkinnedHierarchy) blockers.push('same-source-skinned-hierarchy-not-imported');
        const pendingRequirements: string[] = [];
        if (requirements.physicsBackend) pendingRequirements.push(`active-physics-backend-unverified:${requirements.physicsBackend}`);
        if (requirements.highQualityRenderPipeline) pendingRequirements.push('active-high-quality-render-pipeline-unverified');
        if (!stageBackendCandidates) blockers.push(...pendingRequirements);
        if (blockers.length) return { status: 'blocked' as const, componentType: row.componentType, blockers, nativePassed: false as const };
        const template = this.template(root, version);
        if (!/^[a-zA-Z0-9_.]+$/u.test(row.componentType)) throw new Error('component_scene_type_invalid');
        const document = LumenPrefabDocument.cloneFromTemplate(`assets/components/${row.componentType}.scene`, template.path, 'Root');
        document.setPropertySchema(new LumenComponentPropertySchema(LumenCocosVersion.parse(version)));
        const paths = new Map<string, string>();
        const ensure = (path: string): void => {
            if (!/^\/Root(?:\/[a-zA-Z0-9_]+)*$/u.test(path)) throw new Error('component_scene_node_path_invalid');
            let parent = '/Root';
            for (const part of path.split('/').filter(Boolean).slice(1)) {
                const next = `${parent}/${part}`;
                try { document.findNodeIndex(next); }
                catch { document.addChildFromSpec(parent, { name: part }); }
                parent = next;
            }
        };
        const attach = (logicalPath: string, type: string): string => {
            const dependency = ComponentDependencyPlanner.create(type, declarations, row.dependencyProviders);
            if (dependency.blockers.length) throw new Error(`component_scene_reference_dependency_blocked:${type}`);
            const ui = dependency.attachOrder.includes('cc.UITransform') || (logicalPath === row.nodePath && requirements.uiScene);
            const actualPath = ui ? logicalPath.replace('/Root/', '/Root/Canvas/') : logicalPath;
            const prior = paths.get(logicalPath);
            if (prior && prior !== actualPath) throw new Error('component_scene_reference_path_conflict');
            paths.set(logicalPath, actualPath); ensure(actualPath);
            if (ui) document.attachBuiltinComponent(actualPath, 'cc.UITransform');
            for (const item of dependency.attachOrder) document.attachBuiltinComponent(actualPath, item);
            return actualPath;
        };
        if (requirements.modelRendererCarrier) {
            const carrier = requirements.modelRendererCarrier;
            const provider = declarations.find(item => item.type === carrier.componentType);
            const reference = row.componentType === 'cc.Sorting' ? 'sorting/sorting.ts' : '2d/components/ui-mesh-renderer.ts';
            if (carrier.sources.length !== 1 || carrier.sources[0]?.reference !== reference
                || !provider?.baseTypes.includes(carrier.requiredBase)) throw new Error('component_model_renderer_source_missing');
            attach(row.nodePath, carrier.componentType);
        }
        const targetPath = attach(row.nodePath, row.componentType);
        if (row.componentType === 'cc.UIMeshRenderer') document.setNodeProperty(targetPath, { layer: 33554432 });
        const visit = (recipe: IComponentValueRecipe): void => {
            if (recipe.form === 'component-reference') {
                if (typeof recipe.value !== 'string' || !recipe.componentType) throw new Error('component_scene_reference_invalid');
                attach(recipe.value, recipe.componentType);
            } else if (recipe.form === 'node-reference') {
                if (typeof recipe.value !== 'string') throw new Error('component_scene_reference_invalid');
                ensure(recipe.value); paths.set(recipe.value, recipe.value);
            }
            if (recipe.form === 'literal' && Array.isArray(recipe.value)) {
                for (const item of recipe.value) {
                    if (item && typeof item === 'object' && typeof item.target === 'string'
                        && typeof item.component === 'string' && typeof item.handler === 'string') attach(item.target, item.component);
                }
            }
            recipe.items?.forEach(visit); Object.values(recipe.properties ?? {}).forEach(visit);
        };
        row.cases.filter((field) => field.expectedWrite === 'set-and-readback').forEach((field) => visit(field.rootValue));
        if (requirements.eventController) {
            const event = requirements.eventController;
            const controller = attach(event.nodePath, event.componentType);
            document.setComponentProperty(targetPath, row.componentType, { clickEvents: [{
                target: controller, component: event.componentType, handler: event.handler, customEventData: 'Task51',
            }] });
        }
        const requiresNativeInput = (recipe: IComponentValueRecipe): boolean => recipe.form === 'resource'
            || recipe.form === 'project-file-url' || (recipe.items ?? []).some(requiresNativeInput)
            || Object.values(recipe.properties ?? {}).some(requiresNativeInput);
        const resolveValue = (recipe: IComponentValueRecipe): unknown => {
            if (recipe.form === 'literal') {
                const value = structuredClone(recipe.value);
                if (Array.isArray(value)) for (const item of value) {
                    if (item && typeof item === 'object' && typeof item.target === 'string') item.target = paths.get(item.target) ?? item.target;
                }
                return value;
            }
            if (recipe.form === 'node-reference' || recipe.form === 'component-reference') {
                if (typeof recipe.value !== 'string' || !paths.has(recipe.value)) throw new Error('component_scene_reference_unassembled');
                return paths.get(recipe.value);
            }
            if (recipe.form === 'list') return (recipe.items ?? []).map(resolveValue);
            if (recipe.form === 'object') return Object.fromEntries(Object.entries(recipe.properties ?? {}).map(([key, value]) => [key, resolveValue(value)]));
            throw new Error('component_scene_native_input_required');
        };
        const fieldStates = row.cases.map((field) => ({ id: field.id, status: field.expectedWrite !== 'set-and-readback'
            ? 'expected-public-refusal' : requiresNativeInput(field.rootValue) ? 'native-input-pending' : 'authored-runtime-unverified' }));
        const written = new Set<string>();
        for (const field of row.cases) {
            const rootField = field.selector[0];
            if (!rootField) throw new Error('component_scene_field_selector_missing');
            if (field.expectedWrite !== 'set-and-readback' || requiresNativeInput(field.rootValue) || written.has(rootField)) continue;
            document.setComponentProperty(targetPath, row.componentType, { [rootField]: resolveValue(field.rootValue) });
            written.add(rootField);
        }
        ComponentSceneIntegrity.assert(document);
        return { status: pendingRequirements.length ? 'staged-backend-pending' as const : 'assembled' as const,
            componentType: row.componentType, document, targetPath, pendingRequirements,
            nodePaths: Object.fromEntries(paths), template, blockers: [], fieldStates,
            resourceFieldsBound: false as const, nativePassed: false as const };
    }

    /**
     * @description 重算真实模板来源摘要并拒绝越界或链接替换。
     */
    private static template(root: string, version: string): { path: string; sha256: string } {
        const repository = realpathSync(root);
        const catalog = JSON.parse(readFileSync(join(repository, 'tests/fixtures/editor-stability/serialized/resource-fixtures.json'), 'utf8')) as {
            fixtures: { creatorVersion: string; assetKind: string; files: { source: { path: string; sha256: string } } }[];
        };
        const source = catalog.fixtures.find((fixture) => fixture.creatorVersion === version && fixture.assetKind === 'scene')?.files.source;
        if (!source || !source.path.startsWith(`tests/fixtures/editor-stability/serialized/${version}/`)
            || source.path.split('/').some((part) => ['', '.', '..'].includes(part)))
            throw new Error('component_scene_template_missing');
        const path = resolve(repository, source.path);
        if (!path.startsWith(`${repository}${sep}`) || realpathSync(path) !== path) throw new Error('component_scene_template_escape');
        const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
        if (sha256 !== source.sha256) throw new Error('component_scene_template_hash_mismatch');
        return { path, sha256 };
    }
}
