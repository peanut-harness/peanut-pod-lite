import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import test from 'node:test';

import { createPluginModule, EditorMcpActionRouter, EditorMcpLumenGateway, EditorMcpPluginModule } from '../dist/index.js';

function createCatalogLookupStub() {
    return {
        summary: () => ({
            generatedAt: '2026-01-01T00:00:00.000Z',
            counts: {
                script: 1,
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
        lookup: (_projectRoot, input) => ({
            count: 1,
            hits: [{
                type: 'script',
                path: 'assets/demo/SeatItem.ts',
                uuid: '79507851-d12b-4e25-adc1-31f29ea29cc6',
                compressedUuid: '79507hR0StOJa3BMfKeopzG',
                name: input.name ?? 'SeatItem.ts',
            }],
        }),
        refresh: () => ({
            summaryPath: '/tmp/summary.json',
            generatedAt: '2026-01-01T00:00:00.000Z',
            counts: {
                script: 1,
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

function createLumenGatewayStub() {
    return {
        validate() {},
        async refreshForCommit() {
            return {
                phase: 'editor_refreshed',
                result: { triggered: true, message: 'lumen_asset_db_refresh_barrier' },
                barrier: true,
            };
        },
        async execute(operation) {
            if (operation === 'lumen.templates') {
                return { cocos: '3.8.7', count: 1, templates: [{ id: 'ui/Label' }] };
            }
            if (operation === 'lumen.scaffold') {
                return {
                    phase: 'scaffolded',
                    prefab: 'assets/ui/Demo.prefab',
                    cocos: '3.8.7',
                    recommendedNext: {
                        operation: 'lumen.commit',
                        input: { paths: ['assets/ui/Demo.prefab'] },
                    },
                };
            }
            if (operation === 'lumen.refresh') {
                return {
                    phase: 'editor_refreshed',
                    result: { triggered: true, message: 'lumen_asset_db_refresh:db://assets/ui/Demo.prefab' },
                };
            }
            return { ok: true, operation };
        },
    };
}

test('bindController preserves button events addressed only by nodePath', () => {
    const router = new EditorMcpActionRouter({}, createCatalogLookupStub(), createLumenGatewayStub());
    const parsed = router._readLumenBindControllerInput({
        prefabRelativePath: 'assets/ui/Demo.prefab',
        scriptRelativePath: 'assets/ui/DemoController.ts',
        className: 'DemoController',
        propertyBindings: {},
        buttonEvents: [{ nodePath: '/Demo/ConfirmButton', handler: 'onConfirm', customEventData: 'confirm' }],
    });
    assert.deepEqual(parsed.buttonEvents, [
        {
            nodeName: '/Demo/ConfirmButton',
            nodePath: '/Demo/ConfirmButton',
            handler: 'onConfirm',
            customEventData: 'confirm',
        },
    ]);
});

async function createActivePluginModule(options = {}) {
    const pluginModule = new EditorMcpPluginModule(
        createCatalogLookupStub(),
        options.lumenGateway ?? createLumenGatewayStub(),
    );
    const messageRequests = [];
    let selectedIds = ['node-a'];
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
                getCurrent: async () => ({ uuid: 'root-uuid', name: 'Demo', children: [] }),
                getHierarchy: async () => [
                    {
                        uuid: 'facade',
                        name: '__hidden__',
                        path: '__hidden__',
                        children: [{ uuid: 'root-uuid', name: 'Demo', path: 'Demo', children: [] }],
                    },
                    { uuid: 'root-uuid', name: 'Demo', path: 'Demo' },
                    { uuid: 'child-uuid', name: 'Child', path: 'Demo/Child' },
                ],
            },
            message: {
                request: async (target, message, ...args) => {
                    messageRequests.push({ target, message, args });
                    if (target === 'scene' && message === 'query-current-scene') {
                        return { uuid: 'scene-uuid', url: 'db://assets/Main.scene' };
                    }
                    if (target === 'scene' && message === 'open-scene') {
                        return { opened: 'scene' };
                    }
                    if (target === 'scene' && (message === 'focus-node' || message === 'select-node')) {
                        return { focused: true };
                    }
                    if (target === 'scene' && message === 'create-node') {
                        return { created: true };
                    }
                    if (target === 'scene' && message === 'query-node') {
                        return {
                            uuid: 'child-uuid',
                            __prefab__: {
                                uuid: 'prefab-asset-uuid',
                                prefabStateInfo: { assetUuid: 'prefab-asset-uuid' },
                            },
                        };
                    }
                    if (target === 'scene' && message === 'create-prefab') {
                        return 'prefab-uuid';
                    }
                    if (target === 'scene' && message === 'apply-prefab') {
                        return true;
                    }
                    if (target === 'scene' && (message === 'unlink-prefab' || message === 'restore-prefab')) {
                        return { unlinked: true };
                    }
                    if (target === 'asset-db' && message === 'open-asset') {
                        return { opened: 'asset' };
                    }
                    if (target === 'asset-db' && message === 'query-ready') {
                        return true;
                    }
                    if (target === 'asset-db' && message === 'query-asset-info') {
                        const dbPath = typeof args[0] === 'string' ? args[0] : '';
                        const projectPath = options.projectPath ?? 'projects/mcp-test';
                        const relativePath = dbPath.replace(/^db:\/\//u, '');
                        const metaPath = join(projectPath, `${relativePath}.meta`);
                        if (!existsSync(metaPath)) {
                            return null;
                        }
                        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
                        return { uuid: meta.uuid, importer: meta.importer ?? '' };
                    }
                    return null;
                },
            },
            selection: {
                getActiveIds: async () => selectedIds,
                setActiveIds: async (ids) => {
                    selectedIds = [...ids];
                },
            },
            projectRead: {
                getProjectName: async () => 'MCP Test Project',
                getProjectPath: async () => options.projectPath ?? 'projects/mcp-test',
            },
        },
        services: { request: async () => undefined },
        logger: { info: () => {} },
    });
    return { pluginModule, messageRequests };
}

test('Editor MCP plugin should declare a tooling manifest and dynamic factory', () => {
    const pluginModule = createPluginModule();
    const packageManifest = JSON.parse(readFileSync(new URL('../peanut.editor-mcp.manifest.json', import.meta.url), 'utf8'));

    assert.equal(pluginModule instanceof EditorMcpPluginModule, true);
    assert.equal(pluginModule.manifest.id, 'peanut.editor-mcp');
    assert.equal(pluginModule.manifest.kind, 'tooling-plugin');
    assert.equal(pluginModule.manifest.version, packageManifest.version);
    assert.equal(pluginModule.manifest.permissions.assetDb.write, true);
    assert.equal(packageManifest.id, pluginModule.manifest.id);
    assert.equal(packageManifest.permissions.assetDb.write, pluginModule.manifest.permissions.assetDb.write);
    assert.deepEqual(packageManifest.permissions.sceneScripts, pluginModule.manifest.permissions.sceneScripts);
});

test('Editor MCP plugin should list, plan, and execute supported operations', async () => {
    const { pluginModule } = await createActivePluginModule();
    const capabilities = await pluginModule.dispatchMcpAction('editor-mcp.capabilities.list');
    const capabilityAlias = await pluginModule.dispatchMcpAction('cocos.capabilities');
    const editorPlan = await pluginModule.dispatchMcpAction('editor-mcp.plan', { operation: 'editor.queryVersion' });
    const plan = await pluginModule.dispatchMcpAction('cocos.plan', { operation: 'asset.queryInfo', input: { pathOrUuid: 'assets/example.prefab' } });
    const catalogPlan = await pluginModule.dispatchMcpAction('cocos.plan', {
        operation: 'asset.catalog.lookup',
        input: { type: 'script', name: 'SeatItem', limit: 5 },
    });
    const lumenPlan = await pluginModule.dispatchMcpAction('cocos.plan', {
        operation: 'lumen.scaffold',
        input: { prefabRelativePath: 'assets/ui/Demo.prefab', rootName: 'Demo' },
    });
    const versionResult = await pluginModule.dispatchMcpAction('cocos.call', { operation: 'editor.queryVersion' });
    const projectResult = await pluginModule.dispatchMcpAction('editor-mcp.execute', { operation: 'editor.queryProject' });
    const assetResult = await pluginModule.dispatchMcpAction('editor-mcp.execute', { operation: 'asset.queryInfo', input: { pathOrUuid: 'assets/example.prefab' } });
    const catalogSummary = await pluginModule.dispatchMcpAction('cocos.call', { operation: 'asset.catalog.summary' });
    const catalogLookup = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'asset.catalog.lookup',
        input: { type: 'script', name: 'SeatItem', limit: 5 },
    });
    const sceneResult = await pluginModule.dispatchMcpAction('editor-mcp.execute', { operation: 'scene.getHierarchy' });
    const lumenTemplates = await pluginModule.dispatchMcpAction('cocos.call', { operation: 'lumen.templates' });
    const lumenScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'lumen.scaffold',
        input: { prefabRelativePath: 'assets/ui/Demo.prefab', rootName: 'Demo' },
    });
    const lumenCommit = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'lumen.commit',
        input: {},
    });

    assert.equal(capabilities.length, 83);
    assert.equal(capabilityAlias.length, capabilities.length);
    const byOp = Object.fromEntries(capabilities.map((c) => [c.operation, c]));
    assert.equal(byOp['asset.replaceReferences'].lane, 'lumen-offline');
    assert.equal(byOp['asset.waitReady'].lane, 'lumen-offline');
    assert.equal(byOp['asset.replaceReferences'].readOnly, false);
    assert.equal(byOp['asset.waitReady'].readOnly, true);
    assert.equal(byOp['lumen.commit'].lane, 'lumen-offline');
    assert.equal(byOp['scene.open'].lane, 'editor-ui');
    assert.equal(byOp['preview.refresh'].lane, 'preview');
    assert.equal(byOp['asset.open'].lane, 'editor-ui');
    assert.equal(byOp['asset.import'].lane, 'lumen-offline');
    assert.equal(byOp['asset.copy'].lane, 'lumen-offline');
    assert.equal(byOp['asset.move'].lane, 'lumen-offline');
    assert.equal(byOp['asset.rename'].lane, 'lumen-offline');
    assert.equal(byOp['asset.createFolder'].lane, 'lumen-offline');
    assert.equal(byOp['asset.delete'].lane, 'lumen-offline');
    assert.equal(byOp['asset.reimport'].lane, 'lumen-offline');
    assert.equal(byOp['asset.writeText'].lane, 'lumen-offline');
    assert.equal(byOp['asset.ensureSpriteFramesBatch'].lane, 'lumen-offline');
    assert.equal(byOp['asset.ensureSpriteFramesBatch'].readOnly, false);
    assert.equal(byOp['asset.ensureSpriteFramesBatch'].risk, 'write');
    assert.match(String(byOp['lumen.scaffold'].description['en-US'] ?? byOp['lumen.scaffold'].description), /\[lane:lumen-offline\]/);
    assert.match(String(byOp['scene.open'].description['en-US'] ?? byOp['scene.open'].description), /\[lane:editor-ui\]/);
    assert.match(String(byOp['preview.query'].description['en-US'] ?? byOp['preview.query'].description), /\[lane:preview\]/);
    assert.equal(editorPlan.operation, 'editor.queryVersion');
    assert.equal(editorPlan.lane, 'editor-ui');
    assert.equal(lumenPlan.lane, 'lumen-offline');
    assert.equal(plan.operation, 'asset.queryInfo');
    assert.equal(plan.lane, 'lumen-offline');
    assert.equal(plan.executable, true);
    assert.equal(catalogPlan.operation, 'asset.catalog.lookup');
    assert.equal(catalogPlan.readOnly, true);
    assert.equal(catalogPlan.risk, 'read');
    const importOverwritePlan = await pluginModule.dispatchMcpAction('cocos.plan', {
        operation: 'asset.import',
        input: {
            sources: ['assets/a.png'],
            target: 'db://assets/ui',
            overwrite: true,
        },
    });
    assert.equal(importOverwritePlan.risk, 'destructive');
    assert.equal(importOverwritePlan.readOnly, false);
    await assert.rejects(
        async () =>
            pluginModule.dispatchMcpAction('cocos.call', {
                operation: 'lumen.nodeRm',
                input: { prefabRelativePath: 'assets/ui/Demo.prefab', nodePath: 'Demo/Child' },
            }),
        /editor_mcp_destructive_confirmation_required/,
    );
    const editorResource = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.queryCurrentEditorResource',
    });
    assert.equal(editorResource.data.canOpenAsScene, true);
    assert.equal(editorResource.data.restorePlan.kind, 'open-scene');
    const prefabRoot = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.resolvePrefabRootUuid',
        input: { prefabRelativePath: 'assets/ui/Demo.prefab', timeoutMs: 200 },
    });
    assert.equal(prefabRoot.data.rootUuid, 'root-uuid');
    const restored = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.restoreEditorResource',
        input: { uuid: 'prefab-uuid', url: 'db://assets/ui/Demo.prefab' },
    });
    assert.equal(restored.data.action.kind, 'open-asset');
    const skippedLog = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.restoreEditorResource',
        input: { uuid: 'log-uuid', url: 'db://assets/temp/logs/project.log' },
    });
    assert.equal(skippedLog.data.action.kind, 'skip');
    assert.equal(lumenPlan.readOnly, false);
    assert.equal(lumenPlan.executable, true);
    assert.equal(versionResult.data.raw, '3.8.7');
    assert.equal(projectResult.data.name, 'MCP Test Project');
    assert.equal(assetResult.data.type, 'prefab');
    assert.equal(catalogSummary.data.counts.script, 1);
    assert.equal(catalogLookup.data.hits[0].uuid, '79507851-d12b-4e25-adc1-31f29ea29cc6');
    assert.equal(sceneResult.data.nodes[0].name, '__hidden__');
    assert.equal(sceneResult.data.nodes[0].children[0].uuid, 'root-uuid');
    assert.equal(sceneResult.data.availability, 'live');
    assert.equal(lumenTemplates.data.count, 1);
    assert.equal(lumenScaffold.data.prefab, 'assets/ui/Demo.prefab');
    assert.equal(lumenScaffold.data.recommendedNext.operation, 'lumen.commit');
    assert.equal(lumenCommit.data.editorRefresh.result.triggered, true);
    assert.equal(lumenCommit.data.catalog.counts.script, 1);
    assert.deepEqual(lumenCommit.data.pipeline, [
        'assetdb_refresh',
        'hierarchy_settle',
        'assetdb_registration',
        'catalog_refresh',
        'validate_refs',
    ]);
    assert.ok(Array.isArray(lumenCommit.data.validation));
    assert.equal(lumenCommit.data.validation.length, 0);
    assert.equal(lumenCommit.data.recommendedNext, undefined);
    assert.ok(Array.isArray(lumenCommit.data.acceptancePipeline));
    assert.ok(lumenCommit.data.acceptancePipeline.includes('preview.refresh'));
    assert.match(String(lumenCommit.data.nextHint), /Never scene\.save/);
    assert.doesNotMatch(String(lumenCommit.data.nextHint), /scene\.reload as write|→ scene\.reload/);
    assert.match(String(lumenCommit.data.nextHint), /scene\.open/);
});

