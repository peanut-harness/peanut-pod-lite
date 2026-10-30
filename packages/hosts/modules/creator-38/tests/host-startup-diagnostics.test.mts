import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { HostStartupDiagnostics } = require('../src/host-startup-diagnostics.ts');
const own = { name: 'peanut-pod-lite-host', path: '/project/extensions/peanut-pod-lite-host' };
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(reply: () => Promise<unknown> = async () => false, existingEnabled: unknown = null, run?: () => Promise<unknown>) {
    const broadcasts = new EventEmitter(); const failures: unknown[] = []; const records: unknown[] = [];
    let enabledPackage = existingEnabled as { name: string; path: string; enable: boolean } | null;
    let requests = 0; let runs = 0;
    const observer = new HostStartupDiagnostics({ getEnabledPackage: () => enabledPackage, extensionPath: own.path,
        messages: { addBroadcastListener: (name: string, callback: () => void) => broadcasts.on(name, callback),
            removeBroadcastListener: (name: string, callback: () => void) => broadcasts.removeListener(name, callback),
            request: async (name: string, method: string) => { assert.equal(name, 'asset-db'); assert.equal(method, 'query-ready'); requests++; return reply(); } },
        run: async () => { runs++; return run ? run() : { passed: 1 }; }, record: (...value: unknown[]) => records.push(value), fail: (error: unknown) => failures.push(error) });
    return { observer, broadcasts, failures, records, enablePackage: (info: { name: string; path: string; enable: boolean }) => { enabledPackage = info; },
        counts: () => ({ requests, runs }) };
}

test('cold load waits for Creator package activation and asset-db readiness before running smoke once', async () => {
    const ctx = setup(); ctx.observer.loadedSuccessfully();
    assert.deepEqual(ctx.counts(), { requests: 0, runs: 0 });
    ctx.enablePackage({ ...own, enable: true }); await flush(); assert.deepEqual(ctx.counts(), { requests: 1, runs: 0 });
    ctx.broadcasts.emit('asset-db:ready'); await flush(); ctx.broadcasts.emit('asset-db:ready'); await flush();
    assert.deepEqual(ctx.counts(), { requests: 1, runs: 1 }); assert.deepEqual(ctx.failures, []); await ctx.observer.dispose();
});

test('hot reload queries ready after the Creator load hook and enabled package readback', async () => {
    const ctx = setup(async () => true, { ...own, enable: true }); ctx.observer.loadedSuccessfully(); await flush();
    assert.deepEqual(ctx.counts(), { requests: 1, runs: 1 }); await ctx.observer.dispose();
});

test('ready observed before the false query reply is retained, without treating Core load as ready', async () => {
    let reply!: (value: unknown) => void; const ctx = setup(() => new Promise(resolve => { reply = resolve; }));
    ctx.enablePackage({ ...own, enable: true }); ctx.observer.loadedSuccessfully(); ctx.broadcasts.emit('asset-db:ready'); await flush();
    reply(false); await flush(); assert.equal(ctx.counts().runs, 1); await ctx.observer.dispose();
});

test('query rejection, malformed ready and smoke failures preserve actual diagnostic errors', async () => {
    for (const reply of [async () => { throw new Error('sdk-query-failed'); }, async () => ({ ready: true })]) {
        const ctx = setup(reply, { ...own, enable: true }); ctx.observer.loadedSuccessfully(); await flush();
        assert.equal(ctx.failures.length, 1); assert.equal(ctx.counts().runs, 0); await ctx.observer.dispose();
    }
    const ctx = setup(async () => true, { ...own, enable: true }, async () => { throw new Error('actual-smoke-failed'); });
    ctx.observer.loadedSuccessfully(); await flush(); assert.match(String(ctx.failures[0]), /actual-smoke-failed/u); await ctx.observer.dispose();
});

