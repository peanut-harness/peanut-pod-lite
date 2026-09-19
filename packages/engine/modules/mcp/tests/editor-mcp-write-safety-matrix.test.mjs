import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import test from 'node:test';

import { EditorMcpPluginModule } from '../dist/index.js';

function createCatalogLookupStub() {
    return {
        summary: () => ({
            generatedAt: '2026-01-01T00:00:00.000Z',
            counts: {
                script: 0,
                image: 0,
                spriteFrame: 0,
                texture: 0,
                prefab: 0,
                scene: 0,
                config: 0,
                audio: 0,
                video: 0,
                spine: 0,
                dragonBones: 0,
                cubeMap: 0,
                tiledMap: 0,
                particle: 0,
                spriteAtlas: 0,
                autoAtlas: 0,
                font: 0,
                directory: 0,
                other: 0,
            },
            conflictCount: 0,
        }),
        lookup: () => ({ count: 0, hits: [] }),
        refresh: () => ({
            summaryPath: '/tmp/summary.json',
            generatedAt: '2026-01-01T00:00:00.000Z',
            counts: {
                script: 0,
                image: 0,
                spriteFrame: 0,
                texture: 0,
                prefab: 0,
                scene: 0,
                config: 0,
                audio: 0,
                video: 0,
                spine: 0,
                dragonBones: 0,
                cubeMap: 0,
                tiledMap: 0,
                particle: 0,
                spriteAtlas: 0,
                autoAtlas: 0,
                font: 0,
                directory: 0,
                other: 0,
            },
            conflictCount: 0,
        }),
    };
}

async function activateRouter(options = {}) {
    const importCalls = [];
    const projectPath = options.projectPath ?? mkdtempSync(join(tmpdir(), 'peanut-editor-mcp-matrix-'));
    mkdirSync(join(projectPath, 'temp', 'logs'), { recursive: true });
    writeFileSync(join(projectPath, 'temp', 'logs', 'project.log'), '', 'utf8');
    const handlers = new Map();
    const definitions = new Map();
    const pluginModule = new EditorMcpPluginModule(createCatalogLookupStub());
    await pluginModule.activate({
        plugin: { id: 'peanut.editor-mcp' },
        runtime: {
            version: {
                getCurrentVersion: () => ({
                    raw: '3.8.7',
                    major: 3,
                    minor: 8,
                    patch: 7,
                    stage: 'editor_api_38',
                    phase: 'editor_api_stable',
                }),
            },
            assetRead: { query: async (pathOrUuid) => ({ pathOrUuid, type: 'prefab' }) },
            scene: {
                getCurrent: async () => options.sceneCurrent ?? null,
                getHierarchy: async () =>
                    (typeof options.sceneHierarchy === 'function'
                        ? options.sceneHierarchy()
                        : options.sceneHierarchy) ?? [
                        {
                            uuid: 'canvas-uuid',
                            name: 'Canvas',
                            active: true,
                            path: 'Canvas',
                            children: [],
                        },
                    ],
            },
            selection: {
                getActiveIds: async () => [],
                setActiveIds: async () => undefined,
            },
            projectRead: {
                getProjectName: async () => 'Matrix',
                getProjectPath: async () => projectPath,
            },
            message: {
                ...(options.messageSendHandler == null
                    ? {}
                    : {
                          send: async (target, message, ...args) => {
                              importCalls.push({ target, message, args, delivery: 'send' });
                              return options.messageSendHandler(target, message, ...args);
                          },
                      }),
                request: async (target, message, ...args) => {
                    importCalls.push({ target, message, args });
                    if (options.messageHandler != null) {
                        return options.messageHandler(target, message, ...args);
                    }
                    if (target === 'scene' && message === 'query-current-scene') {
                        return options.currentScene ?? { uuid: null, url: null };
                    }
                    if (message === 'query-ready') {
                        return true;
                    }
                    if (message === 'import-asset' || message === 'import') {
                        return { imported: args[0] };
                    }
                    if (message === 'refresh-asset' || message === 'refresh') {
                        return true;
                    }
                    if (message === 'query-uuid') {
                        return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
                    }
                    if (message === 'open-scene' || message === 'open-asset') {
                        return { opened: message, arg: args[0] };
                    }
                    return null;
                },
            },
        },
        services: { request: async () => undefined },
        logger: { info: () => {} },
        mcp: {
            register: (definition, handler) => {
                definitions.set(definition.name, definition);
                handlers.set(definition.name, handler);
                return () => {
                    definitions.delete(definition.name);
                    handlers.delete(definition.name);
                };
            },
        },
    });
    return { pluginModule, importCalls, projectPath, handlers, definitions };
}