test('Editor MCP plugin should reject unsupported or invalid requests and calls after deactivation', async () => {
    const { pluginModule } = await createActivePluginModule();

    await assert.rejects(async () => pluginModule.dispatchMcpAction('cocos.call', { operation: 'asset.delete' }), /editor_mcp_asset_delete_paths_required/);
    await assert.rejects(async () => pluginModule.dispatchMcpAction('cocos.call', { operation: 'asset.queryInfo', input: {} }), /editor_mcp_asset_path_or_uuid_required/);
    await assert.rejects(async () => pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'asset.catalog.lookup',
        input: {},
    }), /editor_mcp_catalog_lookup_requires_uuid_or_type_or_name_or_path/);
    await assert.rejects(
        async () => pluginModule.dispatchMcpAction('cocos.call', { operation: 'snowb.bmfont.export' }),
        /editor_mcp_operation_unsupported:snowb\.bmfont\.export/,
    );
    await assert.rejects(async () => {
        const gateway = new EditorMcpLumenGateway(async () => '/tmp/unused');
        gateway.validate('lumen.scaffold', { prefabRelativePath: '../escape.prefab' });
    }, /editor_mcp_lumen_prefabRelativePath_not_project_relative/);

    await pluginModule.deactivate('manual_disable');
    await assert.rejects(async () => pluginModule.dispatchMcpAction('cocos.capabilities'), /editor_mcp_not_active/);
});

