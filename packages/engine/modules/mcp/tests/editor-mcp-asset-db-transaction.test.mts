import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    EditorMcpAssetDbTransaction,
    type IEditorMcpAssetDbTransactionMessagePort,
} from '../src/editor-mcp-asset-db-transaction.js';
import { ResourceOperationClosureResolver } from '../src/resource-operation-closure-resolver.js';

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
