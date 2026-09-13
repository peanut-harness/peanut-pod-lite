import type {
    IPluginManagerPanelDocumentLike,
    IPluginManagerPanelElementLike,
} from '../panels/plugin-manager-panel-ui.js';
import { MockPluginManagerPanelElement } from './mock-plugin-manager-panel-element.js';

/**
 * @description 插件管理面板验收使用的最小 DOM 文档。
 */
export class MockPluginManagerPanelDocument implements IPluginManagerPanelDocumentLike {
    /**
     * @description 文档 body。
     */
    public readonly body = new MockPluginManagerPanelElement('body');

    /**
     * @description 创建元素。
     * @param tagName 标签名
     * @returns 新元素
     */
    public createElement(tagName: string): IPluginManagerPanelElementLike {
        return new MockPluginManagerPanelElement(tagName);
    }

    /**
     * @description 按 id 查找元素。
     * @param id 元素 id
     * @returns 命中元素；不存在时返回 null
     */
    public getElementById(id: string): MockPluginManagerPanelElement | null {
        return this.body.findById(id);
    }
}
