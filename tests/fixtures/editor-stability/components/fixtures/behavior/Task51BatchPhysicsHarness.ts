import { _decorator, Component, Node, EffectAsset, Camera, Canvas, Vec3, Color, PhysicsSystem, PhysicsSystem2D, director } from 'cc';
import { BULLET_BATCH_RETEST_TYPES } from '../../component-batch-physics-catalog';
import type { Task51BatchCase } from '../../component-batch-physics-catalog';
import { Task51BulletBatchCase } from './Task51BulletBatchCase';
import { Task51JointBatchCase } from './Task51JointBatchCase';

/**
 * @description 共享冻结场景的23项物理用例控制器；每项独立观测，禁止自动提升验收。
 */
@_decorator.ccclass('Task51BatchPhysicsHarness')
export class Task51BatchPhysicsHarness extends Component {
    /**
     * @description 每个未通过组件对应唯一序列化节点。
     */
    @_decorator.property([Node])
    public targets: Node[] = [];
    /**
     * @description 场景显式引用的已加载unlit着色器。
     */
    @_decorator.property(EffectAsset)
    public fixtureEffect: EffectAsset | null = null;
    /**
     * @description 实际帧及物理步计数。
     */
    private frames = 0;
    /**
     * @description 本阶段申请帧。
     */
    private requestedFrame = 0;
    /**
     * @description 实际完成物理步数。
     */
    private steps = 0;
    /**
     * @description 前一实例延迟清理后的启动帧。
     */
    private prepareFrame = 0;
    /**
     * @description 固定选择和刺激。
     */
    private type = '';
    /**
     * @description 当前刺激阶段。
     */
    private phase = 'baseline';
    /**
     * @description 实际用例策略。
     */
    private current: Task51BatchCase | null = null;
    /**
     * @description 当前激活的冻结节点。
     */
    private target: Node | null = null;
    /**
     * @description 唯一可见控制面板。
     */
    private panel: HTMLElement | null = null;
    /**
     * @description 终态或首个错误观测。
     */
    private output: HTMLElement | null = null;
    /**
     * @description 单次终态读取，错误不逐帧重试。
     */
    private published = false;
    /**
     * @description 页面离开时只清理所属实例。
     */
    private readonly pageHide = (): void => this.onDestroy();
    /**
     * @description 先校验23项装配完整，再允许可见界面逐项选择。
     */
    protected start(): void {
        const types = [...BULLET_BATCH_RETEST_TYPES];
        if (!this.fixtureEffect || this.targets.length !== types.length
            || types.some(type => this.targets.filter(n => n.name === type && n.getComponent(type)).length !== 1))
            throw new Error('batch_frozen_targets_incomplete');
        for (const node of this.targets) node.active = false;
        PhysicsSystem.instance.autoSimulation = false; PhysicsSystem2D.instance.autoSimulation = false;
        const host = window.parent.document;
        if (host.getElementById('task51-behavior-observation')) throw new Error('batch_duplicate_panel');
        this.panel = host.createElement('section'); this.panel.id = 'task51-behavior-observation';
        this.panel.style.cssText = 'position:fixed;left:10px;top:70px;width:300px;overflow:hidden;z-index:10000;background:#fff;color:#111;padding:12px;font:12px monospace';
        const select = host.createElement('select'); select.setAttribute('aria-label', 'Task51 component');
        for (const type of types) { const option = host.createElement('option'); option.value = type; option.textContent = type; select.appendChild(option); }
        select.onchange = () => this.choose(select.value); this.panel.appendChild(select);
        for (const phase of ['baseline', 'effect']) { const button = host.createElement('button'); button.textContent = 'Task51 ' + phase;
            button.onclick = () => this.apply(phase); this.panel.appendChild(button); }
        this.output = host.createElement('pre'); this.output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
        this.panel.appendChild(this.output); host.body.appendChild(this.panel); this.choose(types[0]!);
        window.addEventListener('pagehide', this.pageHide, { once: true });
    }
    /**
     * @description 用真实UI选择唯一节点，等旧对象清理后再初始化下一项。
     * @param type 已冻结的组件。
     */
    private choose(type: string): void {
        if (this.target) this.target.active = false;
        this.current?.dispose(); this.current = null; this.target = null;
        this.type = type; this.phase = 'baseline'; this.steps = 0; this.published = false;
        this.requestedFrame = this.frames; this.prepareFrame = this.frames + 4;
        if (this.output) this.output.textContent = JSON.stringify({ componentType: type, phase: 'baseline', ready: false });
    }
    /**
     * @description 原生相机和Canvas随实际用例组切换，不用画面代理代替组件。
     */
    private prepare(): void {
        const is2D = (JOINT_BATCH_TYPES as readonly string[]).includes(this.type); const scene = director.getScene()!;
        const canvas = scene.getComponentInChildren(Canvas)!;
        const main = scene.getComponentsInChildren(Camera).find(camera => camera.node.name === 'BatchCamera3D');
        if (!main) throw new Error('batch_main_camera_missing');
        for (const camera of scene.getComponentsInChildren(Camera)) {
            camera.enabled = is2D ? camera === canvas.cameraComponent : camera === main;
            camera.clearFlags = Camera.ClearFlag.SOLID_COLOR; camera.clearColor = new Color(0, 0, 0);
            if (camera === main) { camera.node.setWorldPosition(new Vec3(12, 10, 16)); camera.node.lookAt(new Vec3(0, -2.5, 0)); camera.clearColor = new Color(0, 0, 0); camera.usePostProcess = false; }
        }
        for (const layer of scene.getComponentsInChildren(Canvas)) layer.enabled = is2D;
        scene.globals.skybox.enabled = false;
        this.target = this.targets.find(n => n.name === this.type)!; this.target.active = true;
        this.current = is2D ? new Task51JointBatchCase(this.type, this.target)
            : new Task51BulletBatchCase(this.type, this.target, this.fixtureEffect!);
        this.current.reset('baseline');
    }
    /**
     * @description 公开阶段刺激，失败后必须重新选择独立用例，不能继续错误实例。
     * @param phase 固定刺激。
     */
    private apply(phase: string): void {
        if (!this.current || !this.target) return;
        try { this.current.reset(phase); this.phase = phase; this.requestedFrame = this.frames; this.steps = 0; this.published = false;
            if (this.output) this.output.textContent = JSON.stringify({ componentType: this.type, phase, ready: false }); }
        catch (error) { this.fail(error); }
    }
    /**
     * @description 固定90个实际求解步，再留两个实际帧供渲染终态稳定。
     */
    protected update(): void {
        this.frames++;
        try {
            if (!this.current && this.prepareFrame > 0 && this.frames >= this.prepareFrame) { this.prepareFrame = 0; this.prepare(); }
            if (this.current && this.steps < 90) { this.current.step(); this.steps++; }
        } catch (error) { this.fail(error); }
    }
    /**
     * @description 只发布真实终态一次，保留实际类、节点、帧和求解器结果。
     */
    protected lateUpdate(): void {
        if (!this.current || !this.output || this.published || this.steps !== 90 || this.frames - this.requestedFrame < 94) return;
        this.published = true;
        try { this.output.textContent = JSON.stringify({ schemaVersion: 1, protocolVersion: 2, componentType: this.type,
            sceneName: director.getScene()?.name ?? '', phase: this.phase, ready: true, accepted: false,
            requestedFrame: this.requestedFrame, observedFrame: this.frames, engineFramesElapsed: this.frames - this.requestedFrame,
            state: { ...this.current.state(), steps: this.steps } }); } catch (error) { this.fail(error); }
    }
    /**
     * @description 原始错误原样保留并停用失败节点，不把错误转成成功。
     * @param error 实际异常。
     */
    private fail(error: unknown): void {
        console.error('task51-batch-case-failed', this.type, error); this.published = true; this.prepareFrame = 0;
        if (this.output) this.output.textContent = JSON.stringify({ componentType: this.type, phase: this.phase, ready: false, failed: true, error: String(error) });
        if (this.target) this.target.active = false;
        const failed = this.current; this.current = null; this.target = null;
        try { failed?.dispose(); } catch (cleanupError) { console.error('task51-batch-cleanup-failed', this.type, cleanupError); }
    }
    /**
     * @description 仅清理本预览实例和面板，不修改外部应用或SDK。
     */
    protected onDestroy(): void {
        window.removeEventListener('pagehide', this.pageHide); if (this.target) this.target.active = false;
        this.current?.dispose(); this.current = null; this.panel?.remove(); this.panel = null; this.output = null;
    }
}
