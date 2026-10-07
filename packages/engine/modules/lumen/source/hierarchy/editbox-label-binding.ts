import type { LumenComponentPropertySchema } from '../schema/component-property';
import { LumenNodeConventions } from '../schema/node-conventions';
import type { LumenPrefabDocument } from './prefab-document';

/**
 * @description 受测EditBox样式映射到真实自有Label与Sprite，保留完整公开字段且不写无效影子样式。
 */
export class LumenEditBoxLabelBinding {
    /**
     * @description 公开EditBox字段对应的真实Label载体字段。
     */
    private static readonly _fields = [
        { source: '_placeholder', owner: '_placeholderLabel', target: '_string' },
        { source: '_fontSize', owner: '_textLabel', target: '_fontSize' },
        { source: '_lineHeight', owner: '_textLabel', target: '_lineHeight' },
        { source: '_fontColor', owner: '_textLabel', target: '_color' },
        { source: '_placeholderFontSize', owner: '_placeholderLabel', target: '_fontSize' },
        { source: '_placeholderFontColor', owner: '_placeholderLabel', target: '_color' },
    ] as const;

    /**
     * @description 全补丁与现有载体先校验，再沿原节点组件工厂创建缺失载体并赋值。
     * @param document 当前内存文档。
     * @param nodePath 自有EditBox节点。
     * @param componentType 实际组件类型。
     * @param patch 完整公开补丁。
     * @param schema 真实版本属性表。
     * @returns 是否由此映射处理。
     */
    public static apply(
        document: LumenPrefabDocument,
        nodePath: string,
        componentType: string,
        patch: Readonly<Record<string, unknown>>,
        schema: LumenComponentPropertySchema,
    ): boolean {
        if (!this._supported(componentType, schema.version.toString())) {
            return false;
        }
        const nodeIndex = document.findNodeIndex(nodePath);
        const edit = document.entries[document.findComponentIndex(nodeIndex, componentType)];
        if (edit == null) {
            throw new Error('lumen_editbox_carrier_owner_missing');
        }
        const encoded = schema.encodeComponentPatch(componentType, patch, edit);
        if (!this._fields.some(field => Object.prototype.hasOwnProperty.call(encoded, field.source)) &&
            !Object.prototype.hasOwnProperty.call(encoded, '_backgroundImage')) {
            return false;
        }
        const resolve = (index: number): Record<string, unknown> | null => document.entries[index] ?? null;
        this._owner(edit, resolve);
        const labels = this._labels(edit, resolve);
        let sprite = this._component(nodeIndex, 'cc.Sprite', resolve);
        for (const owner of ['_textLabel', '_placeholderLabel'] as const) {
            const needed = this._fields.some(field => field.owner === owner && Object.prototype.hasOwnProperty.call(encoded, field.source));
            const child = this._child(nodeIndex, owner === '_textLabel' ? 'TEXT_LABEL' : 'PLACEHOLDER_LABEL', resolve);
            if (needed && labels[owner] == null && child != null) {
                this._assertCanAttach(child, 'cc.Label', resolve);
            }
        }
        if (Object.prototype.hasOwnProperty.call(encoded, '_backgroundImage') && sprite == null && encoded._backgroundImage != null) {
            this._assertCanAttach(nodeIndex, 'cc.Sprite', resolve);
        }
        for (const owner of ['_textLabel', '_placeholderLabel'] as const) {
            const needed = this._fields.some(field => field.owner === owner && Object.prototype.hasOwnProperty.call(encoded, field.source));
            if (!needed || labels[owner] != null) {
                continue;
            }
            const name = owner === '_textLabel' ? 'TEXT_LABEL' : 'PLACEHOLDER_LABEL';
            const child = this._child(nodeIndex, name, resolve);
            if (child == null) {
                document.addChildFromSpec(nodePath, { name, components: ['cc.UITransform', 'cc.Label'] });
            } else {
                document.attachBuiltinComponent(nodePath + '/' + name, 'cc.Label');
            }
            const index = document.findComponentIndex(document.findNodeIndex(nodePath + '/' + name), 'cc.Label');
            labels[owner] = document.entries[index] ?? null;
            if (labels[owner] == null) {
                throw new Error('lumen_editbox_carrier_owner_allocation_missing');
            }
        }
        if (Object.prototype.hasOwnProperty.call(encoded, '_backgroundImage') && sprite == null && encoded._backgroundImage != null) {
            document.attachBuiltinComponent(nodePath, 'cc.Sprite');
            sprite = this._component(nodeIndex, 'cc.Sprite', resolve);
        }
        const ownFields = { ...encoded };
        for (const field of this._fields) {
            if (Object.prototype.hasOwnProperty.call(encoded, field.source)) {
                const label = labels[field.owner];
                if (label == null) {
                    throw new Error('lumen_editbox_carrier_owner_allocation_missing');
                }
                label[field.target] = encoded[field.source];
            }
            delete ownFields[field.source];
            delete edit[field.source];
        }
        for (const owner of ['_textLabel', '_placeholderLabel'] as const) {
            const label = labels[owner];
            if (label != null) {
                const index = document.entries.indexOf(label);
                if (index < 0) {
                    throw new Error('lumen_editbox_carrier_owner_allocation_missing');
                }
                edit[owner] = { __id__: index };
            }
        }
        if (sprite != null && Object.prototype.hasOwnProperty.call(encoded, '_backgroundImage')) {
            sprite._spriteFrame = encoded._backgroundImage;
        }
        Object.assign(edit, ownFields);
        return true;
    }

