import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ComponentSdkWindowModuleLifecycle, type ComponentSdkModuleContents } from '../../../../../tests/fixtures/editor-stability/components/component-sdk-window-module-lifecycle.ts';

/**
 * @description Controlled asynchronous native outcome without an SDK process.
 */
function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void; let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
/**
 * @description Flush bounded Promise continuations without timing dependencies.
 */
async function flush(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve(); }
/**
 * @description Run the real helper through observable diagnostic and wait ports.
 */
function fixture() {
    const receipts = new Map<string, Record<string, unknown>>(); const errors: unknown[] = []; const delays: ReturnType<typeof deferred<void>>[] = [];
    const lifecycle = new ComponentSdkWindowModuleLifecycle({ writeReceipt: (path, result) => { receipts.set(path, result); },
        reportError: error => { errors.push(error); }, delay: () => { const gate = deferred(); delays.push(gate); return gate.promise; } });
    return { lifecycle, receipts, errors, delays };
}
/**
 * @description Track actual load/unload calls separately from pre-call destruction.
 */
function contents(load: () => Promise<Record<string, unknown> | undefined>, unload: () => Promise<Record<string, unknown> | undefined> = async () => undefined) {
    const calls: string[] = []; let destroyed = false;
    const value: ComponentSdkModuleContents = { isDestroyed: () => destroyed, executeJavaScript: source => {
        const method = source.includes('.load()') ? 'load' : 'unload'; calls.push(method); return method === 'load' ? load() : unload(); } };
    return { value, calls, destroy: () => { destroyed = true; } };
}

test('late installed result is unloaded before close completes', async () => {
    const f = fixture(); const load = deferred<Record<string, unknown>>(); const cleanup = deferred<Record<string, unknown> | undefined>();
    const c = contents(() => load.promise, () => cleanup.promise); f.lifecycle.install(() => c.value, 'owned.js', 'receipt'); await flush();
    let closed = false; const closing = f.lifecycle.close().then(() => { closed = true; });
    load.resolve({ installed: true, calls: 3 }); await flush(); assert.equal(closed, false); assert.deepEqual(c.calls, ['load', 'unload']);
    cleanup.resolve(undefined); await closing; assert.equal(f.lifecycle.canRestart, true);
    assert.deepEqual(f.receipts.get('receipt'), { installed: false, calls: 3, cleanup: 'module-unloaded' });
});

test('load rejection during closing retains identical error and never becomes detached or cancelled', async () => {
    const f = fixture(); const load = deferred<Record<string, unknown>>(); const error = Error('native-load-failed');
    const unhandled: unknown[] = []; const observe = (reason: unknown): void => { unhandled.push(reason); }; process.on('unhandledRejection', observe);
    try {
        const c = contents(() => load.promise); f.lifecycle.install(() => c.value, 'owned.js', 'receipt'); await flush();
        const rejected = assert.rejects(f.lifecycle.close(), reason => reason === error); c.destroy(); load.reject(error);
        await rejected; await new Promise<void>(done => setImmediate(done)); assert.deepEqual(f.errors, [error]);
        assert.equal(f.receipts.get('receipt')?.failed, true); assert.equal(f.receipts.get('receipt')?.cancelled, false);
        assert.equal(f.receipts.get('receipt')?.stack, error.stack); assert.deepEqual(unhandled, []); assert.equal(f.lifecycle.canRestart, false);
    } finally { process.removeListener('unhandledRejection', observe); }
});

