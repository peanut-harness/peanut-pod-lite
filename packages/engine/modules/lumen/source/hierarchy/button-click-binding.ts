import type { PrefabEntry } from '../types';

/**
 * @description 维护按钮事件的精确幂等绑定，保留其他回调及既有序列化下标。
 */
export class LumenButtonClickBinding {
    /**
     * @description 复用第一个完全匹配事件，移除其重复引用，或追加新事件。
     * @param entries 当前文档序列化条目。
     * @param button 已定位的 Button 组件。
     * @param event 由绑定入口构造的完整点击事件。
     * @returns 无返回值。
     */
    public static bind(entries: PrefabEntry[], button: PrefabEntry, event: PrefabEntry): void {
        const existing: unknown[] = Array.isArray(button.clickEvents) ? button.clickEvents : [];
        let matched = false;
        const nextEvents = existing.filter((ref) => {
            const index = this._referenceIndex(ref);
            const current = index == null ? undefined : entries[index];
            if (
                current?.__type__ !== 'cc.ClickEvent' ||
                this._referenceIndex(current.target) !== this._referenceIndex(event.target) ||
                current.component !== event.component ||
                current._componentId !== event._componentId ||
                current.handler !== event.handler ||
                current.customEventData !== event.customEventData
            ) {
                return true;
            }
            if (matched) return false;
            matched = true;
            return true;
        });
        if (!matched) {
            nextEvents.push({ __id__: entries.length });
            entries.push(event);
        }
        button.clickEvents = nextEvents;
    }

    /**
     * @description 读取合法的非负整数引用，不将无效输入当作可复用事件。
     * @param value 待检查的序列化引用。
     * @returns 引用下标；无效时为 null。
     */
    private static _referenceIndex(value: unknown): number | null {
        if (value == null || typeof value !== 'object' || !('__id__' in value)) return null;
        const index = value.__id__;
        return typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 ? index : null;
    }
}
