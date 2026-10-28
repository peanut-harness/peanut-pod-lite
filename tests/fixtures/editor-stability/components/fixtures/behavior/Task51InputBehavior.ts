import { _decorator, Component, Node, director, Sprite, SpriteFrame, UITransform, Color,
    Button, Toggle, ToggleContainer, Slider, BlockInputEvents } from 'cc';

/**
 * @description 原生指针输入驱动的独立组件夹具；面板只重置与布防，不模拟引擎输入。
 */
@_decorator.ccclass('Task51InputBehavior')
export class Task51InputBehavior extends Component {
    /**
     * @description 冻结的被测类型。
     */
    @_decorator.property
    public componentType = '';
    /**
     * @description 已导入的真实图片依赖。
     */
    @_decorator.property(SpriteFrame)
    public fixtureFrame: SpriteFrame | null = null;
    /**
     * @description 真实引擎更新次数。
     */
    private frames = 0;
    /**
     * @description 当前观测起点。
     */
    private requestedFrame = 0;
    /**
     * @description 观测阶段。
     */
    private phase = 'baseline';
    /**
     * @description 当前原生触摸结束事件数。
     */
    private nativeEvents = 0;
    /**
     * @description 组件回调数或父级冒泡数。
     */
    private callbacks = 0;
    /**
     * @description 当前可见面板。
     */
    private panel: HTMLElement | null = null;
    /**
     * @description 公开观测文本。
     */
    private output: HTMLElement | null = null;
    /**
     * @description 两个真实单选项。
     */
    private toggles: Toggle[] = [];
    /**
     * @description 真实滑块。
     */
    private handle: Sprite | null = null;
    /**
     * @description 页面退出释放函数。
     */
    private readonly pageHide = (): void => this.onDestroy();
    /**
     * @description 记录真实SDK触摸结束，不由面板调用。
     */
    private readonly inputEnded = (): void => { this.nativeEvents++; this.changed(); };
    /**
     * @description 记录真实SDK组件回调。
     */
    private readonly componentChanged = (): void => {
        this.callbacks++;
        if (this.componentType === 'cc.Button') this.node.getComponent(Sprite)!.color = new Color(255, 60, 40);
        this.changed();
    };
    /**
     * @description 记录遮挡层的父级冒泡；被阻断时不会调用。
     */
    private readonly parentEnded = (): void => {
        this.callbacks++; this.node.getComponent(Sprite)!.color = new Color(255, 60, 40); this.changed();
    };
    /**
     * @description 建立真实依赖和仅供布防的面板。
     */
    protected start(): void {
        if (!this.node.getComponent(this.componentType) || !this.fixtureFrame) throw new Error('task51_input_dependency_missing');
        this.configure(this.node.getComponent(Sprite)!, 420, 180, new Color(30, 130, 255));
        this.node.on(Node.EventType.TOUCH_END, this.inputEnded, this);
        if (this.componentType === 'cc.Button') {
            const button = this.node.getComponent(Button)!; button.transition = Button.Transition.NONE;
            button.interactable = true; this.node.on(Button.EventType.CLICK, this.componentChanged, this);
        } else if (this.componentType === 'cc.Toggle') {
            const toggle = this.node.getComponent(Toggle)!; toggle.transition = Button.Transition.NONE;
            toggle.checkMark = this.sprite(this.node, 'ActualCheckmark', 220, 120, new Color(40, 255, 80));
            this.node.on(Toggle.EventType.TOGGLE, this.componentChanged, this);
        } else if (this.componentType === 'cc.ToggleContainer') {
            this.node.getComponent(ToggleContainer)!.allowSwitchOff = false;
            this.toggles = [-140, 140].map((x, i) => {
                const background = this.sprite(this.node, 'Option' + i, 200, 120, new Color(30, 130, 255));
                background.node.setPosition(x, 0, 0); const toggle = background.node.addComponent(Toggle);
                toggle.transition = Button.Transition.NONE; toggle.checkMark = this.sprite(background.node, 'Check' + i, 160, 80, new Color(40, 255, 80));
                background.node.on(Toggle.EventType.TOGGLE, this.componentChanged, this);
                background.node.on(Node.EventType.TOUCH_END, this.inputEnded, this); return toggle;
            });
        } else if (this.componentType === 'cc.Slider') {
            const slider = this.node.getComponent(Slider)!; this.node.getComponent(UITransform)!.setContentSize(480, 80);
            this.handle = this.sprite(this.node, 'ActualHandle', 56, 140, new Color(255, 220, 40));
            slider.direction = Slider.Direction.Horizontal; slider.handle = this.handle;
            this.node.on('slide', this.componentChanged, this);
        } else if (this.componentType === 'cc.BlockInputEvents') this.node.parent!.on(Node.EventType.TOUCH_END, this.parentEnded, this);
        else throw new Error('task51_input_case_unknown');
        const host = window.parent.document;
        if (host.getElementById('task51-behavior-observation')) throw new Error('task51_input_duplicate_panel');
        this.panel = host.createElement('section'); this.panel.id = 'task51-behavior-observation';
        this.panel.style.cssText = 'position:fixed;left:10px;top:70px;width:300px;overflow:hidden;z-index:10000;background:#fff;color:#111;padding:12px;font:12px monospace';
        for (const phase of ['baseline', 'effect']) {
            const button = host.createElement('button'); button.textContent = 'Task51 ' + phase;
            button.onclick = () => this.reset(phase); this.panel.appendChild(button);
        }
        this.output = host.createElement('pre'); this.output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
        this.panel.appendChild(this.output); host.body.appendChild(this.panel); this.reset('baseline');
        window.addEventListener('pagehide', this.pageHide, { once: true });
    }
    /**
     * @description 用实际引擎帧等待输入与组件状态稳定。
     */
    protected update(): void {
        this.frames++;
        if (this.frames - this.requestedFrame < 16 || !this.output) return;
        this.output.textContent = JSON.stringify({ schemaVersion: 1, protocolVersion: 2, componentType: this.componentType,
            sceneName: director.getScene()?.name ?? '', phase: this.phase, ready: true, accepted: false,
            requestedFrame: this.requestedFrame, observedFrame: this.frames, engineFramesElapsed: this.frames - this.requestedFrame,
            state: this.state() });
    }
    /**
     * @description 释放本实例注册的事件和面板。
     */
    protected onDestroy(): void {
        window.removeEventListener('pagehide', this.pageHide); this.node.off(Node.EventType.TOUCH_END, this.inputEnded, this);
        this.node.off(Button.EventType.CLICK, this.componentChanged, this); this.node.off(Toggle.EventType.TOGGLE, this.componentChanged, this);
        this.node.off('slide', this.componentChanged, this); this.node.parent?.off(Node.EventType.TOUCH_END, this.parentEnded, this);
        for (const toggle of this.toggles) {
            toggle.node.off(Toggle.EventType.TOGGLE, this.componentChanged, this);
            toggle.node.off(Node.EventType.TOUCH_END, this.inputEnded, this);
        }
        this.panel?.remove(); this.panel = null; this.output = null;
    }
    /**
     * @description 重置公开组件状态；不调用任何触摸或点击处理器。
     * @param phase 基线或布防阶段。
     */
    private reset(phase: string): void {
        this.phase = phase; this.node.getComponent(Sprite)!.color = new Color(30, 130, 255);
        if (this.componentType === 'cc.Toggle') this.node.getComponent(Toggle)!.isChecked = false;
        if (this.componentType === 'cc.ToggleContainer') {
            this.toggles[0]!.isChecked = true; this.toggles[1]!.isChecked = false;
        }
        if (this.componentType === 'cc.Slider') this.node.getComponent(Slider)!.progress = 0.25;
        if (this.componentType === 'cc.BlockInputEvents') this.node.getComponent(BlockInputEvents)!.enabled = phase === 'effect';
        this.nativeEvents = 0; this.callbacks = 0; this.changed();
    }
    /**
     * @description 每个真实事件后重新计帧。
     */
    private changed(): void {
        this.requestedFrame = this.frames;
        if (this.output) this.output.textContent = JSON.stringify({ phase: this.phase, ready: false });
    }
    /**
     * @description 读取公开SDK结果与真实回调次数。
     * @returns 当前组件实际状态。
     */
    private state(): Record<string, unknown> {
        const state: Record<string, unknown> = { nativeEvents: this.nativeEvents, callbacks: this.callbacks,
            frameBound: this.node.getComponent(Sprite)!.spriteFrame === this.fixtureFrame };
        if (this.componentType === 'cc.Toggle') {
            const toggle = this.node.getComponent(Toggle)!; state.checked = toggle.isChecked;
            state.checkmarkActive = toggle.checkMark!.node.active; state.checkmarkBound = toggle.checkMark!.spriteFrame === this.fixtureFrame;
        }
        if (this.componentType === 'cc.ToggleContainer') state.checked = this.toggles.map(t => t.isChecked);
        if (this.componentType === 'cc.Slider') { state.progress = this.node.getComponent(Slider)!.progress;
            state.handleX = this.handle!.node.position.x; state.handleBound = this.handle!.spriteFrame === this.fixtureFrame; }
        if (this.componentType === 'cc.BlockInputEvents') state.blockEnabled = this.node.getComponent(BlockInputEvents)!.enabled;
        return state;
    }
    /**
     * @description 创建实际图片节点。
     * @param parent 父节点。
     * @param name 节点名。
     * @param width 宽。
     * @param height 高。
     * @param color 色。
     * @returns 已配置的实际Sprite。
     */
    private sprite(parent: Node, name: string, width: number, height: number, color: Color): Sprite {
        const node = new Node(name); parent.addChild(node); node.addComponent(UITransform);
        const sprite = node.addComponent(Sprite); this.configure(sprite, width, height, color); return sprite;
    }
    /**
     * @description 使用真实帧和公开大小模式配置图片。
     * @param sprite 目标。
     * @param width 宽。
     * @param height 高。
     * @param color 色。
     */
    private configure(sprite: Sprite, width: number, height: number, color: Color): void {
        sprite.spriteFrame = this.fixtureFrame; sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.color = color;
        sprite.node.getComponent(UITransform)!.setContentSize(width, height);
    }
}