test('failed late cleanup does not prevent another admitted installation cleanup', async () => {
    const f = fixture(); const a = deferred<Record<string, unknown>>(); const b = deferred<Record<string, unknown>>(); const error = Error('late-cleanup-failed');
    const first = contents(() => a.promise, async () => { throw error; }); const second = contents(() => b.promise);
    f.lifecycle.install(() => first.value, 'a.js', 'a'); f.lifecycle.install(() => second.value, 'b.js', 'b'); await flush();
    const rejected = assert.rejects(f.lifecycle.close(), reason => reason === error); a.resolve({ installed: true }); b.resolve({ installed: true }); await rejected;
    assert.deepEqual(second.calls, ['load', 'unload']); assert.deepEqual(f.errors, [error]);
    assert.equal(f.receipts.get('a')?.failed, true); assert.equal(f.receipts.get('a')?.installationState, 'unknown');
    assert.equal(f.receipts.get('a')?.cleanup, 'unknown'); assert.equal(f.receipts.get('b')?.cleanup, 'module-unloaded');
});

test('pre-call destroyed state differs from cleanup rejection followed by destruction', async () => {
    const f = fixture(); const cleanup = deferred<Record<string, unknown> | undefined>(); const error = Error('native-unload-failed');
    const before = contents(async () => ({ installed: true })); const during = contents(async () => ({ installed: true }), () => cleanup.promise);
    f.lifecycle.install(() => before.value, 'before.js', 'before'); f.lifecycle.install(() => during.value, 'during.js', 'during'); await flush();
    before.destroy(); const rejected = assert.rejects(f.lifecycle.close(), reason => reason === error); await flush(); during.destroy(); cleanup.reject(error); await rejected;
    assert.deepEqual(before.calls, ['load']); assert.equal(f.receipts.get('before')?.cleanup, 'contents-destroyed-before-cleanup');
    assert.deepEqual(during.calls, ['load', 'unload']); assert.equal(f.receipts.get('during')?.failed, true); assert.deepEqual(f.errors, [error]);
});

test('concurrent close shares one promise and restores every owned listener once', async () => {
    const f = fixture(); let listeners = 2; let restores = 0;
    for (let i = 0; i < 2; i++) f.lifecycle.own(() => { listeners--; restores++; });
    const c = contents(async () => ({ installed: true })); f.lifecycle.install(() => c.value, 'owned.js', 'receipt'); await flush();
    const a = f.lifecycle.close(); assert.equal(a, f.lifecycle.close()); assert.equal(f.lifecycle.isOpen, false); await a;
    assert.equal(listeners, 0); assert.equal(restores, 2); assert.deepEqual(c.calls, ['load', 'unload']); assert.equal(f.lifecycle.close(), a);
});

test('closed admission cannot invoke stale lookup or mutate a later generation', async () => {
    const old = fixture(); const gate = deferred<Record<string, unknown>>(); const c = contents(() => gate.promise);
    old.lifecycle.install(() => c.value, 'old.js', 'old'); await flush(); const closing = old.lifecycle.close(); assert.equal(old.lifecycle.canRestart, false);
    let staleLookups = 0; const stalePhaseCallback = (): void => { if (old.lifecycle.isOpen) old.lifecycle.install(() => { staleLookups++; return c.value; }, 'old.js', 'old'); };
    stalePhaseCallback(); old.lifecycle.install(() => { staleLookups++; return c.value; }, 'old.js', 'old'); gate.resolve({ installed: true }); await closing;
    assert.equal(old.lifecycle.canRestart, true); const next = fixture(); const n = contents(async () => ({ installed: true, next: true }));
    next.lifecycle.install(() => n.value, 'next.js', 'next'); await flush(); stalePhaseCallback(); assert.equal(staleLookups, 0);
    assert.equal(next.receipts.get('next')?.next, true); assert.equal(old.receipts.has('next'), false); await next.lifecycle.close();
});

test('poll wakeup after stop invokes no native operation and records clean cancellation', async () => {
    const f = fixture(); let lookups = 0; const c = contents(async () => ({ installed: true }));
    f.lifecycle.install(() => { lookups++; return lookups === 1 ? null : c.value; }, 'owned.js', 'receipt'); await flush();
    assert.equal(f.delays.length, 1); const closing = f.lifecycle.close(); f.delays[0]!.resolve(); await closing;
    assert.equal(lookups, 1); assert.deepEqual(c.calls, []); assert.equal(f.receipts.get('receipt')?.cancelled, true); assert.deepEqual(f.errors, []);
});

