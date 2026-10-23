import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    EditorMcpAssetDbTransaction,
    type IEditorMcpAssetDbTransactionMessagePort,
} from '../src/editor-mcp-asset-db-transaction.js';
import {
    EditorMcpAssetDbCreationCoordinator,
    EditorMcpAssetDbCreationError,
} from '../src/editor-mcp-asset-db-creation-coordinator.js';
import { ResourceOperationClosureResolver } from '../src/resource-operation-closure-resolver.js';
import { EditorMcpLumenGateway } from '../src/editor-mcp-lumen-gateway.js';
import { EditorMcpActionRouter } from '../src/editor-mcp-action-router.js';
import { EditorMcpLumenInputCodec } from '../src/editor-mcp-lumen-input-codec.js';

test('Router requires exact verified creation target and type for all eleven native source kinds', () => {
    const router = Object.assign(Object.create(EditorMcpActionRouter.prototype) as object, {
        _runtime: { message: {} }, _lumenCreationCoordinationEnabled: true,
    }) as { _readRequiredCreationEvidence(operation: string, input: Record<string, unknown>, data: unknown): unknown };
    const types = { prefab: 'prefab', scene: 'scene', mtl: 'material', anim: 'animationClip', pmtl: 'physicsMaterial', rt: 'renderTexture',
        animgraph: 'animationGraph', animgraphvari: 'animationGraphVariant', animask: 'animationMask', rpp: 'renderPipeline', terrain: 'terrain' };
    for (const [extension, resourceType] of Object.entries(types)) {
        const input = { assetRelativePath: `assets/Real.${extension}`, cocosVersion: '3.8.3' };
        const creation = { phase: 'verified', targetDbPath: `db://${input.assetRelativePath}`, resourceType, uuid: 'actual-uuid',
            metaPresent: true, parentRegistered: true, subAssetUuids: [], polls: 1, waitedMs: 5, cleanup: { complete: true }, projectState: 'changed' };
        assert.deepEqual(router._readRequiredCreationEvidence('lumen.scaffold', input, { creation }), creation);
        if (extension === 'prefab') {
            for (const prefabPath of ['assets/Real.prefab', 'db://assets/Real.prefab']) {
                assert.deepEqual(router._readRequiredCreationEvidence('prefab.createFromNode', { prefabPath }, { creation }), creation);
            }
        }
        for (const alias of [`/assets/Real.${extension}`, `./assets/Real.${extension}`, `assets/./Real.${extension}`,
            `db://assets/Real.${extension}`]) {
            const aliased = { ...input, assetRelativePath: alias };
            assert.ok(new EditorMcpLumenInputCodec().readScaffoldInput(aliased).prefabRelativePath.endsWith(`Real.${extension}`));
            assert.deepEqual(router._readRequiredCreationEvidence('lumen.scaffold', aliased, { creation }), creation);
            assert.throws(() => router._readRequiredCreationEvidence('lumen.scaffold', aliased, {
                creation: { ...creation, targetDbPath: `db://assets/Other.${extension}` } }), /evidence_invalid/u);
        }
        assert.throws(() => router._readRequiredCreationEvidence('lumen.scaffold', input, {}), /evidence_missing/u);
        for (const mismatch of [{ ...creation, targetDbPath: `db://assets/Other.${extension}` },
            { ...creation, resourceType: resourceType === 'scene' ? 'prefab' : 'scene' }, { ...creation, phase: 'registered' }]) {
            assert.throws(() => router._readRequiredCreationEvidence('lumen.scaffold', input, { creation: mismatch }), /evidence_invalid/u);
        }
    }
});

