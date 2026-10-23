/**
 * @description 仅读取实际蒙皮依赖及已创建模型，独立于字段读回核验同源资源、关节和动画控制器。
 */
export class ComponentNativeSkinnedContext {
    /**
     * @description 在Creator场景进程读取固定三种组件的公开依赖，不创建材质实例或修改场景。
     * @param component 已找到的实际组件。
     * @returns 纯JSON原生依赖；其它类型返回null。
     */
    public static read(component: object): unknown {
        const cc = require('cc'); const type: string = cc.js.getClassName(component);
        if (!['cc.SkeletalAnimation', 'cc.SkinnedMeshRenderer', 'cc.SkinnedMeshBatchRenderer'].includes(type)) return null;
        const node = this.get(component, 'node');
        let renderer: unknown = component;
        if (type === 'cc.SkeletalAnimation') {
            const children = this.call(node, 'getComponentsInChildren', [cc.SkinnedMeshRenderer]);
            const matches = Array.isArray(children) ? children.filter(child => cc.js.getClassName(child) === 'cc.SkinnedMeshRenderer') : [];
            if (matches.length !== 1) throw new Error('component_skinned_native_renderer_not_unique'); renderer = matches[0];
        }
        const root = this.get(renderer, 'skinningRoot');
        let cursor = this.get(renderer, 'node'); const ancestors = new Set<object>(); let rootIsAncestor = false;
        while (cursor && typeof cursor === 'object' && !ancestors.has(cursor)) {
            if (ancestors.size >= 256) throw new Error('component_skinned_native_parent_budget_exceeded');
            if (cursor === root) { rootIsAncestor = true; break; }
            ancestors.add(cursor); cursor = this.get(cursor, 'parent');
        }
        const controller = root ? this.call(root, 'getComponent', [cc.SkeletalAnimation]) : null;
        const skeleton = this.get(renderer, 'skeleton'); const mesh = this.get(renderer, 'mesh');
        const joints = this.get(skeleton, 'joints'); const clips = this.get(controller, 'clips');
        const asset = (value: unknown): unknown => ({ uuid: this.get(value, '_uuid') ?? null,
            type: value ? cc.js.getClassName(value) : null, valid: Boolean(value && cc.isValid(value)) });
        const unitValues = this.get(renderer, 'units');
        const units = Array.isArray(unitValues) ? unitValues.map(unit => ({ mesh: asset(this.get(unit, 'mesh')),
            skeleton: asset(this.get(unit, 'skeleton')), material: asset(this.get(unit, 'material')) })) : [];
        const struct = this.get(mesh, 'struct'); const bundles = this.get(struct, 'vertexBundles');
        const vertexCounts = Array.isArray(bundles) ? bundles.map(bundle => this.get(this.get(bundle, 'view'), 'count')) : [];
        const model = this.get(renderer, 'model');
        return { type, rootPresent: Boolean(root && cc.isValid(root)), rootIsAncestor, controllerPresent: Boolean(controller && cc.isValid(controller)),
            controllerOnAnimationNode: type !== 'cc.SkeletalAnimation' || root === node,
            mesh: asset(mesh), skeleton: asset(skeleton), clips: Array.isArray(clips) ? clips.map(asset) : [],
            joints: Array.isArray(joints) ? joints.map(path => {
                if (typeof path !== 'string' || path.split('/').some(part => ['', '.', '..'].includes(part)))
                    throw new Error('component_skinned_native_joint_path_invalid');
                const joint = root ? this.call(root, 'getChildByPath', [path]) : null;
                return { path, valid: Boolean(joint && cc.isValid(joint)) };
            }) : [], units, vertexCounts, modelPresent: Boolean(model && cc.isValid(model)), modelType: model ? cc.js.getClassName(model) : null };
    }

    /**
     * @description 逐次读回同时要求真实依赖成立，字段值相同不能掩盖空模型或错误来源。
     * @param value 原生只读结果。
     * @param componentType 当前组件。
     * @param sourceUuid 从实际AssetDB网格身份取得的glTF根UUID。
     * @param jointPaths 冻结实际SDK导入骨架的关节路径。
     */
    public static assert(value: unknown, componentType: string, sourceUuid: string, jointPaths: readonly string[]): void {
        const observed = this.record(value);
        if (observed.type !== componentType || observed.rootPresent !== true || observed.rootIsAncestor !== true || observed.controllerPresent !== true
            || observed.controllerOnAnimationNode !== true || observed.modelPresent !== true)
            throw new Error('component_skinned_native_controller_or_model_missing');
        if (!Array.isArray(observed.vertexCounts) || !observed.vertexCounts.length
            || observed.vertexCounts.some(count => typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0))
            throw new Error('component_skinned_native_mesh_empty');
        if (!Array.isArray(observed.joints) || observed.joints.length !== jointPaths.length
            || observed.joints.some((joint, index) => this.record(joint).path !== jointPaths[index] || this.record(joint).valid !== true))
            throw new Error('component_skinned_native_joint_missing');
        const sourceAsset = (asset: unknown, type: string): void => {
            const entry = this.record(asset);
            if (entry.type !== type || entry.valid !== true || typeof entry.uuid !== 'string' || !entry.uuid.startsWith(sourceUuid + '@'))
                throw new Error('component_skinned_native_asset_source_mismatch:' + type);
        };
        if (!Array.isArray(observed.clips) || !observed.clips.length) throw new Error('component_skinned_native_animation_missing');
        observed.clips.forEach(clip => sourceAsset(clip, 'cc.AnimationClip'));
        if (componentType === 'cc.SkinnedMeshBatchRenderer') {
            if (!Array.isArray(observed.units) || !observed.units.length) throw new Error('component_skinned_native_batch_units_missing');
            for (const unit of observed.units) {
                const entry = this.record(unit); sourceAsset(entry.mesh, 'cc.Mesh'); sourceAsset(entry.skeleton, 'cc.Skeleton'); sourceAsset(entry.material, 'cc.Material');
            }
            if (this.record(observed.mesh).type !== 'cc.Mesh' || this.record(observed.mesh).valid !== true
                || this.record(observed.skeleton).type !== 'cc.Skeleton' || this.record(observed.skeleton).valid !== true)
                throw new Error('component_skinned_native_batch_output_missing');
        } else {
            sourceAsset(observed.mesh, 'cc.Mesh'); sourceAsset(observed.skeleton, 'cc.Skeleton');
        }
    }

    /**
     * @description 固定公开属性读取，不沿未知对象枚举状态。
     * @param value 原生对象。
     * @param key 本文件固定属性名。
     * @returns 实际属性或null。
     */
    private static get(value: unknown, key: string): unknown {
        return value && typeof value === 'object' ? Reflect.get(value, key) : null;
    }

    /**
     * @description 仅调用本文件固定的公开只读节点查询方法。
     * @param value 已观测节点。
     * @param key 固定只读方法名。
     * @param args 固定类型或原骨架路径。
     * @returns 原查询结果。
     */
    private static call(value: unknown, key: string, args: readonly unknown[]): unknown {
        const method = this.get(value, key);
        if (typeof method !== 'function') throw new Error('component_skinned_native_query_missing:' + key);
        return Reflect.apply(method, value, args);
    }

    /**
     * @description 原生JSON边界不接受空值或数组，不以类型断言伪造观测。
     * @param value 未受信JSON。
     * @returns 普通记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_skinned_native_record_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
