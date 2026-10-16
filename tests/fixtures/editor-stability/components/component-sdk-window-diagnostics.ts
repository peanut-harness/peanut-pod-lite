/**
 * @description 仅从当前已登记Creator的现有主窗口读取固定SDK计时回调；不打开窗口或执行观察到的SDK文本。
 */
export class ComponentSdkWindowDiagnostics {
    /**
     * @description 精确限定当前SDK安装的唯一主窗口，仅发送本文件固定的只读观测函数。
     */
    public static async read(electron: any, creatorApp: string, version: string): Promise<unknown> {
        if (version !== '3.8.7') throw new Error('component_sdk_window_diagnostics_version_unverified');
        const expected = creatorApp + '/Contents/Resources/app.asar/node_modules/@editor/creator/static/windows/main.html';
        const windows = electron.BrowserWindow.getAllWindows().filter((window: any) => {
            const address = window.webContents.getURL(); if (!address.startsWith('file:')) return false;
            const url = new URL(address);
            return url.hostname === '' && decodeURIComponent(url.pathname) === expected;
        });
        if (windows.length !== 1 || windows[0].webContents.isDestroyed()) throw new Error('component_sdk_window_diagnostics_main_window_identity_invalid');
        const contents = windows[0].webContents;
        return { webContentsId: contents.id, observation: await contents.executeJavaScript(this.rendererSource(), false) };
    }

    /**
     * @description 只序列化本文件拥有的固定只读函数，不接纳调用方脚本、窗口地址或参数。
     */
    public static rendererSource(): string { return '({' + Function.prototype.toString.call(this.snapshot) + '}).snapshot()'; }

    /**
     * @description 在现有SDK主窗口中读取已缓存SDK模块与广播回调的函数文本，不调用回调或读取账号数据。
     */
    private static snapshot(): unknown {
        const targets = ['/app.asar/node_modules/@editor/creator/static/windows/script/',
            '/app.asar/node_modules/@editor/creator/dist/message/',
            '/app.asar/modules/editor-extensions/extensions/hierarchy/dist/'];
        const modules: unknown[] = []; const sources: unknown[] = []; const seen = new Set<object>(); let complete = true;
        const walker = { walk(value: any, path: string, depth: number): void {
            if (!value || !['object', 'function'].includes(typeof value) || seen.has(value) || depth > 6) return;
            if (seen.size >= 1024) { complete = false; return; } seen.add(value);
            if (typeof value === 'function') {
                const source = Function.prototype.toString.call(value);
                if (/main-window:ready|hierarchy:render-tree/u.test(source) || /\/(?:__eb__|addBroadcastListener|removeBroadcastListener)$/u.test(path)) {
                    if (source.length > 131072 || sources.length >= 128) { complete = false; return; }
                    sources.push({ path, source });
                }
            }
            if (Object.prototype.toString.call(value) === '[object Map]') {
                for (const [key, item] of value.entries()) if (typeof key === 'string') walker.walk(item, path + '/' + key, depth + 1);
                return;
            }
            for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
                if (['constructor', '__proto__', 'caller', 'arguments'].includes(name) || !('value' in descriptor)) continue;
                walker.walk(descriptor.value, path + '/' + name, depth + 1);
            }
        } };
        for (const [path, module] of Object.entries(require.cache)) {
            if (!module || !targets.some(prefix => path.includes(prefix))) continue;
            const value = Object.getOwnPropertyDescriptor(module, 'exports')?.value;
            const relative = path.slice(path.indexOf('/app.asar/') + '/app.asar/'.length);
            modules.push({ path: relative, exportNames: Object.keys(value ?? {}) }); walker.walk(value, relative, 0);
        }
        const editor = Reflect.get(globalThis, 'Editor');
        walker.walk(editor?.Message?.__protected__, 'Editor.Message.__protected__', 0);
        return { complete, inspectedObjects: seen.size, modules, sources };
    }
}
