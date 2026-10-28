import { _decorator, Component, Node, director, Vec2, Size, Color, Graphics, UITransform,
    PhysicsSystem2D, RigidBody2D, ERigidBody2DType, Collider2D, BoxCollider2D, CircleCollider2D,
    PolygonCollider2D, Contact2DType, EPhysics2DDrawFlags } from 'cc';

/**
 * @description 固定90个真实Box2D步进及实际碰撞回调，不用位置赋值模拟重力或碰撞。
 */
@_decorator.ccclass('Task51Physics2DBehavior')
export class Task51Physics2DBehavior extends Component {
    /**
     * @description 冻结的未通过组件类型。
     */
    @_decorator.property
    public componentType = '';
    /**
     * @description 每阶段固定物理步数。
     */
    private static readonly stepsPerPhase = 90;
    /**
     * @description 实际引擎帧。
     */
    private frames = 0;
    /**
     * @description 申请观测的引擎帧。
     */
    private requestedFrame = 0;
    /**
     * @description 当前公开刺激阶段。
     */
    private phase = 'baseline';
    /**
     * @description 已完成的实际物理步数。
     */
    private steps = 0;
    /**
     * @description 旧物体延迟销毁后的准备帧。
     */
    private rebuildFrame = 0;
    /**
     * @description 被测的真实碰撞体。
     */
    private target: Collider2D | null = null;
    /**
     * @description 实际运动物体。
     */
    private ball: Node | null = null;
    /**
     * @description 实际运动刚体。
     */
    private body: RigidBody2D | null = null;
    /**
     * @description 仅统计实际命中被测碰撞体的回调。
     */
    private contacts = 0;
    /**
     * @description 唯一观测面板。
     */
    private panel: HTMLElement | null = null;
    /**
     * @description 可见实际观测。
     */
    private output: HTMLElement | null = null;
    /**
     * @description 页面离开释放本预览资源。
     */
    private readonly pageHide = (): void => this.onDestroy();
    /**
     * @description 准备真实后端与固定刺激，不执行字段矩阵。
     */
    protected start(): void {
        if (!['cc.RigidBody2D', 'cc.BoxCollider2D', 'cc.CircleCollider2D', 'cc.PolygonCollider2D'].includes(this.componentType)
            || !this.node.getComponent(this.componentType)) throw new Error('task51_physics2d_target_missing');
        if (!PhysicsSystem2D.PHYSICS_BOX2D && !PhysicsSystem2D.PHYSICS_BOX2D_WASM) throw new Error('task51_box2d_required');
        const system = PhysicsSystem2D.instance; system.enable = true; system.autoSimulation = false;
        system.gravity = new Vec2(0, -320); system.fixedTimeStep = 1 / 60; system.maxSubSteps = 1;
        system.allowSleep = false; system.debugDrawFlags = EPhysics2DDrawFlags.Shape;
        this.node.setScale(1, 1, 1); this.node.setRotationFromEuler(0, 0, 0);
        this.prepareTarget(); this.createPanel(); this.apply('baseline');
        window.addEventListener('pagehide', this.pageHide, { once: true });
    }
    /**
     * @description 构建被测静态形状或真实自由落体刚体。
     */
    private prepareTarget(): void {
        if (this.componentType === 'cc.RigidBody2D') {
            this.body = this.node.getComponent(RigidBody2D)!; this.ball = this.node;
            this.prepareBody(this.body); this.addBallShape(this.node); return;
        }
        const rigid = this.node.getComponent(RigidBody2D) ?? this.node.addComponent(RigidBody2D);
        rigid.type = ERigidBody2DType.Static; this.target = this.node.getComponent(Collider2D)!;
        this.node.setPosition(0, this.target instanceof CircleCollider2D ? -160 : -80, 0);
        if (this.target instanceof BoxCollider2D) this.target.size = new Size(240, 30);
        else if (this.target instanceof CircleCollider2D) this.target.radius = 100;
        else if (this.target instanceof PolygonCollider2D) this.target.points = [new Vec2(-120, -15), new Vec2(120, -15), new Vec2(120, 15), new Vec2(-120, 15)];
        else throw new Error('task51_physics2d_shape_unknown');
        this.target.friction = 0; this.target.restitution = 0; this.target.apply();
    }
    /**
     * @description 运动物体仅由Box2D推进。
     * @param body 真实刚体。
     */
    private prepareBody(body: RigidBody2D): void {
        body.type = ERigidBody2DType.Dynamic; body.fixedRotation = true; body.allowSleep = false;
        body.linearDamping = 0; body.angularDamping = 0; body.enabledContactListener = true;
    }
    /**
     * @description 真实圆形夹具与跟随刚体节点的可见图形。
     * @param node 实际刚体节点。
     */
    private addBallShape(node: Node): void {
        const shape = node.addComponent(CircleCollider2D); shape.radius = 20; shape.density = 1;
        shape.friction = 0; shape.restitution = 0; shape.apply();
        shape.on(Contact2DType.BEGIN_CONTACT, (_self: Collider2D, other: Collider2D) => {
            if (other === this.target) this.contacts++;
        }, this);
        const graphic = node.addComponent(Graphics); graphic.fillColor = new Color(35, 160, 255);
        graphic.circle(0, 0, 20); graphic.fill();
    }
    /**
     * @description 新建唯一面板，刺激仅由用户可见按钮触发。
     */
    private createPanel(): void {
        const host = window.parent.document;
        if (host.getElementById('task51-behavior-observation')) throw new Error('task51_physics2d_duplicate_panel');
        this.panel = host.createElement('section'); this.panel.id = 'task51-behavior-observation';
        this.panel.style.cssText = 'position:fixed;left:10px;top:70px;width:300px;overflow:hidden;z-index:10000;background:#fff;color:#111;padding:12px;font:12px monospace';
        for (const phase of ['baseline', 'effect']) { const button = host.createElement('button'); button.textContent = 'Task51 ' + phase;
            button.onclick = () => this.apply(phase); this.panel.appendChild(button); }
        this.output = host.createElement('pre'); this.output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
        this.panel.appendChild(this.output); host.body.appendChild(this.panel);
    }
    /**
     * @description 在新阶段开始前丢弃旧运动体，保留实际被测实例。
     * @param phase 固定公开刺激。
     */
    private apply(phase: string): void {
        if (this.ball && this.ball !== this.node) this.ball.destroy();
        if (this.componentType !== 'cc.RigidBody2D') { this.ball = null; this.body = null; }
        this.phase = phase; this.requestedFrame = this.frames; this.rebuildFrame = this.frames + 2;
        this.steps = 0; this.contacts = 0;
        if (this.target) this.target.enabled = phase === 'effect';
        PhysicsSystem2D.instance.resetAccumulator(PhysicsSystem2D.instance.fixedTimeStep / 2);
        if (this.output) this.output.textContent = JSON.stringify({ phase, ready: false });
    }
    /**
     * @description 延迟销毁完成后设置唯一初始条件，之后不再写运动位置。
     */
    private resetMotion(): void {
        if (this.componentType !== 'cc.RigidBody2D') {
            this.ball = new Node('ActualPhysicsBall'); this.ball.layer = this.node.layer; this.node.parent!.addChild(this.ball);
            this.ball.addComponent(UITransform).setContentSize(40, 40); this.body = this.ball.addComponent(RigidBody2D);
            this.prepareBody(this.body); this.addBallShape(this.ball);
        }
        this.ball!.setPosition(0, 140, 0); this.body!.linearVelocity = Vec2.ZERO; this.body!.angularVelocity = 0;
        this.body!.gravityScale = this.componentType === 'cc.RigidBody2D' && this.phase === 'baseline' ? 0 : 1;
        this.body!.wakeUp();
    }
    /**
     * @description 每个实际引擎帧执行一个含同步和事件的公开物理步进，90步后冻结。
     */
    protected update(): void {
        this.frames++;
        if (this.frames < this.rebuildFrame || this.steps >= Task51Physics2DBehavior.stepsPerPhase) return;
        if (this.frames === this.rebuildFrame) this.resetMotion();
        const system = PhysicsSystem2D.instance; system.autoSimulation = true;
        try { system.postUpdate(system.fixedTimeStep); this.steps++; } finally { system.autoSimulation = false; }
    }
    /**
     * @description 只公开完整物理步进后的实际观测。
     */
    protected lateUpdate(): void {
        if (!this.output || this.steps !== Task51Physics2DBehavior.stepsPerPhase) return;
        const body = this.body!; const velocity = body.linearVelocity;
        const state = { backendBox2D: PhysicsSystem2D.PHYSICS_BOX2D || PhysicsSystem2D.PHYSICS_BOX2D_WASM,
            testedComponentBound: !!this.node.getComponent(this.componentType), dynamicBodyBound: this.ball!.getComponent(RigidBody2D) === body,
            bodyImplBound: body.impl !== null, debugShapesEnabled: PhysicsSystem2D.instance.debugDrawFlags === EPhysics2DDrawFlags.Shape,
            steps: this.steps, targetEnabled: this.target?.enabled ?? body.enabled, gravityScale: body.gravityScale,
            contacts: this.contacts, ballY: this.ball!.position.y, velocityY: velocity.y };
        this.output.textContent = JSON.stringify({ schemaVersion: 1, protocolVersion: 2, componentType: this.componentType,
            sceneName: director.getScene()?.name ?? '', phase: this.phase, ready: true, accepted: false,
            requestedFrame: this.requestedFrame, observedFrame: this.frames, engineFramesElapsed: this.frames - this.requestedFrame, state });
    }
    /**
     * @description 只释放本预览内的运动体与面板，不触碰SDK或其它工程。
     */
    protected onDestroy(): void {
        window.removeEventListener('pagehide', this.pageHide); this.panel?.remove(); this.panel = null; this.output = null;
        if (this.ball && this.ball !== this.node) this.ball.destroy(); this.ball = null;
    }
}
