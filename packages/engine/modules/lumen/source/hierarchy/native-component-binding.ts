import type { LumenComponentPropertySchema } from '../schema/component-property';
import { LumenPrefabDocument } from './prefab-document';
import { LumenMaskSpriteFrameBinding } from './mask-sprite-frame-binding';
import { LumenEditBoxLabelBinding } from './editbox-label-binding';
import { LumenDeepClone } from './deep-clone';

/**
 * @description 统一受测原生组件载体映射入口，保持文档与属性codec的稳定职责边界。
 */
export class LumenNativeComponentBinding {
    /**
     * @description 为已有动画层次中的新蒙皮组件恢复唯一动画根；合批只从同源、无相对变换的真实子模型取得单元。
     * @param document 当前内存文档。
     * @param componentType 待添加的组件。
     * @param nodeIndex 实际所属节点。
     * @param schema 精确版本契约。
     * @returns 经完整校验的初始原生依赖；不改变文档或公开字段目录。
     */
    public static defaults(document: LumenPrefabDocument, componentType: string, nodeIndex: number,
        schema: LumenComponentPropertySchema): Readonly<Record<string, unknown>> {
        if (!['3.8.3', '3.8.7'].includes(schema.version.toString())
            || !['cc.SkinnedMeshRenderer', 'cc.SkinnedMeshBatchRenderer'].includes(componentType)) return {};
        const entries = document.entries; const roots: number[] = []; const visited = new Set<number>();
        let current: number | null = nodeIndex;
        while (current !== null) {
            if (visited.has(current)) throw new Error('lumen_skinning_parent_cycle'); visited.add(current);
            const node = entries[current];
            if (!node) throw new Error('lumen_skinning_parent_missing');
            const components = Array.isArray(node._components) ? node._components : [];
            if (components.some(ref => {
                const id = this.id(ref); return id !== null && entries[id]?.__type__ === 'cc.SkeletalAnimation';
            })) roots.push(current);
            current = this.id(node._parent);
        }
        if (!roots.length) return {};
        if (roots.length !== 1) throw new Error('lumen_skinning_animation_root_ambiguous');
        const root = roots[0]; if (root === undefined) throw new Error('lumen_skinning_animation_root_missing');
        const binding = { _skinningRoot: { __id__: root } };
        if (componentType !== 'cc.SkinnedMeshBatchRenderer') return binding;
        const sources = entries.filter(entry => entry.__type__ === 'cc.SkinnedMeshRenderer' && this.id(entry._skinningRoot) === root);
        if (!sources.length) return binding;
        const units = sources.map(entry => {
            const mesh = this.asset(entry._mesh); const skeleton = this.asset(entry._skeleton);
            const material = this.asset(Array.isArray(entry._materials) ? entry._materials[0] : null);
            const source = mesh.split('@')[0];
            if (!mesh.includes('@') || skeleton.split('@')[0] !== source || material.split('@')[0] !== source)
                throw new Error('lumen_skinning_batch_source_mismatch');
            this.assertIdentityTransform(document, this.id(entry.node), root);
            const matrix = Object.fromEntries(Array.from({ length: 16 }, (_, index) =>
                ['m' + String(index).padStart(2, '0'), index % 5 === 0 ? 1 : 0]));
            return { __type__: 'cc.SkinnedMeshUnit', mesh: LumenDeepClone.clone(entry._mesh),
                skeleton: LumenDeepClone.clone(entry._skeleton), material: { __uuid__: material, __expectedType__: 'cc.Material' },
                _localTransform: { __type__: 'cc.Mat4', ...matrix }, _offset: { __type__: 'cc.Vec2', x: 0, y: 0 },
                _size: { __type__: 'cc.Vec2', x: 1, y: 1 } };
        });
        return { ...binding, units, _materials: [{ __uuid__: this.asset(units[0]?.material), __expectedType__: 'cc.Material' }] };
    }

