import { _decorator, Component, Node, director, Sprite, SpriteFrame, Color, Label, RichText, UITransform,
    UIOpacity, UISkew, Graphics, Mask, Layout, Widget, Sorting2D, ScrollView, ScrollBar, ProgressBar } from 'cc';

/**
 * @description 独立UI场景的真实公开行为对照；只有实际引擎帧与截图联合验收，不自动通过。
 */
@_decorator.ccclass('Task51UiBehavior')
export class Task51UiBehavior extends Component {
    /**
     * @description 冻结输入指定的唯一被测类型。
     */
    @_decorator.property
    public componentType = '';
    /**
     * @description 图片类行为使用已导入的真实帧，文字和图形用例不要求此资源。
     */
    @_decorator.property(SpriteFrame)
    public fixtureFrame: SpriteFrame | null = null;
    /**
     * @description 实际引擎更新次数。
     */
    private frames = 0;
    /**
     * @description 当前状态及其真实起始帧。
     */
    private pending: { phase: string; frame: number } | null = null;
    /**
     * @description 本实例独占的同源外层面板。
     */
    private panel: HTMLElement | null = null;
    /**
     * @description 完整可见JSON输出。
     */
    private output: HTMLElement | null = null;
    /**
     * @description 真实运行时创建的图像节点。
     */
    private visuals: Node[] = [];
    /**
     * @description 页面退出时释放外层面板。
     */
    private readonly pageHide = (): void => this.onDestroy();
    /**
     * @description 核对实际组件并准备公开依赖，不在编辑器运行。
     */
    protected start(): void {
        if (!this.node.getComponent(this.componentType)) throw new Error('task51_ui_target_missing');
        this.prepare();
        const host = window.parent.document;
        if (host.getElementById('task51-behavior-observation')) throw new Error('task51_ui_duplicate_panel');
        this.panel = host.createElement('section'); this.panel.id = 'task51-behavior-observation';
        this.panel.style.cssText = 'position:fixed;left:10px;top:70px;width:300px;overflow:hidden;z-index:10000;background:#fff;color:#111;padding:12px;font:12px monospace';
        for (const phase of ['baseline', 'effect']) {
            const button = host.createElement('button'); button.textContent = `Task51 ${phase}`;
            button.onclick = () => this.apply(phase); this.panel.appendChild(button);
        }
        this.output = host.createElement('pre'); this.output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
        this.panel.appendChild(this.output); host.body.appendChild(this.panel); this.apply('baseline');
        window.addEventListener('pagehide', this.pageHide, { once: true });
    }
    /**
     * @description 等待16个实际引擎更新帧，保留真实组件状态；不把墙钟等待当作呈现通过。
     */
    protected update(): void {
        this.frames++;
        if (!this.pending || this.frames - this.pending.frame < 16) return;
        const { phase, frame } = this.pending; this.pending = null;
        if (this.output) this.output.textContent = JSON.stringify({ schemaVersion: 1, protocolVersion: 2,
            componentType: this.componentType, sceneName: director.getScene()?.name ?? '', phase, ready: true, accepted: false,
            requestedFrame: frame, observedFrame: this.frames, engineFramesElapsed: this.frames - frame, state: this.state() });
    }
    /**
     * @description 仅释放当前测试面板和事件，不干预其它标签页。
     */
    protected onDestroy(): void {
        window.removeEventListener('pagehide', this.pageHide);
        for (const button of Array.from(this.panel?.querySelectorAll('button') ?? [])) button.onclick = null;
        this.panel?.remove(); this.panel = null; this.output = null; this.pending = null;
    }
    /**
     * @description 使用实际SpriteFrame建立有区分力的公开渲染依赖。
     */
    private prepare(): void {
        const type = this.componentType;
        if (['cc.Sprite', 'cc.UITransform', 'cc.UIOpacity', 'cc.UISkew', 'cc.Sorting2D', 'cc.Widget'].includes(type)) {
            this.configureSprite(this.node.getComponent(Sprite)!, 360, 200, new Color(30, 130, 255, 255));
        }
        if (type === 'cc.Sorting2D') {
            const other = this.node.parent?.getChildByName('SortingBackdrop');
            if (!other?.getComponent(Sorting2D)) throw new Error('task51_ui_sorting_pair_missing');
            this.configureSprite(other.getComponent(Sprite)!, 360, 200, new Color(255, 60, 40, 255));
            other.setPosition(0, 0, 0); this.node.setPosition(0, 0, 0); other.getComponent(Sorting2D)!.sortingOrder = 1;
        }
        if (type === 'cc.Layout') {
            const colors = [new Color(255, 60, 40), new Color(40, 255, 80), new Color(40, 100, 255)];
            this.visuals = colors.map((color, i) => this.sprite(this.node, 'Layout' + i, 120, 120, color));
        }
        if (type === 'cc.Mask') {
            this.node.getComponent(UITransform)!.setContentSize(160, 160);
            this.visuals = [this.sprite(this.node, 'MaskedImage', 320, 320, Color.WHITE)];
        }
        if (type === 'cc.ScrollView' || type === 'cc.ScrollBar') this.prepareScroll();
        if (type === 'cc.ProgressBar') {
            const progress = this.node.getComponent(ProgressBar)!;
            if (!progress.barSprite) throw new Error('task51_ui_progress_bar_missing');
            this.configureSprite(this.node.getComponent(Sprite)!, 480, 80, new Color(70, 70, 70));
            this.configureSprite(progress.barSprite, 480, 64, new Color(40, 255, 120));
            progress.barSprite.node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
            progress.barSprite.node.setPosition(-240, 0, 0); progress.totalLength = 480;
        }
    }
    /**
     * @description 准备真实ScrollView内容和公开绑定的ScrollBar，保留原SDK预设的Mask结构。
     */
    private prepareScroll(): void {
        const scroll = this.scroll(); const content = scroll.content;
        if (!content?.parent) throw new Error('task51_ui_scroll_content_missing');
        scroll.node.getComponent(UITransform)!.setContentSize(420, 240);
        content.parent.getComponent(UITransform)!.setContentSize(420, 240);
        content.getComponent(UITransform)!.setContentSize(420, 900);
        content.getComponent(UITransform)!.setAnchorPoint(0.5, 1); content.setPosition(0, 120, 0);
        scroll.horizontal = false; scroll.vertical = true; scroll.inertia = false; scroll.elastic = false;
        const colors = [new Color(255, 60, 40), new Color(40, 255, 80), new Color(40, 100, 255)];
        this.visuals = colors.map((color, i) => {
            const node = this.sprite(content, 'Card' + i, 380, 180, color); node.setPosition(0, -100 - i * 300, 0); return node;
        });
        const bar = scroll.verticalScrollBar;
        if (!bar?.handle) throw new Error('task51_ui_scroll_bar_missing');
        bar.node.active = this.componentType === 'cc.ScrollBar'; bar.enableAutoHide = false;
        if (this.componentType === 'cc.ScrollBar') {
            const widget = bar.node.getComponent(Widget); if (widget) widget.enabled = false;
            bar.node.getComponent(UITransform)!.setContentSize(48, 240); bar.node.setPosition(250, 0, 0);
            this.configureSprite(bar.handle, 48, 80, new Color(40, 255, 255));
            bar.direction = ScrollBar.Direction.VERTICAL; bar.setScrollView(scroll);
        }
    }
    /**
     * @description 新建属于当前场景的真实图像节点，不使用HUD代替内容。
     * @param parent 当前所有者。
     * @param name 固定节点名。
     * @param width 真实宽度。
     * @param height 真实高度。
     * @param color 固定颜色。
     * @returns 已挂接的节点。
     */
    private sprite(parent: Node, name: string, width: number, height: number, color: Color): Node {
        const node = new Node(name); node.layer = this.node.layer; node.parent = parent;
        node.addComponent(UITransform); this.configureSprite(node.addComponent(Sprite), width, height, color); return node;
    }
    /**
     * @description 始终绑定实际已导入帧，并使用可控尺寸。
     * @param sprite 当前真实Sprite。
     * @param width 内容宽度。
     * @param height 内容高度。
     * @param color 固定颜色。
     * @returns 无；缺资源拒绝。
     */
    private configureSprite(sprite: Sprite, width: number, height: number, color: Color): void {
        if (!sprite || !this.fixtureFrame) throw new Error('task51_ui_frame_missing');
        sprite.spriteFrame = this.fixtureFrame; sprite.type = Sprite.Type.SIMPLE; sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = color; sprite.node.getComponent(UITransform)!.setContentSize(width, height);
    }
    /**
     * @description 两个固定状态只调用真实组件公开接口。
     * @param phase 基线或变化。
     * @returns 无；16帧后才发布就绪。
     */
    private apply(phase: string): void {
        if (!['baseline', 'effect'].includes(phase)) throw new Error('task51_ui_phase_invalid');
        const effect = phase === 'effect'; const type = this.componentType;
        if (type === 'cc.Label') {
            const label = this.node.getComponent(Label)!; label.useSystemFont = true; label.fontFamily = 'Arial';
            label.fontSize = 96; label.lineHeight = 112; label.overflow = Label.Overflow.CLAMP; label.enableWrapText = false;
            this.node.getComponent(UITransform)!.setContentSize(700, 160); label.string = effect ? 'CHANGED' : 'BASELINE';
        } else if (type === 'cc.RichText') {
            const rich = this.node.getComponent(RichText)!; rich.fontSize = 96; rich.lineHeight = 112; rich.maxWidth = 700;
            rich.string = effect ? '<color=#33aaff>TWO</color>' : '<color=#ff4433>ONE</color>';
        } else if (type === 'cc.Sprite') this.node.getComponent(Sprite)!.color = effect ? new Color(255, 60, 40) : new Color(30, 130, 255);
        else if (type === 'cc.UIOpacity') this.node.getComponent(UIOpacity)!.opacity = effect ? 32 : 255;
        else if (type === 'cc.UITransform') this.node.getComponent(UITransform)!.setContentSize(effect ? 480 : 200, 180);
        else if (type === 'cc.UISkew') { const skew = this.node.getComponent(UISkew)!; skew.x = effect ? 30 : 0; skew.y = 0; }
        else if (type === 'cc.Graphics') {
            const graphics = this.node.getComponent(Graphics)!; graphics.clear(); graphics.lineWidth = effect ? 32 : 4;
            graphics.strokeColor = new Color(40, 255, 255); graphics.rect(-150, -90, 300, 180); graphics.stroke();
        } else if (type === 'cc.Mask') this.node.getComponent(Mask)!.inverted = effect;
        else if (type === 'cc.Layout') {
            const layout = this.node.getComponent(Layout)!; layout.resizeMode = Layout.ResizeMode.CONTAINER;
            layout.spacingX = 20; layout.spacingY = 20; layout.type = effect ? Layout.Type.VERTICAL : Layout.Type.HORIZONTAL;
            layout.updateLayout(true);
        } else if (type === 'cc.Widget') {
            const widget = this.node.getComponent(Widget)!; widget.target = this.node.parent;
            widget.alignMode = Widget.AlignMode.ONCE; widget.isAlignLeft = true; widget.isAlignRight = false;
            widget.isAlignTop = false; widget.isAlignBottom = false; widget.isAlignHorizontalCenter = false;
            widget.isAlignVerticalCenter = false; widget.isAbsoluteLeft = true; widget.left = effect ? 480 : 120; widget.updateAlignment();
        } else if (type === 'cc.Sorting2D') this.node.getComponent(Sorting2D)!.sortingOrder = effect ? 2 : 0;
        else if (type === 'cc.ProgressBar') this.node.getComponent(ProgressBar)!.progress = effect ? 0.75 : 0.25;
        else if (type === 'cc.ScrollView' || type === 'cc.ScrollBar') {
            const scroll = this.scroll(); scroll.stopAutoScroll(); if (effect) scroll.scrollToBottom(0); else scroll.scrollToTop(0);
        } else throw new Error('task51_ui_case_unknown');
        if (this.output) this.output.textContent = JSON.stringify({ phase, ready: false });
        this.pending = { phase, frame: this.frames };
    }
    /**
     * @description 获取冻结层级中唯一的真实滚动驱动，不读私有字段。
     * @returns 对应ScrollView。
     */
    private scroll(): ScrollView {
        const scroll = (this.componentType === 'cc.ScrollBar' ? this.node.parent : this.node)?.getComponent(ScrollView);
        if (!scroll) throw new Error('task51_ui_scroll_driver_missing'); return scroll;
    }
    /**
     * @description 只输出当前组件可验证的实际状态，画面与恢复由外层独立核对。
     * @returns 紧凑可见观测。
     */
    private state(): Record<string, unknown> {
        const type = this.componentType; const sprite = this.node.getComponent(Sprite);
        const frameBound = !!this.fixtureFrame && sprite?.spriteFrame === this.fixtureFrame;
        if (type === 'cc.Label') { const c = this.node.getComponent(Label)!; return { text: c.string, fontSize: c.fontSize }; }
        if (type === 'cc.RichText') { const c = this.node.getComponent(RichText)!; return { text: c.string, fontSize: c.fontSize }; }
        if (type === 'cc.Sprite') return { frameBound, color: [sprite!.color.r, sprite!.color.g, sprite!.color.b, sprite!.color.a].join(',') };
        if (type === 'cc.UIOpacity') return { frameBound, opacity: this.node.getComponent(UIOpacity)!.opacity };
        if (type === 'cc.UITransform') { const t = this.node.getComponent(UITransform)!; return { frameBound, width: t.width, height: t.height }; }
        if (type === 'cc.UISkew') { const c = this.node.getComponent(UISkew)!; return { frameBound, skewX: c.x, skewY: c.y }; }
        if (type === 'cc.Graphics') return { lineWidth: this.node.getComponent(Graphics)!.lineWidth };
        if (type === 'cc.Mask') return { inverted: this.node.getComponent(Mask)!.inverted, childFrameBound: this.visuals[0]?.getComponent(Sprite)?.spriteFrame === this.fixtureFrame };
        if (type === 'cc.Layout') return { layoutType: this.node.getComponent(Layout)!.type, childCount: this.visuals.length,
            childrenFramesBound: this.visuals.every(node => node.getComponent(Sprite)?.spriteFrame === this.fixtureFrame), positions: this.visuals.map(node => [node.position.x, node.position.y]) };
        if (type === 'cc.Widget') { const c = this.node.getComponent(Widget)!; return { frameBound, left: c.left, targetIsParent: c.target === this.node.parent, posX: this.node.position.x }; }
        if (type === 'cc.Sorting2D') { const other = this.node.parent!.getChildByName('SortingBackdrop')!; return { frameBound,
            order: this.node.getComponent(Sorting2D)!.sortingOrder, backdropOrder: other.getComponent(Sorting2D)!.sortingOrder,
            backdropFrameBound: other.getComponent(Sprite)!.spriteFrame === this.fixtureFrame }; }
        if (type === 'cc.ProgressBar') { const c = this.node.getComponent(ProgressBar)!; return { progress: c.progress, totalLength: c.totalLength,
            barWidth: c.barSprite!.node.getComponent(UITransform)!.width, barFrameBound: c.barSprite!.spriteFrame === this.fixtureFrame }; }
        if (type === 'cc.ScrollView' || type === 'cc.ScrollBar') { const c = this.scroll(); const bar = c.verticalScrollBar;
            return { offsetY: c.getScrollOffset().y, maxY: c.getMaxScrollOffset().y, contentY: c.content!.position.y, childCount: this.visuals.length, contentFramesBound: this.visuals.every(node => node.getComponent(Sprite)?.spriteFrame === this.fixtureFrame),
                ...(type === 'cc.ScrollBar' ? { verticalBarBound: bar === this.node.getComponent(ScrollBar),
                    handleFrameBound: bar?.handle?.spriteFrame === this.fixtureFrame, handleY: bar?.handle?.node.position.y } : {}) }; }
        throw new Error('task51_ui_observation_unknown');
    }
}