    /**
     * @description 检视读取真实原生Label载体，纯codec无文档或未受测版本保持原行为。
     * @param componentType 实际类型。
     * @param component EditBox条目。
     * @param field 公开目录对应的序列化字段。
     * @param version 真实属性表版本。
     * @param resolveEntry 文档引用解析器。
     * @returns 真实载体字段或原字段。
     */
    public static readField(
        componentType: string,
        component: Readonly<Record<string, unknown>>,
        field: string,
        version: string,
        resolveEntry?: (index: number) => Record<string, unknown> | null,
    ): unknown {
        const mapping = this._fields.find(value => value.source === field);
        if (!this._supported(componentType, version) || resolveEntry == null || mapping == null) {
            return component[field];
        }
        this._owner(component, resolveEntry);
        const labels = this._labels(component, resolveEntry);
        return labels[mapping.owner]?.[mapping.target] ?? null;
    }

    /**
     * @description 仅启用已获得真实原生反例的两个版本。
     * @param type 组件类型。
     * @param version 真实版本。
     * @returns 是否受测。
     */
    private static _supported(type: string, version: string): boolean {
        return type === 'cc.EditBox' && ['3.8.3', '3.8.7'].includes(version);
    }

    /**
     * @description 校验EditBox在节点组件列表中的真实归属。
     * @param edit 实际条目。
     * @param resolve 引用解析器。
     * @returns 自有节点索引。
     */
    private static _owner(edit: Readonly<Record<string, unknown>>, resolve: (index: number) => Record<string, unknown> | null): number {
        const index = this._index(edit.node), node = index == null ? null : resolve(index);
        if (index == null || node?.__type__ !== 'cc.Node' || !Array.isArray(node._components) ||
            !node._components.some(ref => { const id = this._index(ref); return id != null && resolve(id) === edit; })) {
            throw new Error('lumen_editbox_carrier_owner_node_invalid');
        }
        return index;
    }

    /**
     * @description 同时校验两个Label并拒绝共享同一载体的冲突。
     * @param edit 实际EditBox条目。
     * @param resolve 引用解析器。
     * @returns 受检Label集合。
     */
    private static _labels(edit: Readonly<Record<string, unknown>>, resolve: (index: number) => Record<string, unknown> | null): Record<'_textLabel' | '_placeholderLabel', Record<string, unknown> | null> {
        const text = this._label(edit, '_textLabel', 'TEXT_LABEL', resolve);
        const hint = this._label(edit, '_placeholderLabel', 'PLACEHOLDER_LABEL', resolve);
        if (text != null && text === hint) {
            throw new Error('lumen_editbox_carrier_owner_alias');
        }
        return { _textLabel: text, _placeholderLabel: hint };
    }

