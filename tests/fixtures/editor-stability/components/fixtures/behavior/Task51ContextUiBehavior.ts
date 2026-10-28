import { _decorator, Component, Node, director, Sprite, SpriteFrame, Color, UITransform, Label,
    PageView, PageViewIndicator, Layout, Size, EditBox, SafeArea, Widget, sys,
    RenderRoot2D, UICoordinateTracker, Camera, EventHandler, Vec3 } from 'cc';

/**
 * @description 分页、输入及上下文UI的公开运行行为，不通过脚本伪造输入事件。
 */
@_decorator.ccclass('Task51ContextUiBehavior')
export class Task51ContextUiBehavior extends Component {
    /**
     * @description 冻结类型。
     */
    @_decorator.property
    public componentType = '';
    /**
     * @description 真实图片依赖。
     */
    @_decorator.property(SpriteFrame)
    public fixtureFrame: SpriteFrame | null = null;
    /**
     * @description 映射用例的真实UI标记。
     */
    @_decorator.property(Node)
    public uiMarker: Node | null = null;
    /**
     * @description 实际引擎帧。
     */
    private frames = 0;
    /**
     * @description 观测起始帧。
     */
    private requestedFrame = 0;
    /**
     * @description 当前阶段。
     */
    private phase = 'baseline';
    /**
     * @description 面板节点。
     */
    private panel: HTMLElement | null = null;
    /**
     * @description 公开输出。
     */
    private output: HTMLElement | null = null;
    /**
     * @description 真实编辑器事件计数。
     */
    private edits = { changed: 0, ended: 0, returned: 0 };
    /**
     * @description 真实映射相机。
     */
    private mappingCamera: Camera | null = null;
    /**
     * @description 实际映射回调是否发生。
     */
    private mapped = false;
    /**
     * @description 页面退出释放函数。
     */
    private readonly pageHide = (): void => this.onDestroy();
    /**
     * @description SDK文本变更事件。
     */
    private readonly textChanged = (): void => { this.edits.changed++; this.changed(); };
    /**
     * @description SDK编辑结束事件。
     */
    private readonly editEnded = (): void => { this.edits.ended++; this.changed(); };
    /**
     * @description SDK回车事件。
     */
    private readonly editReturned = (): void => { this.edits.returned++; this.changed(); };
    /**
     * @description 准备真实依赖并挂接外层控制面板。
     */
    protected start(): void {
        if (!this.node.getComponent(this.componentType) || !this.fixtureFrame) throw new Error('task51_context_dependency_missing');
        this.prepare(); const host = window.parent.document;
        if (host.getElementById('task51-behavior-observation')) throw new Error('task51_context_duplicate_panel');
        this.panel = host.createElement('section'); this.panel.id = 'task51-behavior-observation';
        this.panel.style.cssText = 'position:fixed;left:10px;top:70px;width:300px;overflow:hidden;z-index:10000;background:#fff;color:#111;padding:12px;font:12px monospace';
        for (const phase of ['baseline', 'effect']) { const button = host.createElement('button'); button.textContent = 'Task51 ' + phase;
            button.onclick = () => this.apply(phase); this.panel.appendChild(button); }
        this.output = host.createElement('pre'); this.output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
        this.panel.appendChild(this.output); host.body.appendChild(this.panel); this.apply('baseline');
        window.addEventListener('pagehide', this.pageHide, { once: true });
    }
    /**
     * @description 仅在16个真实引擎更新后公开状态。
     */
    protected update(): void {
        this.frames++; if (this.frames - this.requestedFrame < 16 || !this.output) return;
        this.output.textContent = JSON.stringify({ schemaVersion: 1, protocolVersion: 2, componentType: this.componentType,
            sceneName: director.getScene()?.name ?? '', phase: this.phase, ready: true, accepted: false,
            requestedFrame: this.requestedFrame, observedFrame: this.frames, engineFramesElapsed: this.frames - this.requestedFrame, state: this.state() });
    }
    /**
     * @description 释放当前实例事件和面板。
     */
    protected onDestroy(): void {
        window.removeEventListener('pagehide', this.pageHide);
        this.node.off(EditBox.EventType.TEXT_CHANGED, this.textChanged, this);
        this.node.off(EditBox.EventType.EDITING_DID_ENDED, this.editEnded, this);
        this.node.off(EditBox.EventType.EDITING_RETURN, this.editReturned, this);
        this.panel?.remove(); this.panel = null; this.output = null;
    }
    /**
     * @description 实际SDK映射回调直接驱动UI标记，不自行计算映射坐标。
     * @param position SDK公开回调坐标。
     */
    public trackUi(position: Vec3): void {
        if (!this.uiMarker || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('task51_mapping_callback_invalid');
        this.uiMarker.setPosition(position.x, position.y, 0); this.mapped = true;
    }
    /**
     * @description 配置公开资源依赖及所需渲染节点。
     */
    private prepare(): void {
        const type = this.componentType;
        if (type === 'cc.PageView' || type === 'cc.PageViewIndicator') {
            const page = this.page(); if (!page.content || !page.content.parent) throw new Error('task51_page_content_missing');
            page.node.getComponent(UITransform)!.setContentSize(420, 240); page.content.parent.getComponent(UITransform)!.setContentSize(420, 240);
            page.direction = PageView.Direction.HORIZONTAL; page.sizeMode = PageView.SizeMode.Unified;
            page.inertia = false; page.elastic = false;
            const layout = page.content.getComponent(Layout)!; layout.type = Layout.Type.HORIZONTAL;
            layout.resizeMode = Layout.ResizeMode.CONTAINER; layout.spacingX = 0;
            if (!page.indicator) throw new Error('task51_page_indicator_missing');
            page.indicator.spriteFrame = this.fixtureFrame; page.indicator.cellSize = new Size(120, 120); page.indicator.spacing = 40;
            page.indicator.node.getComponent(Layout)!.spacingX = 40;
            page.indicator.node.setPosition(0, -240, 0); page.indicator.setPageView(page);
            for (const color of [new Color(255, 60, 40), new Color(40, 255, 80), new Color(40, 100, 255)]) {
                const node = new Node('ActualPage'); node.layer = page.node.layer; node.addComponent(UITransform);
                this.sprite(node, 420, 240, color); page.addPage(node);
            }
            page.content.getComponent(Layout)!.updateLayout(true);
        } else if (type === 'cc.EditBox') {
            const edit = this.node.getComponent(EditBox)!; edit.inputMode = EditBox.InputMode.SINGLE_LINE;
            edit.inputFlag = EditBox.InputFlag.DEFAULT; edit.maxLength = 16; edit.backgroundImage = this.fixtureFrame;
            this.node.getComponent(UITransform)!.setContentSize(640, 180);
            for (const label of [edit.textLabel, edit.placeholderLabel]) { if (!label) throw new Error('task51_edit_label_missing');
                label.useSystemFont = true; label.fontFamily = 'Arial'; label.fontSize = 96; label.lineHeight = 110;
                label.color = Color.WHITE; label.node.getComponent(UITransform)!.setContentSize(620, 160); }
            edit.placeholder = 'TYPE TEST'; this.node.on(EditBox.EventType.TEXT_CHANGED, this.textChanged, this);
            this.node.on(EditBox.EventType.EDITING_DID_ENDED, this.editEnded, this);
            this.node.on(EditBox.EventType.EDITING_RETURN, this.editReturned, this);
        } else if (type === 'cc.SafeArea') this.sprite(this.node, 200, 180, new Color(30, 130, 255));
        else if (type === 'cc.RenderRoot2D') {
            this.node.setParent(director.getScene(), true); this.sprite(this.node, 420, 180, new Color(30, 130, 255));
        } else if (type === 'cc.UICoordinateTracker') {
            if (!this.uiMarker) throw new Error('task51_mapping_marker_missing');
            this.sprite(this.uiMarker, 160, 160, new Color(40, 255, 80));
            const cameraNode = new Node('ActualMappingCamera'); director.getScene()!.addChild(cameraNode);
            cameraNode.setPosition(0, 0, 10); this.mappingCamera = cameraNode.addComponent(Camera);
            this.mappingCamera.projection = Camera.ProjectionType.ORTHO; this.mappingCamera.orthoHeight = 5;
            this.mappingCamera.priority = -10; this.mappingCamera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
            // The SDK returns coordinates local to its target; the marker is positioned in its parent's space.
            const tracker = this.node.getComponent(UICoordinateTracker)!; tracker.target = this.uiMarker.parent;
            tracker.camera = this.mappingCamera; tracker.useScale = false;
            const callback = new EventHandler(); callback.target = this.node; callback.component = 'Task51ContextUiBehavior'; callback.handler = 'trackUi';
            tracker.syncEvents = [callback]; this.node.setPosition(-3, 0, 0);
        } else throw new Error('task51_context_case_unknown');
    }
    /**
     * @description 执行真实公开API；文本效果仅布防，必须由外部实际键盘完成。
     * @param phase 基线或效果。
     */
    private apply(phase: string): void {
        this.phase = phase; const effect = phase === 'effect'; const type = this.componentType;
        if (type === 'cc.PageView' || type === 'cc.PageViewIndicator') { this.page().stopAutoScroll(); this.page().scrollToPage(effect ? 2 : 0, 0); }
        else if (type === 'cc.EditBox') { this.node.getComponent(EditBox)!.string = effect ? '' : 'BASELINE'; this.edits = { changed: 0, ended: 0, returned: 0 }; }
        else if (type === 'cc.SafeArea') {
            const safe = this.node.getComponent(SafeArea)!; const widget = this.node.getComponent(Widget)!;
            safe.enabled = false; widget.enabled = false; widget.alignMode = Widget.AlignMode.ALWAYS;
            this.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5); this.node.setPosition(0, 0, 0);
            this.node.getComponent(UITransform)!.setContentSize(200, 180);
            if (effect) { widget.enabled = true; safe.enabled = true; safe.updateArea(); }
        } else if (type === 'cc.RenderRoot2D') this.node.getComponent(RenderRoot2D)!.enabled = !effect;
        else if (type === 'cc.UICoordinateTracker') this.node.setPosition(effect ? 2 : -2, 0, 0);
        else throw new Error('task51_context_case_unknown');
        this.changed();
    }
    /**
     * @description 事件后重新计帧。
     */
    private changed(): void { this.requestedFrame = this.frames; if (this.output) this.output.textContent = JSON.stringify({ phase: this.phase, ready: false }); }
    /**
     * @description 获取真实分页组件。
     * @returns 明确绑定的分页组件。
     */
    private page(): PageView {
        const page = this.componentType === 'cc.PageView' ? this.node.getComponent(PageView) : this.node.parent?.getComponent(PageView);
        if (!page) throw new Error('task51_page_binding_missing'); return page;
    }
    /**
     * @description 读取公开运行结果。
     * @returns 实际组件状态。
     */
    private state(): Record<string, unknown> {
        const type = this.componentType;
        if (type === 'cc.PageView' || type === 'cc.PageViewIndicator') {
            const page = this.page(); return { pageIndex: page.getCurrentPageIndex(), pageCount: page.getPages().length,
                contentX: page.content!.position.x, pageFramesBound: page.getPages().every(n => n.getComponent(Sprite)!.spriteFrame === this.fixtureFrame),
                indicatorAlphas: page.indicator!.node.children.map(n => n.getComponent(Sprite)!.color.a),
                indicatorFramesBound: page.indicator!.node.children.every(n => n.getComponent(Sprite)!.spriteFrame === this.fixtureFrame) };
        }
        if (type === 'cc.EditBox') { const edit = this.node.getComponent(EditBox)!; return { text: edit.string,
            labelText: edit.textLabel!.string, ...this.edits, frameBound: edit.backgroundImage === this.fixtureFrame }; }
        if (type === 'cc.SafeArea') { const rect = sys.getSafeAreaRect(); const ui = this.node.getComponent(UITransform)!;
            return { enabled: this.node.getComponent(SafeArea)!.enabled, width: ui.width, height: ui.height,
                safeWidth: rect.width, safeHeight: rect.height, frameBound: this.node.getComponent(Sprite)!.spriteFrame === this.fixtureFrame }; }
        if (type === 'cc.RenderRoot2D') return { enabled: this.node.getComponent(RenderRoot2D)!.enabled,
            detachedFromCanvas: this.node.parent === director.getScene(), frameBound: this.node.getComponent(Sprite)!.spriteFrame === this.fixtureFrame };
        const tracker = this.node.getComponent(UICoordinateTracker)!; return { sourceX: this.node.position.x, markerX: this.uiMarker!.position.x,
            mapped: this.mapped, targetBound: tracker.target === this.uiMarker!.parent, cameraBound: tracker.camera === this.mappingCamera,
            frameBound: this.uiMarker!.getComponent(Sprite)!.spriteFrame === this.fixtureFrame };
    }
    /**
     * @description 配置实际图片。
     * @param node 真实节点。
     * @param width 宽。
     * @param height 高。
     * @param color 色。
     * @returns 实际Sprite。
     */
    private sprite(node: Node, width: number, height: number, color: Color): Sprite {
        const sprite = node.getComponent(Sprite) ?? node.addComponent(Sprite); sprite.spriteFrame = this.fixtureFrame;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.color = color; node.getComponent(UITransform)!.setContentSize(width, height); return sprite;
    }
}