test('new graph, mask, pipeline and binary Terrain scaffolds publish through the verified SDK creation transaction', async () => {
    for (const [kind, extension] of [['animationGraph', 'animgraph'], ['animationGraphVariant', 'animgraphvari'],
        ['animationMask', 'animask'], ['renderPipeline', 'rpp'], ['terrain', 'terrain']] as const) {
        const projectRoot = mkdtempSync(join(tmpdir(), 'native-source-gateway-')); const path = `assets/generated/Real.${extension}`;
        mkdirSync(join(projectRoot, 'assets/generated'), { recursive: true });
        const registrations = new Map<string, unknown>([['db://assets/generated', { uuid: 'parent-uuid', subAssets: {} }]]);
        const uuid = '12345678-1234-4234-8234-123456789abc'; let publications = 0; let commits = 0;
        const message: IEditorMcpAssetDbTransactionMessagePort = { request: async (_target, method, url, content) => {
            if (method === 'query-ready') return true;
            if (method === 'query-asset-info') return registrations.get(String(url)) ?? null;
            if (method === 'create-asset') {
                assert.equal(url, `db://${path}`); assert.equal(commits, 1);
                assert.equal(existsSync(join(projectRoot, path)), false); assert.equal(existsSync(join(projectRoot, `${path}.meta`)), false);
                if (kind === 'terrain') {
                    assert.ok(Buffer.isBuffer(content)); assert.equal(content.readInt32LE(0), 0x01010008);
                } else {
                    assert.equal(typeof content, 'string'); const data = JSON.parse(String(content));
                    assert.equal((Array.isArray(data) ? data[0] : data)._name, 'Real');
                }
                writeFileSync(join(projectRoot, path), content as string | Buffer);
                writeFileSync(join(projectRoot, `${path}.meta`), JSON.stringify({ uuid, imported: true }));
                registrations.set(String(url), { uuid, subAssets: {} }); publications += 1; return { uuid };
            }
            return null;
        } };
        const transaction = new EditorMcpAssetDbTransaction({ requireProjectPath: async () => projectRoot,
            requireMessage: () => message, refreshForCommit: async () => null });
        const coordinator = new EditorMcpAssetDbCreationCoordinator({ requireProjectPath: async () => projectRoot,
            requireMessage: () => message, transaction });
        const gateway = new EditorMcpLumenGateway(async () => projectRoot, message, '3.8.3'); gateway.configureCreationCoordinator(coordinator);
        try {
            const result = await gateway.execute('lumen.scaffold', { assetRelativePath: path, rootName: 'Real', template: 'empty', autoCommit: false },
                { enterCommitWindow: () => { commits += 1; return true; } }) as { creation: { phase: string; resourceType: string; uuid: string } };
            assert.equal(publications, 1); assert.equal(result.creation.phase, 'verified');
            assert.equal(result.creation.resourceType, kind); assert.equal(result.creation.uuid, uuid);
        } finally { rmSync(projectRoot, { recursive: true, force: true }); }
    }
});

test('binary creation snapshots Buffer before its first await, preserving bytes while the caller mutates its input', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'native-binary-snapshot-')); mkdirSync(join(projectRoot, 'assets'));
    const input = Buffer.from([8, 0, 1, 1, 0, 255]); const expected = Buffer.from(input); let registered = false;
    const uuid = '12345678-1234-4234-8234-123456789abc';
    const message: IEditorMcpAssetDbTransactionMessagePort = { request: async (_target, method, path, content) => {
        if (method === 'query-ready') return true;
        if (method === 'query-asset-info' && path === 'db://assets') return { uuid: 'root-uuid', subAssets: {} };
        if (method === 'query-asset-info') return registered ? { uuid, subAssets: {} } : null;
        if (method === 'create-asset') {
            assert.equal(path, 'db://assets/Real.terrain'); assert.ok(Buffer.isBuffer(content)); assert.notEqual(content, input);
            assert.deepEqual(content, expected); writeFileSync(join(projectRoot, 'assets/Real.terrain'), content);
            writeFileSync(join(projectRoot, 'assets/Real.terrain.meta'), JSON.stringify({ uuid })); registered = true; return { uuid };
        }
        return null;
    } };
    const transaction = new EditorMcpAssetDbTransaction({ requireProjectPath: async () => projectRoot,
        requireMessage: () => message, refreshForCommit: async () => null });
    const coordinator = new EditorMcpAssetDbCreationCoordinator({ requireProjectPath: async () => { input.fill(42); return projectRoot; },
        requireMessage: () => message, transaction });
    try {
        await coordinator.create({ targetPath: 'assets/Real.terrain', resourceType: 'terrain', content: input });
        assert.deepEqual(readFileSync(join(projectRoot, 'assets/Real.terrain')), expected); assert.notDeepEqual(input, expected);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); }
});

