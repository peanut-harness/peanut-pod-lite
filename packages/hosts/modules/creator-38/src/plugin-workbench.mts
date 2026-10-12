import { readFileSync, realpathSync } from 'fs';
import { createRequire } from 'module';
import { join, relative, resolve } from 'path';
import type { PluginManagerApp } from '@peanut/pod-engine/kernel';

/**
 * @description 当前通用面板绑定的已激活插件身份；入口只来自 contribution 解析器。
 */
interface IWorkbenchContext {
    pluginId: string;
    panelId: string;
    title: string;
    entry: string;
    panelBridge: string | null;
}

/**
 * @description Creator 公共 API 的最小适配面，避免面板控制依赖完整编辑器实现。
 */
interface IWorkbenchEditor {
    Project: { path: string };
    Panel: { open(name: string): Promise<unknown>; close?(name: string): Promise<unknown> };
    Message: { send(extension: string, message: string): void };
}

/**
 * @description 为已安装且活动的插件提供一个实际 Creator 面板及身份绑定的 bridge。
 */
export class PluginWorkbench {
    private readonly _contexts = new Map<string, IWorkbenchContext>();
    private readonly getManager: () => PluginManagerApp;
    private readonly getEditor: () => IWorkbenchEditor;
    private readonly extensionName: string;

    /**
     * @description 接收当前内核与 Creator API，避免保存已卸载的内核实例。
     * @param getManager 当前内核解析器
     * @param getEditor 当前 Creator API 解析器
     * @param extensionName 声明静态面板及消息的宿主名称
     */
    public constructor(
        getManager: () => PluginManagerApp,
        getEditor: () => IWorkbenchEditor,
        extensionName: string,
    ) {
        this.getManager = getManager;
        this.getEditor = getEditor;
        this.extensionName = extensionName;
    }

    /**
     * @description 校验活动插件入口后打开通用面板；重复打开会切换到当前选择的插件。
     * @param pluginId 管理器中真实存在的插件标识
     * @returns 已绑定的面板定义
     */
    public async open(pluginId: string, slot = 'plugin-workbench'): Promise<IWorkbenchContext> {
        this._assertSlot(slot);
        const manager = this.getManager();
        const panel = manager.resolveEmbeddedPluginPanel(pluginId);
        const snapshot = manager.getInstalledPackageSnapshot(pluginId);
        const installed = snapshot?.versions.find((version) => version.version === snapshot.activeVersion);
        if (installed == null) throw new Error('plugin_workbench_installation_missing');
        const root = realpathSync(installed.installPath);
        const entry = realpathSync(panel.entry);
        this._assertWithinRoot(root, entry);
        const manifest = JSON.parse(readFileSync(join(root, `${pluginId}.manifest.json`), 'utf8')) as { panelBridge?: string };
        let panelBridge: string | null = null;
        if (typeof manifest.panelBridge === 'string') {
            panelBridge = realpathSync(resolve(root, manifest.panelBridge));
            this._assertWithinRoot(root, panelBridge);
        }
        const context = { pluginId, panelId: panel.id, title: panel.title, entry, panelBridge };
        this._contexts.set(slot, context);
        await this.getEditor().Panel.open(`${this.extensionName}.${slot}`);
        this.getEditor().Message.send(this.extensionName, `refresh-${slot}`);
        return context;
    }

    /**

     * @description Host Controller 只能选择三个固定槽位，缺失参数不得回退到默认工作台。

     */
    public async openHost(payload: { pluginId?: string; hostSlotId?: string } | null): Promise<IWorkbenchContext> {
        const slot = payload?.hostSlotId;
        if (typeof slot !== 'string' || !['plugin-host-1', 'plugin-host-2', 'plugin-host-3'].includes(slot)) throw new Error('plugin_workbench_slot_invalid');
        if (typeof payload?.pluginId !== 'string' || payload.pluginId.trim().length === 0) throw new Error('plugin_workbench_plugin_id_invalid');
        return this.open(payload.pluginId, slot);
    }

    /**
     * @description 回读当前选择，同时拒绝已停用或面板定义已变化的插件。
     * @returns 当前仍有效的面板绑定
     */
    public query(slot = 'plugin-workbench'): IWorkbenchContext {
        this._assertSlot(slot);
        const context = this._contexts.get(slot);
        if (context == null) throw new Error('plugin_workbench_not_bound');
        const current = this.getManager().resolveEmbeddedPluginPanel(context.pluginId);
        if (current.id !== context.panelId || realpathSync(current.entry) !== context.entry) throw new Error('plugin_workbench_binding_changed');
        return context;
    }

    /**
     * @description 按绑定身份转发面板请求，拒绝旧 iframe 在切换后继续调用其他插件。
     * @param pluginId 发起请求的插件身份
     * @param panelId 发起请求的面板身份
     * @param request 既有 PanelBridge 或插件原生 bridge 请求
     * @param native 是否使用 manifest 声明的原生 bridge
     * @returns 原处理器的响应
     */
    public async request(pluginId: string, panelId: string, request: { id: string; event: string; payload?: Record<string, unknown> }, native = false, slot = 'plugin-workbench'): Promise<unknown> {
        const context = this.query(slot);
        if (pluginId !== context.pluginId || panelId !== context.panelId) throw new Error('plugin_workbench_caller_mismatch');
        if (!native) return this.getManager().createPanelBridgeClient(pluginId, panelId).request({ ...request, expectsResponse: true });
        if (context.panelBridge == null) throw new Error('plugin_native_panel_bridge_unavailable');
        const bridgeRequire = createRequire(context.panelBridge);
        const bridge = bridgeRequire(context.panelBridge) as { handleRequest(input: object): Promise<unknown> };
        if (typeof bridge.handleRequest !== 'function') throw new Error('plugin_native_panel_bridge_invalid');
        return bridge.handleRequest({ request, hostExtensionName: this.extensionName, projectDirectory: this.getEditor().Project.path, editorApi: this.getEditor(), requestSbfBase64: async () => { throw new Error('plugin_panel_export_source_required'); } });
    }

    /**

     * @description 关闭指定槽位并清理其绑定，保留其他槽位。

     */
    public async close(slot: string): Promise<void> {
        this._assertSlot(slot);
        await this.getEditor().Panel.close?.(`${this.extensionName}.${slot}`);
        this._contexts.delete(slot);
    }

    /**

     * @description 只允许宿主声明的默认工作台和三个固定槽位。

     */
    private _assertSlot(slot: string): void {
        if (!['plugin-workbench', 'plugin-host-1', 'plugin-host-2', 'plugin-host-3'].includes(slot)) throw new Error('plugin_workbench_slot_invalid');
    }

    /**
     * @description 将路径限制在安装根目录，包含真实路径的符号链接逃逸检查。
     * @param root 已安装包真实目录
     * @param path 面板或原生 bridge 的真实路径
     * @returns 校验通过后返回
     */
    private _assertWithinRoot(root: string, path: string): void {
        const pathFromRoot = relative(root, path);
        if (pathFromRoot.length === 0 || pathFromRoot.startsWith('..')) throw new Error('plugin_workbench_entry_escape');
    }
}
