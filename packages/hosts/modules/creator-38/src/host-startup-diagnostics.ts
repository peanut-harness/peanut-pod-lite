'use strict';

const { createHash } = require('crypto');
const { readFileSync, realpathSync } = require('fs');
const { join } = require('path');

type PackageInfo = { enable?: boolean; name?: string; path?: string };
type PackageQuery = { getPackages(options?: { name?: string; enable?: boolean }): PackageInfo[] };
type Messages = { addBroadcastListener(name: string, callback: () => void): void; removeBroadcastListener(name: string, callback: () => void): void;
    request(name: string, method: string): Promise<unknown> };
type Options = { getEnabledPackage: () => PackageInfo | null; messages: Messages; extensionPath: string; run: () => Promise<unknown>;
    record: (state: string, detail?: unknown) => void; fail: (error: unknown) => void };

/**
 * @description 在自身贡献启用且数据库真实 ready 后运行诊断；不在扩展 load 中调用数据库。
 */
class HostStartupDiagnostics {
    private readonly options: Options;
    private enabled = false;
    private loaded = false;
    private ready = false;
    private disposed = false;
    private started = false;
    private activationCheck: ReturnType<typeof setImmediate> | null = null;
    private running: Promise<void> | null = null;
    private query: Promise<void> | null = null;
    private readonly onReady = (): void => { this.ready = true; this.tryRun(); };

    /**
     * @description 注入事件与消息端口便于离线测试，不依赖测试目录或测试全局变量。
     */
    public constructor(options: Options) {
        this.options = options;
        try {
            options.messages.addBroadcastListener('asset-db:ready', this.onReady);
            options.record('waiting-for-load-completion');
        } catch (error) {
            options.messages.removeBroadcastListener('asset-db:ready', this.onReady);
            throw error;
        }
    }

    /**
     * @description SDK 正常导出模块的可读来源固定；未知实现不能假设 enable 的贡献顺序。
     */
    public static fromSdk(editor: { App?: { version?: string }; Message?: Messages; Package?: PackageQuery }, options: Omit<Options, 'getEnabledPackage' | 'messages'>): HostStartupDiagnostics {
        if (!['3.8.3', '3.8.7'].includes(editor.App?.version ?? '') || !editor.Message)
            throw new Error('host_startup_diagnostics_sdk_unavailable');
        const packages = editor.Package;
        if (!packages || typeof packages.getPackages !== 'function'
            || typeof editor.Message.addBroadcastListener !== 'function' || typeof editor.Message.removeBroadcastListener !== 'function')
            throw new Error('host_startup_diagnostics_package_query_unavailable');
        const extensionPath = realpathSync(options.extensionPath);
        return new HostStartupDiagnostics({ ...options, extensionPath, messages: editor.Message, getEnabledPackage: () => {
            const matches = packages.getPackages({ name: 'peanut-pod-lite-host', enable: true });
            if (!Array.isArray(matches)) throw new Error('host_startup_diagnostics_package_list_invalid');
            return matches.find(info => info.name === 'peanut-pod-lite-host' && info.enable === true
                && typeof info.path === 'string' && realpathSync(info.path) === extensionPath) ?? null;
        } });
    }

    /**
     * @description 两个精确 SDK 的同一可读 PackageManager 来源，enable 事件在贡献关联之后发出。
     */
    public static assertSource(root: string): void {
        const pins = { 'index.js': 'a3b7afbb4755b55b6b5ccd04f704db8071a42740377edd5086d067ba5d223922',
            'dist/browser/index.js': '39ada0c1d77ba5734ea9cb1f8efdc26c9ab98324794665d7860868b01c7ec1bc',
            'dist/renderer/index.js': '0717082a663689e5ce16960efdc3db40c5b714c8b11d6fa2896ab03aef72358f' };
        for (const [file, expected] of Object.entries(pins)) if (createHash('sha256').update(readFileSync(join(root, file))).digest('hex') !== expected)
            throw new Error('host_startup_diagnostics_sdk_source_mismatch');
    }

    /**
     * @description Core 真实激活完成；该标记不代表 SDK 扩展 enable 或数据库 ready。
     */
    public loadedSuccessfully(): void {
        this.loaded = true;
        if (this.disposed || this.enabled || this.activationCheck) return;
        // Creator calls this from the extension's load hook before Package.enable()
        // publishes its enabled state. A single next-turn readback observes the
        // completed host lifecycle without relying on private EventEmitter APIs.
        this.activationCheck = setImmediate(() => {
            this.activationCheck = null;
            if (this.disposed) return;
            try {
                if (!this.options.getEnabledPackage()) throw new Error('host_startup_diagnostics_extension_not_enabled');
                this.enabled = true;
                this.options.record('enabled');
                this.query = this.queryReady().catch(error => { this.reportFailure(error); });
            } catch (error) { this.reportFailure(error); }
        });
    }

    /**
     * @description 只移除自身引用，待实际已运行诊断完成后再允许 Core 卸载。
     */
    public async dispose(): Promise<void> {
        this.disposed = true;
        if (this.activationCheck) { clearImmediate(this.activationCheck); this.activationCheck = null; }
        this.options.messages.removeBroadcastListener('asset-db:ready', this.onReady);
        if (this.query) await this.query;
        if (this.running) await this.running;
    }

    /**
     * @description 仅在 SDK 自身 enable 完成事件后查询，热重载已 ready 无需等第二次广播。
     */
    private async queryReady(): Promise<void> {
        const ready = await this.options.messages.request('asset-db', 'query-ready');
        if (typeof ready !== 'boolean') throw new Error('host_startup_diagnostics_ready_reply_invalid');
        if (this.disposed) return;
        if (ready) this.ready = true;
        this.tryRun();
    }

    /**
     * @description 三项真实前置均满足后只执行一次，所有异常记录原始原因。
     */
    private tryRun(): void {
        if (this.disposed || this.started || !this.loaded || !this.enabled || !this.ready) return;
        this.started = true; this.options.record('running');
        this.running = Promise.resolve().then(() => this.options.run()).then(result => { this.options.record('complete', result); })
            .catch(error => { this.reportFailure(error); });
    }

    /**
     * @description 异步失败仍写报告与错误通道，不能以未运行诊断冒充零错误。
     */
    private reportFailure(error: unknown): void {
        this.started = true;
        this.options.record('failed', error instanceof Error ? error.message : String(error)); this.options.fail(error);
    }
}

module.exports = { HostStartupDiagnostics };
