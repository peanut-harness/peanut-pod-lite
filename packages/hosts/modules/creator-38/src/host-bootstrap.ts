'use strict';

const path = require('path');
const { resolve } = path;
const { HostUpdateCoordinator } = require('./host-update-coordinator.ts');

function createHostBootstrap({ extensionRoot, projectPath, getEditor = () => globalThis.Editor, waitForAssetDbReady: waitForReady = null }) {
    let runtime = null;
    let coordinator = null;
    let quitListenerRegistered = false;
    let runtimeReady = false;
    let initialization = null;
    let initializationFailure = null;
    let cancelAssetDbWait = null;
    let unloading = false;

    function getCoordinator() {
        if (coordinator != null) return coordinator;
        const selectedProjectPath = projectPath ?? getEditor()?.Project?.path;
        if (typeof selectedProjectPath !== 'string' || selectedProjectPath.trim().length === 0) {
            throw new Error('peanut_host_update_project_unavailable');
        }
        coordinator = new HostUpdateCoordinator({ extensionRoot, projectPath: selectedProjectPath });
        return coordinator;
    }

    function registerQuitListener() {
        if (quitListenerRegistered) return;
        const app = getEditor()?.App;
        if (typeof app?.on !== 'function') return;
        app.on('quit', () => {
            try {
                getCoordinator().applyStagedAtExit();
            } catch (error) {
                try {
                    getCoordinator().writeState({
                        ...(getCoordinator().readState() ?? {}),
                        state: 'switch_failed',
                        error: normalizeError(error),
                        message: 'Lite Host update was not switched; the current Host remains available.',
                    });
                } catch {
                    // The previous Host remains intact if update state cannot be saved.
                }
            }
        });
        quitListenerRegistered = true;
    }

    function loadRuntime(entryPath) {
        const selectedPath = entryPath ?? getCoordinator().runtimeEntry();
        if (typeof selectedPath !== 'string' || !selectedPath.endsWith(`${path.sep}main.js`)) {
            throw new Error('peanut_host_update_runtime_invalid');
        }
        delete require.cache[selectedPath];
        return require(selectedPath);
    }

    async function initializeRuntime() {
        if (unloading) throw new Error('peanut_host_startup_cancelled');
        const update = getCoordinator();
        const state = update.readState();
        const candidateNeedsHealthCheck = state?.state === 'switching' || state?.state === 'pending-health-check';
        try {
            await (waitForReady ?? waitForSdkAssetDbReady)();
            if (unloading) throw new Error('peanut_host_startup_cancelled');
            runtime = loadRuntime();
            await runtime.load({ extensionRoot });
            const health = await runtime.methods.queryStatus();
            if (candidateNeedsHealthCheck) update.confirmHealthy(health);
            runtimeReady = true;
            return health;
        } catch (error) {
            if (!candidateNeedsHealthCheck || unloading) throw error;
            try {
                await runtime?.unload?.();
            } catch {
                // The candidate remains isolated in its version directory.
            }
            update.rollback(error);
            runtime = loadRuntime(update.runtimeEntry());
            try {
                await runtime.load({ extensionRoot });
            } catch (rollbackError) {
                update.writeState({
                    ...(update.readState() ?? {}),
                    state: 'rollback-unconfirmed',
                    error: normalizeError(rollbackError),
                    message: 'Lite Host update failed. The previous runtime could not be confirmed; inspect the retained previous package before continuing.',
                });
                throw rollbackError;
            }
            const health = await runtime.methods.queryStatus();
            runtimeReady = true;
            return health;
        }
    }

    async function load() {
        registerQuitListener();
        runtimeReady = false;
        initializationFailure = null;
        unloading = false;
        runtime = null;
        initialization = new Promise((resolve, reject) => {
            setImmediate(() => {
                initializeRuntime().then(resolve, reject);
            });
        });
        void initialization.catch(error => { initializationFailure = error; });
        // Creator enables package contributions only after this resolves. Keep package IO,
        // runtime require and startup behind that boundary so the SDK timer worker registers first.
        return undefined;
    }

    async function unload() {
        unloading = true;
        cancelAssetDbWait?.();
        try {
            await initialization;
        } catch {
            // Shutdown still unloads the runtime after a failed asynchronous startup.
        }
        const current = runtime;
        runtime = null;
        runtimeReady = false;
        initialization = null;
        initializationFailure = null;
        if (typeof current?.unload === 'function') await current.unload();
    }

    function waitForSdkAssetDbReady() {
        const messages = getEditor()?.Message;
        if (typeof messages?.request !== 'function' || typeof messages.addBroadcastListener !== 'function'
            || typeof messages.removeBroadcastListener !== 'function') throw new Error('peanut_host_asset_db_ready_api_unavailable');
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error) => {
                if (settled) return;
                settled = true;
                cancelAssetDbWait = null;
                let failure = error;
                try { messages.removeBroadcastListener('asset-db:ready', onReady); }
                catch (cleanupError) { failure ??= cleanupError; }
                if (failure) reject(failure); else resolve();
            };
            const onReady = () => finish();
            try { messages.addBroadcastListener('asset-db:ready', onReady); }
            catch (error) { finish(error); return; }
            cancelAssetDbWait = () => finish(new Error('peanut_host_startup_cancelled'));
            Promise.resolve().then(() => messages.request('asset-db', 'query-ready')).then(ready => {
                if (typeof ready !== 'boolean') { finish(new Error('peanut_host_asset_db_ready_reply_invalid')); return; }
                if (ready) finish();
            }, finish);
        });
    }

    function createMethodsProxy() {
        return new Proxy({}, {
            get(_target, property) {
                if (property === 'queryLiteHostUpdateStatus') return () => getCoordinator().status();
                if (property === 'stageLiteHostUpdate') {
                    return (candidatePath, descriptor) => getCoordinator().stage(candidatePath, descriptor);
                }
                if (property === 'requestLiteHostRestart') {
                    return () => {
                        const status = getCoordinator().status();
                        if (status.state !== 'staged') throw new Error('peanut_host_update_not_staged');
                        if (typeof getEditor()?.App?.quit !== 'function') throw new Error('peanut_host_update_restart_unavailable');
                        // Creator's extension process does not reliably receive Editor.App's
                        // final `quit` event. This explicit restart route is invoked only
                        // after the user asks to restart, so switch atomically immediately
                        // before asking Creator to quit; startup then health-checks the new Host.
                        getCoordinator().applyStagedAtExit();
                        getEditor().App.quit();
                        return getCoordinator().status();
                    };
                }
                if (typeof property !== 'string' || property === 'then') return undefined;
                const method = runtime?.methods?.[property];
                if (typeof method !== 'function' && (runtime !== null || !initialization)) return undefined;
                return (...args) => {
                    if (initializationFailure) throw initializationFailure;
                    const invoke = () => {
                        const currentMethod = runtime?.methods?.[property];
                        if (typeof currentMethod !== 'function') throw new Error('peanut_host_runtime_method_unavailable');
                        return Reflect.apply(currentMethod, runtime.methods, args);
                    };
                    return runtimeReady || !initialization ? invoke() : initialization.then(invoke);
                };
            },
            ownKeys() {
                return [...new Set([
                    ...Object.keys(runtime?.methods ?? {}),
                    'queryLiteHostUpdateStatus',
                    'stageLiteHostUpdate',
                    'requestLiteHostRestart',
                ])];
            },
            getOwnPropertyDescriptor(_target, property) {
                return this.ownKeys().includes(property) ? { configurable: true, enumerable: true } : undefined;
            },
        });
    }

    return { load, unload, methods: createMethodsProxy() };
}

function normalizeError(error) {
    return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

const hostBootstrap = createHostBootstrap({ extensionRoot: resolve(__dirname, '..') });

module.exports = hostBootstrap;
Object.defineProperty(module.exports, 'createHostBootstrap', { value: createHostBootstrap });
