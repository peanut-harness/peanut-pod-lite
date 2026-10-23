'use strict';

const { createHash } = require('crypto');
const { readFileSync, realpathSync } = require('fs');
const { dirname, join, resolve } = require('path');

type PackageInfo = { name?: string; path?: string };
type Events = { find?(name: string): PackageInfo | null; on(name: string, callback: (info: PackageInfo) => void): unknown; removeListener(name: string, callback: (info: PackageInfo) => void): unknown };
type Messages = { addBroadcastListener(name: string, callback: () => void): void; removeBroadcastListener(name: string, callback: () => void): void;
    request(name: string, method: string): Promise<unknown> };
type Options = { events: Events; messages: Messages; extensionPath: string; run: () => Promise<unknown>;
    existingEnabled?: PackageInfo | null; record: (state: string, detail?: unknown) => void; fail: (error: unknown) => void };

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
    private running: Promise<void> | null = null;
    private query: Promise<void> | null = null;
    private readonly onReady = (): void => { this.ready = true; this.tryRun(); };
    private readonly onEnabled = (info: PackageInfo): void => {
        if (this.disposed || this.enabled || info.name !== 'peanut-pod-lite-host' || typeof info.path !== 'string'
            || resolve(info.path) !== this.options.extensionPath) return;
        this.enabled = true; this.options.record('enabled');
        this.query = this.queryReady().catch(error => { this.reportFailure(error); });
    };

    /**
     * @description 注入事件与消息端口便于离线测试，不依赖测试目录或测试全局变量。
     */
    public constructor(options: Options) {
        this.options = options;
        options.events.on('enable', this.onEnabled);
        try {
            options.messages.addBroadcastListener('asset-db:ready', this.onReady);
            options.record('waiting-for-enable');
            if (options.existingEnabled) this.onEnabled(options.existingEnabled);
        } catch (error) {
            options.events.removeListener('enable', this.onEnabled);
            options.messages.removeBroadcastListener('asset-db:ready', this.onReady);
            throw error;
        }
    }

    /**
     * @description SDK 正常导出模块的可读来源固定；未知实现不能假设 enable 的贡献顺序。
     */
    public static fromSdk(editor: { App?: { version?: string }; Message?: Messages }, options: Omit<Options, 'events' | 'messages'>): HostStartupDiagnostics {
        if (!['3.8.3', '3.8.7'].includes(editor.App?.version ?? '') || !editor.Message)
            throw new Error('host_startup_diagnostics_sdk_unavailable');
        const entry = require.resolve('@editor/package'); const root = dirname(entry);
        this.assertSource(root);
        // 普通 SDK 模块导出；不求值或解码任何 SDK 源码。
        const events: Events = require('@editor/package');
        if (typeof events.find !== 'function' || typeof events.on !== 'function' || typeof events.removeListener !== 'function'
            || typeof editor.Message.addBroadcastListener !== 'function' || typeof editor.Message.removeBroadcastListener !== 'function')
            throw new Error('host_startup_diagnostics_events_unavailable');
        return new HostStartupDiagnostics({ ...options, extensionPath: realpathSync(options.extensionPath), events, messages: editor.Message,
            existingEnabled: events.find('peanut-pod-lite-host') });
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
    public loadedSuccessfully(): void { this.loaded = true; this.tryRun(); }

    /**
     * @description 只移除自身引用，待实际已运行诊断完成后再允许 Core 卸载。
     */
    public async dispose(): Promise<void> {
        this.disposed = true;
        this.options.events.removeListener('enable', this.onEnabled);
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