test('AssetDB transaction waits for UUID, meta and sub-assets', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peanut-assetdb-transaction-'));
    const relativePath = 'assets/generated/Controller.ts';
    mkdirSync(join(projectRoot, 'assets/generated'), { recursive: true });
    writeFileSync(join(projectRoot, relativePath), 'export const ready = true;\n', 'utf8');
    writeFileSync(
        join(projectRoot, `${relativePath}.meta`),
        JSON.stringify({ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', importer: 'typescript' }),
        'utf8',
    );
    let queryCount = 0;
    const message: IEditorMcpAssetDbTransactionMessagePort = {
        request: async (_target, messageName): Promise<unknown> => {
            if (messageName !== 'query-asset-info') {
                return null;
            }
            queryCount += 1;
            if (queryCount === 1) {
                return null;
            }
            return {
                uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                importer: 'typescript',
                subAssets: {
                    child: { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@child' },
                },
            };
        },
    };
    let refreshCount = 0;
    const transaction = new EditorMcpAssetDbTransaction({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        refreshForCommit: async (): Promise<unknown> => {
            refreshCount += 1;
            return { settled: true };
        },
    });
    try {
        const evidence = await transaction.commit([relativePath], { timeoutMs: 1000, pollIntervalMs: 20 });
        assert.equal(evidence.phase, 'assetdb_registered');
        assert.equal(refreshCount, 1);
        assert.equal(evidence.polls, 1);
        assert.equal(evidence.registrations[0]?.uuid, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        assert.deepEqual(evidence.registrations[0]?.subAssetUuids, ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@child']);
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('AssetDB transaction registers pure disk copies before refresh and removes its probe', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peanut-assetdb-copy-registration-'));
    const relativePath = 'assets/copied/Record.json';
    mkdirSync(join(projectRoot, 'assets/copied'), { recursive: true });
    writeFileSync(join(projectRoot, relativePath), '{"copied":true}\n', 'utf8');
    writeFileSync(
        join(projectRoot, `${relativePath}.meta`),
        JSON.stringify({ uuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', importer: 'json' }),
        'utf8',
    );
    let probeCreated = false;
    let probeDeleted = false;
    const message: IEditorMcpAssetDbTransactionMessagePort = {
        request: async (_target, messageName, pathValue): Promise<unknown> => {
            const dbPath = typeof pathValue === 'string' ? pathValue : '';
            if (messageName === 'create-asset') {
                assert.match(dbPath, /^db:\/\/assets\/copied\/__peanut_assetdb_register_[0-9a-f]{32}\.json$/u);
                probeCreated = true;
                return { uuid: 'cccccccc-dddd-eeee-ffff-000000000000' };
            }
            if (messageName === 'delete-asset') {
                assert.equal(probeCreated, true);
                probeDeleted = true;
                return true;
            }
            if (messageName === 'query-asset-info' && dbPath === `db://${relativePath}` && probeCreated) {
                return { uuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', importer: 'json', subAssets: {} };
            }
            return null;
        },
    };
    const transaction = new EditorMcpAssetDbTransaction({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        refreshForCommit: async (): Promise<unknown> => {
            assert.equal(probeCreated, true);
            return { settled: true };
        },
    });
    try {
        const evidence = await transaction.commit([relativePath], { timeoutMs: 1000, pollIntervalMs: 20 });
        assert.equal(evidence.phase, 'assetdb_registered');
        assert.equal(evidence.registrations[0]?.uuid, 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff');
        assert.equal(probeDeleted, true);
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('AssetDB transaction removes partial probes when a later probe creation fails', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peanut-assetdb-probe-rollback-'));
    const relativePaths = ['assets/copied-a/Record.json', 'assets/copied-b/Record.json'];
    for (const relativePath of relativePaths) {
        mkdirSync(join(projectRoot, relativePath, '..'), { recursive: true });
        writeFileSync(join(projectRoot, relativePath), '{"copied":true}\n', 'utf8');
        writeFileSync(join(projectRoot, `${relativePath}.meta`), '{}\n', 'utf8');
    }
    const probePaths: string[] = [];
    const message: IEditorMcpAssetDbTransactionMessagePort = {
        request: async (_target, messageName, pathValue): Promise<unknown> => {
            const dbPath = typeof pathValue === 'string' ? pathValue : '';
            if (messageName === 'create-asset') {
                const relativePath = dbPath.slice('db://'.length);
                probePaths.push(relativePath);
                writeFileSync(join(projectRoot, relativePath), '{}\n', 'utf8');
                writeFileSync(join(projectRoot, `${relativePath}.meta`), '{}\n', 'utf8');
                if (probePaths.length === 2) {
                    throw new Error('probe_create_failed');
                }
                return { uuid: 'cccccccc-dddd-eeee-ffff-000000000000' };
            }
            if (messageName === 'delete-asset') {
                return false;
            }
            return null;
        },
    };
    const transaction = new EditorMcpAssetDbTransaction({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        refreshForCommit: async (): Promise<unknown> => ({ settled: true }),
    });
    try {
        await assert.rejects(transaction.commit(relativePaths), /probe_create_failed/u);
        assert.equal(probePaths.length, 2);
        for (const probePath of probePaths) {
            assert.equal(existsSync(join(projectRoot, probePath)), false);
            assert.equal(existsSync(join(projectRoot, `${probePath}.meta`)), false);
        }
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('AssetDB transaction fails closed when registration stays pending', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peanut-assetdb-pending-'));
    const message: IEditorMcpAssetDbTransactionMessagePort = {
        request: async (): Promise<unknown> => null,
    };
    const transaction = new EditorMcpAssetDbTransaction({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        refreshForCommit: async (): Promise<unknown> => ({ settled: false }),
    });
    try {
        await assert.rejects(
            transaction.commit(['assets/pending.prefab'], { timeoutMs: 100, pollIntervalMs: 20 }),
            /editor_mcp_assetdb_registration_pending:db:\/\/assets\/pending\.prefab/u,
        );
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('resource closure resolves meta UUIDs and transitive serialized dependencies', (): void => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peanut-resource-closure-'));
    const assetsRoot = join(projectRoot, 'assets');
    mkdirSync(assetsRoot, { recursive: true });
    const materialUuid = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    writeFileSync(join(assetsRoot, 'Root.prefab'), JSON.stringify([{ dependency: { __uuid__: materialUuid } }]), 'utf8');
    writeFileSync(
        join(assetsRoot, 'Root.prefab.meta'),
        JSON.stringify({ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', importer: 'prefab', subMetas: {} }),
        'utf8',
    );
    writeFileSync(join(assetsRoot, 'Shared.mtl'), JSON.stringify([{ name: 'shared' }]), 'utf8');
    writeFileSync(
        join(assetsRoot, 'Shared.mtl.meta'),
        JSON.stringify({ uuid: materialUuid, importer: 'material', subMetas: {} }),
        'utf8',
    );
    try {
        const closure = new ResourceOperationClosureResolver().resolve(projectRoot, ['assets/Root.prefab']);
        assert.ok(closure.dependencies.includes('db://assets/Shared.mtl'));
        assert.ok(closure.uuidKeys.includes('uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
        assert.ok(closure.uuidKeys.includes(`uuid:${materialUuid}`));
        assert.ok(closure.sidecars.includes('db://assets/Root.prefab.meta'));
        assert.ok(closure.sidecars.includes('db://assets/Shared.mtl.meta'));
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('AssetDB creation publishes in-memory prefab only after parent registration and commit entry', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peanut-assetdb-create-success-'));
    mkdirSync(join(projectRoot, 'assets'), { recursive: true });
    const registrations = new Map<string, Record<string, unknown>>([['db://assets', { uuid: 'assets-root' }]]);
    const calls: string[] = [];
    const targetDbPath = 'db://assets/generated/Demo.prefab';
    const targetUuid = '11111111-2222-4333-8444-555555555555';
    let commitEntered = false;
    const message: IEditorMcpAssetDbTransactionMessagePort = {
        request: async (_target, messageName, pathValue, contentValue): Promise<unknown> => {
            if (messageName === 'query-ready') return true;
            const dbPath = typeof pathValue === 'string' ? pathValue : '';
            calls.push(`${messageName}:${dbPath}`);
            if (messageName === 'query-asset-info') {
                return registrations.get(dbPath) ?? null;
            }
            if (messageName === 'create-asset') {
                const relativePath = dbPath.slice('db://'.length);
                mkdirSync(join(projectRoot, relativePath, '..'), { recursive: true });
                writeFileSync(join(projectRoot, relativePath), typeof contentValue === 'string' ? contentValue : '{}\n', 'utf8');
                writeFileSync(join(projectRoot, `${relativePath}.meta`), '{}\n', 'utf8');
                if (dbPath.includes('__peanut_assetdb_register_')) {
                    registrations.set(dbPath, { uuid: 'probe-uuid', subAssets: {} });
                    registrations.set('db://assets/generated', { uuid: 'parent-uuid', subAssets: {} });
                    writeFileSync(join(projectRoot, 'assets/generated.meta'), JSON.stringify({ uuid: 'parent-uuid' }));
                    return { uuid: 'probe-uuid' };
                }
                assert.equal(commitEntered, true);
                registrations.set(dbPath, {
                    uuid: targetUuid,
                    importer: 'prefab',
                    subAssets: { root: { uuid: `${targetUuid}@root` } },
                });
                return { uuid: targetUuid };
            }
            if (messageName === 'delete-asset') {
                registrations.delete(dbPath);
                const relativePath = dbPath.slice('db://'.length);
                rmSync(join(projectRoot, relativePath), { force: true });
                rmSync(join(projectRoot, `${relativePath}.meta`), { force: true });
                return true;
            }
            return null;
        },
    };
    const transaction = new EditorMcpAssetDbTransaction({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        refreshForCommit: async () => null,
    });
    const coordinator = new EditorMcpAssetDbCreationCoordinator({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        transaction,
    });
    try {
        const evidence = await coordinator.create({
            targetPath: targetDbPath,
            resourceType: 'prefab',
            content: '[{"__type__":"cc.Prefab"}]\n',
            lifecycle: {
                enterCommitWindow: () => {
                    commitEntered = true;
                    return true;
                },
            },
            timeoutMs: 500,
            pollIntervalMs: 20,
        });
        assert.equal(evidence.phase, 'verified');
        assert.equal(evidence.uuid, targetUuid);
        assert.equal(evidence.metaPresent, true);
        assert.deepEqual(evidence.subAssetUuids, [`${targetUuid}@root`]);
        assert.equal(calls.some((entry) => entry.startsWith('create-asset:db://assets/generated/__peanut_assetdb_register_')), true);
        assert.equal(calls.filter((entry) => entry === `create-asset:${targetDbPath}`).length, 1);
        assert.equal(readdirSync(join(projectRoot, 'assets/generated')).some((name) => name.includes('__peanut_assetdb_register_')), false);
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('AssetDB creation rejects an existing target without publishing', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peanut-assetdb-create-conflict-'));
    mkdirSync(join(projectRoot, 'assets'), { recursive: true });
    let createCalls = 0;
    const message: IEditorMcpAssetDbTransactionMessagePort = {
        request: async (_target, messageName, pathValue): Promise<unknown> => {
            if (messageName === 'query-asset-info' && pathValue === 'db://assets/Existing.prefab') {
                return { uuid: 'existing-uuid', importer: 'prefab', subAssets: {} };
            }
            if (messageName === 'create-asset') {
                createCalls += 1;
            }
            return null;
        },
    };
    const transaction = new EditorMcpAssetDbTransaction({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        refreshForCommit: async () => null,
    });
    const coordinator = new EditorMcpAssetDbCreationCoordinator({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        transaction,
    });
    try {
        await assert.rejects(
            coordinator.create({
                targetPath: 'assets/Existing.prefab',
                resourceType: 'prefab',
                content: '[]\n',
            }),
            (error: unknown) => error instanceof EditorMcpAssetDbCreationError &&
                error.message === 'editor_mcp_asset_create_conflict:db://assets/Existing.prefab' &&
                error.evidence.projectState === 'unchanged',
        );
        assert.equal(createCalls, 0);
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('AssetDB creation cancels before publication and removes its empty parent directory', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peanut-assetdb-create-cancel-'));
    mkdirSync(join(projectRoot, 'assets'), { recursive: true });
    const registrations = new Map<string, Record<string, unknown>>([['db://assets', { uuid: 'assets-root' }]]);
    let mainPublished = false;
    const message: IEditorMcpAssetDbTransactionMessagePort = {
        request: async (_target, messageName, pathValue): Promise<unknown> => {
            if (messageName === 'query-ready') return true;
            const dbPath = typeof pathValue === 'string' ? pathValue : '';
            if (messageName === 'query-asset-info') return registrations.get(dbPath) ?? null;
            if (messageName === 'create-asset') {
                if (!dbPath.includes('__peanut_assetdb_register_')) mainPublished = true;
                registrations.set(dbPath, { uuid: 'probe-uuid', subAssets: {} });
                registrations.set('db://assets/cancelled', { uuid: 'parent-uuid', subAssets: {} });
                registrations.set('parent-uuid', { uuid: 'parent-uuid', subAssets: {} });
                writeFileSync(join(projectRoot, 'assets/cancelled.meta'), JSON.stringify({ uuid: 'parent-uuid' }));
                return { uuid: 'probe-uuid' };
            }
            if (messageName === 'refresh-asset') {
                assert.equal(dbPath, 'db://assets');
                registrations.delete('db://assets/cancelled');
                registrations.delete('parent-uuid');
                return null;
            }
            if (messageName === 'delete-asset') {
                registrations.delete(dbPath);
                return true;
            }
            return null;
        },
    };
    const transaction = new EditorMcpAssetDbTransaction({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        refreshForCommit: async () => null,
    });
    const coordinator = new EditorMcpAssetDbCreationCoordinator({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        transaction,
    });
    try {
        await assert.rejects(
            coordinator.create({
                targetPath: 'assets/cancelled/Scene.scene',
                resourceType: 'scene',
                content: '[]\n',
                lifecycle: { enterCommitWindow: () => false },
                timeoutMs: 500,
                pollIntervalMs: 20,
            }),
            /editor_mcp_task_cancelled_before_commit/u,
        );
        assert.equal(mainPublished, false);
        assert.equal(existsSync(join(projectRoot, 'assets/cancelled')), false);
        assert.equal(registrations.get('db://assets/cancelled'), undefined);
        assert.equal(registrations.get('parent-uuid'), undefined);
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('AssetDB creation rolls back an owned publication that remains registration pending', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peanut-assetdb-create-pending-'));
    mkdirSync(join(projectRoot, 'assets/generated'), { recursive: true });
    const targetDbPath = 'db://assets/generated/Pending.prefab';
    const targetUuid = '66666666-7777-4888-8999-aaaaaaaaaaaa';
    let deleted = false;
    const message: IEditorMcpAssetDbTransactionMessagePort = {
        request: async (_target, messageName, pathValue, contentValue): Promise<unknown> => {
            if (messageName === 'query-ready') return true;
            const dbPath = typeof pathValue === 'string' ? pathValue : '';
            if (messageName === 'query-asset-info') {
                if (dbPath === 'db://assets/generated') return { uuid: 'parent-uuid', subAssets: {} };
                return null;
            }
            if (messageName === 'create-asset' && dbPath === targetDbPath) {
                writeFileSync(join(projectRoot, 'assets/generated/Pending.prefab'), String(contentValue), 'utf8');
                writeFileSync(join(projectRoot, 'assets/generated/Pending.prefab.meta'), '{}\n', 'utf8');
                return { uuid: targetUuid };
            }
            if (messageName === 'delete-asset' && dbPath === targetDbPath) {
                deleted = true;
                rmSync(join(projectRoot, 'assets/generated/Pending.prefab'), { force: true });
                rmSync(join(projectRoot, 'assets/generated/Pending.prefab.meta'), { force: true });
                return true;
            }
            return null;
        },
    };
    const transaction = new EditorMcpAssetDbTransaction({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        refreshForCommit: async () => null,
    });
    const coordinator = new EditorMcpAssetDbCreationCoordinator({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        transaction,
    });
    try {
        await assert.rejects(
            coordinator.create({
                targetPath: targetDbPath,
                resourceType: 'prefab',
                content: '[]\n',
                timeoutMs: 100,
                pollIntervalMs: 20,
            }),
            (error: unknown) => error instanceof EditorMcpAssetDbCreationError &&
                error.message === 'editor_mcp_asset_create_registration_pending' &&
                error.evidence.cleanup.complete === true &&
                error.evidence.projectState === 'unchanged',
        );
        assert.equal(deleted, true);
        assert.equal(existsSync(join(projectRoot, 'assets/generated/Pending.prefab')), false);
        assert.equal(existsSync(join(projectRoot, 'assets/generated/Pending.prefab.meta')), false);
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('AssetDB creation refuses cleanup when published ownership does not match', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peanut-assetdb-create-mismatch-'));
    mkdirSync(join(projectRoot, 'assets'), { recursive: true });
    const targetDbPath = 'db://assets/Mismatch.prefab';
    let deleteCalls = 0;
    let published = false;
    const message: IEditorMcpAssetDbTransactionMessagePort = {
        request: async (_target, messageName, pathValue): Promise<unknown> => {
            if (messageName === 'query-ready') return true;
            const dbPath = typeof pathValue === 'string' ? pathValue : '';
            if (messageName === 'query-asset-info') {
                if (dbPath === 'db://assets') return { uuid: 'assets-root', subAssets: {} };
                if (dbPath === targetDbPath && published) {
                    return { uuid: 'external-uuid', importer: 'prefab', subAssets: {} };
                }
                return null;
            }
            if (messageName === 'create-asset' && dbPath === targetDbPath) {
                published = true;
                writeFileSync(join(projectRoot, 'assets/Mismatch.prefab.meta'), '{}\n', 'utf8');
                return { uuid: 'transaction-uuid' };
            }
            if (messageName === 'delete-asset') deleteCalls += 1;
            return null;
        },
    };
    const transaction = new EditorMcpAssetDbTransaction({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        refreshForCommit: async () => null,
    });
    const coordinator = new EditorMcpAssetDbCreationCoordinator({
        requireProjectPath: async () => projectRoot,
        requireMessage: () => message,
        transaction,
    });
    try {
        await assert.rejects(
            coordinator.create({ targetPath: targetDbPath, resourceType: 'prefab', content: '[]\n' }),
            (error: unknown) => error instanceof EditorMcpAssetDbCreationError &&
                error.message === 'editor_mcp_asset_create_identity_mismatch' &&
                error.evidence.cleanup.ownershipMismatch === true &&
                error.evidence.projectState === 'may_have_changed',
        );
        assert.equal(deleteCalls, 0);
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('text registration requires actual matching ordinary bounded meta and query exceptions stay unknown', async (context) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'pod-text-meta-')));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'assets'));
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    writeFileSync(join(root, 'assets/a.txt'), 'a');
    const meta = join(root, 'assets/a.txt.meta');
    writeFileSync(meta, JSON.stringify({ uuid, importer: 'text' }));
    let unavailable = false;
    const transaction = new EditorMcpAssetDbTransaction({ requireProjectPath: async () => root,
        requireMessage: () => ({ request: async () => { if (unavailable) throw new Error('injected_query_unknown'); return { uuid, importer: 'text' }; } }),
        refreshForCommit: async () => ({ settled: true }) });
    assert.equal((await transaction.queryTextRegistration('assets/a.txt', uuid))?.uuid, uuid);
    writeFileSync(meta, JSON.stringify({ uuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', importer: 'text' }));
    await assert.rejects(transaction.queryTextRegistration('assets/a.txt'), /uuid_conflict/u);
    writeFileSync(meta, 'x'.repeat(1024 * 1024 + 1));
    await assert.rejects(transaction.queryTextRegistration('assets/a.txt'), /meta_unsafe/u);
    unavailable = true;
    await assert.rejects(transaction.queryTextRegistration('assets/a.txt'), /injected_query_unknown/u);
});
