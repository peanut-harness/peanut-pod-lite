import { _decorator, Component, Node, director, Sprite, SpriteFrame, Texture2D, UITransform, Color, Canvas,
    MeshRenderer, SpriteRenderer, Billboard, Line, CurveRange, Material, EffectAsset, Vec3, utils, primitives,
    Light, DirectionalLight, PointLight, SphereLight, SpotLight, RangedDirectionalLight, Camera } from 'cc';

/**
 * @description 用真实几何、图片与受光材质验证未通过的呈现组件；不触碰已通过字段。
 */
@_decorator.ccclass('Task51VisualBehavior')
export class Task51VisualBehavior extends Component {
    /**
     * @description 冻结类型。
     */
    @_decorator.property
    public componentType = '';
    /**
     * @description 实际图片依赖。
     */
    @_decorator.property(SpriteFrame)
    public fixtureFrame: SpriteFrame | null = null;
    /**
     * @description 场景显式引用的实际EffectAsset，避免依赖名称查找时资源尚未注册。
     */
    @_decorator.property(EffectAsset)
    public fixtureEffect: EffectAsset | null = null;
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
     * @description 唯一控制面板。
     */
    private panel: HTMLElement | null = null;
    /**
     * @description 公开运行输出。
     */
    private output: HTMLElement | null = null;
    /**
     * @description 灯光用例的实际受光物体。
     */
    private litRenderer: MeshRenderer | null = null;
    /**
     * @description 实际标准材质。
     */
    private litMaterial: Material | null = null;
    /**
     * @description Canvas用例中的实际图片。
     */
    private canvasSprite: Sprite | null = null;
    /**
     * @description 三维精灵明确绑定的真实纹理材质。
     */
    private spriteMaterial: Material | null = null;
    /**
     * @description 页面退出清理。
     */
    private readonly pageHide = (): void => this.onDestroy();
    /**
     * @description 初始化组件依赖与控制面板。
     */
    protected start(): void {
        if (!this.node.getComponent(this.componentType)) throw new Error('task51_visual_component_missing');
        this.prepare(); const host = window.parent.document;
        if (host.getElementById('task51-behavior-observation')) throw new Error('task51_visual_duplicate_panel');
        this.panel = host.createElement('section'); this.panel.id = 'task51-behavior-observation';
        this.panel.style.cssText = 'position:fixed;left:10px;top:70px;width:300px;overflow:hidden;z-index:10000;background:#fff;color:#111;padding:12px;font:12px monospace';
        for (const phase of ['baseline', 'effect']) { const button = host.createElement('button'); button.textContent = 'Task51 ' + phase;
            button.onclick = () => this.apply(phase); this.panel.appendChild(button); }
        this.output = host.createElement('pre'); this.output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
        this.panel.appendChild(this.output); host.body.appendChild(this.panel); this.apply('baseline');
        window.addEventListener('pagehide', this.pageHide, { once: true });
    }
    /**
     * @description 只在16个实际引擎更新后公开结果，不自动通过。
     */
    protected update(): void {
        this.frames++; if (this.frames - this.requestedFrame < 16 || !this.output) return;
        this.output.textContent = JSON.stringify({ schemaVersion: 1, protocolVersion: 2, componentType: this.componentType,
            sceneName: director.getScene()?.name ?? '', phase: this.phase, ready: true, accepted: false,
            requestedFrame: this.requestedFrame, observedFrame: this.frames, engineFramesElapsed: this.frames - this.requestedFrame, state: this.state() });
    }
    /**
     * @description 释放本实例面板，不改动其它页面或安装SDK。
     */
    protected onDestroy(): void {
        window.removeEventListener('pagehide', this.pageHide); this.panel?.remove(); this.panel = null; this.output = null;
    }
    /**
     * @description 配置有区分力的真实公开依赖。
     */
    private prepare(): void {
        const type = this.componentType;
        if (this.isLight()) { this.prepareLight(); return; }
        if (type === 'cc.MeshRenderer') return;
        if (!this.fixtureFrame) throw new Error('task51_visual_frame_missing');
        if (type === 'cc.Canvas') {
            for (const child of this.node.children) if (!child.getComponent(Camera)) child.active = false;
            const image = new Node('ActualCanvasImage'); image.layer = this.node.layer; this.node.addChild(image);
            image.addComponent(UITransform).setContentSize(360, 200); this.canvasSprite = image.addComponent(Sprite);
            this.canvasSprite.spriteFrame = this.fixtureFrame; this.canvasSprite.sizeMode = Sprite.SizeMode.CUSTOM;
            this.canvasSprite.color = new Color(40, 180, 255); image.getComponent(UITransform)!.setContentSize(360, 200);
        } else if (type === 'cc.SpriteRenderer') {
            const sprite = this.node.getComponent(SpriteRenderer)!; sprite.spriteFrame = this.fixtureFrame;
            if (!this.fixtureEffect) throw new Error('task51_sprite_effect_missing');
            this.spriteMaterial = new Material(); this.spriteMaterial.initialize({ effectAsset: this.fixtureEffect, defines: { USE_TEXTURE: true } });
            if (this.spriteMaterial.passes.length === 0) throw new Error('task51_sprite_passes_missing');
            this.spriteMaterial.setProperty('mainTexture', this.fixtureFrame.texture); sprite.setMaterial(this.spriteMaterial, 0);
            this.fixtureFrame.ensureMeshData(); const bounds = this.fixtureFrame.mesh!.struct;
            if (!bounds.minPosition || !bounds.maxPosition) throw new Error('task51_sprite_bounds_missing');
            const width = bounds.maxPosition.x - bounds.minPosition.x; const height = bounds.maxPosition.y - bounds.minPosition.y;
            if (!(width > 0 && height > 0)) throw new Error('task51_sprite_bounds_invalid'); this.node.setScale(4 / width, 4 / height, 1);
        } else if (type === 'cc.Billboard') {
            const billboard = this.node.getComponent(Billboard)!;
            if (!(this.fixtureFrame.texture instanceof Texture2D)) throw new Error('task51_billboard_texture_invalid');
            billboard.texture = this.fixtureFrame.texture; billboard.width = 4; billboard.height = 4; billboard.rotation = 0;
        } else if (type === 'cc.Line') {
            const line = this.node.getComponent(Line)!; line.worldSpace = true;
            const width = new CurveRange(); width.mode = CurveRange.Mode.Constant; width.constant = 0.3; line.width = width;
            line.positions = [new Vec3(-2, -1, 0), new Vec3(0, 1, 0), new Vec3(2, -1, 0)];
        } else throw new Error('task51_visual_case_unknown');
    }
    /**
     * @description 建立真正受光的标准材质球体，关闭其它光和环境照明以区分当前灯的效果。
     */
    private prepareLight(): void {
        const scene = director.getScene()!; const light = this.node.getComponent(Light)!;
        for (const other of scene.getComponentsInChildren(Light)) if (other !== light) other.enabled = false;
        for (const renderer of scene.getComponentsInChildren(MeshRenderer)) renderer.enabled = false;
        scene.globals.skybox.enabled = false; scene.globals.ambient.skyIllum = 0;
        scene.globals.ambient.skyLightingColor = Color.BLACK; scene.globals.ambient.groundLightingColor = Color.BLACK;
        const model = new Node('ActualLitSphere'); scene.addChild(model); this.litRenderer = model.addComponent(MeshRenderer);
        this.litRenderer.mesh = utils.createMesh(primitives.sphere(1.5, { segments: 32 }));
        if (!this.fixtureEffect) throw new Error('task51_light_effect_missing');
        this.litMaterial = new Material(); this.litMaterial.initialize({ effectAsset: this.fixtureEffect });
        if (this.litMaterial.passes.length === 0) throw new Error('task51_light_passes_missing');
        this.litMaterial.setProperty('mainColor', new Color(255, 120, 60)); this.litMaterial.setProperty('metallic', 0);
        this.litMaterial.setProperty('roughness', 0.5); this.litRenderer.setMaterial(this.litMaterial, 0);
        this.node.setPosition(0, 0, 4); this.node.lookAt(Vec3.ZERO); light.color = new Color(255, 240, 220);
        if (light instanceof DirectionalLight || light instanceof RangedDirectionalLight) light.illuminance = 65000;
        else if (light instanceof PointLight || light instanceof SphereLight || light instanceof SpotLight) { light.luminance = 50000; light.range = 20; }
        else throw new Error('task51_light_type_unknown');
        if (light instanceof RangedDirectionalLight) this.node.setScale(20, 20, 20);
    }
    /**
     * @description 使用公开生命周期执行呈现对照。
     * @param phase 基线或效果。
     */
    private apply(phase: string): void {
        this.phase = phase; this.node.getComponent(this.componentType)!.enabled = phase === 'effect';
        if (this.componentType === 'cc.RangedDirectionalLight' && phase === 'effect') {
            // The render light updates transforms only while attached; reassert public transforms after the disabled baseline.
            this.node.setPosition(this.node.position); this.node.setRotation(this.node.rotation); this.node.setScale(this.node.scale);
        }
        this.requestedFrame = this.frames; if (this.output) this.output.textContent = JSON.stringify({ phase, ready: false });
    }
    /**
     * @description 读取真实组件和实际依赖。
     * @returns 实际观测，不是字段矩阵重跑。
     */
    private state(): Record<string, unknown> {
        const type = this.componentType; const enabled = this.node.getComponent(type)!.enabled;
        if (this.isLight()) return { enabled, geometryBound: !!this.litRenderer?.mesh?.renderingSubMeshes.length,
            materialBound: this.litRenderer?.getRenderMaterial(0)?.effectAsset === this.litMaterial?.effectAsset,
            standardEffect: this.litMaterial?.effectAsset?.name === 'builtin-standard', sphereEnabled: this.litRenderer?.enabled === true,
            effectBound: this.litMaterial?.effectAsset === this.fixtureEffect, passesReady: !!this.litMaterial?.passes.length,
            ambientIllum: director.getScene()!.globals.ambient.skyIllum,
            ...(type === 'cc.RangedDirectionalLight' ? { renderTransformReady: !enabled || this.rangedTransformReady() } : {}) };
        if (type === 'cc.MeshRenderer') { const renderer = this.node.getComponent(MeshRenderer)!;
            return { enabled, geometryBound: !!renderer.mesh?.renderingSubMeshes.length, materialBound: renderer.getRenderMaterial(0) !== null }; }
        if (type === 'cc.Canvas') return { enabled, frameBound: this.canvasSprite?.spriteFrame === this.fixtureFrame,
            cameraBound: this.node.getComponent(Canvas)!.cameraComponent !== null };
        if (type === 'cc.SpriteRenderer') return { enabled, frameBound: this.node.getComponent(SpriteRenderer)!.spriteFrame === this.fixtureFrame,
            geometryBound: !!this.fixtureFrame?.mesh?.renderingSubMeshes.length,
            materialBound: this.node.getComponent(SpriteRenderer)!.getRenderMaterial(0)?.effectAsset === this.fixtureEffect,
            textureBound: this.spriteMaterial?.getProperty('mainTexture') === this.fixtureFrame?.texture, passesReady: !!this.spriteMaterial?.passes.length };
        if (type === 'cc.Billboard') { const c = this.node.getComponent(Billboard)!; return { enabled,
            textureBound: c.texture === this.fixtureFrame?.texture, width: c.width, height: c.height }; }
        const line = this.node.getComponent(Line)!; return { enabled, positions: line.positions.map(p => [p.x, p.y, p.z]),
            lineWidth: line.width.constant, materialBound: line.getRenderMaterial(0) !== null };
    }
    /**
     * @description 核对真正参与渲染的范围灯位置及范围，禁止仅用节点字段替代。
     * @returns 渲染灯与节点公开变换是否一致。
     */
    private rangedTransformReady(): boolean {
        const lights = director.getScene()!.renderScene!.rangedDirLights.filter(light => light.node === this.node);
        if (lights.length !== 1) return false;
        const light = lights[0]!;
        return Vec3.equals(light.position, this.node.worldPosition) && Vec3.equals(light.scale, this.node.worldScale)
            && Vec3.equals(light.scale, new Vec3(20, 20, 20));
    }
    /**
     * @description 固定范围内的灯光类型。
     * @returns 是否灯光用例。
     */
    private isLight(): boolean {
        return ['cc.DirectionalLight', 'cc.PointLight', 'cc.SphereLight', 'cc.SpotLight', 'cc.RangedDirectionalLight'].includes(this.componentType);
    }
}
