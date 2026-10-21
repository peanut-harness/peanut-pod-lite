import { execFile } from 'node:child_process';
import type { IGrantedRuntimeClientSet } from '@peanut/pod-sdk';

/**
 * @description 在macOS只读核对Creator实际选择浏览器中的本工程标签；权限或平台未知时拒绝推断不存在。
 */
export class EditorMcpPreviewWindowInspector {
    /**
     * @description 当前宿主的实际消息客户端。
     */
    private readonly _message: Pick<NonNullable<IGrantedRuntimeClientSet['message']>, 'request'>;

    /**
     * @description 绑定只读预览URL查询通道。
     * @param message 受信宿主消息客户端。
     */
    public constructor(message: Pick<NonNullable<IGrantedRuntimeClientSet['message']>, 'request'>) { this._message = message; }

    /**
     * @description 验证当前平台、服务PID和URL后，只读取匹配标签数量，不返回其它浏览记录。
     * @returns 明确存在、不存在或未知。
     */
    public async inspect(): Promise<'exists' | 'absent' | 'unknown'> {
        const count = await this.countMatchingTabs();
        return count === null ? 'unknown' : count > 0 ? 'exists' : 'absent';
    }

    /**
     * @description 仅统计当前Creator预览URL对应标签，不返回其它浏览记录。
     * @returns 匹配标签数，权限或身份不可证明时为null。
     */
    public async countMatchingTabs(): Promise<number | null> {
        if (process.platform !== 'darwin') return null;
        const editor: unknown = Reflect.get(globalThis, 'Editor');
        if (!editor || typeof editor !== 'object') return null;
        const profile: unknown = Reflect.get(editor, 'Profile');
        if (!profile || typeof profile !== 'object') return null;
        const getConfig: unknown = Reflect.get(profile, 'getConfig');
        if (typeof getConfig !== 'function') return null;
        try {
            const platform: unknown = await Reflect.apply(getConfig, profile, ['preview', 'preview.current.platform']);
            if (platform !== 'browser') return null;
            const browser: unknown = await Reflect.apply(getConfig, profile, ['program', 'browserV2']);
            if (!browser || typeof browser !== 'object' || Array.isArray(browser)) return null;
            const configured: unknown = Reflect.get(browser, 'path');
            if (configured !== undefined && typeof configured !== 'string') return null;
            const browserPath = typeof configured === 'string' ? configured : '';
            if (browserPath && (!browserPath.startsWith('/') || !browserPath.endsWith('.app'))) return null;
            const raw: unknown = await this._message.request('preview', 'query-preview-url');
            if (typeof raw !== 'string') return null;
            const url = new URL(raw); const port = Number(url.port);
            if (url.protocol !== 'http:' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
            const listener = await this._exec('/usr/sbin/lsof', ['-nP', '-a', '-p', String(process.pid), '-iTCP:' + port, '-sTCP:LISTEN']);
            if (!listener) return null;
            const hosts = [...new Set([url.hostname, 'localhost', '127.0.0.1', '[::1]'])];
            const result = await this._exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', EditorMcpPreviewWindowInspector._script,
                String(port), JSON.stringify(hosts), browserPath]);
            if (!result) return null;
            const count: unknown = JSON.parse(result);
            return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
        } catch { return null; }
    }

    /**
     * @description 执行仅有读取功能的固定系统命令；超时、权限拒绝和解析失败保持未知。
     * @param file 固定可执行程序。
     * @param args 分离传递的参数，不经过shell。
     * @returns 输出或null。
     */
    private async _exec(file: string, args: string[]): Promise<string | null> {
        return new Promise((resolve) => {
            execFile(file, args, { timeout: 5000, maxBuffer: 65536 }, (error, stdout) => resolve(error ? null : stdout.trim()));
        });
    }

    /**
     * @description 固定JXA只检查Creator选择的浏览器；先用AppKit确认已运行，再批量读取标签，避免查询其它浏览器。
     */
    private static readonly _script = `function run(argv) {
        ObjC.import('AppKit');
        var port = Number(argv[0]), hosts = JSON.parse(argv[1]), configuredPath = argv[2], count = 0;
        var names = ['Google Chrome', 'Google Chrome Dev', 'Microsoft Edge', 'Safari', 'Brave Browser', 'Arc'];
        var targetUrl = configuredPath ? $.NSURL.fileURLWithPath(configuredPath)
            : $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString('http://localhost:' + port));
        if (!targetUrl) return 'null';
        var name = ObjC.unwrap(targetUrl.lastPathComponent).replace(/\\.app$/, '');
        if (names.indexOf(name) < 0) return 'null';
        var bundle = $.NSBundle.bundleWithURL(targetUrl);
        if (!bundle) return 'null';
        var identifier = ObjC.unwrap(bundle.bundleIdentifier);
        if (typeof identifier !== 'string' || !identifier) return 'null';
        var running = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(identifier);
        if (Number(running.count) === 0) return '0';
        if (Number(running.count) !== 1) return 'null';
        var app = Application(identifier);
        if (!app.running()) return 'null';
        var windows = app.windows();
        for (var w = 0; w < windows.length; w++) {
            var urls = windows[w].tabs.url();
            for (var t = 0; t < urls.length; t++) {
                var match = /^https?:\\/\\/([^/]+)(?:\\/|$)/.exec(String(urls[t]));
                if (!match) continue;
                var authority = match[1], suffix = ':' + port;
                if (authority.slice(-suffix.length) === suffix && hosts.indexOf(authority.slice(0, -suffix.length)) >= 0) count++;
            }
        }
        return String(count);
    }`;
}
