'use strict';

const { randomBytes } = require('crypto');
const { existsSync, mkdirSync, renameSync, rmSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Builds a Lite-oriented IGrantedRuntimeClientSet from the live Creator Editor
 * global without booting the full plugin-manager kernel.
 */

function getEditor() {
    return globalThis.Editor;
}

function requireMessageRequest() {
    const request = getEditor()?.Message?.request;
    if (typeof request !== 'function') {
        throw new Error('peanut_lite_editor_message_unavailable');
    }
    return request.bind(getEditor().Message);
}

function parseCreatorVersion(rawVersion) {
    const raw = typeof rawVersion === 'string' && rawVersion.trim().length > 0 ? rawVersion.trim() : '0.0.0';
    const match = /(\d+)\.(\d+)\.(\d+)/u.exec(raw);
    const major = match == null ? 0 : Number(match[1]);
    const minor = match == null ? 0 : Number(match[2]);
    const patch = match == null ? 0 : Number(match[3]);
    let phase = 'editor_api_stable';
    if (major < 3) {
        phase = 'creator_2x';
    } else if (major === 3 && minor < 6) {
        phase = 'creator_3x_early';
    }
    return Object.freeze({ raw, major, minor, patch, phase });
}

function toAssetDbUrl(pathOrUuid) {
    if (typeof pathOrUuid !== 'string' || pathOrUuid.trim().length === 0) {
        return null;
    }
    const value = pathOrUuid.trim().replace(/\\/gu, '/');
    if (value.startsWith('db://') || /^[0-9a-f-]{36}/iu.test(value)) {
        return value;
    }
    if (value.startsWith('assets/') || value === 'assets') {
        return `db://${value}`;
    }
    return `db://assets/${value.replace(/^\/+/u, '')}`;
}

function resolveAssetDiskPath(dbUrl) {
    const projectPath = getEditor()?.Project?.path;
    if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
        throw new Error('peanut_lite_project_path_unavailable');
    }
    if (!dbUrl.startsWith('db://assets/')) {
        throw new Error('peanut_lite_asset_path_invalid');
    }
    const segments = dbUrl.slice('db://'.length).split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
        throw new Error('peanut_lite_asset_path_invalid');
    }
    return join(projectPath, ...segments);
}

async function writeAssetSilently(relativePath, content) {
    const request = requireMessageRequest();
    const dbUrl = toAssetDbUrl(relativePath);
    if (dbUrl == null) {
        throw new Error('peanut_lite_asset_path_invalid');
    }
    let existing = null;
    try {
        existing = await request('asset-db', 'query-asset-info', dbUrl);
    } catch {
        existing = null;
    }
    if (existing != null) {
        await request('asset-db', 'save-asset', dbUrl, content);
        await request('asset-db', 'refresh-asset', dbUrl);
        return request('asset-db', 'query-asset-info', dbUrl);
    }
    const absolutePath = resolveAssetDiskPath(dbUrl);
    const recoveryDirectory = join(
        getEditor().Project.path,
        'temp',
        '.peanut-lite-asset-recovery',
        randomBytes(16).toString('hex'),
    );
    const orphanPaths = [absolutePath, `${absolutePath}.meta`].filter((candidate) => existsSync(candidate));
    const backups = orphanPaths.map((orphanPath) => ({
        originalPath: orphanPath,
        backupPath: join(recoveryDirectory, orphanPath.endsWith('.meta') ? 'asset.meta' : 'asset'),
    }));
    try {
        if (backups.length > 0) {
            mkdirSync(recoveryDirectory, { recursive: true });
            for (const backup of backups) {
                renameSync(backup.originalPath, backup.backupPath);
            }
        }
        await request('asset-db', 'create-asset', dbUrl, content);
        rmSync(recoveryDirectory, { recursive: true, force: true });
    } catch (error) {
        for (const backup of backups) {
            if (existsSync(backup.backupPath) && !existsSync(backup.originalPath)) {
                renameSync(backup.backupPath, backup.originalPath);
            }
        }
        rmSync(recoveryDirectory, { recursive: true, force: true });
        throw error;
    }
    await request('asset-db', 'refresh-asset', dbUrl);
    return request('asset-db', 'query-asset-info', dbUrl);
}

function readAssetSnapshot(item) {
    if (item == null || typeof item !== 'object') {
        return null;
    }
    const record = item;
    const uuid = typeof record.uuid === 'string' ? record.uuid : null;
    const path = typeof record.path === 'string' ? record.path : typeof record.url === 'string' ? record.url : '';
    const importer = typeof record.importer === 'string' ? record.importer : '';
    const name = typeof record.name === 'string' ? record.name : path.split('/').pop() ?? '';
    if (uuid == null) {
        return null;
    }
    const snapshot = { uuid, path, importer, name };
    if (record.subAssets != null && typeof record.subAssets === 'object') {
        snapshot.subAssets = record.subAssets;
    }
    return snapshot;
}

/**
 * @returns {import('@peanut/pod-sdk').IGrantedRuntimeClientSet}
 */