test('Editor MCP lumen gateway scaffolds and builds structure on a real project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-editor-mcp-lumen-'));
    try {
        mkdirSync(join(root, 'assets'), { recursive: true });
        writeFileSync(join(root, 'package.json'), '{"name":"mcp-lumen","creator":{"version":"3.8.7"}}\n');
        writeFileSync(join(root, 'assets/Icon.png'), 'png-source');
        writeFileSync(join(root, 'assets/Icon.png.meta'), `${JSON.stringify({
            importer: 'image',
            uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            subMetas: {
                texture: {
                    importer: 'texture',
                    uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@texture',
                    userData: {
                        wrapModeS: 'clamp-to-edge',
                        wrapModeT: 'clamp-to-edge',
                        minfilter: 'linear',
                        magfilter: 'linear',
                        mipfilter: 'none',
                        anisotropy: 0,
                    },
                },
                spriteFrame: {
                    importer: 'sprite-frame',
                    uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@sprite',
                    userData: {
                        trimThreshold: 1,
                        rotated: false,
                        borderTop: 0,
                        borderBottom: 0,
                        borderLeft: 0,
                        borderRight: 0,
                        packable: true,
                        pixelsToUnit: 100,
                        pivotX: 0.5,
                        pivotY: 0.5,
                        meshType: 0,
                        trimType: 'auto',
                    },
                },
            },
            userData: {
                type: 'sprite-frame',
                hasAlpha: true,
                fixAlphaTransparencyArtifacts: false,
            },
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Click.wav'), 'wav-source');
        writeFileSync(join(root, 'assets/Click.wav.meta'), `${JSON.stringify({
            ver: '1.0.0',
            importer: 'audio-clip',
            imported: true,
            uuid: '11111111-2222-4333-8444-555555555555',
            files: ['.json', '.wav'],
            subMetas: {},
            userData: { downloadMode: 0 },
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Intro.mp4'), 'mp4-source');
        writeFileSync(join(root, 'assets/Intro.mp4.meta'), `${JSON.stringify({
            ver: '1.0.0',
            importer: 'video-clip',
            imported: true,
            uuid: '22222222-3333-4444-8555-666666666666',
            files: ['.json', '.mp4'],
            subMetas: {},
            userData: {},
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Title.ttf'), 'ttf-source');
        writeFileSync(join(root, 'assets/Title.ttf.meta'), `${JSON.stringify({
            ver: '1.0.0',
            importer: 'ttf-font',
            imported: true,
            uuid: '33333333-4444-4555-8666-777777777777',
            files: ['.json'],
            subMetas: {},
            userData: {},
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Score.fnt'), 'info face="Score"\n');
        writeFileSync(join(root, 'assets/Score.fnt.meta'), `${JSON.stringify({
            ver: '1.0.0',
            importer: 'bitmap-font',
            imported: true,
            uuid: '44444444-5555-4666-8777-888888888888',
            files: ['.json'],
            subMetas: {},
            userData: { fontSize: 32, textureUuid: '' },
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Hero.skel'), 'skel-source');
        writeFileSync(join(root, 'assets/Hero.skel.meta'), `${JSON.stringify({
            ver: '1.1.50',
            importer: 'spine-data',
            imported: true,
            uuid: '55555555-6666-4777-8888-999999999999',
            files: ['.json'],
            subMetas: {},
            userData: { atlasUuid: '' },
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Hero.dbbin'), 'dbbin-source');
        writeFileSync(join(root, 'assets/Hero.dbbin.meta'), `${JSON.stringify({
            ver: '1.1.50',
            importer: 'dragonbones',
            imported: true,
            uuid: '66666666-7777-4888-8999-aaaaaaaaaaaa',
            files: ['.bin'],
            subMetas: {},
            userData: {},
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Sky.cubemap'), '{}\n');
        writeFileSync(join(root, 'assets/Sky.cubemap.meta'), `${JSON.stringify({
            ver: '1.0.12',
            importer: 'texture-cube',
            imported: true,
            uuid: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
            files: ['.json'],
            subMetas: {},
            userData: { wrapModeS: 'repeat', wrapModeT: 'repeat', minfilter: 'nearest', magfilter: 'nearest', mipfilter: 'none', anisotropy: 1, mipBakeMode: 1 },
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Level.tmx'), '<map version="1.4"/>\n');
        writeFileSync(join(root, 'assets/Level.tmx.meta'), `${JSON.stringify({
            ver: '1.0.7',
            importer: 'tiled-map',
            imported: true,
            uuid: '88888888-9999-4aaa-8bbb-cccccccccccc',
            files: ['.json'],
            subMetas: {},
            userData: {},
        }, null, 2)}\n`);
        mkdirSync(join(root, 'assets/pack'), { recursive: true });
        writeFileSync(join(root, 'assets/pack.meta'), `${JSON.stringify({
            ver: '1.2.0',
            importer: 'directory',
            imported: true,
            uuid: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
            files: [],
            subMetas: {},
            userData: { isBundle: false },
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Smoke.plist'), '<?xml version="1.0"?><plist/>\n');
        writeFileSync(join(root, 'assets/Smoke.plist.meta'), `${JSON.stringify({
            ver: '1.0.7',
            importer: 'particle',
            imported: true,
            uuid: 'aaaa1111-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            files: ['.json'],
            subMetas: {},
            userData: { spriteFrameUuid: 'ffffffff-0000-4fff-8aaa-bbbbbbbbbbbb' },
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Hero.plist'), '<?xml version="1.0"?><plist/>\n');
        writeFileSync(join(root, 'assets/Hero.plist.meta'), `${JSON.stringify({
            ver: '1.0.7',
            importer: 'sprite-atlas',
            imported: true,
            uuid: 'bbbb2222-cccc-4ddd-8eee-ffffffffffff',
            files: ['.json'],
            subMetas: {
                icon: {
                    importer: 'sprite-frame',
                    uuid: 'bbbb2222-cccc-4ddd-8eee-ffffffffffff@icon',
                    name: 'icon',
                    displayName: 'icon',
                },
            },
            userData: {},
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/note.json'), '{"ok":true}\n');
        writeFileSync(join(root, 'assets/note.json.meta'), `${JSON.stringify({
            ver: '1.0.7',
            importer: 'json',
            imported: true,
            uuid: 'cccc3333-dddd-4eee-8fff-000000000000',
            files: ['.json'],
            subMetas: {},
            userData: {},
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/note.txt'), 'hello\n');
        writeFileSync(join(root, 'assets/note.txt.meta'), `${JSON.stringify({
            ver: '1.0.7',
            importer: 'text',
            imported: true,
            uuid: 'dddd4444-eeee-4fff-8000-111111111111',
            files: ['.json'],
            subMetas: {},
            userData: {},
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Table.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]));
        writeFileSync(join(root, 'assets/Table.bin.meta'), `${JSON.stringify({
            ver: '1.0.0',
            importer: 'buffer',
            imported: true,
            uuid: 'eeee5555-ffff-4000-8111-222222222222',
            files: ['.bin'],
            subMetas: {},
            userData: {},
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Probe.ts'), 'export class Probe {}\n');
        writeFileSync(join(root, 'assets/Probe.ts.meta'), `${JSON.stringify({
            ver: '4.0.24',
            importer: 'typescript',
            imported: true,
            uuid: 'ffff6666-aaaa-4bbb-8ccc-333333333333',
            files: [],
            subMetas: {},
            userData: {},
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/plugin.js'), 'module.exports = {};\n');
        writeFileSync(join(root, 'assets/plugin.js.meta'), `${JSON.stringify({
            ver: '4.0.24',
            importer: 'javascript',
            imported: true,
            uuid: 'aaaa7777-bbbb-4ccc-8ddd-444444444444',
            files: [],
            subMetas: {},
            userData: { isPlugin: false, loadPluginInWeb: true },
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Cube.mesh'), '[{"__type__":"cc.Mesh"}]\n');
        writeFileSync(join(root, 'assets/Cube.mesh.meta'), `${JSON.stringify({
            ver: '1.0.0',
            importer: 'instantiation-mesh',
            imported: true,
            uuid: 'bbbb8888-cccc-4ddd-8eee-555555555555',
            files: ['.json'],
            subMetas: {},
            userData: {},
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Skin.skeleton'), '[{"__type__":"cc.Skeleton"}]\n');
        writeFileSync(join(root, 'assets/Skin.skeleton.meta'), `${JSON.stringify({
            ver: '1.0.0',
            importer: 'instantiation-skeleton',
            imported: true,
            uuid: 'cccc9999-dddd-4eee-8fff-666666666666',
            files: ['.json'],
            subMetas: {},
            userData: {},
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Walk.animation'), '[{"__type__":"cc.AnimationClip"}]\n');
        writeFileSync(join(root, 'assets/Walk.animation.meta'), `${JSON.stringify({
            ver: '1.0.0',
            importer: 'instantiation-animation',
            imported: true,
            uuid: 'dddd0000-eeee-4fff-8000-777777777777',
            files: ['.json'],
            subMetas: {},
            userData: {},
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Body.material'), '[{"__type__":"cc.Material"}]\n');
        writeFileSync(join(root, 'assets/Body.material.meta'), `${JSON.stringify({
            ver: '1.0.0',
            importer: 'instantiation-material',
            imported: true,
            uuid: 'eeee1111-ffff-4000-8111-888888888888',
            files: ['.json'],
            subMetas: {},
            userData: {},
        }, null, 2)}\n`);
        writeFileSync(join(root, 'assets/Hero.fbx'), 'fbx-source');
        writeFileSync(join(root, 'assets/Hero.fbx.meta'), `${JSON.stringify({
            importer: 'fbx',
            uuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
            subMetas: {
                mesh0: {
                    importer: 'mesh',
                    uuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff@mesh',
                    name: 'Cube',
                    displayName: 'Cube',
                },
            },
            userData: {
                normals: 2,
                tangents: 2,
                morphNormals: 1,
                skipValidation: true,
                disableMeshSplit: true,
                allowMeshDataAccess: true,
                addVertexColor: false,
                promoteSingleRootNode: false,
                generateLightmapUVNode: false,
                dumpMaterials: false,
                useVertexColors: false,
                depthWriteInAlphaModeBlend: false,
                legacyFbxImporter: false,
                keepUnknown: true,
                fbx: {
                    animationBakeRate: 0,
                    preferLocalTimeSpan: true,
                    smartMaterialEnabled: false,
                },
                imageMetas: [{ name: 'albedo', uri: 'tex.png', remap: '' }],
            },
        }, null, 2)}\n`);
        const lumenGateway = new EditorMcpLumenGateway(async () => root);
        const { pluginModule } = await createActivePluginModule({
            projectPath: root,
            lumenGateway,
        });

        const scaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { prefabRelativePath: 'assets/ui/Demo.prefab', rootName: 'Demo', template: 'empty' },
        });
        assert.equal(scaffold.data.prefab, 'assets/ui/Demo.prefab');

        const structure = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.structure',
            input: {
                prefabRelativePath: 'assets/ui/Demo.prefab',
                parentPath: '/Demo',
                recipe: { name: 'Title', template: 'ui/Label', props: { string: 'Hello' } },
                autoCommit: true,
            },
        });
        assert.ok(Array.isArray(structure.data.created));
        assert.equal(structure.data.created[0], '/Demo/Title');
        assert.equal(structure.data.autoCommit, true);
        assert.deepEqual(structure.data.commit.pipeline, [
            'assetdb_refresh',
            'hierarchy_settle',
            'assetdb_registration',
            'catalog_refresh',
            'validate_refs',
        ]);
        assert.ok(Array.isArray(structure.data.commit.validation));
        assert.equal(structure.data.recommendedNext.operation, 'lumen.commit');

        const tree = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.tree',
            input: { prefabRelativePath: 'assets/ui/Demo.prefab' },
        });
        assert.equal(tree.data.tree.name, 'Demo');
        assert.equal(tree.data.kind, 'prefab');

        const inspectRootDefault = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { prefabRelativePath: 'assets/ui/Demo.prefab' },
        });
        assert.equal(inspectRootDefault.data.kind, 'prefab');
        assert.equal(inspectRootDefault.data.node.path, '/Demo');
        assert.equal(inspectRootDefault.data.node.name, 'Demo');

        const sceneScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { prefabRelativePath: 'assets/Game.scene', rootName: 'Game', template: 'empty' },
        });
        assert.equal(sceneScaffold.data.kind, 'scene');
        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.nodeAdd',
            input: {
                prefabRelativePath: 'assets/Game.scene',
                parentPath: '/Game',
                template: 'ui/Label',
                name: 'Title',
            },
        });
        const sceneTree = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.tree',
            input: { prefabRelativePath: 'assets/Game.scene' },
        });
        assert.equal(sceneTree.data.kind, 'scene');
        assert.equal(sceneTree.data.tree.name, 'Game');
        assert.equal(
            sceneTree.data.tree.children.some((child) => child.name === 'Title'),
            true,
        );

        const materialScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/fx/Lit.mtl', rootName: 'Lit', template: 'standard' },
        });
        assert.equal(materialScaffold.data.kind, 'material');
        assert.equal(materialScaffold.data.prefab, 'assets/fx/Lit.mtl');

        const materialInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/fx/Lit.mtl' },
        });
        assert.equal(materialInspect.data.kind, 'material');
        assert.equal(materialInspect.data.asset.effectAsset, '1baf0fc9-befa-459c-8bdd-af1a450a0319');
        assert.equal(materialInspect.data.asset.props[0].roughness, 0.8);

        const materialSet = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/fx/Lit.mtl',
                props: { props: { roughness: 0.2 } },
            },
        });
        assert.equal(materialSet.data.kind, 'material');
        assert.equal(materialSet.data.recommendedNext.operation, 'lumen.commit');

        const materialAgain = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { prefabRelativePath: 'assets/fx/Lit.mtl' },
        });
        assert.equal(materialAgain.data.asset.props[0].roughness, 0.2);
        assert.equal(materialAgain.data.asset.props[0].metallic, 0.6);

        const imageInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Icon.png' },
        });
        assert.equal(imageInspect.data.kind, 'image');
        assert.equal(imageInspect.data.asset.texture.wrapModeS, 'clamp-to-edge');
        assert.equal(imageInspect.data.asset.spriteFrame.pivotX, 0.5);

        const imageSet = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/Icon.png',
                props: {
                    texture: { wrapModeS: 'repeat', anisotropy: 4 },
                    spriteFrame: { borderLeft: 6, pivotX: 0.25, packable: false },
                },
            },
        });
        assert.equal(imageSet.data.kind, 'image');
        assert.equal(imageSet.data.recommendedNext.input.paths[0], 'assets/Icon.png');

        const imageAgain = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Icon.png' },
        });
        assert.equal(imageAgain.data.asset.texture.wrapModeS, 'repeat');
        assert.equal(imageAgain.data.asset.texture.filterMode, 'bilinear');
        assert.equal(imageAgain.data.asset.spriteFrame.borderLeft, 6);
        assert.equal(imageAgain.data.asset.spriteFrame.packable, false);
        assert.equal(readFileSync(join(root, 'assets/Icon.png'), 'utf8'), 'png-source');

        const effectScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/fx/Unlit.effect', rootName: 'Unlit', template: 'empty' },
        });
        assert.equal(effectScaffold.data.kind, 'effect');
        const effectInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/fx/Unlit.effect' },
        });
        assert.equal(effectInspect.data.kind, 'effect');
        assert.deepEqual(effectInspect.data.asset.properties.mainColor, [1, 1, 1, 1]);
        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/fx/Unlit.effect',
                props: { properties: { mainColor: [0, 1, 0, 1] } },
            },
        });
        const effectAgain = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/fx/Unlit.effect' },
        });
        assert.deepEqual(effectAgain.data.asset.properties.mainColor, [0, 1, 0, 1]);

        const modelInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Hero.fbx' },
        });
        assert.equal(modelInspect.data.kind, 'model');
        assert.equal(modelInspect.data.asset.model.normals, 2);
        assert.equal(modelInspect.data.asset.fbx.animationBakeRate, 0);
        assert.equal(modelInspect.data.asset.subAssets[0].importer, 'mesh');
        const modelSet = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/Hero.fbx',
                props: {
                    model: { normals: 1, addVertexColor: true },
                    fbx: { animationBakeRate: 30, smartMaterialEnabled: true },
                    material: { dumpMaterials: true },
                    // remap 必须是 catalog 可解析 uuid（本 fixture 的 Icon.png）
                    imageMetas: [{ name: 'albedo', remap: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }],
                },
            },
        });
        assert.equal(modelSet.data.kind, 'model');
        assert.equal(modelSet.data.recommendedNext.input.paths[0], 'assets/Hero.fbx');
        const modelAgain = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Hero.fbx' },
        });
        assert.equal(modelAgain.data.asset.model.normals, 1);
        assert.equal(modelAgain.data.asset.model.addVertexColor, true);
        assert.equal(modelAgain.data.asset.fbx.animationBakeRate, 30);
        assert.equal(modelAgain.data.asset.material.dumpMaterials, true);
        assert.equal(modelAgain.data.asset.imageMetas[0].remap, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        assert.equal(readFileSync(join(root, 'assets/Hero.fbx'), 'utf8'), 'fbx-source');

        const atlasScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/ui/Icons.pac', rootName: 'Icons', template: 'empty' },
        });
        assert.equal(atlasScaffold.data.kind, 'autoAtlas');
        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/ui/Icons.pac',
                props: { pack: { maxWidth: 2048, padding: 4 }, texture: { wrapModeS: 'clamp-to-edge' } },
            },
        });
        const atlasInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/ui/Icons.pac' },
        });
        assert.equal(atlasInspect.data.kind, 'autoAtlas');
        assert.equal(atlasInspect.data.asset.pack.maxWidth, 2048);
        assert.equal(atlasInspect.data.asset.texture.wrapModeS, 'clamp-to-edge');

        const labelScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/ui/Digits.labelatlas', rootName: 'Digits' },
        });
        assert.equal(labelScaffold.data.kind, 'labelAtlas');
        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/ui/Digits.labelatlas',
                props: {
                    spriteFrameUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@sprite',
                    itemWidth: 16,
                    startChar: '0',
                },
            },
        });
        const labelInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/ui/Digits.labelatlas' },
        });
        assert.equal(labelInspect.data.kind, 'labelAtlas');
        assert.equal(labelInspect.data.asset.itemWidth, 16);
        assert.equal(labelInspect.data.asset.startChar, '0');

        const graphScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/anim/Hero.animgraph', rootName: 'HeroGraph' },
        });
        assert.equal(graphScaffold.data.kind, 'animationGraph');
        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/anim/Hero.animgraph',
                props: {
                    layers: [{ index: 0, name: 'Base', weight: 0.5 }],
                    variables: [{ name: 'speed', type: 'FLOAT', value: 1.25 }],
                },
            },
        });
        const graphInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/anim/Hero.animgraph' },
        });
        assert.equal(graphInspect.data.kind, 'animationGraph');
        assert.equal(graphInspect.data.asset.layers[0].name, 'Base');
        assert.equal(graphInspect.data.asset.variables[0].value, 1.25);

        const variantScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/anim/Hero.animgraphvari', rootName: 'HeroVariant' },
        });
        assert.equal(variantScaffold.data.kind, 'animationGraphVariant');
        const heroGraphUuid = JSON.parse(readFileSync(join(root, 'assets/anim/Hero.animgraph.meta'), 'utf8')).uuid;
        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/anim/Hero.animgraphvari',
                props: { graph: heroGraphUuid },
            },
        });
        const variantInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/anim/Hero.animgraphvari' },
        });
        assert.equal(variantInspect.data.asset.graph, heroGraphUuid);

        const maskScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/anim/Body.animask', rootName: 'BodyMask' },
        });
        assert.equal(maskScaffold.data.kind, 'animationMask');
        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/anim/Body.animask',
                props: { joints: [{ path: 'Root/Hips', enabled: false }] },
            },
        });
        const maskInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/anim/Body.animask' },
        });
        assert.equal(maskInspect.data.asset.joints[0].enabled, false);

        const rtScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/fx/Screen.rt', rootName: 'Screen' },
        });
        assert.equal(rtScaffold.data.kind, 'renderTexture');
        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/fx/Screen.rt',
                props: { width: 512, height: 256, texture: { wrapModeS: 'clamp-to-edge' } },
            },
        });
        const rtInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/fx/Screen.rt' },
        });
        assert.equal(rtInspect.data.asset.width, 512);
        assert.equal(rtInspect.data.asset.texture.wrapModeS, 'clamp-to-edge');

        const pipeScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/fx/Forward.rpp', rootName: 'ForwardPipe', template: 'forward' },
        });
        assert.equal(pipeScaffold.data.kind, 'renderPipeline');
        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/fx/Forward.rpp',
                props: { flows: [{ index: 0, name: 'MainFlow', priority: 4 }] },
            },
        });
        const pipeInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/fx/Forward.rpp' },
        });
        assert.equal(pipeInspect.data.asset.type, 'ForwardPipeline');
        assert.equal(pipeInspect.data.asset.flows[0].name, 'MainFlow');
        assert.equal(pipeInspect.data.asset.flows[0].priority, 4);

        const flowScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/fx/Main.flow', rootName: 'MainFlow' },
        });
        assert.equal(flowScaffold.data.kind, 'renderFlow');
        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/fx/Main.flow',
                props: {
                    name: 'MainFlow',
                    priority: 3,
                    stageUuids: ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
                },
            },
        });
        const flowInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/fx/Main.flow' },
        });
        assert.equal(flowInspect.data.kind, 'renderFlow');
        assert.equal(flowInspect.data.asset.type, 'RenderFlow');
        assert.equal(flowInspect.data.asset.priority, 3);
        assert.deepEqual(flowInspect.data.asset.stageUuids, ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);

        const stageScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/fx/Opaque.stg', rootName: 'OpaqueStage' },
        });
        assert.equal(stageScaffold.data.kind, 'renderStage');
        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/fx/Opaque.stg',
                props: { name: 'OpaqueStage', tag: 2 },
            },
        });
        const stageInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/fx/Opaque.stg' },
        });
        assert.equal(stageInspect.data.kind, 'renderStage');
        assert.equal(stageInspect.data.asset.name, 'OpaqueStage');
        assert.equal(stageInspect.data.asset.tag, 2);

        const audioInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Click.wav' },
        });
        assert.equal(audioInspect.data.kind, 'audio');
        assert.equal(audioInspect.data.asset.downloadMode, 0);
        const audioSet = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: { assetRelativePath: 'assets/Click.wav', props: { downloadMode: 'DOM_AUDIO' } },
        });
        assert.equal(audioSet.data.kind, 'audio');
        const audioAgain = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Click.wav' },
        });
        assert.equal(audioAgain.data.asset.downloadMode, 1);
        assert.equal(audioAgain.data.asset.downloadModeName, 'DOM_AUDIO');
        assert.equal(readFileSync(join(root, 'assets/Click.wav'), 'utf8'), 'wav-source');

        const videoInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Intro.mp4' },
        });
        assert.equal(videoInspect.data.kind, 'video');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/Intro.mp4', props: { downloadMode: 1 } },
                }),
            /lumen_video_property_not_editable:video.downloadMode/,
        );
        assert.equal(readFileSync(join(root, 'assets/Intro.mp4'), 'utf8'), 'mp4-source');

        const ttfInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Title.ttf' },
        });
        assert.equal(ttfInspect.data.kind, 'ttfFont');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/Title.ttf', props: { fontSize: 16 } },
                }),
            /lumen_font_property_not_editable:ttfFont.fontSize/,
        );
        assert.equal(readFileSync(join(root, 'assets/Title.ttf'), 'utf8'), 'ttf-source');

        const fontSet = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/Score.fnt',
                props: { textureUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', fontSize: 48 },
            },
        });
        assert.equal(fontSet.data.kind, 'bitmapFont');
        const fontInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Score.fnt' },
        });
        assert.equal(fontInspect.data.asset.textureUuid, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        assert.equal(fontInspect.data.asset.fontSize, 48);
        assert.equal(readFileSync(join(root, 'assets/Score.fnt'), 'utf8'), 'info face="Score"\n');

        const spineSet = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/Hero.skel',
                props: { atlasUuid: '77777777-8888-4999-8aaa-bbbbbbbbbbbb' },
            },
        });
        assert.equal(spineSet.data.kind, 'spine');
        const spineInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Hero.skel' },
        });
        assert.equal(spineInspect.data.asset.atlasUuid, '77777777-8888-4999-8aaa-bbbbbbbbbbbb');
        assert.equal(readFileSync(join(root, 'assets/Hero.skel'), 'utf8'), 'skel-source');

        const dbInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Hero.dbbin' },
        });
        assert.equal(dbInspect.data.kind, 'dragonBones');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/Hero.dbbin', props: { atlasUuid: 'x' } },
                }),
            /lumen_dragonbones_property_not_editable:dragonBones.atlasUuid/,
        );
        assert.equal(readFileSync(join(root, 'assets/Hero.dbbin'), 'utf8'), 'dbbin-source');

        const cubeSet = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/Sky.cubemap',
                props: { faces: { left: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, texture: { anisotropy: 4 } },
            },
        });
        assert.equal(cubeSet.data.kind, 'cubeMap');
        const cubeInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Sky.cubemap' },
        });
        assert.equal(cubeInspect.data.asset.faces.left, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        assert.equal(cubeInspect.data.asset.texture.anisotropy, 4);
        assert.equal(readFileSync(join(root, 'assets/Sky.cubemap'), 'utf8'), '{}\n');

        const tmxInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Level.tmx' },
        });
        assert.equal(tmxInspect.data.kind, 'tiledMap');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/Level.tmx', props: { atlasUuid: 'x' } },
                }),
            /lumen_tiledmap_property_not_editable:tiledMap.atlasUuid/,
        );
        assert.equal(readFileSync(join(root, 'assets/Level.tmx'), 'utf8'), '<map version="1.4"/>\n');

        const dirSet = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/pack',
                props: { isBundle: true, bundleName: 'game-pack', priority: 8 },
            },
        });
        assert.equal(dirSet.data.kind, 'directory');
        const dirInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/pack' },
        });
        assert.equal(dirInspect.data.asset.isBundle, true);
        assert.equal(dirInspect.data.asset.bundleName, 'game-pack');
        assert.equal(dirInspect.data.asset.priority, 8);

        const particleInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Smoke.plist' },
        });
        assert.equal(particleInspect.data.kind, 'particle');
        assert.equal(particleInspect.data.asset.spriteFrameUuid, 'ffffffff-0000-4fff-8aaa-bbbbbbbbbbbb');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/Smoke.plist', props: { spriteFrameUuid: 'x' } },
                }),
            /lumen_particle_property_not_editable:particle.spriteFrameUuid/,
        );
        assert.equal(readFileSync(join(root, 'assets/Smoke.plist'), 'utf8'), '<?xml version="1.0"?><plist/>\n');

        const spriteAtlasInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Hero.plist' },
        });
        assert.equal(spriteAtlasInspect.data.kind, 'spriteAtlas');
        assert.equal(spriteAtlasInspect.data.asset.spriteFrames[0].name, 'icon');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/Hero.plist', props: { textureUuid: 'x' } },
                }),
            /lumen_spriteatlas_property_not_editable:spriteAtlas.textureUuid/,
        );
        assert.equal(readFileSync(join(root, 'assets/Hero.plist'), 'utf8'), '<?xml version="1.0"?><plist/>\n');

        const jsonInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/note.json' },
        });
        assert.equal(jsonInspect.data.kind, 'json');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/note.json', props: { source: '{}' } },
                }),
            /lumen_json_property_not_editable:json.source/,
        );
        assert.equal(readFileSync(join(root, 'assets/note.json'), 'utf8'), '{"ok":true}\n');

        const textInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/note.txt' },
        });
        assert.equal(textInspect.data.kind, 'text');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/note.txt', props: { source: 'x' } },
                }),
            /lumen_text_property_not_editable:text.source/,
        );
        assert.equal(readFileSync(join(root, 'assets/note.txt'), 'utf8'), 'hello\n');

        const bufferInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Table.bin' },
        });
        assert.equal(bufferInspect.data.kind, 'buffer');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/Table.bin', props: { source: 'x' } },
                }),
            /lumen_buffer_property_not_editable:buffer.source/,
        );
        assert.deepEqual(readFileSync(join(root, 'assets/Table.bin')), Buffer.from([0x00, 0x01, 0x02, 0xff]));

        const scriptInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Probe.ts' },
        });
        assert.equal(scriptInspect.data.kind, 'script');
        const scriptSet = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: {
                assetRelativePath: 'assets/Probe.ts',
                props: { source: 'export class Probe { static readonly tag = "mcp"; }\n' },
            },
        });
        assert.equal(scriptSet.data.kind, 'script');
        assert.equal(
            readFileSync(join(root, 'assets/Probe.ts'), 'utf8'),
            'export class Probe { static readonly tag = "mcp"; }\n',
        );

        const jsSet = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: { assetRelativePath: 'assets/plugin.js', props: { isPlugin: true, loadPluginInEditor: true } },
        });
        assert.equal(jsSet.data.kind, 'javascript');
        assert.equal(readFileSync(join(root, 'assets/plugin.js'), 'utf8'), 'module.exports = {};\n');
        const jsInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/plugin.js' },
        });
        assert.equal(jsInspect.data.kind, 'javascript');
        assert.equal(jsInspect.data.asset.isPlugin, true);
        assert.equal(jsInspect.data.asset.loadPluginInEditor, true);

        const meshInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Cube.mesh' },
        });
        assert.equal(meshInspect.data.kind, 'mesh');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/Cube.mesh', props: { source: '[]' } },
                }),
            /lumen_mesh_property_not_editable:mesh.source/,
        );
        assert.equal(readFileSync(join(root, 'assets/Cube.mesh'), 'utf8'), '[{"__type__":"cc.Mesh"}]\n');

        const skeletonInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Skin.skeleton' },
        });
        assert.equal(skeletonInspect.data.kind, 'skeleton');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/Skin.skeleton', props: { source: '[]' } },
                }),
            /lumen_skeleton_property_not_editable:skeleton.source/,
        );
        assert.equal(readFileSync(join(root, 'assets/Skin.skeleton'), 'utf8'), '[{"__type__":"cc.Skeleton"}]\n');

        const animationDumpInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Walk.animation' },
        });
        assert.equal(animationDumpInspect.data.kind, 'instantiationAnimation');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/Walk.animation', props: { source: '[]' } },
                }),
            /lumen_instantiation_animation_property_not_editable:instantiationAnimation.source/,
        );
        assert.equal(readFileSync(join(root, 'assets/Walk.animation'), 'utf8'), '[{"__type__":"cc.AnimationClip"}]\n');

        const materialDumpInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/Body.material' },
        });
        assert.equal(materialDumpInspect.data.kind, 'instantiationMaterial');
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.assetSet',
                    input: { assetRelativePath: 'assets/Body.material', props: { source: '[]' } },
                }),
            /lumen_instantiation_material_property_not_editable:instantiationMaterial.source/,
        );
        assert.equal(readFileSync(join(root, 'assets/Body.material'), 'utf8'), '[{"__type__":"cc.Material"}]\n');

        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.inspect',
                    input: {
                        prefabRelativePath: 'assets/fx/Lit.mtl',
                        assetRelativePath: 'assets/fx/Other.mtl',
                    },
                }),
            /editor_mcp_lumen_path_conflict/,
        );
        await assert.rejects(
            async () =>
                pluginModule.dispatchMcpAction('cocos.call', {
                    operation: 'lumen.tree',
                    input: { assetRelativePath: 'assets/fx/Lit.mtl' },
                }),
            /lumen_not_hierarchy_asset/,
        );

        const animScaffold = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/anim/Idle.anim', rootName: 'Idle', template: 'empty' },
        });
        assert.equal(animScaffold.data.kind, 'animationClip');
        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.assetSet',
            input: { assetRelativePath: 'assets/anim/Idle.anim', props: { wrapMode: 'Loop', sample: 30 } },
        });
        const animInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.inspect',
            input: { assetRelativePath: 'assets/anim/Idle.anim' },
        });
        assert.equal(animInspect.data.kind, 'animationClip');
        assert.equal(animInspect.data.asset.wrapModeName, 'Loop');
        assert.equal(animInspect.data.asset.sample, 30);

        const physInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/phys/Ground.pmtl', rootName: 'Ground' },
        });
        assert.equal(physInspect.data.kind, 'physicsMaterial');
        const terrainInspect = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.scaffold',
            input: { assetRelativePath: 'assets/land/Field.terrain', rootName: 'Field' },
        });
        assert.equal(terrainInspect.data.kind, 'terrain');

        const commit = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.commit',
            input: { paths: ['assets/ui/Demo.prefab'] },
        });
        assert.deepEqual(commit.data.pipeline, [
            'assetdb_refresh',
            'hierarchy_settle',
            'assetdb_registration',
            'catalog_refresh',
            'validate_refs',
        ]);
        assert.ok(Array.isArray(commit.data.validation));
        assert.equal(commit.data.validation[0].ok, true);
        assert.equal(typeof commit.data.catalog.generatedAt, 'string');
        // 无 Creator Message 时 AssetDB 为 noop；catalog 仍应重建成功。
        assert.equal(commit.data.editorRefresh.result.triggered, false);

        const commitByAlias = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'lumen.commit',
            input: { prefabRelativePath: 'assets/ui/Demo.prefab' },
        });
        assert.deepEqual(commitByAlias.data.pipeline, [
            'assetdb_refresh',
            'hierarchy_settle',
            'assetdb_registration',
            'catalog_refresh',
            'validate_refs',
        ]);
        assert.equal(commitByAlias.data.editorRefresh.result.triggered, false);

        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/Demo.prefab'), 'utf8'));
        assert.equal(
            prefab.some((entry) => entry.__type__ === 'cc.Label'),
            true,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('Editor MCP should set selection by path and batch queryInfo', async () => {
    const { pluginModule, messageRequests } = await createActivePluginModule();
    const setSelection = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'editor.setSelection',
        input: { paths: ['Demo/Child'] },
    });
    assert.deepEqual(setSelection.data.ids, ['child-uuid']);
    assert.equal(setSelection.data.count, 1);
    assert.equal(setSelection.data.items[0].path, 'Demo/Child');

    const cleared = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'editor.setSelection',
        input: { clear: true },
    });
    assert.deepEqual(cleared.data.ids, []);
    assert.equal(cleared.data.count, 0);

    const batch = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'asset.queryInfo',
        input: { paths: ['assets/a.prefab', 'assets/b.prefab'] },
    });
    assert.equal(batch.data.batch, true);
    assert.equal(batch.data.count, 2);
    assert.equal(batch.data.items.length, 2);

    const focus = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.focusNode',
        input: { path: 'Demo/Child' },
    });
    assert.equal(focus.data.available, true);

    const createNode = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'scene.createNode',
        input: { type: 'Camera', name: 'MainCamera', parentPath: 'Demo' },
    });
    assert.equal(createNode.data.available, true);

    const createPrefab = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'prefab.createFromNode',
        input: { nodePath: 'Demo/Child', prefabPath: 'db://assets/Child.prefab' },
    });
    assert.equal(createPrefab.data.available, true);
    assert.equal(createPrefab.data.data.instancePath, 'Demo/Child');
    assert.equal(createPrefab.data.data.instanceUuid, 'child-uuid');
    assert.deepEqual(messageRequests.at(-1), {
        target: 'scene',
        message: 'create-prefab',
        args: ['child-uuid', 'db://assets/Child.prefab'],
    });

    const apply = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'prefab.apply',
        input: { nodePath: 'Demo/Child' },
    });
    assert.equal(apply.data.available, true);
    assert.deepEqual(messageRequests.at(-1), {
        target: 'scene',
        message: 'apply-prefab',
        args: ['child-uuid'],
    });

    const revert = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'prefab.revert',
        input: { nodePath: 'Demo/Child' },
    });
    assert.equal(revert.data.available, true);
    assert.equal(revert.data.message, 'prefab_revert_ok:restore-prefab');
    assert.deepEqual(messageRequests.at(-1), {
        target: 'scene',
        message: 'restore-prefab',
        args: ['child-uuid', 'prefab-asset-uuid'],
    });

    const unpack = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'prefab.unpack',
        input: { nodePath: 'Demo/Child', confirmDestructive: true },
    });
    assert.equal(unpack.data.available, true);
    assert.equal(unpack.data.message, 'prefab_unpack_ok:unlink-prefab');
    assert.deepEqual(messageRequests.at(-1), {
        target: 'scene',
        message: 'unlink-prefab',
        args: ['child-uuid', true],
    });

    await assert.rejects(
        async () =>
            pluginModule.dispatchMcpAction('cocos.call', {
                operation: 'prefab.unlink',
                input: { nodePath: 'Demo/Child' },
            }),
        /editor_mcp_destructive_confirmation_required/,
    );
    const unlink = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'prefab.unlink',
        input: { nodePath: 'Demo/Child', confirmDestructive: true },
    });
    assert.equal(unlink.data.available, true);
});

test('Editor MCP plugin should execute silent asset lifecycle on disk', async () => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-editor-mcp-lifecycle-'));
    try {
        mkdirSync(join(root, 'assets/seed'), { recursive: true });
        writeFileSync(join(root, 'package.json'), '{"name":"mcp-lifecycle","creator":{"version":"3.8.7"}}\n');
        const seedPath = join(root, 'assets/seed/Icon.png');
        writeFileSync(seedPath, 'png-source');
        writeFileSync(
            `${seedPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.27',
                    importer: 'image',
                    imported: true,
                    uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                    files: ['.json', '.png'],
                    subMetas: {},
                    userData: { type: 'raw', hasAlpha: false },
                },
                null,
                2,
            )}\n`,
        );

        const refreshCalls = [];
        const { pluginModule } = await createActivePluginModule({
            projectPath: root,
            lumenGateway: {
                validate() {},
                async refreshForCommit(paths) {
                    refreshCalls.push({ paths });
                    return { phase: 'editor_refreshed', result: { triggered: true } };
                },
                async execute(operation, input) {
                    if (operation === 'lumen.refresh') {
                        refreshCalls.push(input);
                        return { phase: 'editor_refreshed', result: { triggered: true } };
                    }
                    return { ok: true, operation };
                },
            },
        });

        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'asset.createFolder',
            input: { path: 'assets/out' },
        });
        assert.equal(existsSync(join(root, 'assets/out')), true);

        const copy = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'asset.copy',
            input: { paths: ['assets/seed/Icon.png'], targetDirectory: 'assets/out' },
        });
        assert.equal(existsSync(join(root, 'assets/out/Icon.png')), true);
        assert.ok(Array.isArray(copy.data.items) && copy.data.items.length >= 1);

        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'asset.rename',
            input: { path: 'assets/out/Icon.png', newName: 'Renamed.png' },
        });
        assert.equal(existsSync(join(root, 'assets/out/Renamed.png')), true);

        const reimport = await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'asset.reimport',
            input: { paths: ['assets/out/Renamed.png'] },
        });
        assert.equal(reimport.data.phase, 'editor_refreshed');
        assert.equal(reimport.data.via, 'watcher_settle_skip_refresh_for_images');

        await pluginModule.dispatchMcpAction('cocos.call', {
            operation: 'asset.delete',
            input: { paths: ['assets/out/Renamed.png'], confirmDestructive: true },
        });
        assert.equal(existsSync(join(root, 'assets/out/Renamed.png')), false);
        assert.deepEqual(refreshCalls, [{ paths: ['assets/out/Icon.png'] }]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
