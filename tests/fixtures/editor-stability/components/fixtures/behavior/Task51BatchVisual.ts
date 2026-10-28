import { Node, Mesh, MeshRenderer, Material, EffectAsset, Color, utils, primitives, Collider,
    BoxCollider, CapsuleCollider, ConeCollider, CylinderCollider, MeshCollider, PlaneCollider, SimplexCollider,
    SphereCollider, BoxCharacterController, CapsuleCharacterController, Vec3 } from 'cc';

/**
 * @description 统一显式材质和实际碰撞形状装配；没有依赖时拒绝创建。
 */
export class Task51BatchVisual {
    /**
     * @description 本实例创建并负责释放的材质。
     */
    private readonly materials: Material[] = [];
    /**
     * @description 本实例创建并负责释放的网格。
     */
    private readonly meshes: Mesh[] = [];
    /**
     * @description 序列化节点上的渲染器在释放资源前先解除引用，避免下次激活引用已销毁资源。
     */
    private readonly renderers = new Set<MeshRenderer>();
    /**
     * @description 显式引用实际着色器，避免名称查找缺失。
     * @param effect 场景已加载的真实EffectAsset。
     */
    public constructor(private readonly effect: EffectAsset) {}
    /**
     * @description 给实际运动节点绑定可见网格。
     * @param node 实际物理节点。
     * @param mesh 实际生成网格。
     * @param color 固定刺激颜色。
     * @returns 实际渲染组件。
     */
    public mesh(node: Node, mesh: Mesh, color: Color): MeshRenderer {
        this.meshes.push(mesh); const material = new Material(); material.initialize({ effectAsset: this.effect, defines: { USE_TEXTURE: false } });
        if (!material.passes.length) throw new Error('batch_unlit_pass_missing');
        material.setProperty('mainColor', color); this.materials.push(material);
        const renderer = node.getComponent(MeshRenderer) ?? node.addComponent(MeshRenderer);
        renderer.mesh = mesh; renderer.setMaterial(material, 0); renderer.enabled = true; this.renderers.add(renderer); return renderer;
    }
    /**
     * @description 给运动体显示明确的真实几何。
     * @param node 实际运动节点。
     * @returns 实际渲染组件。
     */
    public ball(node: Node): MeshRenderer {
        return this.mesh(node, utils.createMesh(primitives.sphere(0.75, { segments: 24 })), new Color(25, 175, 250));
    }
    /**
     * @description 控制器可见几何从实际公开尺寸生成，不用普通球体冒充控制器形状。
     * @param controller 实际控制器。
     * @returns 实际渲染组件。
     */
    public controller(controller: BoxCharacterController | CapsuleCharacterController): MeshRenderer {
        const shape = controller instanceof BoxCharacterController
            ? primitives.box({ width: controller.halfSideExtent * 2, height: controller.halfHeight * 2, length: controller.halfForwardExtent * 2 })
            : primitives.capsule(controller.radius, controller.radius, controller.height + controller.radius * 2);
        return this.mesh(controller.node, utils.createMesh(shape), new Color(25, 175, 250));
    }
    /**
     * @description 从实际被测碰撞体构造明确形状，不用空占位引用。
     * @param collider 实际被测实例。
     * @returns 与形状对应的可见网格。
     */
    public shape(collider: Collider): Mesh {
        if (collider instanceof BoxCollider) { collider.size = new Vec3(6, 0.5, 6); return utils.createMesh(primitives.box({ width: 6, height: 0.5, length: 6 })); }
        if (collider instanceof SphereCollider) { collider.radius = 1.5; return utils.createMesh(primitives.sphere(1.5, { segments: 24 })); }
        if (collider instanceof CapsuleCollider) { collider.radius = 1; collider.height = 2; return utils.createMesh(primitives.capsule(1, 1, 4)); }
        if (collider instanceof ConeCollider) { collider.radius = 3; collider.height = 1; return utils.createMesh(primitives.cylinder(0, 3, 1)); }
        if (collider instanceof CylinderCollider) { collider.radius = 3; collider.height = 0.5; return utils.createMesh(primitives.cylinder(3, 3, 0.5)); }
        if (collider instanceof MeshCollider) {
            const mesh = utils.createMesh(primitives.box({ width: 6, height: 0.5, length: 6 })); collider.mesh = mesh; collider.convex = true; return mesh;
        }
        if (collider instanceof PlaneCollider) { collider.normal = new Vec3(0, 1, 0); collider.constant = 0; return utils.createMesh(primitives.box({ width: 6, height: 0.05, length: 6 })); }
        if (collider instanceof SimplexCollider) {
            collider.shapeType = SimplexCollider.ESimplexType.TRIANGLE; collider.vertex0 = new Vec3(-3, 0, -3);
            collider.vertex1 = new Vec3(0, 0, 3); collider.vertex2 = new Vec3(3, 0, -3);
            return utils.createMesh({ positions: [-3, 0, -3, 0, 0, 3, 3, 0, -3], normals: [0, 1, 0, 0, 1, 0, 0, 1, 0], indices: [0, 1, 2] });
        }
        throw new Error('batch_shape_not_registered');
    }
    /**
     * @description 在所属场景节点停用后释放私有GPU资源。
     */
    public dispose(): void {
        for (const renderer of this.renderers) { renderer.enabled = false; renderer.mesh = null; renderer.setMaterial(null, 0); }
        for (const material of this.materials) material.destroy(); for (const mesh of this.meshes) mesh.destroy();
    }
}