test('Creator 3.8 Editor.Package query facade is used instead of private EventEmitter methods', async () => {
    const extensionPath = mkdtempSync(join(tmpdir(), 'creator-383-extension-'));
    const broadcasts = new EventEmitter(); const failures: unknown[] = []; const records: unknown[] = [];
    let requests = 0; let runs = 0; let activePackages: unknown[] = []; const queries: unknown[] = [];
    const packageApi = { getPackages: (options?: unknown) => { queries.push(options); return activePackages; } };
    const Message = {
        addBroadcastListener: (name: string, callback: () => void) => broadcasts.on(name, callback),
        removeBroadcastListener: (name: string, callback: () => void) => broadcasts.removeListener(name, callback),
        request: async () => { requests++; return false; }
    };
    try {
        const observer = HostStartupDiagnostics.fromSdk({ App: { version: '3.8.3' }, Message, Package: packageApi }, {
            extensionPath, run: async () => { runs++; return { passed: 1 }; },
            record: (...value: unknown[]) => records.push(value), fail: (error: unknown) => failures.push(error)
        });
        observer.loadedSuccessfully();
        assert.equal(queries.length, 0);
        activePackages = [{ name: own.name, path: realpathSync(extensionPath), enable: true }];
        await flush();
        broadcasts.emit('asset-db:ready'); await flush();
        assert.equal(requests, 1, JSON.stringify({ records, failures })); assert.equal(runs, 1); assert.deepEqual(failures, []);
        assert.deepEqual(queries, [{ name: 'peanut-pod-lite-host', enable: true }]);
        assert.ok(records.some(record => Array.isArray(record) && record[0] === 'complete'));
        await observer.dispose();
    } finally { rmSync(extensionPath, { recursive: true, force: true }); }
});

test('Creator 3.8 startup diagnostics fail closed when its own package is not enabled after load', async () => {
    const extensionPath = mkdtempSync(join(tmpdir(), 'creator-383-extension-missing-package-'));
    try {
        const failures: unknown[] = [];
        const observer = HostStartupDiagnostics.fromSdk({ App: { version: '3.8.3' }, Package: { getPackages: () => [
            { name: own.name, path: extensionPath, enable: false }
        ] }, Message: {
            addBroadcastListener: () => {}, removeBroadcastListener: () => {}, request: async () => false
        } }, { extensionPath, run: async () => ({}), record: () => {}, fail: error => failures.push(error) });
        observer.loadedSuccessfully(); await flush();
        assert.match(String(failures[0]), /host_startup_diagnostics_extension_not_enabled/u);
        await observer.dispose();
    } finally { rmSync(extensionPath, { recursive: true, force: true }); }
});

test('Creator 3.8 startup diagnostics fail closed when the public package query API is missing', () => {
    const extensionPath = mkdtempSync(join(tmpdir(), 'creator-383-extension-missing-query-'));
    try {
        assert.throws(() => HostStartupDiagnostics.fromSdk({ App: { version: '3.8.3' }, Message: {
            addBroadcastListener: () => {}, removeBroadcastListener: () => {}, request: async () => false
        } }, { extensionPath, run: async () => ({}), record: () => {}, fail: () => {} }), /host_startup_diagnostics_package_query_unavailable/u);
    } finally { rmSync(extensionPath, { recursive: true, force: true }); }
});

test('unload removes only owned listeners, cancels pending readiness and repeated reload has no growth', async () => {
    const ctx = setup(); const foreign = () => {}; ctx.broadcasts.on('asset-db:ready', foreign);
    await ctx.observer.dispose(); assert.equal(ctx.broadcasts.listenerCount('asset-db:ready'), 1);
    ctx.broadcasts.emit('asset-db:ready'); assert.deepEqual(ctx.counts(), { requests: 0, runs: 0 });
    for (let index = 0; index < 10; index++) { const next = setup(async () => true, own); next.observer.loadedSuccessfully(); await flush(); await next.observer.dispose();
        assert.equal(next.broadcasts.listenerCount('asset-db:ready'), 0); }
});

