/**
 * @description 在真实场景进程读取版本固定白名单中的公开字段，不提供写入或代码执行。
 */
export class ComponentNativeFieldReader {
    /**
     * @description 按暂存契约读取指定组件；数组中的嵌套字段保留逐项结果。
     * @param nodeSuffix 省略场景根名的节点路径。
     * @param componentType 已审计组件类型。
     * @returns 实际身份、公开getter及明确读取失败。
     */
    public static read(nodeSuffix: string, componentType: string): unknown {
        const cc = require('cc'); const contract: unknown = require(__dirname + '/public-field-contract.json');
        if (!this.isRecord(contract) || !Array.isArray(contract.components)
            || !/^\/(?:[a-zA-Z0-9_]+\/)*[a-zA-Z0-9_]+$/u.test(nodeSuffix)) throw new Error('component_native_field_contract_invalid');
        const row: unknown = contract.components.find((entry: unknown) => this.isRecord(entry) && entry.componentType === componentType);
        if (!this.isRecord(row) || !Array.isArray(row.cases)) throw new Error('component_native_field_type_unlisted');
        const scene = cc.director.getScene(); if (!scene) throw new Error('component_native_scene_missing');
        const found: Record<string, unknown>[] = [];
        const visit = (value: unknown, prefix: string): void => {
            if (!this.isRecord(value) || typeof value.name !== 'string' || !Array.isArray(value.children))
                throw new Error('component_native_node_shape');
            const path = prefix + '/' + value.name;
            if (path === nodeSuffix) found.push(value);
            for (const child of value.children) visit(child, path);
        };
        for (const child of scene.children) visit(child, '');
        const node = found[0];
        if (found.length !== 1 || !node) return { present: false, reason: 'target-node-missing', nodeSuffix, componentType };
        if (typeof node.getComponents !== 'function') throw new Error('component_native_components_api_missing');
        const list: unknown = Reflect.apply(node.getComponents, node, [cc.Component]);
        if (!Array.isArray(list)) throw new Error('component_native_components_shape');
        const components = list.filter((value: unknown) => cc.js.getClassName(value) === componentType);
        const component: unknown = components[0];
        if (components.length !== 1 || !this.isRecord(component)) return { present: false, reason: 'target-component-missing', nodeSuffix, componentType };
        return { present: true, type: cc.js.getClassName(component), uuid: component.uuid, valid: cc.isValid(component), nodeSuffix,
            fields: row.cases.map((field: unknown) => {
                if (!this.isRecord(field) || typeof field.id !== 'string' || !Array.isArray(field.selector))
                    throw new Error('component_native_field_shape');
                const selectorSource = Array.isArray(field.safeSelector) ? field.safeSelector : field.selector;
                let access = 'native-public-getter';
                let selector = selectorSource.map((key: unknown) => {
                    if (typeof key !== 'string' || !/^[a-zA-Z0-9_]+$/u.test(key)) throw new Error('component_native_selector_invalid');
                    return key;
                });
                const root = selector[0];
                if (root && !(root in component) && Array.isArray(field.nativeSerializedSelector)) {
                    selector = field.nativeSerializedSelector.map((key: unknown) => {
                        if (typeof key !== 'string' || !/^[a-zA-Z0-9_]+$/u.test(key)) throw new Error('component_native_serialized_selector_invalid');
                        return key;
                    });
                    access = 'native-serialized-field';
                }
                try { return { id: field.id, status: 'read', access, selector,
                    value: this.value(this.select(component, selector), field.validValue, 0) }; }
                catch (error) { return { id: field.id, status: 'failed', reason: error instanceof Error ? error.message : String(error) }; }
            }) };
    }

    /**
     * @description 只沿公开字段取值，不枚举对象图或读取私有替代字段。
     * @param value 当前原生对象。
     * @param selector 已审计公开字段路径。
     * @returns 实际getter结果。
     */
    private static select(value: unknown, selector: readonly string[]): unknown {
        if (!selector.length) return value;
        if (Array.isArray(value)) return value.map((item) => this.select(item, selector));
        const key = selector[0];
        if (!this.isRecord(value) || !key || !(key in value)) throw new Error('public-getter-missing:' + selector.join('.'));
        return this.select(value[key], selector.slice(1));
    }

    /**
     * @description 按配方形状转换纯JSON；引用保留真实身份及有效性。
     * @param value 实际原生值。
     * @param recipe 已冻结配方。
     * @param depth 有界递归深度。
     * @returns 有界JSON。
     */
    private static value(value: unknown, recipe: unknown, depth: number): unknown {
        if (depth > 12) throw new Error('component_native_value_depth');
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('component_native_nonfinite'); return value; }
        if (value === undefined) throw new Error('component_native_value_undefined');
        if (!this.isRecord(recipe)) throw new Error('component_native_recipe_shape');
        const cc = require('cc');
        if (this.isRecord(value)) {
            if (value instanceof cc.Node) return { reference: 'node', path: this.nodePath(value), valid: cc.isValid(value) };
            if (value instanceof cc.Component) return { reference: 'component', path: this.nodePath(value.node), type: cc.js.getClassName(value), valid: cc.isValid(value) };
            if (value instanceof cc.Asset) return { reference: 'asset', uuid: value._uuid, type: cc.js.getClassName(value), valid: cc.isValid(value) };
        }
        if (Array.isArray(value)) {
            if (value.length > 128) throw new Error('component_native_value_array_limit');
            const items = Array.isArray(recipe.items) ? recipe.items : [];
            const literals = Array.isArray(recipe.value) ? recipe.value : null;
            return value.map((item, index) => this.value(item, items[index] ?? items[0]
                ?? (literals ? { form: 'literal', value: literals[index] } : recipe), depth + 1));
        }
        let shape: Record<string, unknown>;
        if (recipe.form === 'object' && this.isRecord(recipe.properties)) shape = recipe.properties;
        else if (recipe.form === 'literal' && this.isRecord(recipe.value))
            shape = Object.fromEntries(Object.entries(recipe.value).map(([key, item]) => [key, { form: 'literal', value: item }]));
        else throw new Error('component_native_object_shape_missing');
        if (!this.isRecord(value)) throw new Error('component_native_value_shape');
        return Object.fromEntries(Object.entries(shape).map(([key, item]) => [key, this.value(value[key], item, depth + 1)]));
    }

    /**
     * @description 读取相对当前Scene的实际路径，不依赖资产显示名。
     * @param value 实际节点。
     * @returns 场景根以下路径。
     */
    private static nodePath(value: unknown): string {
        const names: string[] = []; const scene = require('cc').director.getScene(); let depth = 0;
        while (value && value !== scene) {
            if (++depth > 64 || !this.isRecord(value) || typeof value.name !== 'string') throw new Error('component_native_node_shape');
            names.unshift(value.name); value = value.parent;
        }
        return '/' + names.join('/');
    }

    /**
     * @description 在公共文件边界与原生返回值处缩窄对象。
     * @param value 未知数据。
     * @returns 是否为非空非数组对象。
     */
    private static isRecord(value: unknown): value is Record<string, unknown> {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }
}
