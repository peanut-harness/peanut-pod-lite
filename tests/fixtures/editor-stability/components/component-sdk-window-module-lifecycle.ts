/**
 * @description One generation of owned window-module installs; closing drains only work admitted before closing.
 */
export class ComponentSdkWindowModuleLifecycle {
    // Preserve the original entry-point polling budget: 100 attempts at 250 ms.
    private static readonly maximumAttempts = 100;
    private static readonly pollMilliseconds = 250;
    private phase: 'open' | 'closing' | 'closed' = 'open';
    private readonly pending = new Set<Promise<void>>();
    private readonly windows: { contents: ComponentSdkModuleContents; script: string; receipt: string; result: Record<string, unknown> }[] = [];
    private readonly restores: (() => void)[] = [];
    private readonly failures: unknown[] = [];
    private readonly failedReceipts = new Set<string>();
    private closing: Promise<void> | null = null;

    /**
     * @description Keep receipt, logging and waiting ports tied to this generation, never a later load.
     */
    public constructor(private readonly ports: ComponentSdkModulePorts) {}

    /**
     * @description Phase callbacks may admit work only before closing begins.
     */
    public get isOpen(): boolean { return this.phase === 'open'; }

    /**
     * @description A failed cleanup cannot authorize a replacement generation over surviving resources.
     */
    public get canRestart(): boolean { return this.phase === 'closed' && this.failures.length === 0; }

    /**
     * @description Record an owned observer restoration immediately after its installation.
     */
    public own(restore: () => void): void {
        if (!this.isOpen) throw new Error('component_sdk_window_generation_closing');
        this.restores.push(restore);
    }

    /**
     * @description Admit before the first asynchronous operation and retain real failures without detached rejections.
     */
    public install(lookup: () => ComponentSdkModuleContents | null, script: string, receipt: string): void {
        if (!this.isOpen) return;
        const task = Promise.resolve().then(() => this.runInstall(lookup, script, receipt))
            .catch(error => { this.failed(error, receipt); });
        this.pending.add(task);
        void task.then(() => { this.pending.delete(task); });
    }

    /**
     * @description Failed synchronous setup starts cleanup without assuming that the SDK loader calls unload.
     */
    public abort(error: unknown): void {
        this.failed(error);
        // Observe background rejection; close() still retains that same failed outcome for the loader's unload.
        void this.close().catch(cleanupError => { this.report(cleanupError); });
    }

    /**
     * @description Synchronously close admission; concurrent callers share the same complete cleanup outcome.
     */
    public close(): Promise<void> {
        if (this.closing) return this.closing;
        this.phase = 'closing';
        this.closing = Promise.resolve().then(() => this.finishClose());
        return this.closing;
    }

    /**
     * @description Poll only the owned existing window and clean a successful late result before its task settles.
     */
    private async runInstall(lookup: () => ComponentSdkModuleContents | null, script: string, receipt: string): Promise<void> {
        for (let attempt = 0; attempt < ComponentSdkWindowModuleLifecycle.maximumAttempts && this.isOpen; attempt++) {
            const contents = lookup();
            if (contents && !contents.isDestroyed()) {
                const result = await contents.executeJavaScript('require(' + JSON.stringify(script) + ').load()', false);
                if (result?.installed === true) {
                    const window = { contents, script, receipt, result };
                    if (!this.isOpen) { await this.clean(window); return; }
                    this.windows.push(window); this.ports.writeReceipt(receipt, result); return;
                }
            }
            if (this.isOpen) await this.ports.delay(ComponentSdkWindowModuleLifecycle.pollMilliseconds);
        }
        if (this.isOpen) throw new Error('component_sdk_window_renderer_trace_not_ready');
        this.ports.writeReceipt(receipt, { installed: false, cancelled: true, reason: 'generation-closing-before-install' });
    }

    /**
     * @description Attempt every owned cleanup even when observers, installs or another window have failed.
     */
    private async finishClose(): Promise<void> {
        try {
            for (const restore of this.restores.splice(0).reverse()) {
                try { restore(); } catch (error) { this.failed(error); }
            }
            await Promise.allSettled([...this.pending]);
            await Promise.allSettled(this.windows.splice(0).map(async window => {
                try { await this.clean(window); } catch (error) { this.failed(error, window.receipt); }
            }));
            if (this.failures.length === 1) throw this.failures[0];
            if (this.failures.length > 1) throw new AggregateError([...this.failures], 'component_sdk_window_cleanup_failed');
        } finally { this.phase = 'closed'; }
    }

    /**
     * @description A pre-call destroyed observation differs from a real rejection, which always reaches failed().
     */
    private async clean(window: { contents: ComponentSdkModuleContents; script: string; receipt: string; result: Record<string, unknown> }): Promise<void> {
        const destroyed = window.contents.isDestroyed();
        if (!destroyed) await window.contents.executeJavaScript('require(' + JSON.stringify(window.script) + ').unload()', false);
        // Keep an earlier failure receipt authoritative even when later cleanup succeeds.
        if (this.failedReceipts.has(window.receipt)) return;
        this.ports.writeReceipt(window.receipt, { ...window.result, installed: false,
            cleanup: destroyed ? 'contents-destroyed-before-cleanup' : 'module-unloaded' });
    }

    /**
     * @description Shutdown never relabels an actual failure as cancellation; diagnostic failures also propagate.
     */
    private failed(error: unknown, receipt?: string): void {
        this.failures.push(error);
        if (receipt) {
            this.failedReceipts.add(receipt);
            try { this.ports.writeReceipt(receipt, { installed: false, failed: true, cancelled: false, installationState: 'unknown', cleanup: 'unknown',
                error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }); }
            catch (receiptError) { this.failures.push(receiptError); this.report(receiptError); }
        }
        this.report(error);
    }

    /**
     * @description Preserve logger errors in the cleanup outcome without creating detached promise failures.
     */
    private report(error: unknown): void {
        try { this.ports.reportError(error); } catch (logError) { this.failures.push(logError); }
    }
}

/**
 * @description Minimal existing Electron webContents contract; the helper creates no window or listener.
 */
export interface ComponentSdkModuleContents {
    isDestroyed(): boolean;
    executeJavaScript(source: string, userGesture: false): Promise<Record<string, unknown> | undefined>;
}

/**
 * @description Existing entry-point I/O only, injectable for deferred-promise lifecycle tests.
 */
export interface ComponentSdkModulePorts {
    writeReceipt(path: string, result: Record<string, unknown>): void;
    reportError(error: unknown): void;
    delay(milliseconds: number): Promise<void>;
}