// Frozen readable SDK JavaScript only; assertions never evaluate these SDK modules.
const sdkSources: Record<string, string> = {"index.js": "\"use strict\";\"browser\"===process.type?module.exports=require(\"./dist/browser\"):\"renderer\"===process.type&&(module.exports=require(\"./dist/renderer\"));", "dist/browser/index.js": "\"use strict\";Object.defineProperty(exports,\"__esModule\",{value:!0}),exports.PackageManager=void 0;const package_1=require(\"./package\"),ipc=require(\"@base/electron-base-ipc\"),events_1=require(\"events\"),pkg=require(\"../../package.json\"),ipcFlag=`${pkg.name}@${pkg.version}`;class PackageManager extends events_1.EventEmitter{constructor(){super(...arguments),this.path2pkg={},this.name2pkg={}}contributionTo(e,t){if(t.info.contributions)for(let n in t.info.contributions){const r=this.name2pkg[n];if(r)try{const o=t.info.contributions[n];r.contributionTo(e,t,o)}catch(e){console.error(`[${t.name}] Data from \"${n}\" cannot be accepted.`),console.error(e)}}}contributionFrom(e){for(let t in this.path2pkg){const n=this.path2pkg[t],r=e.name;if(n.json&&n.json.contributions&&n.json.contributions[r])try{e.contributionTo(\"register\",n.generateInfo(),n.json.contributions[r]),n.enabled&&e.contributionTo(\"enable\",n.generateInfo(),n.json.contributions[r])}catch(t){console.error(`[${e.name}] Data from \"${n.name}\" cannot be accepted.`),console.error(t)}}}register(e){if(this.path2pkg[e])return this.path2pkg[e].generateInfo();const t=new package_1.Package(e);this.path2pkg[e]=t,t.execHook(\"register\");const n=t.generateInfo();return this.contributionTo(\"register\",n),this.emit(\"register\",n),ipc.broadcast(`${ipcFlag}:emit`,\"register\",n),n}unregister(e){const t=this.path2pkg[e];if(!t)return;t.enabled&&this.disable(e),delete this.path2pkg[e];const n=t.generateInfo();return this.contributionTo(\"unregister\",n),this.emit(\"unregister\",n),ipc.broadcast(`${ipcFlag}:emit`,\"unregister\",n),t.execHook(\"unregister\"),n}async enable(e){const t=this.path2pkg[e];if(!t)return;if(this.name2pkg[t.name])return;if(t.enabled)return;if(this.emit(\"before-enable\",t.generateInfo()),await t.enable(),!t.enabled){return t.generateInfo()}this.name2pkg[t.name]=t;const n=t.generateInfo();return this.contributionTo(\"enable\",n),this.contributionFrom(t),this.emit(\"enable\",n),ipc.broadcast(`${ipcFlag}:emit`,\"enable\",n),n}async disable(e){const t=this.path2pkg[e];if(!t)return;if(this.emit(\"before-disable\",t.generateInfo()),!t.enabled)return;try{await t.disable()}catch(e){if(console.error(e),!t.enabled){return t.generateInfo()}}delete this.name2pkg[t.name];const n=t.generateInfo();return this.contributionTo(\"disable\",n),this.contributionFrom(t),this.emit(\"disable\",n),ipc.broadcast(`${ipcFlag}:emit`,\"disable\",n),n}find(e){return this.name2pkg[e]||null}exec(e,t,...n){return ipc.emit(`${ipcFlag}:exec`,e,t,...n)}execSync(e,t,...n){return ipc.emit(`${ipcFlag}:exec`,e,t,...n)}execWithoutReply(e,t,...n){ipc.emit(`${ipcFlag}:exec-without-reply`,e,t,...n)}reload(e){return ipc.emit(`${ipcFlag}:reload`,e)}debugRely(e){package_1.Package.debugRely(e)}}exports.PackageManager=PackageManager,module.exports=new PackageManager,ipc.on(`${ipcFlag}:exec`,async(e,t,n,...r)=>{let o,i=module.exports.find(t);if(!i){const n=new Error(`The '${t}' plug-in does not exist.`);throw e.reply(n),n}try{o=await i.exec(n,...r)}catch(t){if(t instanceof Error||(t=new Error(\"The exception needs to be 'Error'\\n  You have thrown a normal data in a message.\\n  The exception needs to be an error object.\")),e.needCallback)return e.reply(t),o;throw t}return e.reply(null,o),o}),ipc.on(`${ipcFlag}:exec-without-reply`,async(e,t,n,...r)=>{let o=module.exports.find(t);if(!o){const n=new Error(`The '${t}' plug-in does not exist.`);throw e.reply(n),n}try{await o.execWithoutReply(n,...r)}catch(e){throw e instanceof Error||(e=new Error(\"The exception needs to be 'Error'\\n  You have thrown a normal data in a message.\\n  The exception needs to be an error object.\")),e}}),ipc.on(`${ipcFlag}:reload`,async(e,t)=>{let n=module.exports.find(t);n?(await n.unload(),await n.load(),e.reply(null)):e.reply(new Error(`The '${t}' plug-in does not exist.`))});", "dist/renderer/index.js": "\"use strict\";const panel=require(\"@editor/panel\"),{EventEmitter:EventEmitter}=require(\"events\"),electronSync=require(\"v-electron-sync\"),ipc=require(\"@base/electron-base-ipc\"),pkg=require(\"../../package.json\"),ipcFlag=`${pkg.name}@${pkg.version}`;class PackageManager extends EventEmitter{exec(e,c,...r){return ipc.send(`${ipcFlag}:exec`,e,c,...r)}execSync(e,c,...r){return ipc.sendSync(`${ipcFlag}:exec`,e,c,...r)}execWithoutReply(e,c,...r){ipc.send(`${ipcFlag}:exec-without-reply`,e,c,...r)}reload(e){return ipc.send(`${ipcFlag}:reload`,e)}}module.exports=new PackageManager,ipc.on(`${ipcFlag}:emit`,(e,c,...r)=>{module.exports.emit(c,...r)});"};
test('frozen 3.8.3/3.8.7 SDK normal export proves enable ordering, find membership and reload without enable', () => {
    const root = mkdtempSync(join(tmpdir(), 'host-sdk-package-source-'));
    try {
        for (const [file, source] of Object.entries(sdkSources)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), source); }
        HostStartupDiagnostics.assertSource(root);
        const browser = sdkSources['dist/browser/index.js'];
        const enable = browser.slice(browser.indexOf('async enable('), browser.indexOf('async disable('));
        assert.ok(enable.indexOf('await t.enable()') < enable.indexOf('this.name2pkg[t.name]=t'));
        assert.ok(enable.indexOf('this.contributionTo("enable",n)') < enable.indexOf('this.emit("enable",n)'));
        assert.match(browser, /find\(e\)\{return this\.name2pkg\[e\]\|\|null\}/u);
        assert.match(browser, /await n\.unload\(\),await n\.load\(\),e\.reply\(null\)/u);
        writeFileSync(join(root, 'dist/browser/index.js'), browser + '\n');
        assert.throws(() => HostStartupDiagnostics.assertSource(root), /sdk_source_mismatch/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unload awaits an already running smoke and preserves its rejection after listener disposal', async () => {
    let reject!: (error: Error) => void;
    const ctx = setup(async () => true, own, () => new Promise((_, fail) => { reject = fail; }));
    ctx.observer.loadedSuccessfully(); await flush(); const disposed = ctx.observer.dispose();
    reject(new Error('smoke-rejected-during-unload')); await disposed;
    assert.match(String(ctx.failures[0]), /smoke-rejected-during-unload/u);
    assert.equal(ctx.broadcasts.listenerCount('asset-db:ready'), 0);
});