test('matrix: asset.importPlan expands Spine closure and layers leaf-first', async () => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-mcp-import-plan-'));
    const dir = join(root, 'spine');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Hero.png'), 'png');
    writeFileSync(join(dir, 'Hero.atlas'), 'Hero.png\n');
    writeFileSync(join(dir, 'Hero.skel'), 'skel');
    const { pluginModule } = await activateRouter();
    const plan = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'asset.importPlan',
        input: { sources: [join(dir, 'Hero.skel')], expandClosure: true },
    });
    assert.equal(plan.data.expandedSources.length, 3);
    assert.deepEqual(
        plan.data.layers.flat().map((item) => item.source.split('/').pop()),
        ['Hero.png', 'Hero.atlas', 'Hero.skel'],
    );
});

test('matrix: asset.writeText creates a new text asset before it exists on disk', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-mcp-write-text-new-'));
    const relativePath = 'assets/generated/NewController.ts';
    const absolutePath = join(projectPath, relativePath);
    let registered = false;
    const { pluginModule, importCalls } = await activateRouter({
        projectPath,
        messageHandler: async (_target, message, dbUrl, content) => {
            if (message === 'query-asset-info') {
                return registered || String(dbUrl).endsWith('/') ? { uuid: 'registered' } : null;
            }
            if (message === 'create-asset') {
                assert.equal(existsSync(absolutePath), false);
                mkdirSync(join(projectPath, 'assets/generated'), { recursive: true });
                writeFileSync(absolutePath, content, 'utf8');
                writeFileSync(`${absolutePath}.meta`, '{"uuid":"registered"}\n', 'utf8');
                registered = true;
                return { uuid: 'registered' };
            }
            if (message === 'query-ready') {
                return true;
            }
            return null;
        },
    });

    await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'asset.writeText',
        input: { path: relativePath, content: 'export const ready = true;\n' },
    });

    assert.equal(readFileSync(absolutePath, 'utf8'), 'export const ready = true;\n');
    assert.equal(importCalls.some((entry) => entry.message === 'create-asset'), true);
    assert.equal(importCalls.some((entry) => entry.message === 'refresh-asset' && entry.args[0] === `db://${relativePath}`), false);
});

test('matrix: asset.writeText recovers an unregistered disk orphan without overwrite prompts', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-mcp-write-text-orphan-'));
    const relativePath = 'assets/generated/RecoveredController.ts';
    const absolutePath = join(projectPath, relativePath);
    mkdirSync(join(projectPath, 'assets/generated'), { recursive: true });
    writeFileSync(absolutePath, 'stale\n', 'utf8');
    writeFileSync(`${absolutePath}.meta`, '{"uuid":"stale"}\n', 'utf8');
    let registered = false;
    let failCreate = true;
    const { pluginModule, importCalls } = await activateRouter({
        projectPath,
        messageHandler: async (_target, message, dbUrl, content) => {
            if (message === 'query-asset-info') {
                return registered || String(dbUrl).endsWith('/') ? { uuid: 'registered' } : null;
            }
            if (message === 'create-asset') {
                assert.equal(existsSync(absolutePath), false);
                assert.equal(existsSync(`${absolutePath}.meta`), false);
                if (failCreate) {
                    throw new Error('simulated_create_failure');
                }
                writeFileSync(absolutePath, content, 'utf8');
                writeFileSync(`${absolutePath}.meta`, '{"uuid":"registered"}\n', 'utf8');
                registered = true;
                return { uuid: 'registered' };
            }
            if (message === 'query-ready') {
                return true;
            }
            return null;
        },
    });

    await assert.rejects(
        pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'asset.writeText',
            input: { path: relativePath, content: 'export const recovered = true;\n' },
        }),
        /simulated_create_failure/,
    );
    assert.equal(readFileSync(absolutePath, 'utf8'), 'stale\n');
    assert.equal(readFileSync(`${absolutePath}.meta`, 'utf8'), '{"uuid":"stale"}\n');
    failCreate = false;
    await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'asset.writeText',
        input: { path: relativePath, content: 'export const recovered = true;\n' },
    });

    assert.equal(readFileSync(absolutePath, 'utf8'), 'export const recovered = true;\n');
    assert.equal(importCalls.filter((entry) => entry.message === 'create-asset').length, 2);
    assert.equal(importCalls.some((entry) => entry.message === 'refresh-asset' && entry.args[0] === `db://${relativePath}`), false);
});