function createLiteGrantedRuntime() {
    const editor = getEditor();
    const versionInfo = parseCreatorVersion(editor?.App?.version ?? 'unknown');

    const message = Object.freeze({
        send: async (target, messageName, ...args) => {
            const send = editor?.Message?.send;
            if (typeof send === 'function') {
                await send(target, messageName, ...args);
                return;
            }
            await requireMessageRequest()(target, messageName, ...args);
        },
        request: async (target, messageName, ...args) => requireMessageRequest()(target, messageName, ...args),
        broadcast: async (messageName, ...args) => {
            const broadcast = editor?.Message?.broadcast;
            if (typeof broadcast === 'function') {
                await broadcast(messageName, ...args);
                return;
            }
            throw new Error('peanut_lite_editor_broadcast_unavailable');
        },
    });

    const assetRead = Object.freeze({
        query: async (pathOrUuid) => {
            const request = requireMessageRequest();
            const dbUrl = toAssetDbUrl(pathOrUuid);
            if (dbUrl == null) {
                return null;
            }
            try {
                return await request('asset-db', 'query-asset-info', dbUrl);
            } catch {
                return null;
            }
        },
        queryAssets: async (options = {}) => {
            const request = requireMessageRequest();
            try {
                const raw = await request('asset-db', 'query-assets', {
                    pattern: options.pattern ?? 'db://assets/**/*',
                    importer: options.importer,
                });
                if (!Array.isArray(raw)) {
                    return [];
                }
                return raw.map((item) => readAssetSnapshot(item)).filter((item) => item != null);
            } catch {
                return [];
            }
        },
    });

    const assetWrite = Object.freeze({
        writePrefab: async (relativePath, prefab) => {
            const content = JSON.stringify(prefab, null, 4);
            return writeAssetSilently(relativePath, content);
        },
        writeBinary: async (relativePath, content) => {
            return writeAssetSilently(relativePath, content);
        },
        refresh: async (relativePath) => {
            const request = requireMessageRequest();
            const dbUrl = toAssetDbUrl(relativePath);
            if (dbUrl == null) {
                return null;
            }
            const existing = await assetRead.query(dbUrl);
            if (existing == null) {
                return null;
            }
            try {
                await request('asset-db', 'refresh-asset', dbUrl);
            } catch {
                return null;
            }
            return assetRead.query(dbUrl);
        },
    });

    const assetDelete = Object.freeze({
        deleteAsset: async (relativePath) => {
            const request = requireMessageRequest();
            const dbUrl = toAssetDbUrl(relativePath);
            if (dbUrl == null) {
                throw new Error('peanut_lite_asset_path_invalid');
            }
            await request('asset-db', 'delete-asset', dbUrl);
        },
    });

    const scene = Object.freeze({
        getManifestField: () => 'contributions.scene.script',
        getCurrent: async () => {
            const request = requireMessageRequest();
            try {
                return (await request('scene', 'query-current-scene')) ?? null;
            } catch {
                try {
                    return (await request('scene', 'query-scene')) ?? null;
                } catch {
                    return null;
                }
            }
        },
        getHierarchy: async () => {
            const request = requireMessageRequest();
            try {
                const tree = await request('scene', 'query-node-tree');
                return Array.isArray(tree) ? tree : [];
            } catch {
                return [];
            }
        },
        execute: async (packageName, method, args = []) => {
            const request = requireMessageRequest();
            return request('scene', 'execute-scene-script', {
                name: packageName,
                method,
                args: [...args],
            });
        },
    });

    const selection = Object.freeze({
        getActiveIds: async () => {
            const selected = editor?.Selection?.getSelected?.('node');
            return Array.isArray(selected) ? selected.filter((value) => typeof value === 'string') : [];
        },
        setActiveIds: async (selectionIds) => {
            const ids = selectionIds.filter((value) => typeof value === 'string');
            if (typeof editor?.Selection?.select === 'function') {
                editor.Selection.select('node', ids);
                return;
            }
            throw new Error('peanut_lite_selection_unavailable');
        },
    });

    const projectRead = Object.freeze({
        getProjectPath: async () => {
            const projectPath = editor?.Project?.path;
            return typeof projectPath === 'string' && projectPath.trim().length > 0 ? projectPath : null;
        },
        getProjectName: async () => editor?.Project?.name ?? '',
    });

    return Object.freeze({
        version: Object.freeze({
            getCurrentVersion: () => versionInfo,
        }),
        message,
        assetRead,
        assetCatalog: undefined,
        assetWrite,
        assetDelete,
        scene,
        selection,
        projectRead,
        designSources: Object.freeze([]),
        network: undefined,
        native: Object.freeze({}),
    });
}

/**
 * Thin read runtime kept for fallback when gateway wiring is unavailable.
 */
function createLiteReadRuntime() {
    const granted = createLiteGrantedRuntime();
    return Object.freeze({
        version: Object.freeze({
            getCurrentVersion: () => granted.version.getCurrentVersion().raw,
        }),
        project: Object.freeze({
            getProjectName: async () => (await granted.projectRead.getProjectName()) ?? getEditor()?.Project?.name ?? '',
            getProjectPath: async () => {
                const path = await granted.projectRead.getProjectPath();
                if (path == null) {
                    throw new Error('peanut_cocos_mcp_core_project_path_unavailable');
                }
                return path;
            },
        }),
        selection: Object.freeze({
            getActiveIds: async () => granted.selection.getActiveIds(),
        }),
        message: Object.freeze({
            request: async (target, messageName, ...args) => granted.message.request(target, messageName, ...args),
        }),
    });
}

module.exports = { createLiteGrantedRuntime, createLiteReadRuntime, parseCreatorVersion };