test('unload waits for pending query resolution and never starts smoke after disposal', async () => {
    let resolveQuery!: (value: unknown) => void;
    const ctx = setup(() => new Promise(resolve => { resolveQuery = resolve; }), own);
    ctx.observer.loadedSuccessfully(); await flush();
    let settled = false; const disposed = ctx.observer.dispose().then(() => { settled = true; });
    await flush(); assert.equal(settled, false);
    resolveQuery(true); await disposed;
    assert.equal(settled, true); assert.equal(ctx.counts().runs, 0); assert.deepEqual(ctx.failures, []);
});

test('unload waits for pending query rejection and preserves its actual failure after disposal', async () => {
    let rejectQuery!: (error: Error) => void;
    const ctx = setup(() => new Promise((_, reject) => { rejectQuery = reject; }), own);
    ctx.observer.loadedSuccessfully(); await flush();
    let settled = false; const disposed = ctx.observer.dispose().then(() => { settled = true; });
    await flush(); assert.equal(settled, false); assert.equal(ctx.broadcasts.listenerCount('asset-db:ready'), 0);
    rejectQuery(new Error('query-rejected-during-unload')); await disposed;
    assert.equal(settled, true); assert.equal(ctx.counts().runs, 0);
    assert.match(String(ctx.failures[0]), /query-rejected-during-unload/u);
    assert.ok(ctx.records.some((record: unknown) => Array.isArray(record) && record[0] === 'failed' && record[1] === 'query-rejected-during-unload'));
});

test('unload retains an invalid SDK ready reply instead of treating disposal as successful cancellation', async () => {
    let resolveQuery!: (value: unknown) => void;
    const ctx = setup(() => new Promise(resolve => { resolveQuery = resolve; }), own);
    ctx.observer.loadedSuccessfully(); await flush();
    const disposed = ctx.observer.dispose(); resolveQuery({ ready: true }); await disposed;
    assert.equal(ctx.counts().runs, 0);
    assert.match(String(ctx.failures[0]), /host_startup_diagnostics_ready_reply_invalid/u);
});