test('matrix: asset.import rejects basename collisions before writing', async () => {
    const { pluginModule } = await activateRouter();
    await assert.rejects(
        () =>
            pluginModule.dispatchMcpAction('cocos.call', {
                operation: 'asset.import',
                input: {
                    sources: ['/tmp/a/Icon.png', '/tmp/b/Icon.png'],
                    target: 'db://assets/ui',
                    expandClosure: false,
                },
            }),
        /asset_import_target_collision/,
    );
});

test('matrix: overwrite import is destructive and blocked without confirm', async () => {
    const { pluginModule } = await activateRouter();
    const planned = await pluginModule.dispatchMcpAction('cocos.plan', {
        operation: 'asset.import',
        input: {
            sources: ['/tmp/a/Icon.png'],
            target: 'db://assets/ui',
            overwrite: true,
        },
    });
    assert.equal(planned.risk, 'destructive');
    await assert.rejects(
        () =>
            pluginModule.dispatchMcpAction('cocos.call', {
                operation: 'asset.import',
                input: {
                    sources: ['/tmp/a/Icon.png'],
                    target: 'db://assets/ui',
                    overwrite: true,
                },
            }),
        /editor_mcp_destructive_confirmation_required/,
    );
});

test('matrix: layered import waits query-ready per layer and keeps stable order', async () => {
    const { pluginModule, importCalls } = await activateRouter();
    const result = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'asset.import',
        input: {
            sources: [
                'assets/spine/Hero.skel',
                'assets/spine/Hero.png',
                'assets/spine/Hero.atlas',
            ],
            target: 'db://assets/imported',
            expandClosure: false,
        },
    });
    assert.deepEqual(
        result.data.imported.map((item) => item.source),
        ['assets/spine/Hero.png', 'assets/spine/Hero.atlas', 'assets/spine/Hero.skel'],
    );
    const readyCount = importCalls.filter((call) => call.message === 'query-ready').length;
    assert.ok(readyCount >= 3);
    assert.equal(result.data.postflight.logChecked, true);
});

test('matrix: restore skips project.log and never open-scene', async () => {
    const openCalls = [];
    const { pluginModule } = await activateRouter({
        messageHandler: async (target, message, ...args) => {
            openCalls.push({ target, message, args });
            if (message === 'query-current-scene') {
                return { uuid: 'log', url: 'db://assets/temp/logs/project.log' };
            }
            throw new Error(`unexpected:${target}:${message}`);
        },
    });
    const current = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.queryCurrentEditorResource',
    });
    assert.equal(current.data.canOpenAsScene, false);
    assert.equal(current.data.restorePlan.kind, 'skip');
    const restored = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.restoreEditorResource',
        input: {},
    });
    assert.equal(restored.data.action.kind, 'skip');
    assert.equal(
        openCalls.some((call) => call.message === 'open-scene'),
        false,
    );
});

test('matrix: prefab root unresolved soft-returns without throwing', async () => {
    const { pluginModule } = await activateRouter({
        sceneHierarchy: [{ uuid: 'facade', name: '__hidden__', children: [] }],
    });
    const result = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.resolvePrefabRootUuid',
        input: { rootName: 'MissingRoot', timeoutMs: 80 },
    });
    assert.equal(result.data.rootName, 'MissingRoot');
    assert.equal(result.data.rootUuid, null);
    assert.equal(result.data.unresolved, true);
});