test('observer restore failures retain evidence while all other cleanup runs', async () => {
    const f = fixture(); const first = Error('restore-first'); const second = Error('restore-second'); let healthy = 0;
    f.lifecycle.own(() => { throw first; }); f.lifecycle.own(() => { healthy++; }); f.lifecycle.own(() => { throw second; });
    const c = contents(async () => ({ installed: true })); f.lifecycle.install(() => c.value, 'owned.js', 'receipt'); await flush();
    await assert.rejects(f.lifecycle.close(), error => error instanceof AggregateError && error.errors.includes(first) && error.errors.includes(second));
    assert.equal(healthy, 1); assert.deepEqual(c.calls, ['load', 'unload']); assert.deepEqual(f.errors, [second, first]);
});

test('receipt and logger both failing retain every cause without unhandled detached rejection', async () => {
    const receiptError = Error('receipt-failed'); const logError = Error('logger-failed'); let cleaned = 0;
    const unhandled: unknown[] = []; const observe = (reason: unknown): void => { unhandled.push(reason); }; process.on('unhandledRejection', observe);
    try {
        const lifecycle = new ComponentSdkWindowModuleLifecycle({ writeReceipt: () => { throw receiptError; }, reportError: () => { throw logError; }, delay: async () => {} });
        const c = contents(async () => ({ installed: true }), async () => { cleaned++; return undefined; }); lifecycle.install(() => c.value, 'owned.js', 'receipt'); await flush();
        await assert.rejects(lifecycle.close(), error => error instanceof AggregateError && error.errors.includes(receiptError)
            && error.errors.includes(logError) && error.errors.length === 4);
        await new Promise<void>(done => setImmediate(done)); assert.equal(cleaned, 1); assert.deepEqual(unhandled, []);
    } finally { process.removeListener('unhandledRejection', observe); }
});

test('successful later cleanup cannot overwrite an earlier failed receipt', async () => {
    const receipts = new Map<string, Record<string, unknown>>(); const error = Error('initial-receipt-write-failed'); let writes = 0;
    const lifecycle = new ComponentSdkWindowModuleLifecycle({ writeReceipt: (path, result) => {
        if (++writes === 1) throw error; receipts.set(path, result);
    }, reportError: () => {}, delay: async () => {} });
    const c = contents(async () => ({ installed: true })); lifecycle.install(() => c.value, 'owned.js', 'receipt'); await flush();
    await assert.rejects(lifecycle.close(), reason => reason === error); assert.deepEqual(c.calls, ['load', 'unload']);
    assert.equal(receipts.get('receipt')?.failed, true); assert.equal(receipts.get('receipt')?.installationState, 'unknown');
});

test('partial synchronous setup abort closes admission and cleans without a loader unload call', async () => {
    const f = fixture(); const setupError = Error('sdk-ipc-unavailable'); let listeners = 1;
    const unhandled: unknown[] = []; const observe = (reason: unknown): void => { unhandled.push(reason); }; process.on('unhandledRejection', observe);
    try {
        f.lifecycle.own(() => { listeners--; }); f.lifecycle.abort(setupError); assert.equal(f.lifecycle.isOpen, false);
        await flush(); assert.equal(listeners, 0); assert.equal(f.lifecycle.canRestart, false);
        assert.ok(f.errors.includes(setupError)); await assert.rejects(f.lifecycle.close(), error => error === setupError);
        await new Promise<void>(done => setImmediate(done)); assert.deepEqual(unhandled, []);
    } finally { process.removeListener('unhandledRejection', observe); }
});

