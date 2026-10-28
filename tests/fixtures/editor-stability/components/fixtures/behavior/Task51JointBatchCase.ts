import { Node, Vec2, Color, Graphics, UITransform, RigidBody2D, ERigidBody2DType, CircleCollider2D,
    PhysicsSystem2D, EPhysics2DDrawFlags, Joint2D, DistanceJoint2D, FixedJoint2D, HingeJoint2D,
    RelativeJoint2D, SliderJoint2D, SpringJoint2D, WheelJoint2D } from 'cc';
import type { Task51BatchCase } from '../../component-batch-physics-catalog';

/**
 * @description 七种真实Box2D关节共用同一锚点、动态体与求解器，不用图形位置模拟约束。
 */
export class Task51JointBatchCase implements Task51BatchCase {
    /**
     * @description 被测真实关节。
     */
    private readonly joint: Joint2D;
    /**
     * @description 实际动态刚体。
     */
    private readonly body: RigidBody2D;
    /**
     * @description 私有静态锚点。
     */
    private readonly anchor = new Node('ActualJointAnchor');
    /**
     * @description 实际静态连接刚体。
     */
    private readonly anchorBody: RigidBody2D;
    /**
     * @description 实际运动图形。
     */
    private readonly graphic: Graphics;
    /**
     * @description 当前真实刺激。
     */
    private phase = 'baseline';
    /**
     * @description 只装配本用例实际依赖，使用独立可写向量。
     * @param type 固定未通过组件。
     * @param target 冻结场景中的实际节点。
     */
    public constructor(private readonly type: string, private readonly target: Node) {
        if (!PhysicsSystem2D.PHYSICS_BOX2D && !PhysicsSystem2D.PHYSICS_BOX2D_WASM) throw new Error('batch_box2d_required');
        const system = PhysicsSystem2D.instance; system.enable = true; system.autoSimulation = false;
        system.gravity = new Vec2(0, -320); system.fixedTimeStep = 1 / 60; system.maxSubSteps = 1;
        system.allowSleep = false; system.debugDrawFlags = EPhysics2DDrawFlags.Joint;
        this.joint = target.getComponent(Joint2D)!; this.joint.enabled = false;
        this.body = target.getComponent(RigidBody2D)!; this.body.enabled = true; this.body.type = ERigidBody2DType.Dynamic;
        this.body.fixedRotation = true; this.body.allowSleep = false; this.body.gravityScale = 1;
        this.body.linearDamping = 0; this.body.angularDamping = 0;
        const shape = target.getComponent(CircleCollider2D) ?? target.addComponent(CircleCollider2D);
        shape.radius = 30; shape.density = 1; shape.apply();
        this.graphic = target.getComponent(Graphics) ?? target.addComponent(Graphics); this.graphic.clear();
        this.graphic.fillColor = new Color(25, 175, 250); this.graphic.circle(0, 0, 30); this.graphic.fill();
        this.anchor.layer = target.layer; this.anchor.setPosition(0, 240, 0); target.parent!.addChild(this.anchor);
        this.anchor.addComponent(UITransform).setContentSize(20, 20); this.anchorBody = this.anchor.addComponent(RigidBody2D);
        this.anchorBody.type = ERigidBody2DType.Static;
        const anchorGraphic = this.anchor.addComponent(Graphics); anchorGraphic.fillColor = new Color(240, 120, 30);
        anchorGraphic.rect(-10, -10, 20, 20); anchorGraphic.fill();
        this.joint.connectedBody = this.anchorBody; this.joint.anchor = new Vec2(0, 100); this.joint.connectedAnchor = new Vec2(0, 0);
        try { this.configure(); } catch (error) { this.joint.enabled = false; this.anchor.destroy(); throw error; }
    }
    /**
     * @description 只配置关节种类之间真实存在的差异。
     */
    private configure(): void {
        const joint = this.joint;
        if (joint instanceof DistanceJoint2D) { joint.anchor = new Vec2(0, 0); joint.autoCalcDistance = false; joint.maxLength = 100; return; }
        if (joint instanceof SpringJoint2D) { joint.anchor = new Vec2(0, 0); joint.autoCalcDistance = false; joint.distance = 100; joint.frequency = 8; joint.dampingRatio = 1; return; }
        if (joint instanceof RelativeJoint2D) {
            joint.autoCalcOffset = false; joint.linearOffset = new Vec2(0, 100); joint.angularOffset = 0;
            joint.maxForce = 100000; joint.maxTorque = 100000; joint.correctionFactor = 0.8; return;
        }
        if (joint instanceof SliderJoint2D) {
            joint.autoCalcAngle = false; joint.angle = 0; joint.enableLimit = true;
            joint.lowerLimit = -40; joint.upperLimit = 40; joint.enableMotor = false; return;
        }
        if (joint instanceof WheelJoint2D) { joint.angle = 0; joint.frequency = 8; joint.dampingRatio = 1; joint.enableMotor = false; return; }
        if (joint instanceof HingeJoint2D) { joint.enableLimit = false; joint.enableMotor = false; return; }
        if (!(joint instanceof FixedJoint2D)) throw new Error('batch_joint_not_registered');
    }
    /**
     * @description 重置位置、同步真实世界后再创建约束，避免捕获旧位姿。
     * @param phase 基线或效果。
     */
    public reset(phase: string): void {
        this.phase = phase; this.joint.enabled = false;
        this.target.setPosition(0, 140, 0); this.target.setRotationFromEuler(0, 0, 0);
        this.body.linearVelocity = new Vec2(0, 0); this.body.angularVelocity = 0; this.body.wakeUp();
        const system = PhysicsSystem2D.instance; system.physicsWorld.syncSceneToPhysics(); system.resetAccumulator(system.fixedTimeStep / 2);
        this.joint.enabled = phase === 'effect'; if (this.joint.enabled) this.joint.apply();
    }
    /**
     * @description 每次实际引擎更新只执行一个真实求解步，包含场景同步和关节调试绘制。
     */
    public step(): void {
        const system = PhysicsSystem2D.instance; system.autoSimulation = true;
        try { system.postUpdate(system.fixedTimeStep); } finally { system.autoSimulation = false; }
    }
    /**
     * @description 读取真实底层关节、运动位姿和渲染器。
     * @returns 实际观测。
     */
    public state(): Record<string, unknown> {
        return { backend: 'box2d', backendBound: PhysicsSystem2D.PHYSICS_BOX2D || PhysicsSystem2D.PHYSICS_BOX2D_WASM,
            targetBound: this.target.getComponent(this.type) === this.joint, targetNode: this.target.name,
            targetEnabled: this.joint.enabled, bodyBound: !!this.body.impl?.impl,
            visualBound: this.graphic.enabled && this.graphic.node.activeInHierarchy, materialBound: !!this.graphic.getRenderMaterial(0)?.passes.length,
            nativeJointBound: !!this.joint.impl?.impl,
            connectedBodyBound: this.joint.connectedBody === this.anchorBody,
            x: this.target.position.x, y: this.target.position.y, vx: this.body.linearVelocity.x, vy: this.body.linearVelocity.y, phase: this.phase };
    }
    /**
     * @description 先停用关节，再销毁唯一私有锚点。
     */
    public dispose(): void {
        this.joint.enabled = false; this.anchor.destroy();
    }
}
