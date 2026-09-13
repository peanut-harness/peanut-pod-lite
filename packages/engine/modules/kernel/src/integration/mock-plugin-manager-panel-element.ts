import type { IPluginManagerPanelElementLike } from '../panels/plugin-manager-panel-ui.js';

/**
 * @description 插件管理面板验收使用的最小 DOM 元素。
 */
export class MockPluginManagerPanelElement implements IPluginManagerPanelElementLike {
    /**
     * @description 元素 id。
     */
    public id: string = '';
    /**
     * @description 元素类名。
     */
    public className: string = '';
    /**
     * @description 文本内容。
     */
    public textContent: string | null = null;
    /**
     * @description 序列化后的子树 HTML。
     */
    public innerHTML: string = '';
    /**
     * @description 是否禁用。
     */
    public disabled?: boolean;
    /**
     * @description 是否隐藏。
     */
    public hidden?: boolean;
    /**
     * @description data 属性集合。
     */
    public readonly dataset: Record<string, string> = {};

    /**
     * @description 标签名。
     */
    private readonly _tagName: string;
    /**
     * @description 子元素。
     */
    private readonly _children: MockPluginManagerPanelElement[] = [];
    /**
     * @description 事件监听器。
     */
    private readonly _listeners = new Map<string, Array<() => void | Promise<void>>>();
    /**
     * @description 父元素。
     */
    private _parent: MockPluginManagerPanelElement | null = null;

    /**
     * @description 创建最小 DOM 元素。
     * @param tagName 标签名
     */
    public constructor(tagName: string) {
        this._tagName = tagName;
    }

    /**
     * @description 追加子元素。
     * @param child 子元素
     * @returns 同一子元素
     */
    public appendChild(child: IPluginManagerPanelElementLike): IPluginManagerPanelElementLike {
        const mockChild = MockPluginManagerPanelElement._fromElement(child);
        mockChild._parent = this;
        this._children.push(mockChild);
        this._syncInnerHtml();
        return child;
    }

    /**
     * @description 替换全部子元素。
     * @param children 新子元素
     * @returns 无返回值
     */
    public replaceChildren(...children: IPluginManagerPanelElementLike[]): void {
        this._children.length = 0;
        for (const child of children) {
            const mockChild = MockPluginManagerPanelElement._fromElement(child);
            mockChild._parent = this;
            this._children.push(mockChild);
        }
        this._syncInnerHtml();
    }

    /**
     * @description 注册事件监听器。
     * @param eventName 事件名
     * @param listener 监听器
     * @returns 无返回值
     */
    public addEventListener(eventName: string, listener: () => void | Promise<void>): void {
        const listeners = this._listeners.get(eventName) ?? [];
        listeners.push(listener);
        this._listeners.set(eventName, listeners);
    }

    /**
     * @description 触发点击监听器。
     * @returns 无返回值
     */
    public async click(): Promise<void> {
        if (this.disabled) {
            return;
        }
        const listeners = this._listeners.get('click') ?? [];
        for (const listener of listeners) {
            await listener();
        }
    }

    /**
     * @description 在当前子树按 id 查找元素。
     * @param id 元素 id
     * @returns 命中元素；不存在时返回 null
     */
    public findById(id: string): MockPluginManagerPanelElement | null {
        if (this.id === id) {
            return this;
        }
        for (const child of this._children) {
            const hit = child.findById(id);
            if (hit != null) {
                return hit;
            }
        }
        return null;
    }

    /**
     * @description 将面板元素契约收窄为验收 DOM 元素。
     * @param value 面板元素
     * @returns 验收 DOM 元素
     */
    private static _fromElement(value: IPluginManagerPanelElementLike): MockPluginManagerPanelElement {
        if (!(value instanceof MockPluginManagerPanelElement)) {
            throw new Error('plugin_manager_panel_mock_element_required');
        }
        return value;
    }

    /**
     * @description 同步当前元素与父元素的序列化 HTML。
     */
    private _syncInnerHtml(): void {
        this.innerHTML = this._children.map((child) => child._serialize()).join('');
        this._parent?._syncInnerHtml();
    }

    /**
     * @description 序列化当前元素子树。
     * @returns HTML 文本
     */
    private _serialize(): string {
        const attributes: string[] = [];
        if (this.id.length > 0) {
            attributes.push(`id="${this.id}"`);
        }
        if (this.className.length > 0) {
            attributes.push(`class="${this.className}"`);
        }
        for (const [key, value] of Object.entries(this.dataset)) {
            attributes.push(`data-${key}="${value}"`);
        }
        const textContent = this.textContent ?? '';
        const childHtml = this._children.map((child) => child._serialize()).join('');
        return `<${this._tagName}${attributes.length > 0 ? ` ${attributes.join(' ')}` : ''}>${textContent}${childHtml}</${this._tagName}>`;
    }
}