    /**
     * @description 只接受实际序列化节点引用，不从错误类型推测节点身份。
     * @param value 未受信引用。
     * @returns 实际下标或无引用。
     */
    private static id(value: unknown): number | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const id: unknown = Reflect.get(value, '__id__');
        return typeof id === 'number' && Number.isSafeInteger(id) && id >= 0 ? id : null;
    }

    /**
     * @description 合批初始单元必须使用已存在的资源引用，不生成资产或猜测子资源ID。
     * @param value 原生序列化资产引用。
     * @returns 实际UUID。
     */
    private static asset(value: unknown): string {
        const uuid: unknown = value && typeof value === 'object' ? Reflect.get(value, '__uuid__') : null;
        if (typeof uuid !== 'string' || !uuid) throw new Error('lumen_skinning_batch_asset_missing');
        return uuid;
    }

    /**
     * @description 无变换的导入模型可直接采用SDK单位矩阵；其他模型明确拒绝自动合批而不猜测矩阵。
     * @param document 当前文档。
     * @param nodeIndex 实际子模型节点。
     * @param root 唯一动画根。
     */
    private static assertIdentityTransform(document: LumenPrefabDocument, nodeIndex: number | null, root: number): void {
        const visited = new Set<number>(); let current = nodeIndex;
        while (current !== root) {
            if (current === null || visited.has(current)) throw new Error('lumen_skinning_batch_root_mismatch'); visited.add(current);
            const node = document.entries[current]; if (!node) throw new Error('lumen_skinning_batch_node_missing');
            const expected = { _lpos: { x: 0, y: 0, z: 0 }, _lrot: { x: 0, y: 0, z: 0, w: 1 }, _lscale: { x: 1, y: 1, z: 1 } };
            for (const [field, coordinates] of Object.entries(expected)) {
                const value = node[field];
                if (!value || typeof value !== 'object' || Object.entries(coordinates).some(([key, number]) => Reflect.get(value, key) !== number))
                    throw new Error('lumen_skinning_batch_relative_transform_unsupported');
            }
            current = this.id(node._parent);
        }
    }

    /**
     * @description 原生角度、约束、粒子和动画的新映射先在独立内存文档校验，失败不改变真实文档或分配内嵌条目。
     * @param document 当前真实文档。
     * @param componentType 实际组件类型。
     * @param schema 精确版本属性表。
     * @param write 原codec写入流程，禁止外部副作用。
     */
    public static validate(document: LumenPrefabDocument, componentType: string, schema: LumenComponentPropertySchema, write: (target: LumenPrefabDocument) => void): void {
        if (!['3.8.3', '3.8.7'].includes(schema.version.toString()) ||
            !['cc.Billboard', 'cc.FixedConstraint', 'cc.HingeConstraint', 'cc.ParticleSystem',
                'cc.animation.AnimationController', 'dragonBones.ArmatureDisplay'].includes(componentType)) { return; }
        write(new LumenPrefabDocument(document.relativePath, LumenDeepClone.clone([...document.entries]), schema));
    }

    /**
     * @description 在任何实际载体赋值前委托组件自己的整补丁校验与所有权检查。
     * @param document 当前文档。
     * @param nodePath 自有节点路径。
     * @param componentType 实际组件类型。
     * @param patch 完整补丁。
     * @param schema 实际版本属性表。
     * @returns 是否已由载体映射处理。
     */
    public static apply(document: LumenPrefabDocument, nodePath: string, componentType: string, patch: Readonly<Record<string, unknown>>, schema: LumenComponentPropertySchema): boolean {
        return LumenMaskSpriteFrameBinding.apply(document, nodePath, componentType, patch, schema) ||
            LumenEditBoxLabelBinding.apply(document, nodePath, componentType, patch, schema);
    }

    /**
     * @description 保留Mask真实Sprite读取，并为EditBox委托其真实Label载体读取。
     * @param componentType 实际类型。
     * @param component 实际条目。
     * @param field 序列化字段。
     * @param version 实际版本。
     * @param resolveEntry 文档引用解析器。
     * @returns 实际载体字段或原字段。
     */
    public static readField(componentType: string, component: Readonly<Record<string, unknown>>, field: string, version: string, resolveEntry?: (index: number) => Record<string, unknown> | null): unknown {
        if (componentType === 'cc.EditBox') {
            return LumenEditBoxLabelBinding.readField(componentType, component, field, version, resolveEntry);
        }
        return LumenMaskSpriteFrameBinding.readField(componentType, component, field, version, resolveEntry);
    }
}