test('both real entry adapters capture generation, gate reload and preserve registration', () => {
    const entries = [new URL('../scripts/resource-stability-sdk-timer-trace-main.mts', import.meta.url),
        new URL('../../../../../tests/fixtures/editor-stability/components/component-sdk-timer-trace-main.ts', import.meta.url)];
    for (const [index, path] of entries.entries()) {
        const source = readFileSync(path, 'utf8'); assert.match(source, /this\.lifecycle && !this\.lifecycle\.canRestart/u);
        assert.match(source, /const lifecycle = new ComponentSdkWindowModuleLifecycle/u);
        assert.match(source, /this\.lifecycle\?\.hookEntered\(\)/u);
        assert.match(source, /sdk-window-module-lifecycle\.ndjson/u); assert.match(source, /if \(!lifecycle\.isOpen\) return/u);
        assert.match(source, /lifecycle\.install\(/u); assert.match(source, /lifecycle\.own\(\(\) => phases\.restore\(\)\)/u);
        assert.match(source, /return this\.lifecycle\?\.close\(\) \?\? Promise\.resolve\(\)/u);
        assert.match(source, /catch \(error\) \{ lifecycle\.abort\(error\); throw error; \}/u);
        assert.match(source, /reportError: error => \{ console\.error\(error\); \}/u);
        assert.ok(source.includes("registration.task !== '" + (index === 0 ? '4.3' : '5.1') + "'"));
        assert.doesNotMatch(source, /failed: !this\.stopping|if \(!this\.stopping\) console\.error/u);
    }
});


test('synchronous admission and pending native unload phases distinguish entry from unresolved cleanup', async () => {
    const events: Record<string, unknown>[] = []; const load = deferred<Record<string, unknown>>(); const cleanup = deferred<Record<string, unknown> | undefined>();
    const lifecycle = new ComponentSdkWindowModuleLifecycle({ recordEvent: event => { events.push(event); }, writeReceipt: () => {}, reportError: () => {}, delay: async () => {} });
    const c = contents(() => load.promise, () => cleanup.promise); lifecycle.install(() => c.value, 'owned.js', 'receipt'); await flush();
    lifecycle.hookEntered(); const closing = lifecycle.close(); assert.equal(closing, lifecycle.close());
    assert.deepEqual(events.map(event => event.phase), ['generation-created', 'hook-entered', 'admission-closed']); assert.equal(events[0]?.pendingInstalls, 0); assert.equal(events[2]?.pendingInstalls, 1);
    await flush(); assert.equal(events.at(-1)?.phase, 'drain-wait'); load.resolve({ installed: true }); await flush();
    const returned = events.find(event => event.phase === 'original-unload-returned'); assert.equal(returned?.returnKind, 'native-promise');
    assert.equal(events.some(event => event.phase === 'original-unload-fulfilled'), false);
    assert.equal(events.some(event => event.phase === 'close-settled'), false); cleanup.resolve(undefined); await closing;
    assert.equal(events.find(event => event.phase === 'original-unload-fulfilled')?.resultKind, 'undefined');
    assert.equal(events.at(-1)?.phase, 'close-settled'); assert.equal(events.at(-1)?.outcome, 'fulfilled');
    assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1)); assert.deepEqual(c.calls, ['load', 'unload']);
});

test('phase append and logger failures preserve original native rejection and still attempt every cleanup', async () => {
    const nativeError = Error('original-native-unload'); const writeError = Error('phase-append'); const loggerError = Error('phase-log');
    const native = deferred<Record<string, unknown> | undefined>(); const events: Record<string, unknown>[] = []; const logged: unknown[] = []; let healthy = 0;
    const unhandled: unknown[] = []; const observe = (reason: unknown): void => { unhandled.push(reason); }; process.on('unhandledRejection', observe);
    try {
        const lifecycle = new ComponentSdkWindowModuleLifecycle({ recordEvent: event => {
            if (event.phase === 'original-unload-returned') throw writeError; events.push(event);
        }, writeReceipt: () => {}, reportError: error => { logged.push(error); if (error === writeError) throw loggerError; }, delay: async () => {} });
        const failed = contents(async () => ({ installed: true }), () => native.promise);
        const other = contents(async () => ({ installed: true }), async () => { healthy++; return undefined; });
        lifecycle.install(() => failed.value, 'failed.js', 'failed'); lifecycle.install(() => other.value, 'other.js', 'other'); await flush();
        const closing = lifecycle.close(); const rejected = assert.rejects(closing, error => error instanceof AggregateError
            && error.errors.includes(nativeError) && error.errors.includes(writeError) && error.errors.includes(loggerError));
        await flush(); failed.destroy(); native.reject(nativeError); await rejected; await new Promise<void>(done => setImmediate(done));
        assert.equal(healthy, 1); assert.ok(logged.includes(nativeError)); assert.equal(lifecycle.canRestart, false); assert.deepEqual(unhandled, []);
        assert.equal(events.find(event => event.phase === 'original-unload-rejected')?.rejectionPhase, 'await');
        assert.equal(events.at(-1)?.evidenceStatus, 'failed'); assert.equal(events.at(-1)?.outcome, 'rejected');
    } finally { process.removeListener('unhandledRejection', observe); }
});

