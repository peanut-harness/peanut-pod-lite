import { readFileSync } from 'fs';
import { dirname } from 'path';
import { pathToFileURL } from 'url';

declare const Editor: { Message: { request(extension: string, message: string, ...args: unknown[]): Promise<unknown> } };

interface IContext { pluginId: string; panelId: string; title: string; entry: string; }
interface IPanel { $: { frame: HTMLIFrameElement; status: HTMLDivElement }; }

const EXTENSION = 'peanut-pod-lite-host';
let refreshGeneration = 0;
let cleanup: (() => void) | null = null;

/**
 * @description 装载实际插件 HTML，并将 iframe 请求绑定到本次插件与面板身份。
 */
class WorkbenchPanel {
    /**
     * @description Creator ready 或刷新消息触发的实际页面装载。
     * @param panel 当前 Creator 面板 DOM
     * @returns 页面初始化完成后结束
     */
    public static async refresh(panel: IPanel): Promise<void> {
        const generation = ++refreshGeneration;
        cleanup?.();
        cleanup = null;
        panel.$.status.textContent = '正在打开插件…';
        try {
            const context = await Editor.Message.request(EXTENSION, 'query-plugin-workbench') as IContext;
            if (generation !== refreshGeneration) return;
            const frame = panel.$.frame;
            const request = (payload: unknown, native = false) => Editor.Message.request(EXTENSION, 'request-plugin-workbench', context.pluginId, context.panelId, payload, native);
            const onMessage = async (event: MessageEvent) => {
                if (event.source !== frame.contentWindow) return;
                const data = event.data;
                if (data?.type === 'peanut-panel:request') {
                    try {
                        const response = await request(data.request);
                        frame.contentWindow?.postMessage({ type: 'peanut-panel:response', id: data.id, response }, '*');
                    } catch (error) {
                        frame.contentWindow?.postMessage({ type: 'peanut-panel:response', id: data.id, response: { ok: false, error: String(error) } }, '*');
                    }
                } else if (typeof data?.type === 'string' && data.type.startsWith('snowb-cpm:')) {
                    try {
                        const response = await request(data, true);
                        if (response != null) frame.contentWindow?.postMessage(response, '*');
                    } catch (error) {
                        frame.contentWindow?.postMessage({ type: 'snowb-cpm:response', requestId: data.requestId, ok: false, error: String(error) }, '*');
                    }
                }
            };
            const onLoad = () => frame.contentWindow?.postMessage({ type: 'snowb-cpm:init', pluginId: context.pluginId }, '*');
            window.addEventListener('message', onMessage);
            frame.addEventListener('load', onLoad);
            (window as unknown as { __PEANUT_WORKBENCH_REQUEST__: (event: string, payload: unknown) => Promise<unknown> }).__PEANUT_WORKBENCH_REQUEST__ = async (event, payload) => {
                const response = await request({ id: `workbench-${Date.now()}`, event, payload }) as { ok: boolean; payload?: unknown; error?: string };
                if (!response.ok) throw new Error(response.error ?? 'plugin_panel_request_failed');
                return response.payload;
            };
            const base = pathToFileURL(`${dirname(context.entry)}/`).href;
            const init = `<base href="${base}"><script>window.__PEANUT_EDITOR_PANEL_HOST__={request:(event,payload)=>window.parent.__PEANUT_WORKBENCH_REQUEST__(event,payload)};<\/script>`;
            frame.srcdoc = readFileSync(context.entry, 'utf8').replace(/<head[^>]*>/i, (head) => `${head}${init}`);
            panel.$.status.hidden = true;
            cleanup = () => { window.removeEventListener('message', onMessage); frame.removeEventListener('load', onLoad); frame.srcdoc = ''; };
        } catch (error) {
            panel.$.status.hidden = false;
            panel.$.status.textContent = String(error);
        }
    }
}

module.exports = {
    template: '<div id="status"></div><iframe id="frame" title="插件工作区"></iframe>',
    style: ':host{display:flex;min-width:0;min-height:0;height:100%;background:#252525}#frame{flex:1;width:100%;height:100%;min-width:0;min-height:0;border:0}#status{padding:12px;color:#dedede}',
    $: { frame: '#frame', status: '#status' },
    ready(this: IPanel) { void WorkbenchPanel.refresh(this); },
    methods: { refresh(this: IPanel) { return WorkbenchPanel.refresh(this); } },
    close() { refreshGeneration += 1; cleanup?.(); cleanup = null; },
};
