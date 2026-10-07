import { LumenDeepClone } from './deep-clone';
import { LumenPrefabDocument } from './prefab-document';
import type { LumenComponentPropertySchema } from '../schema/component-property';

/**
 * @description 受测Button初始COLOR状态由自有Sprite持久化；原属性codec和点击事件流程完整执行。
 */
export class LumenButtonColorBinding {
    /**
     * @description 在独立内存文档先执行原完整补丁与所有权检查，通过后才在原文档执行同一流程。
     * @param document 当前文档。
     * @param nodePath Button节点路径。
     * @param componentType 实际类型。
     * @param schema 受信版本属性表。
     * @param write 原属性codec及EventHandler创建和清理流程，不执行外部操作。
     * @returns 是否由受测Button流程处理。
     */
    public static apply(
        document: LumenPrefabDocument,
        nodePath: string,
        componentType: string,
        schema: LumenComponentPropertySchema,
        write: (target: LumenPrefabDocument) => void,
    ): boolean {
        if (componentType !== 'cc.Button' || !['3.8.3', '3.8.7'].includes(schema.version.toString())) {
            return false;
        }
        const staged = new LumenPrefabDocument(document.relativePath, LumenDeepClone.clone([...document.entries]), schema);
        write(staged);
        this._synchronize(staged, nodePath);
        write(document);
        this._synchronize(document, nodePath);
        return true;
    }

    /**
     * @description COLOR只更新原生实际目标的唯一自有Sprite，不为其它transition强制状态或生命周期。
     * @param document 已通过原codec的内存文档。
     * @param nodePath 实际Button路径。
     */
    private static _synchronize(document: LumenPrefabDocument, nodePath: string): void {
        const owner = document.findNodeIndex(nodePath);
        const button = document.entries[document.findComponentIndex(owner, 'cc.Button')];
        if (button?._transition !== 1) {
            return;
        }
        const node = document.entries[owner];
        if (this._index(button.node) !== owner || !Array.isArray(node?._components) ||
            node._components.filter(ref => { const id = this._index(ref); return id != null && document.entries[id] === button; }).length !== 1) {
            throw new Error('lumen_button_color_owner_button_invalid');
        }
        const target = button._target == null ? owner : this._index(button._target);
        const targetNode = target == null ? null : document.entries[target];
        if (target == null || targetNode?.__type__ !== 'cc.Node' || !Array.isArray(targetNode._components)) {
            throw new Error('lumen_button_color_owner_target_invalid');
        }
        const sprite = this._sprite(document, target, targetNode._components);
        if (sprite == null) {
            return;
        }
        for (const entry of document.entries) {
            if (entry === button || entry.__type__ !== 'cc.Button') {
                continue;
            }
            const otherTarget = entry._target == null ? this._index(entry.node) : this._index(entry._target);
            if (otherTarget === target) {
                throw new Error('lumen_button_color_owner_shared');
            }
        }
        const color = button._interactable === false ? button._disabledColor : button._normalColor;
        if (color == null) {
            return;
        }
        if (typeof color !== 'object' || Array.isArray(color) ||
            !['r', 'g', 'b', 'a'].every(key => typeof (color as Record<string, unknown>)[key] === 'number' && Number.isFinite((color as Record<string, unknown>)[key]))) {
            throw new Error('lumen_button_color_owner_color_invalid');
        }
        sprite._color = LumenDeepClone.clone(color);
    }

    /**
     * @description 只接受目标节点列表中唯一且node引用一致的Sprite，拒绝外部所有者或重复载体。
     * @param document 当前文档。
     * @param target 目标节点索引。
     * @param references 原节点组件引用。
     * @returns 唯一Sprite或不存在。
     */
    private static _sprite(document: LumenPrefabDocument, target: number, references: readonly unknown[]): Record<string, unknown> | null {
        let found: Record<string, unknown> | null = null;
        for (const ref of references) {
            const index = this._index(ref), entry = index == null ? null : document.entries[index];
            if (entry?.__type__ !== 'cc.Sprite') {
                continue;
            }
            if (this._index(entry.node) !== target) {
                throw new Error('lumen_button_color_owner_foreign');
            }
            if (found != null) {
                throw new Error('lumen_button_color_owner_ambiguous');
            }
            found = entry;
        }
        return found;
    }

    /**
     * @description 读取合法文档引用，不将未知形状强转为成功。
     * @param value 原始引用。
     * @returns 非负整数或null。
     */
    private static _index(value: unknown): number | null {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }
        const index = (value as Readonly<Record<string, unknown>>).__id__;
        return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : null;
    }
}
