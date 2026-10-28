import { Node, director, EffectAsset, Color, Vec3, MeshRenderer, PhysicsSystem, RigidBody, ERigidBodyType,
    Collider, BoxCollider, SphereCollider, Constraint, HingeConstraint, PointToPointConstraint,
    ConfigurableConstraint, ConstantForce, CharacterController, BoxCharacterController, CapsuleCharacterController } from 'cc';
import type { Task51BatchCase } from '../../component-batch-physics-catalog';
import { Task51BatchVisual } from './Task51BatchVisual';

/**
 * @description 共用真实Bullet世界的16项物理行为，不写被测物体的逐帧模拟位置。
 */
export class Task51BulletBatchCase implements Task51BatchCase {
    /**
     * @description 3.8.7未公开导出EConstraintMode枚举；SDK physics-enum.ts中LOCKED固定值为2，仍通过公开属性设置。
     */
    private static readonly lockedConstraintMode = 2;
    /**
     * @description 本用例私有运行节点。
     */
    private readonly owned = new Node('BatchPrivatePhysics');
    /**
     * @description 本用例真实网格材质装配器。
     */
    private readonly visual: Task51BatchVisual;
    /**
     * @description 真实运动节点。
     */
    private motion!: Node;
    /**
     * @description 真实运动刚体。
     */
    private body: RigidBody | null = null;
    /**
     * @description 实际参与画面的运动渲染器。
     */
    private renderer!: MeshRenderer;
    /**
     * @description 被测碰撞体或控制器的实际地面。
     */
    private floor: Collider | null = null;
    /**
     * @description 地面实际渲染器。
     */
    private floorRenderer: MeshRenderer | null = null;
    /**
     * @description 实际约束锚点刚体。
     */
    private anchor: RigidBody | null = null;
    /**
     * @description 实际物理接触和控制器碰撞事件计数。
     */
    private hits = 0;
    /**
     * @description 当前真实刺激。
     */
    private phase = 'baseline';
    /**
     * @description 初始化独立用例，明确所有实际依赖。
     * @param type 固定被测组件。
     * @param target 冻结场景中的实际被测节点。
     * @param effect 已加载真实着色器。
     */
    public constructor(private readonly type: string, private readonly target: Node, effect: EffectAsset) {
        if (!PhysicsSystem.PHYSICS_BULLET) throw new Error('batch_bullet_required');
        const system = PhysicsSystem.instance; system.enable = true; system.autoSimulation = false;
        system.gravity = new Vec3(0, -10, 0); system.fixedTimeStep = 1 / 60; system.maxSubSteps = 1; system.allowSleep = false;
        director.getScene()!.addChild(this.owned); this.visual = new Task51BatchVisual(effect);
        try {
            if (type.endsWith('CharacterController')) this.prepareController();
            else if (type.endsWith('Collider')) this.prepareCollider();
            else this.prepareBody();
        } catch (error) { this.owned.destroy(); this.visual.dispose(); throw error; }
    }
    /**
     * @description 创建真实运动刚体，所有平移都由后续求解器执行。
     * @param node 实际运动节点。
     * @returns 实际刚体。
     */
    private dynamic(node: Node): RigidBody {
        const body = node.getComponent(RigidBody) ?? node.addComponent(RigidBody); body.enabled = true;
        body.type = ERigidBodyType.DYNAMIC; body.mass = 1; body.allowSleep = false;
        body.linearDamping = 0; body.angularDamping = 0; body.angularFactor = new Vec3(0, 0, 0);
        const sphere = node.getComponent(SphereCollider) ?? node.addComponent(SphereCollider); sphere.radius = 0.75;
        this.renderer = this.visual.ball(node); return body;
    }
    /**
     * @description 准备被测静态碰撞形状与独立下落球体。
     */
    private prepareCollider(): void {
        this.floor = this.target.getComponent(Collider)!; this.floor.enabled = false;
        const floorBody = this.target.getComponent(RigidBody)!; floorBody.enabled = true; floorBody.type = ERigidBodyType.STATIC;
        this.floorRenderer = this.visual.mesh(this.target, this.visual.shape(this.floor), new Color(60, 150, 70));
        this.motion = new Node('ActualFallingBody'); this.motion.setPosition(0, 3, 0); this.owned.addChild(this.motion);
        this.body = this.dynamic(this.motion);
        this.motion.getComponent(SphereCollider)!.on('onCollisionEnter', event => { if (event.otherCollider === this.floor) this.hits++; });
    }
    /**
     * @description 准备实际重力、恒力或约束用例。
     */
    private prepareBody(): void {
        this.motion = this.target; this.body = this.dynamic(this.target);
        const constraint = this.target.getComponent(Constraint);
        if (!constraint) { const force = this.target.getComponent(ConstantForce); if (force) { force.enabled = false; force.force = new Vec3(4, 0, 0); } return; }
        constraint.enabled = true; constraint.enabled = false;
        const anchor = new Node('ActualConstraintAnchor'); anchor.setPosition(0, 3, 0); this.owned.addChild(anchor);
        this.anchor = anchor.addComponent(RigidBody); this.anchor.type = ERigidBodyType.STATIC;
        anchor.addComponent(BoxCollider).size = new Vec3(0.1, 0.1, 0.1);
        constraint.connectedBody = this.anchor; constraint.enableCollision = false;
        if (constraint instanceof PointToPointConstraint || constraint instanceof HingeConstraint) {
            constraint.pivotA = new Vec3(0, 2, 0); constraint.pivotB = new Vec3(0, 0, 0);
        }
        if (constraint instanceof HingeConstraint) constraint.axis = new Vec3(0, 0, 1);
        if (constraint instanceof ConfigurableConstraint) {
            constraint.autoPivotB = false; constraint.pivotA = new Vec3(0, 2, 0); constraint.pivotB = new Vec3(0, 0, 0);
            const limits = constraint.linearLimitSettings; limits.xMotion = limits.yMotion = limits.zMotion = Task51BulletBatchCase.lockedConstraintMode;
            const angles = constraint.angularLimitSettings; angles.twistMotion = angles.swingMotion1 = angles.swingMotion2 = Task51BulletBatchCase.lockedConstraintMode;
        }
    }
    /**
     * @description 准备真实控制器和可切换碰撞地面，依赖不切换为PhysX。
     */
    private prepareController(): void {
        this.motion = this.target; const controller = this.target.getComponent(CharacterController)!; controller.enabled = true;
        if (controller instanceof BoxCharacterController) { controller.halfHeight = 0.75; controller.halfSideExtent = 0.6; controller.halfForwardExtent = 0.6; }
        if (controller instanceof CapsuleCharacterController) { controller.radius = 0.6; controller.height = 1.5; }
        controller.stepOffset = 0; controller.minMoveDistance = 0;
        if (!(controller instanceof BoxCharacterController) && !(controller instanceof CapsuleCharacterController)) throw new Error('batch_controller_type_invalid');
        this.renderer = this.visual.controller(controller);
        const ground = new Node('ActualControllerFloor'); ground.setPosition(0, -1, 0); this.owned.addChild(ground);
        const rigid = ground.addComponent(RigidBody); rigid.type = ERigidBodyType.STATIC;
        this.floor = ground.addComponent(BoxCollider); this.floor.enabled = false;
        this.floorRenderer = this.visual.mesh(ground, this.visual.shape(this.floor), new Color(60, 150, 70));
        controller.on('onControllerColliderHit', event => { if (event.collider === this.floor) this.hits++; });
    }
    /**
     * @description 在求解前同步初始变换，再执行公开组件刺激；避免延迟清除变换标志。
     * @param phase 基线或效果。
     */
    public reset(phase: string): void {
        this.phase = phase; this.hits = 0;
        const component = this.target.getComponent(this.type)!; component.enabled = false;
        if (this.floor) this.floor.enabled = false;
        if (this.body) {
            const y = this.type.endsWith('Constraint') ? 1 : this.type === 'cc.ConstantForce' ? 0 : 3;
            this.motion.setWorldPosition(new Vec3(0, y, 0)); this.body.clearState(); this.body.clearForces();
            this.body.setLinearVelocity(new Vec3(0, 0, 0)); this.body.setAngularVelocity(new Vec3(0, 0, 0));
            this.body.useGravity = this.type === 'cc.ConstantForce' ? false : this.type === 'cc.RigidBody' ? phase === 'effect' : true;
            this.body.wakeUp();
        } else this.target.getComponent(CharacterController)!.centerWorldPosition = new Vec3(0, 3, 0);
        PhysicsSystem.instance.syncSceneToPhysics(); PhysicsSystem.instance.resetAccumulator();
        component.enabled = this.type === 'cc.RigidBody' || this.type.endsWith('CharacterController') || phase === 'effect';
        if (this.floor) this.floor.enabled = phase === 'effect';
        if (this.floorRenderer) this.floorRenderer.enabled = phase === 'effect';
        PhysicsSystem.instance.syncSceneToPhysics();
    }
    /**
     * @description 每次实际引擎更新执行一个真实Bullet步进及事件分发。
     */
    public step(): void {
        if (!this.body) this.target.getComponent(CharacterController)!.move(new Vec3(0, -0.15, 0));
        const system = PhysicsSystem.instance; system.autoSimulation = true;
        try { system.postUpdate(system.fixedTimeStep); } finally { system.autoSimulation = false; }
    }
    /**
     * @description 只读取实际物理对象、渲染依赖和事件结果。
     * @returns 实际状态。
     */
    public state(): Record<string, unknown> {
        const velocity = new Vec3(); if (this.body) this.body.getLinearVelocity(velocity);
        const controller = this.target.getComponent(CharacterController); const position = this.motion.worldPosition;
        return { backend: 'bullet', backendBound: PhysicsSystem.PHYSICS_BULLET, targetBound: !!this.target.getComponent(this.type),
            targetNode: this.target.name, targetEnabled: this.target.getComponent(this.type)!.enabled,
            visualBound: !!this.renderer.mesh?.renderingSubMeshes.length && this.renderer.enabled && this.renderer.node.activeInHierarchy,
            bodyBound: controller ? Number.isFinite(controller.centerWorldPosition.y) : !!this.body?.body?.impl,
            materialBound: !!this.renderer.getRenderMaterial(0)?.passes.length,
            x: position.x, y: position.y, vx: controller ? controller.velocity.x : velocity.x, vy: controller ? controller.velocity.y : velocity.y,
            contacts: this.hits, floorEnabled: this.floor?.enabled ?? false, grounded: controller ? controller.isGrounded : false,
            connectedBodyBound: this.type.endsWith('Constraint') ? this.target.getComponent(Constraint)!.connectedBody === this.anchor : true,
            gravity: this.body?.useGravity ?? false, phase: this.phase };
    }
    /**
     * @description 所属节点先停用后释放本用例私有节点和GPU资源。
     */
    public dispose(): void {
        this.owned.destroy(); this.visual.dispose();
    }
}