    /**
     * @description 只接受明确引用或原生约定名称下的唯一直属自有Label。
     * @param edit 当前EditBox。
     * @param field 原生载体引用字段。
     * @param name 原生自动创建时的节点名。
     * @param resolve 引用解析器。
     * @returns 实际Label或缺失。
     */
    private static _label(edit: Readonly<Record<string, unknown>>, field: string, name: string, resolve: (index: number) => Record<string, unknown> | null): Record<string, unknown> | null {
        const owner = this._owner(edit, resolve);
        if (edit[field] == null) {
            const child = this._child(owner, name, resolve);
            return child == null ? null : this._component(child, 'cc.Label', resolve);
        }
        const id = this._index(edit[field]), label = id == null ? null : resolve(id);
        const child = label == null ? null : this._index(label.node), node = child == null ? null : resolve(child), parent = resolve(owner);
        if (label?.__type__ !== 'cc.Label' || child == null || node?.__type__ !== 'cc.Node' ||
            this._index(node._parent) !== owner || !Array.isArray(parent?._children) ||
            !parent._children.some(ref => this._index(ref) === child) || this._component(child, 'cc.Label', resolve) !== label) {
            throw new Error('lumen_editbox_carrier_owner_foreign');
        }
        return label;
    }

    /**
     * @description 按原生名称选择唯一直接子节点，拒绝断链或重复名称。
     * @param owner 父节点索引。
     * @param name 实际名称。
     * @param resolve 引用解析器。
     * @returns 唯一子节点或缺失。
     */
    private static _child(owner: number, name: string, resolve: (index: number) => Record<string, unknown> | null): number | null {
        const parent = resolve(owner);
        if (!Array.isArray(parent?._children)) {
            throw new Error('lumen_editbox_carrier_owner_children_invalid');
        }
        let found: number | null = null;
        for (const ref of parent._children) {
            const id = this._index(ref), node = id == null ? null : resolve(id);
            if (node?._name !== name) {
                continue;
            }
            if (id == null || node.__type__ !== 'cc.Node' || this._index(node._parent) !== owner || found != null) {
                throw new Error('lumen_editbox_carrier_owner_ambiguous');
            }
            found = id;
        }
        return found;
    }

    /**
     * @description 选择组件列表中唯一且node引用一致的组件。
     * @param owner 节点索引。
     * @param type 组件类型。
     * @param resolve 引用解析器。
     * @returns 唯一自有组件或缺失。
     */
    private static _component(owner: number, type: string, resolve: (index: number) => Record<string, unknown> | null): Record<string, unknown> | null {
        const node = resolve(owner);
        if (node?.__type__ !== 'cc.Node' || !Array.isArray(node._components)) {
            throw new Error('lumen_editbox_carrier_owner_node_invalid');
        }
        let found: Record<string, unknown> | null = null;
        for (const ref of node._components) {
            const id = this._index(ref), component = id == null ? null : resolve(id);
            if (component?.__type__ !== type) {
                continue;
            }
            if (this._index(component.node) !== owner || found != null) {
                throw new Error('lumen_editbox_carrier_owner_ambiguous');
            }
            found = component;
        }
        return found;
    }

    /**
     * @description 预检原挂载流程的渲染互斥，禁止较晚载体失败后留下较早分配。
     * @param owner 已有节点。
     * @param type 拟挂载组件。
     * @param resolve 引用解析器。
     * @returns 无返回值。
     */
    private static _assertCanAttach(owner: number, type: string, resolve: (index: number) => Record<string, unknown> | null): void {
        const node = resolve(owner);
        if (!Array.isArray(node?._components)) {
            throw new Error('lumen_editbox_carrier_owner_node_invalid');
        }
        const types = node._components.map(ref => { const id = this._index(ref); return id == null ? null : resolve(id)?.__type__; }).filter((value): value is string => typeof value === 'string');
        LumenNodeConventions.assertRendererCompatible(type, types);
    }

    /**
     * @description 严格读取非负整数文档引用。
     * @param value 原始引用。
     * @returns 合法索引或null。
     */
    private static _index(value: unknown): number | null {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }
        const index = (value as Readonly<Record<string, unknown>>).__id__;
        return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : null;
    }
}
