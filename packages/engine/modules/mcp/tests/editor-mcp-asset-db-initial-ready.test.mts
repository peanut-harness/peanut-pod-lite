import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EditorMcpAssetDbCreationCoordinator, EditorMcpAssetDbCreationError } from '../src/editor-mcp-asset-db-creation-coordinator.js';
import { EditorMcpAssetDbTransaction, type IEditorMcpAssetDbTransactionMessagePort } from '../src/editor-mcp-asset-db-transaction.js';

/**
 * @description 独立物理工程与明确原生就绪响应的创建夹具。
 */
function fixture(ready: () => Promise<unknown>) {
    const root = mkdtempSync(join(tmpdir(), 'pod-initial-ready-'));
    mkdirSync(join(root, 'assets'));
    const target = 'db://assets/generated/Test.pmtl';
    const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    let published = false;
    let mutations = 0;
    const message: IEditorMcpAssetDbTransactionMessagePort = {
        request: async (_target, name, path, content): Promise<unknown> => {
            if (name === 'query-ready') {
                assert.equal(existsSync(join(root, 'assets/generated')), false);
                return ready();
            }
            if (name === 'query-asset-info') {
                if (path === 'db://assets') return { uuid: 'assets-root', subAssets: {} };
                if (path === 'db://assets/generated') {
                    if (existsSync(join(root, 'assets/generated'))) writeFileSync(join(root, 'assets/generated.meta'), JSON.stringify({ uuid: 'parent' }));
                    return { uuid: 'parent', subAssets: {} };
                }
                return path === target && published ? { uuid, importer: 'physics-material', subAssets: {} } : null;
            }
            if (name === 'create-asset') {
                mutations += 1;
                assert.equal(path, target);
                writeFileSync(join(root, 'assets/generated/Test.pmtl'), String(content));
                writeFileSync(join(root, 'assets/generated/Test.pmtl.meta'), JSON.stringify({ uuid }));
                published = true;
                return { uuid };
            }
            throw new Error(`unexpected_message:${name}`);
        },
    };
    const transaction = new EditorMcpAssetDbTransaction({ requireProjectPath: async () => root, requireMessage: () => message, refreshForCommit: async () => null });
    const coordinator = new EditorMcpAssetDbCreationCoordinator({ requireProjectPath: async () => root, requireMessage: () => message, transaction });
    return { root, create: (signal?: AbortSignal) => coordinator.create({ targetPath: target, resourceType: 'physicsMaterial', content: '[]', timeoutMs: 100, pollIntervalMs: 20, lifecycle: { signal } }), mutations: () => mutations };
}

/**
 * @description 就绪之前必须保持物理工程未变。
 */
function unchanged(f: ReturnType<typeof fixture>): void {
    assert.equal(f.mutations(), 0);
    assert.equal(existsSync(join(f.root, 'assets/generated')), false);
}

for (const mode of ['waiting', 'timeout', 'cancel', 'error', 'invalid'] as const) {
    test(`AssetDB initial ready: ${mode}`, async (context) => {
        const controller = new AbortController();
        let polls = 0;
        const f = fixture(async () => {
            polls += 1;
            if (mode === 'cancel') { controller.abort(); return true; }
            if (mode === 'error') throw new Error('actual_native_query_ready_failed');
            if (mode === 'invalid') return { ready: true };
            return mode === 'waiting' && polls >= 2;
        });
        context.after(() => rmSync(f.root, { recursive: true, force: true }));
        if (mode === 'waiting') {
            const result = await f.create();
            assert.equal(result.phase, 'verified');
            assert.equal(result.uuid, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
            assert.equal(polls, 2);
            assert.equal(f.mutations(), 1);
        } else {
            const reason = { timeout: 'editor_mcp_asset_create_ready_pending', cancel: 'editor_mcp_task_cancelled_before_commit', error: 'actual_native_query_ready_failed', invalid: 'editor_mcp_asset_create_ready_response_invalid' }[mode];
            await assert.rejects(f.create(controller.signal), (error: unknown) => error instanceof EditorMcpAssetDbCreationError && error.message === reason && error.evidence.phase === 'reserved' && error.evidence.projectState === 'unchanged');
            assert.ok(polls >= 1);
            unchanged(f);
        }
    });
}
