import type { IComponentNativeDeclaration } from './component-native-source-reader.mts';

/**
 * @description 从实际原生类型归属生成配方与场景共同使用的装配要求。
 */
export class ComponentAssemblyRequirements {
    /**
     * @description 保留原生拥有的层次和后端前置条件，不用空组件代替。
     * @param componentType 策展组件名。
     * @param declaration 同版本原生声明。
     * @returns 实际装配要求与待确认后端。
     */
    public static create(componentType: string, declaration: IComponentNativeDeclaration | undefined) {
        const bases = declaration?.baseTypes ?? [];
        const physical3D = bases.some((base) => ['cc.Collider', 'cc.Constraint', 'cc.CharacterController', 'cc.RigidBody'].includes(base))
            || componentType === 'cc.RigidBody' || componentType === 'cc.ConstantForce';
        const physical2D = bases.some((base) => ['cc.Collider2D', 'cc.Joint2D', 'cc.RigidBody2D'].includes(base))
            || componentType === 'cc.RigidBody2D';
        const character = componentType.includes('CharacterController');
        const importedOwner = componentType.startsWith('cc.Tiled') && componentType !== 'cc.TiledMap';
        const skinnedModel = ['cc.SkeletalAnimation', 'cc.SkinnedMeshRenderer', 'cc.SkinnedMeshBatchRenderer'].includes(componentType);
        const postProcess = bases.includes('cc.PostProcessSetting') || componentType === 'cc.PostProcess';
        return {
            referenceNodesAndComponents: '从值配方的实际路径和类型创建；先完成它们各自的 requireComponent 闭包',
            ...(componentType === 'cc.Sorting' ? { modelRendererCarrier: {
                componentType: 'cc.MeshRenderer', requiredBase: 'cc.ModelRenderer',
                sources: declaration?.sources ?? [], rule: 'Sorting.__preload必须取得真实ModelRenderer；使用实际MeshRenderer并在矩阵写入前绑定已加载Mesh',
            } } : {}),
            uiScene: declaration?.requiredComponents.includes('cc.UITransform') ?? false,
            physicsBackend: character ? 'physx' : physical3D ? 'bullet' : physical2D ? 'box2d' : null,
            physicsBackendMustBeConfirmedFromActiveCreator: physical3D || physical2D || character,
            sourceOwnedTiledComponent: importedOwner,
            sourceOwnedTiledRule: importedOwner ? '先导入真实 TMX 并初始化 TiledMap；只能选择已初始化且类型匹配的原生子组件，禁止手动添加空占位' : null,
            importedSkinnedHierarchy: skinnedModel,
            skinnedHierarchyRule: skinnedModel ? '实例化相同 glTF 输入产生的原生层次，绑定同源 mesh/skeleton/animation 子资源及真实关节节点' : null,
            highQualityRenderPipeline: postProcess,
            renderPipelineMustBeConfirmedFromActiveCreator: postProcess,
            eventController: componentType === 'cc.Button' ? { nodePath: '/Root/Controller', componentType: 'cc.Animation', handler: 'play' } : null,
        };
    }
}
