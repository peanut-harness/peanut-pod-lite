/**
 * @description 仅从当前已登记Creator的现有主窗口读取固定SDK计时回调；不打开窗口或执行观察到的SDK文本。
 */
export class ComponentSdkWindowDiagnostics {
    /**
     * @description 精确限定当前SDK安装的唯一主窗口，仅发送本文件固定的只读观测函数。
     */
    public static async read(electron: any, creatorApp: string, version: string): Promise<unknown> {
        const contents = this.mainContents(electron, creatorApp, version);
        if (!contents) throw new Error('component_sdk_window_diagnostics_main_window_identity_invalid');
        return { webContentsId: contents.id, observation: await contents.executeJavaScript(this.rendererSource(), false) };
    }

    /**
     * @description 只定位当前SDK的唯一现有主窗口；启动期间尚未创建窗口时返回null，不创建窗口。
     */
    public static mainContents(electron: any, creatorApp: string, version: string): any {
        if (!['3.8.3', '3.8.7'].includes(version)) throw new Error('component_sdk_window_diagnostics_version_unverified');
        const expected = creatorApp + '/Contents/Resources/app.asar/node_modules/@editor/creator/static/windows/main.html';
        const windows = electron.BrowserWindow.getAllWindows().filter((window: any) => {
            const address = window.webContents.getURL(); if (!address.startsWith('file:')) return false;
            const url = new URL(address);
            return url.hostname === '' && decodeURIComponent(url.pathname) === expected;
        });
        if (windows.length > 1) throw new Error('component_sdk_window_diagnostics_main_window_identity_invalid');
        return windows.length === 1 && !windows[0].webContents.isDestroyed() ? windows[0].webContents : null;
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
            '/app.asar/builtin/scene/dist/panel/message/',
            '/app.asar/node_modules/@editor/creator/dist/message/',
            '/app.asar/node_modules/@editor/creator/dist/layout/', '/app.asar/node_modules/@editor/creator/dist/startup/',
            '/app.asar/node_modules/@editor/creator/dist/windows/', '/app.asar/node_modules/@editor/creator/dist/panel/',
            '/app.asar/node_modules/@editor/dock/lib/renderer/',
            '/app.asar/node_modules/@editor/panel/lib/',
            '/app.asar/modules/editor-extensions/extensions/hierarchy/dist/'];
        const modules: unknown[] = []; const sources: unknown[] = []; const seen = new Set<object>(); let complete = true;
        const walker = { walk(value: any, path: string, depth: number): void {
            if (!value || !['object', 'function'].includes(typeof value) || seen.has(value) || depth > 6) return;
            if (seen.size >= 2048) { complete = false; return; } seen.add(value);
            if (typeof value === 'function') {
                const source = Function.prototype.toString.call(value);
                if (/main-window:ready|hierarchy:render-tree/u.test(source) || path.startsWith('node_modules/@editor/panel/lib/')
                    || /\/(?:__eb__|addBroadcastListener|removeBroadcastListener)$/u.test(path)
                    || /hierarchy\/dist\/panel\.ccc\/(?:ready|close|beforeClose)$/u.test(path)
                    || (/hierarchy\/dist\/panel\.ccc\/listeners\//u.test(path) && /methods\.ready|scene:ready|query-is-ready/u.test(source))) {
                    if (source.length > 131072 || sources.length >= 128) { complete = false; return; }
                    sources.push({ path, source });
                }
            }
            if (Object.prototype.toString.call(value) === '[object Map]') {
                for (const [key, item] of value.entries()) if (typeof key === 'string') walker.walk(item, path + '/' + key, depth + 1);
                return;
            }
            for (const name of Object.getOwnPropertyNames(value)) {
                if (['constructor', '__proto__', 'caller', 'arguments', '_Ctor', '_builtinJSON', 'userInfo', 'account', 'token'].includes(name)) continue;
                const descriptor = Object.getOwnPropertyDescriptor(value, name);
                if (!descriptor || !('value' in descriptor)) continue;
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
        walker.walk(editor?.Panel?.__protected__, 'Editor.Panel.__protected__', 0);
        const rendererTrace = Reflect.get(globalThis, Symbol.for('peanut.component.sdk-renderer-timer-trace'));
        return { complete, inspectedObjects: seen.size, modules, sources, rendererTimerTrace: rendererTrace?.state ?? null };
    }
}