test('matrix: preview queryErrors falls back to project.log', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-mcp-preview-log-'));
    const { pluginModule } = await activateRouter({
        projectPath,
        messageHandler: async () => {
            throw new Error('no console');
        },
    });
    mkdirSync(join(projectPath, 'temp', 'logs'), { recursive: true });
    writeFileSync(
        join(projectPath, 'temp', 'logs', 'project.log'),
        'info ok\nError: missing sprite frame uuid\nwarn slow\n',
        'utf8',
    );
    const errors = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'preview.queryErrors',
        input: { limit: 10 },
    });
    assert.equal(errors.data.available, true);
    assert.equal(errors.data.source, 'project_log');
    assert.ok(errors.data.errors.some((line) => /missing sprite/i.test(line)));
    assert.equal(typeof errors.data.logOffset, 'number');

    const compat = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'asset.queryCompatibleTypes',
        input: { typeName: 'SpriteFrame' },
    });
    assert.ok(compat.data.compatibleTypes.includes('cc.SpriteFrame'));
});

test('matrix: preview queryErrors sinceOffset only reports new errors', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-mcp-preview-delta-'));
    const { pluginModule } = await activateRouter({
        projectPath,
        messageHandler: async () => {
            throw new Error('no console');
        },
    });
    const logDir = join(projectPath, 'temp', 'logs');
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, 'project.log');
    const baseline = 'info ok\nError: historical noise should be ignored\n';
    writeFileSync(logPath, baseline, 'utf8');
    const sinceOffset = Buffer.byteLength(baseline, 'utf8');
    writeFileSync(logPath, `${baseline}Error: post-write failure\n`, 'utf8');

    const delta = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'preview.queryErrors',
        input: { limit: 10, sinceOffset },
    });
    assert.equal(delta.data.available, true);
    assert.equal(delta.data.source, 'project_log');
    assert.match(String(delta.data.message), /sinceOffset/);
    assert.equal(delta.data.newErrorCount, 1);
    assert.equal(delta.data.verified, false);
    assert.equal(delta.data.verdict, 'fail');
    assert.ok(delta.data.errors.every((line) => /post-write failure/i.test(line)));
    assert.ok(!delta.data.errors.some((line) => /historical noise/i.test(line)));

    const clean = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'preview.queryErrors',
        input: { limit: 10, sinceOffset: Buffer.byteLength(readFileSync(logPath), 'utf8') },
    });
    assert.equal(clean.data.newErrorCount, 0);
    assert.equal(clean.data.verified, true);
    assert.equal(clean.data.verdict, 'pass');

    const observe = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'preview.queryErrors',
        input: { limit: 10 },
    });
    assert.equal(observe.data.verdict, 'observe');
    assert.match(String(observe.data.agentHint), /sinceOffset/i);
});

test('matrix: builder platforms + asset propertySchema/inheritance', async () => {
    const { definitions, pluginModule } = await activateRouter({
        messageHandler: async (target, message) => {
            if (target === 'builder' && message === 'query-all-builder') {
                return [{ platform: 'web-desktop' }, { platform: 'ios' }];
            }
            if (message === 'query-ready') {
                return true;
            }
            return null;
        },
    });
    const buildTool = definitions.get('peanut.editor-mcp.builder-build');
    assert.ok(buildTool);
    assert.equal(buildTool.risk, 'destructive');
    const platforms = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'builder.queryPlatforms',
        input: {},
    });
    assert.equal(platforms.data.available, true);

    const inheritanceRoot = mkdtempSync(join(tmpdir(), 'peanut-mcp-inherit-'));
    mkdirSync(join(inheritanceRoot, 'assets'), { recursive: true });
    writeFileSync(join(inheritanceRoot, 'assets', 'icon.png'), 'png');
    writeFileSync(
        join(inheritanceRoot, 'assets', 'icon.png.meta'),
        `${JSON.stringify({
            uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            importer: 'image',
            files: ['.png'],
            userData: { type: 'sprite-frame' },
            subMetas: {
                icon: {
                    uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@f9941',
                    importer: 'sprite-frame',
                    displayName: 'icon',
                    name: 'icon',
                },
            },
        })}\n`,
    );
    const { pluginModule: locateModule } = await activateRouter({ projectPath: inheritanceRoot });
    const schema = await locateModule.dispatchMcpAction('cocos.call', {
        operation: 'asset.queryPropertySchema',
        input: { path: 'assets/icon.png' },
    });
    assert.equal(schema.data.importer, 'image');
    assert.ok(Array.isArray(schema.data.fields));
    const inheritance = await locateModule.dispatchMcpAction('cocos.call', {
        operation: 'asset.queryInheritance',
        input: { path: 'assets/icon.png' },
    });
    assert.ok(inheritance.data.compatibleChildImporters.includes('sprite-frame'));
});