test('sync native invocation failure remains the identical Error while destroyed pre-call invokes nothing', async () => {
    const events: Record<string, unknown>[] = []; const nativeError = Error('sync-unload');
    const lifecycle = new ComponentSdkWindowModuleLifecycle({ recordEvent: event => { events.push(event); }, writeReceipt: () => {}, reportError: () => {}, delay: async () => {} });
    const failing = contents(async () => ({ installed: true }), () => { throw nativeError; }); const gone = contents(async () => ({ installed: true }));
    lifecycle.install(() => failing.value, 'failing.js', 'failing'); lifecycle.install(() => gone.value, 'gone.js', 'gone'); await flush(); gone.destroy();
    await assert.rejects(lifecycle.close(), error => error === nativeError); assert.deepEqual(gone.calls, ['load']);
    assert.equal(events.find(event => event.phase === 'original-unload-rejected')?.rejectionPhase, 'call');
    assert.ok(events.some(event => event.phase === 'original-unload-destroyed-before-call')); assert.equal(events.at(-1)?.outcome, 'rejected');
});


test('reentrant admission event and reporting share the already-established close Promise', async () => {
    const evidenceError = Error('admission-event-write'); let lifecycle!: ComponentSdkWindowModuleLifecycle;
    let eventClose: Promise<void> | undefined; let reportClose: Promise<void> | undefined; let restored = 0;
    const events: Record<string, unknown>[] = [];
    lifecycle = new ComponentSdkWindowModuleLifecycle({ recordEvent: event => {
        events.push(event);
        if (event.phase === 'admission-closed') { eventClose = lifecycle.close(); throw evidenceError; }
    }, writeReceipt: () => {}, reportError: () => { reportClose = lifecycle.close(); }, delay: async () => {} });
    assert.equal(events[0]?.phase, 'generation-created'); lifecycle.own(() => { restored++; });
    const closing = lifecycle.close(); assert.equal(eventClose, closing); assert.equal(reportClose, closing);
    await assert.rejects(closing, error => error === evidenceError); assert.equal(restored, 1);
    assert.equal(events.filter(event => event.phase === 'admission-closed').length, 1);
    assert.equal(events.filter(event => event.phase === 'close-settled').length, 1);
});

test('generation baseline append failure remains evidence failure without blocking normal owned cleanup', async () => {
    const error = Error('baseline-write'); const phases: string[] = []; const logged: unknown[] = [];
    const lifecycle = new ComponentSdkWindowModuleLifecycle({ recordEvent: event => {
        phases.push(String(event.phase)); if (event.phase === 'generation-created') throw error;
    }, writeReceipt: () => {}, reportError: error => { logged.push(error); }, delay: async () => {} });
    const c = contents(async () => ({ installed: true })); lifecycle.install(() => c.value, 'owned.js', 'receipt'); await flush();
    assert.equal(phases[0], 'generation-created'); await assert.rejects(lifecycle.close(), reason => reason === error);
    assert.deepEqual(c.calls, ['load', 'unload']); assert.deepEqual(logged, [error]); assert.equal(lifecycle.canRestart, false);
});
