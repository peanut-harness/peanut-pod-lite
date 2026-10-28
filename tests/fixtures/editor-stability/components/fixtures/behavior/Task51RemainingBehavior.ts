import { _decorator, Component, Node, TiledMap, TiledTile, UITransform, Graphics, Color, postProcess } from 'cc';

/**
 * @description Tiled与剩余后处理的公开运行行为对照；不在编辑器执行，不自动宣告通过。
 */
@_decorator.ccclass('Task51RemainingBehavior')
export class Task51RemainingBehavior extends Component {
    /**
     * @description 冻结场景声明唯一被测组件。
     */
    @_decorator.property
    public componentType = '';
    /**
     * @description 当前真实引擎更新帧。
     */
    private frames = 0;
    /**
     * @description 当前状态请求，等待足够引擎帧后显示观测。
     */
    private pending: { phase: string; frame: number } | null = null;
    /**
     * @description 只属于本实例的可见证据面板。
     */
    private panel: HTMLElement | null = null;
    /**
     * @description 面板内实际观测文本。
     */
    private output: HTMLElement | null = null;
    /**
     * @description 初始化时保存实际地图引用，以公开接口清除及恢复。
     */
    private mapAsset: TiledMap['tmxAsset'] | null = null;
    /**
     * @description 由真实图层公开工厂创建的单格组件。
     */
    private tile: TiledTile | null = null;
    /**
     * @description 真实用户节点，注册和移除由TiledLayer负责。
     */
    private user: Node | null = null;
    /**
     * @description 页面退出时移除同源外层面板。
     */
    private readonly pageHide = (): void => this.onDestroy();
    /**
     * @description 准备真实依赖与固定按钮，未就绪抛错并保留真实诊断。
     */
    protected start(): void {
        if (typeof document === 'undefined') throw new Error('task51_remaining_browser_required');
        if (this.componentType.startsWith('cc.Tiled')) {
            const map = this.map(); this.mapAsset = map.tmxAsset;
            if (!this.mapAsset || !map.getLayer('Ground') || !map.getObjectGroup('Objects')) throw new Error('task51_remaining_tmx_missing');
            map.getObjectGroup('Objects')!.node.setPosition(24, 0, 0);
            if (this.componentType === 'cc.TiledTile') this.tile = map.getLayer('Ground')!.getTiledTileAt(0, 0, true);
            if (this.componentType === 'cc.TiledUserNodeData') {
                this.user = new Node('Task51RealUser'); this.user.layer = this.node.layer;
                this.user.addComponent(UITransform).setContentSize(8, 8);
                const draw = this.user.addComponent(Graphics); draw.fillColor = new Color(0, 255, 255, 255);
                draw.rect(0, 0, 8, 8); draw.fill(); this.user.setPosition(0, -12, 0);
            }
        }
        const host = window.parent.document;
        if (host.getElementById('task51-behavior-observation')) throw new Error('task51_remaining_panel_collision');
        this.panel = host.createElement('section'); this.panel.id = 'task51-behavior-observation';
        this.panel.style.cssText = 'position:fixed;left:10px;top:70px;width:300px;overflow:hidden;z-index:10000;background:#fff;color:#111;padding:12px;font:12px monospace';
        for (const phase of ['baseline', 'effect']) {
            const button = host.createElement('button'); button.textContent = `Task51 ${phase}`;
            button.onclick = () => this.apply(phase); this.panel.appendChild(button);
        }
        this.output = host.createElement('pre'); this.output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
        this.panel.appendChild(this.output); host.body.appendChild(this.panel);
        this.apply('baseline'); window.addEventListener('pagehide', this.pageHide, { once: true });
    }
    /**
     * @description TAA等待32帧，其余等待8帧；计数来自引擎而不是墙钟计时器。
     */
    protected update(): void {
        this.frames++;
        if (!this.pending || this.frames - this.pending.frame < (this.componentType === 'cc.TAA' ? 32 : 8)) return;
        const { phase, frame } = this.pending; this.pending = null;
        if (this.output) this.output.textContent = JSON.stringify({ schemaVersion: 1, protocolVersion: 2,
            componentType: this.componentType, sceneName: '', phase, ready: true, accepted: false,
            requestedFrame: frame, observedFrame: this.frames, engineFramesElapsed: this.frames - frame, state: this.state() });
    }
    /**
     * @description 清理面板与按钮，不销毁其它场景资源。
     */
    protected onDestroy(): void {
        window.removeEventListener('pagehide', this.pageHide);
        for (const button of Array.from(this.panel?.querySelectorAll('button') ?? [])) button.onclick = null;
        this.panel?.remove(); this.panel = null; this.output = null; this.pending = null;
    }
    /**
     * @description 所有刺激均为当前组件的公开API，地图源和其它几何在两个状态间不改动。
     * @param phase 仅限两个预定义状态。
     * @returns 无；观测由后续引擎帧发布。
     */
    private apply(phase: string): void {
        if (!['baseline', 'effect'].includes(phase)) throw new Error('task51_remaining_phase_invalid');
        const effect = phase === 'effect';
        if (this.componentType.startsWith('cc.Tiled')) this.applyTiled(effect);
        else if (this.componentType === 'cc.PostProcess') this.node.getComponent(postProcess.PostProcess)!.shadingScale = effect ? 0.2 : 1;
        else {
            const setting = this.node.getComponent(this.componentType);
            if (!setting) throw new Error('task51_remaining_setting_missing');
            setting.enabled = effect;
            const dof = this.node.getComponent(postProcess.DOF);
            if (dof) { dof.focusDistance = 100; dof.focusRange = 0.1; dof.bokehRadius = 10; }
            const hbao = this.node.getComponent(postProcess.HBAO);
            if (hbao) { hbao.radiusScale = 5; hbao.aoSaturation = 5; hbao.needBlur = true; }
            const fsr = this.node.getComponent(postProcess.FSR);
            if (fsr) fsr.sharpness = 1;
            const taa = this.node.getComponent(postProcess.TAA);
            if (taa) { taa.sampleScale = 1; taa.feedback = 0.95; }
            const grading = this.node.getComponent(postProcess.ColorGrading);
            if (grading) { if (!grading.colorGradingMap) throw new Error('task51_remaining_lut_missing'); grading.contribute = 1; }
        }
        if (this.output) this.output.textContent = JSON.stringify({ phase, ready: false });
        this.pending = { phase, frame: this.frames };
    }
    /**
     * @description 地图、图层、对象、单格及用户注册分别使用真实SDK拥有的对象。
     * @param effect 是否施加变化。
     * @returns 无；失配即抛错，不替换为字段通过。
     */
    private applyTiled(effect: boolean): void {
        const map = this.map();
        if (this.componentType === 'cc.TiledMap') {
            map.tmxAsset = effect ? null! : this.mapAsset!;
            if (!effect) map.getObjectGroup('Objects')!.node.setPosition(24, 0, 0);
            return;
        }
        const layer = map.getLayer('Ground'); if (!layer) throw new Error('task51_remaining_layer_missing');
        if (this.componentType === 'cc.TiledLayer') layer.setTileGIDAt(effect ? 0 : 1, 0, 0);
        else if (this.componentType === 'cc.TiledObjectGroup') map.getObjectGroup('Objects')!.node.active = !effect;
        else if (this.componentType === 'cc.TiledTile') {
            if (!this.tile) throw new Error('task51_remaining_tile_missing'); this.tile.grid = effect ? 0 : 1;
        } else if (this.componentType === 'cc.TiledUserNodeData') {
            if (!this.user) throw new Error('task51_remaining_user_missing');
            const registered = !!this.user.getComponent('cc.TiledUserNodeData');
            if (effect && registered && !layer.removeUserNode(this.user)) throw new Error('task51_remaining_remove_user_failed');
            if (!effect && !registered && !layer.addUserNode(this.user)) throw new Error('task51_remaining_add_user_failed');
        } else throw new Error('task51_remaining_case_unknown');
    }
    /**
     * @description 获取当前节点真实地图，不通过私有层级字段绕过初始化。
     * @returns 当前地图。
     */
    private map(): TiledMap {
        const map = this.node.getComponent(TiledMap); if (!map) throw new Error('task51_remaining_map_missing'); return map;
    }
    /**
     * @description 记录组件特定状态，实际画面仍由独立截图检查。
     * @returns 当前状态的有限JSON。
     */
    private state(): Record<string, unknown> {
        if (this.componentType.startsWith('cc.Tiled')) {
            const map = this.map(); const layer = map.getLayer('Ground'); const group = map.getObjectGroup('Objects');
            return { mapBound: !!map.tmxAsset, layers: map.getLayers().length, objects: group?.getObjects().length ?? 0,
                gid: layer?.getTileGIDAt(0, 0) ?? null, groupActive: group?.node.active ?? false,
                tileGrid: this.tile?.grid ?? null, tileRegistered: !!this.tile && layer?.getTiledTileAt(0, 0) === this.tile,
                userRegistered: !!this.user?.getComponent('cc.TiledUserNodeData'), userParentIsLayer: !!this.user && this.user.parent === layer?.node };
        }
        const pp = this.node.getComponent(postProcess.PostProcess);
        const setting = this.node.getComponent(this.componentType);
        const grading = this.node.getComponent(postProcess.ColorGrading); const blit = this.node.getComponent(postProcess.BlitScreen);
        const dof = this.node.getComponent(postProcess.DOF); const hbao = this.node.getComponent(postProcess.HBAO);
        const fsr = this.node.getComponent(postProcess.FSR); const taa = this.node.getComponent(postProcess.TAA);
        return { enabled: setting?.enabled, shadingScale: pp?.shadingScale,
            lutBound: !!grading?.colorGradingMap, lutWidth: grading?.colorGradingMap?.width ?? null,
            lutHeight: grading?.colorGradingMap?.height ?? null, contribute: grading?.contribute ?? null,
            activeMaterials: blit?.activeMaterials.length ?? null, focusDistance: dof?.focusDistance ?? null,
            focusRange: dof?.focusRange ?? null, bokehRadius: dof?.bokehRadius ?? null,
            radiusScale: hbao?.radiusScale ?? null, aoSaturation: hbao?.aoSaturation ?? null,
            sharpness: fsr?.sharpness ?? null, sampleScale: taa?.sampleScale ?? null, feedback: taa?.feedback ?? null };
    }
}