test('matrix: scene.open blocks non-scene paths and opens guarded scenes', async () => {
    const { pluginModule, importCalls } = await activateRouter();
    const blocked = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.open',
        input: { path: 'db://assets/temp/project.log' },
    });
    assert.equal(blocked.data.available, false);
    assert.match(blocked.data.message, /scene_open_blocked/);
    const opened = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.open',
        input: { path: 'assets/Main.scene' },
    });
    assert.equal(opened.data.available, true);
    const openCall = importCalls.find((call) => call.target === 'scene' && call.message === 'open-scene');
    assert.ok(openCall);
    assert.deepEqual(openCall.args, ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
    assert.ok(!String(openCall.args[0]).includes('://'), 'open-scene must never receive db://');
});

test('matrix: scene.open falls back to asset-db when the Scene package never replies', async () => {
    const { pluginModule, importCalls } = await activateRouter({
        messageHandler: async (target, message, ...args) => {
            if (target === 'asset-db' && message === 'query-uuid') {
                return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
            }
            if (target === 'scene' && message === 'open-scene') {
                return new Promise(() => {});
            }
            if (target === 'asset-db' && message === 'open-asset') {
                return { opened: true, uuid: args[0] };
            }
            throw new Error(`unexpected:${target}:${message}`);
        },
    });
    const started = Date.now();
    const opened = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.open',
        input: { path: 'assets/Main.scene' },
    });
    assert.equal(opened.data.message, 'scene_open_ok:asset-db:open-asset');
    assert.equal(opened.data.data.openVia, 'asset-db:open-asset');
    assert.ok(Date.now() - started < 3500, 'hung Scene message must not hold the Hub request');
    assert.equal(
        importCalls.some((call) => call.target === 'asset-db' && call.message === 'open-asset'),
        true,
    );
});

test('matrix: scene.open uses one-way AssetDB delivery when request routes reject', async () => {
    const { pluginModule, importCalls } = await activateRouter({
        messageSendHandler: async (target, message, uuid) => {
            if (target === 'scene') {
                throw new Error('scene_send_unavailable');
            }
            assert.equal(target, 'asset-db');
            assert.equal(message, 'open-asset');
            assert.equal(uuid, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        },
        messageHandler: async (target, message) => {
            if (target === 'asset-db' && message === 'query-uuid') {
                return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
            }
            if (target === 'scene' && message === 'open-scene') {
                throw new Error('scene_package_unavailable');
            }
            throw new Error(`unexpected:${target}:${message}`);
        },
    });
    const opened = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.open',
        input: { path: 'assets/Main.scene' },
    });
    assert.equal(opened.data.message, 'scene_open_accepted:asset-db:open-asset');
    assert.equal(opened.data.data.delivery, 'send');
    assert.equal(
        importCalls.some(
            (call) => call.delivery === 'send' && call.target === 'asset-db' && call.message === 'open-asset',
        ),
        true,
    );
});

