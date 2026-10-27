import { _decorator, Component, director, Node, SkeletalAnimation, SkinnedMeshRenderer, SkinnedMeshBatchRenderer, postProcess } from 'cc';

/**
 * @description 浏览器真实预览的有界行为对照；仅通过SDK公开接口改变测试组件，不在编辑器执行。
 */
@_decorator.ccclass('Task51BehaviorObservation')
export class Task51BehaviorObservation extends Component {
    /**
     * @description 冻结场景明确指定的被测组件，不按运行时名称猜测测试范围。
     */
    @_decorator.property
    public componentType = '';
    /**
     * @description 可见的证据容器，销毁时连同事件监听一起释放。
     */
    private panel: HTMLElement | null = null;
    /**
     * @description 仅保存属于当前测试容器的结果节点。
     */
    private output: HTMLPreElement | null = null;
    /**
     * @description 当前实例实际经历的引擎更新帧数，不用计时器冒充渲染就绪。
     */
    private frames = 0;
    /**
     * @description 等待两个引擎更新帧后发布当前状态，连续点击不会发布旧状态。
     */
    private pending: { phase: string; requestedFrame: number } | null = null;
    /**
     * @description 页面卸载也释放挂在同源外层文档的测试容器，避免iframe刷新残留旧控件。
     */
    private readonly pageHide = (): void => this.onDestroy();
    /**
     * @description 初次进入真实浏览器预览时建立两个固定按钮；非浏览器运行明确拒绝。
     */
    protected start(): void {
        if (typeof document === 'undefined') throw new Error('task51_behavior_browser_required');
        if (!['cc.Bloom', 'cc.SkeletalAnimation', 'cc.SkinnedMeshRenderer', 'cc.SkinnedMeshBatchRenderer'].includes(this.componentType))
            throw new Error('task51_behavior_case_not_registered');
        const host = window.parent.document;
        if (host.getElementById('task51-behavior-observation')) throw new Error('task51_behavior_duplicate_panel');
        this.panel = host.createElement('section'); this.panel.id = 'task51-behavior-observation';
        this.panel.style.cssText = 'position:fixed;left:10px;top:70px;width:300px;z-index:10000;background:#fff;color:#111;padding:12px;font:12px monospace';
        for (const phase of ['baseline', 'effect']) {
            const button = host.createElement('button'); button.textContent = `Task51 ${phase}`;
            button.onclick = () => this.apply(phase); this.panel.appendChild(button);
        }
        this.output = host.createElement('pre'); this.output.style.whiteSpace = 'pre-wrap';
        this.panel.appendChild(this.output); host.body.appendChild(this.panel); this.apply('baseline');
        window.addEventListener('pagehide', this.pageHide, { once: true });
    }
    /**
     * @description 用实际引擎帧推进对照状态；结果只宣告观测就绪，不宣告验收成功。
     */
    protected update(): void {
        this.frames++;
        if (!this.pending || this.frames - this.pending.requestedFrame < 2) return;
        const observation = this.observe(this.pending.phase, this.pending.requestedFrame);
        this.pending = null;
        if (this.output) this.output.textContent = JSON.stringify(observation);
        if (this.panel) this.panel.dataset.ready = 'true';
    }
    /**
     * @description 清理实例创建的DOM与按钮回调，不留跨场景控制对象。
     */
    protected onDestroy(): void {
        window.removeEventListener('pagehide', this.pageHide);
        for (const button of Array.from(this.panel?.querySelectorAll('button') ?? [])) button.onclick = null;
        this.panel?.remove(); this.panel = null; this.output = null; this.pending = null;
    }
    /**
     * @description 固定两个状态的公开API调用，不允许浏览器传入属性名、路径或脚本。
     * @param phase 仅限基线或效果。
     * @returns 无；两帧后显示真实状态。
     */
    private apply(phase: string): void {
        if (phase !== 'baseline' && phase !== 'effect') throw new Error('task51_behavior_phase_invalid');
        if (this.componentType === 'cc.SkeletalAnimation') this.sampleAnimation(phase);
        else if (this.componentType === 'cc.Bloom') {
            const bloom = this.node.getComponent(postProcess.Bloom);
            if (!bloom) throw new Error('task51_behavior_bloom_missing');
            bloom.threshold = 0; bloom.intensity = 5; bloom.enabled = phase === 'effect';
        } else {
            const renderer = this.renderer(); renderer.enabled = phase === 'effect';
        }
        if (this.panel) this.panel.dataset.ready = 'false';
        if (this.output) this.output.textContent = JSON.stringify({ phase, ready: false });
        this.pending = { phase, requestedFrame: this.frames };
    }
    /**
     * @description 对真实导入动画采样两个不同时间点，不直接写骨骼位姿。
     * @param phase 选择起始姿势或四分之三时刻。
     * @returns 无；骨骼变化必须由真实动画曲线产生。
     */
    private sampleAnimation(phase: string): void {
        const animation = this.node.getComponent(SkeletalAnimation); const clip = animation?.defaultClip;
        if (!animation || !clip || !(clip.duration > 0)) throw new Error('task51_behavior_animation_dependency_missing');
        const state = animation.getState(clip.name);
        if (!state) throw new Error('task51_behavior_animation_state_missing');
        animation.pause(); state.setTime(phase === 'baseline' ? 0 : clip.duration * 0.75); state.sample();
    }
    /**
     * @description 按登记类型取得实际渲染器，避免批处理用子网格的可见画面冒充通过。
     * @returns 对应的真实渲染组件。
     */
    private renderer(): SkinnedMeshRenderer {
        const renderer = this.componentType === 'cc.SkinnedMeshBatchRenderer'
            ? this.node.getComponent(SkinnedMeshBatchRenderer) : this.node.getComponent(SkinnedMeshRenderer);
        if (!renderer || !renderer.mesh || !renderer.skeleton) throw new Error('task51_behavior_renderer_dependency_missing');
        return renderer;
    }
    /**
     * @description 收集真实组件和骨骼观测，截图必须另外验证实际画面差异。
     * @param phase 当前对照状态。
     * @param requestedFrame 该状态请求时的实际帧数。
     * @returns 可见DOM中的有限JSON记录，不包含自动通过结论。
     */
    private observe(phase: string, requestedFrame: number): Record<string, unknown> {
        const animation = this.node.getComponent(SkeletalAnimation); const clip = animation?.defaultClip;
        const state = clip ? animation?.getState(clip.name) : null;
        const renderer = this.componentType.includes('Renderer') ? this.renderer() : null;
        const bloom = this.componentType === 'cc.Bloom' ? this.node.getComponent(postProcess.Bloom) : null;
        return { schemaVersion: 1, componentType: this.componentType, sceneName: director.getScene()?.name,
            phase, ready: true, requestedFrame, observedFrame: this.frames, engineFramesElapsed: this.frames - requestedFrame,
            enabled: renderer?.enabled ?? bloom?.enabled ?? animation?.enabled,
            meshBound: renderer ? !!renderer.mesh : null, skeletonBound: renderer ? !!renderer.skeleton : null,
            animationTime: state?.time ?? null, animationDuration: clip?.duration ?? null,
            poses: this.componentType === 'cc.SkeletalAnimation' ? this.poses(this.node, '') : [],
            threshold: bloom?.threshold ?? null, intensity: bloom?.intensity ?? null, accepted: false };
    }
    /**
     * @description 递归记录真实层级局部变换，保留名称路径供独立对照，不修改节点。
     * @param node 当前真实节点。
     * @param prefix 父级路径。
     * @returns 实际层级位姿记录。
     */
    private poses(node: Node, prefix: string): Record<string, unknown>[] {
        const path = prefix + '/' + node.name;
        return [{ path, position: [node.position.x, node.position.y, node.position.z],
            rotation: [node.rotation.x, node.rotation.y, node.rotation.z, node.rotation.w] },
        ...node.children.flatMap(child => this.poses(child, path))];
    }
}
