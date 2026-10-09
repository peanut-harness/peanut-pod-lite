'use strict';

const path = require('path');
const { resolve } = path;
const { HostUpdateCoordinator } = require('./host-update-coordinator.ts');

function createHostBootstrap({ extensionRoot, projectPath, getEditor = () => globalThis.Editor }) {
    let runtime = null;
    let coordinator = null;
    let quitListenerRegistered = false;

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

    async function load() {
        registerQuitListener();
        const update = getCoordinator();
        const state = update.readState();
        const candidateNeedsHealthCheck = state?.state === 'switching' || state?.state === 'pending-health-check';
        try {
            runtime = loadRuntime();
            await runtime.load();
            const health = await runtime.methods.queryStatus();
            if (candidateNeedsHealthCheck) update.confirmHealthy(health);
            return health;
        } catch (error) {
            if (!candidateNeedsHealthCheck) throw error;
            try {
                await runtime?.unload?.();
            } catch {
                // The candidate remains isolated in its version directory.
            }
            update.rollback(error);
            runtime = loadRuntime(update.runtimeEntry());
            try {
                await runtime.load();
            } catch (rollbackError) {
                update.writeState({
                    ...(update.readState() ?? {}),
                    state: 'rollback-unconfirmed',
                    error: normalizeError(rollbackError),
                    message: 'Lite Host update failed. The previous runtime could not be confirmed; inspect the retained previous package before continuing.',
                });
                throw rollbackError;
            }
            return runtime.methods.queryStatus();
        }
    }

    async function unload() {
        const current = runtime;
        runtime = null;
        if (typeof current?.unload === 'function') await current.unload();
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
                const method = runtime?.methods?.[property];
                return typeof method === 'function' ? method.bind(runtime.methods) : undefined;
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