test('matrix: scene.open uses one-way Scene delivery before AssetDB fallback', async () => {
    const { pluginModule, importCalls } = await activateRouter({
        messageSendHandler: async (target, message, uuid) => {
            assert.equal(target, 'scene');
            assert.equal(message, 'open-scene');
            assert.equal(uuid, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        },
        messageHandler: async (target, message) => {
            if (target === 'asset-db' && message === 'query-uuid') {
                return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
            }
            if (target === 'scene' && message === 'open-scene') {
                throw new Error('scene_request_never_replies');
            }
            throw new Error(`unexpected:${target}:${message}`);
        },
    });
    const opened = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.open',
        input: { path: 'assets/Main.scene' },
    });
    assert.equal(opened.data.message, 'scene_open_accepted:scene:open-scene');
    assert.equal(opened.data.data.openVia, 'scene:open-scene:send');
    assert.equal(
        importCalls.some(
            (call) => call.delivery === 'send' && call.target === 'asset-db' && call.message === 'open-asset',
        ),
        false,
    );
});

test('matrix: scene.open retries through AssetDB when Scene delivery leaves hierarchy empty', async () => {
    let openedByAssetDb = false;
    const { pluginModule, importCalls } = await activateRouter({
        sceneHierarchy: () =>
            openedByAssetDb
                ? [{ uuid: 'canvas-uuid', name: 'Canvas', active: true, path: 'Canvas', children: [] }]
                : [],
        messageSendHandler: async (target, message, uuid) => {
            assert.equal(target, 'asset-db');
            assert.equal(message, 'open-asset');
            assert.equal(uuid, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
            openedByAssetDb = true;
        },
    });
    const opened = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.open',
        input: { path: 'assets/Main.scene' },
    });
    assert.equal(opened.data.available, true);
    assert.equal(opened.data.data.openVia, 'asset-db:open-asset');
    assert.equal(opened.data.initialSettle.settled, false);
    assert.equal(opened.data.settle.settled, true);
    assert.equal(
        importCalls.some(
            (call) => call.delivery === 'send' && call.target === 'asset-db' && call.message === 'open-asset',
        ),
        true,
    );
});

test('matrix: scene hierarchy returns refused instead of hanging on unavailable probes', async () => {
    const never = new Promise(() => {});
    const { pluginModule } = await activateRouter({
        sceneHierarchy: never,
        messageHandler: async (target, message) => {
            if (target === 'scene' && message === 'query-node-tree') {
                return never;
            }
            throw new Error(`unexpected:${target}:${message}`);
        },
    });
    const started = Date.now();
    const hierarchy = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.getHierarchy',
        input: {},
    });
    assert.deepEqual(hierarchy.data.nodes, []);
    assert.equal(hierarchy.data.availability, 'refused');
    assert.ok(Date.now() - started < 4000, 'unavailable Scene probes must have a finite deadline');
});

test('matrix: scene.open hard-blocks db:// args to open-scene', async () => {
    const { pluginModule, importCalls } = await activateRouter({
        messageHandler: async (target, message, ...args) => {
            if (target === 'asset-db' && message === 'query-uuid') {
                // 故意返回 db 路径，诱使错误实现把它传给 open-scene。
                return 'db://assets/Main.scene';
            }
            if (message === 'open-scene') {
                importCalls.push({ target, message, args });
                return { opened: true };
            }
            return null;
        },
    });
    const opened = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.open',
        input: { path: 'assets/Main.scene' },
    });
    assert.equal(opened.data.available, false);
    assert.match(String(opened.data.message), /uuid/);
    assert.equal(
        importCalls.some((call) => call.message === 'open-scene'),
        false,
        'open-scene must not be called with unresolved/non-uuid',
    );
});

test('matrix: flat tools expose one tool per operation with correct readOnly/risk', async () => {
    const { definitions } = await activateRouter();
    const version = definitions.get('peanut.editor-mcp.editor-query-version');
    assert.ok(version, 'editor-query-version');
    assert.equal(version.readOnly, true);
    assert.equal(version.risk, 'read');
    assert.equal(version.lane, 'editor-ui');
    const refresh = definitions.get('peanut.editor-mcp.asset-catalog-refresh');
    assert.ok(refresh, 'asset-catalog-refresh');
    assert.equal(refresh.readOnly, false);
    assert.equal(refresh.risk, 'write');
    assert.equal(refresh.lane, 'lumen-offline');
    const nodeRm = definitions.get('peanut.editor-mcp.lumen-node-rm');
    assert.ok(nodeRm, 'lumen-node-rm');
    assert.equal(nodeRm.risk, 'destructive');
    assert.equal(nodeRm.lane, 'lumen-offline');
    const sceneOpen = definitions.get('peanut.editor-mcp.scene-open');
    assert.ok(sceneOpen, 'scene-open');
    assert.equal(sceneOpen.lane, 'editor-ui');
    const previewRefresh = definitions.get('peanut.editor-mcp.preview-refresh');
    assert.ok(previewRefresh, 'preview-refresh');
    assert.equal(previewRefresh.lane, 'preview');
    // 旧入口工具已彻底移除。
    assert.equal(definitions.has('peanut.editor-mcp.call'), false);
    assert.equal(definitions.has('peanut.editor-mcp.query'), false);
    assert.equal(definitions.has('peanut.editor-mcp.capabilities'), false);
});

test('matrix: flat read tool handler routes operation and returns data', async () => {
    const { handlers } = await activateRouter();
    const version = handlers.get('peanut.editor-mcp.editor-query-version');
    assert.equal(typeof version, 'function');
    const data = await version({});
    assert.equal(data.raw, '3.8.7');
});

test('matrix: Lite schemas do not accept Pro plan control fields', async () => {
    const { definitions } = await activateRouter();
    const version = definitions.get('peanut.editor-mcp.editor-query-version');
    assert.ok(version, 'editor-query-version');
    assert.equal(Object.hasOwn(version.inputSchema.properties, 'proPlan'), false);
    assert.equal(version.inputSchema.additionalProperties, false);
});

test('matrix: flat write tool schema is precise (required fields, closed, free-form props)', async () => {
    const { definitions } = await activateRouter();
    const compSet = definitions.get('peanut.editor-mcp.lumen-comp-set');
    assert.ok(compSet, 'lumen-comp-set');
    assert.deepEqual(
        [...compSet.inputSchema.required].sort(),
        ['componentType', 'nodePath', 'prefabRelativePath', 'props'],
    );
    assert.equal(compSet.inputSchema.additionalProperties, false);
    assert.equal(compSet.inputSchema.properties.props.additionalProperties, true);
    const assetImport = definitions.get('peanut.editor-mcp.asset-import');
    assert.ok(assetImport, 'asset-import');
    assert.deepEqual([...assetImport.inputSchema.required].sort(), ['sources', 'target']);
});

test('matrix: missing dependency import fails with repair hint code', async () => {
    const { pluginModule } = await activateRouter();
    await assert.rejects(
        () =>
            pluginModule.dispatchMcpAction('cocos.call', {
                operation: 'asset.import',
                input: {
                    sources: ['assets/spine/Hero.skel'],
                    target: 'db://assets/imported',
                    expandClosure: false,
                    dependencyMap: {
                        'assets/spine/Hero.skel': ['assets/spine/Hero.atlas'],
                    },
                },
            }),
        /asset_import_missing_dependencies/,
    );
});

test('matrix: scene.queryNodeWithNodes resolves flat hierarchy paths', async () => {
    const { EditorMcpSceneGateway } = await import('../dist/editor-mcp-scene-gateway.js');
    const gateway = new EditorMcpSceneGateway({ scene: { getHierarchy: async () => [] } });
    const nodes = [
        { uuid: 'a', name: 'Main Camera', active: true, path: 'McpVerify/Main Camera', children: [] },
        { uuid: 'b', name: 'Canvas', active: true, path: 'McpVerify/Canvas', children: [] },
    ];
    const full = gateway.queryNodeWithNodes({ path: 'McpVerify/Main Camera' }, nodes);
    assert.equal(full.message, 'scene_query_node_ok');
    const leaf = gateway.queryNodeWithNodes({ path: 'Main Camera' }, nodes);
    assert.equal(leaf.message, 'scene_query_node_ok');
    const miss = gateway.queryNodeWithNodes({ path: 'Missing' }, nodes);
    assert.equal(miss.message, 'scene_query_node_not_found');
});
