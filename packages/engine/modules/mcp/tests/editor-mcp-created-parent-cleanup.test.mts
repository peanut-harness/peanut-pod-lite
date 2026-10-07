import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EditorMcpAssetDbCreationCoordinator, EditorMcpAssetDbCreationError } from '../src/editor-mcp-asset-db-creation-coordinator.js';
import { EditorMcpAssetDbTransaction, type IEditorMcpAssetDbTransactionMessagePort } from '../src/editor-mcp-asset-db-transaction.js';

const modes = ['native-stale', 'foreign-meta', 'query-error', 'refresh-error', 'refresh-false', 'timeout', 'sibling-change', 'anchor-uuid', 'foreign-file', 'symlink-meta', 'recreated-directory', 'existing-parent', 'success'] as const;
for (const mode of modes) {
    test(`created parent native cleanup: ${mode}`, async (context) => {
        const root = mkdtempSync(join(tmpdir(), 'pod-created-parent-'));
        context.after(() => rmSync(root, { recursive: true, force: true }));
        const anchor = 'assets/anchor', parent = `${anchor}/new`, target = `${parent}/Cancelled.pmtl`;
        mkdirSync(join(root, anchor), { recursive: true });
        writeFileSync(join(root, anchor + '.meta'), JSON.stringify({ uuid: 'anchor' }));
        writeFileSync(join(root, anchor, 'Keep.txt'), 'keep');
        const parentUuid = '11111111-2222-4333-8444-555555555555', mainUuid = '66666666-7777-4888-8999-aaaaaaaaaaaa';
        const cache = new Map<string, Record<string, unknown>>([[`db://${anchor}`, { uuid: 'anchor' }]]);
        const original = new Error('original_native_parent_cleanup_failure');
        const calls: { name: string; key: string }[] = [];
        let cleanupStage = false, mainPublished = false;
        const registerParent = () => {
            writeFileSync(join(root, parent + '.meta'), JSON.stringify({ uuid: parentUuid, importer: 'directory' }));
            cache.set(`db://${parent}`, { uuid: parentUuid, subAssets: {} });
            cache.set(parentUuid, { uuid: parentUuid, subAssets: {} });
        };
        if (mode === 'existing-parent') { mkdirSync(join(root, parent)); registerParent(); }
        const message: IEditorMcpAssetDbTransactionMessagePort = {
            request: async (_channel, name, keyValue, contentValue): Promise<unknown> => {
                const key = String(keyValue ?? ''); calls.push({ name, key });
                if (name === 'query-ready') return true;
                if (name === 'query-asset-info') {
                    if (mode === 'query-error' && cleanupStage && !existsSync(join(root, parent)) && key === parentUuid) throw original;
                    return cache.get(key) ?? null;
                }
                if (name === 'create-asset') {
                    if (key.includes('__peanut_assetdb_register_')) {
                        registerParent(); cache.set(key, { uuid: 'probe' });
                        writeFileSync(join(root, key.slice('db://'.length)), String(contentValue));
                        return { uuid: 'probe' };
                    }
                    mainPublished = true;
                    writeFileSync(join(root, target), String(contentValue));
                    writeFileSync(join(root, target + '.meta'), JSON.stringify({ uuid: mainUuid, importer: 'physics-material' }));
                    cache.set(`db://${target}`, { uuid: mainUuid, importer: 'physics-material', subAssets: {} });
                    return { uuid: mainUuid };
                }
                if (name === 'delete-asset') {
                    cache.delete(key);
                    rmSync(join(root, key.slice('db://'.length)), { force: true });
                    rmSync(join(root, key.slice('db://'.length) + '.meta'), { force: true });
                    return true;
                }
                if (name === 'refresh-asset') {
                    assert.equal(key, `db://${anchor}`);
                    if (mode === 'refresh-error') throw original;
                    if (mode === 'refresh-false') return false;
                    if (mode !== 'timeout') { cache.delete(`db://${parent}`); cache.delete(parentUuid); }
                    return null;
                }
                throw new Error(`unexpected_native_call:${name}`);
            },
        };
        const transaction = new EditorMcpAssetDbTransaction({ requireProjectPath: async () => root, requireMessage: () => message, refreshForCommit: async () => null });
        const coordinator = new EditorMcpAssetDbCreationCoordinator({ requireProjectPath: async () => root, requireMessage: () => message, transaction });
        const input = {
            targetPath: target, resourceType: 'physicsMaterial' as const, content: '[{"__type__":"cc.PhysicsMaterial"}]\n', timeoutMs: 100, pollIntervalMs: 20,
            lifecycle: { enterCommitWindow: () => {
                if (mode === 'success') return true;
                cleanupStage = true;
                if (mode === 'foreign-meta') writeFileSync(join(root, parent + '.meta'), JSON.stringify({ uuid: 'foreign-parent' }));
                if (mode === 'anchor-uuid') cache.set(`db://${anchor}`, { uuid: 'foreign-anchor' });
                if (mode === 'sibling-change') writeFileSync(join(root, anchor, 'Keep.txt'), 'external');
                if (mode === 'foreign-file') writeFileSync(join(root, parent, 'External.txt'), 'external');
                if (mode === 'symlink-meta') { rmSync(join(root, parent + '.meta')); symlinkSync(join(root, anchor, 'Keep.txt'), join(root, parent + '.meta')); }
                if (mode === 'recreated-directory') { renameSync(join(root, parent), join(root, anchor, 'Retained-original')); mkdirSync(join(root, parent)); }
                return false;
            } },
        };
        if (mode === 'success') {
            const result = await coordinator.create(input); assert.equal(result.phase, 'verified'); assert.equal(result.uuid, mainUuid);
            assert(mainPublished); assert.equal(calls.filter((x) => x.name === 'refresh-asset').length, 0); return;
        }
        let failure: unknown;
        try { await coordinator.create(input); } catch (error: unknown) { failure = error; }
        assert(failure instanceof EditorMcpAssetDbCreationError); assert.equal(mainPublished, false);
        assert.equal(failure.message, 'editor_mcp_task_cancelled_before_commit');
        const ownership = ['foreign-meta', 'sibling-change', 'anchor-uuid', 'foreign-file', 'symlink-meta', 'recreated-directory'].includes(mode);
        const nativeFailure = ['query-error', 'refresh-error', 'refresh-false', 'timeout'].includes(mode);
        if (mode === 'existing-parent') {
            assert.equal(existsSync(join(root, parent)), true); assert.equal(failure.evidence.cleanup.complete, true);
            assert.equal(calls.filter((x) => x.name === 'refresh-asset').length, 0);
        } else if (ownership) {
            assert.equal(existsSync(join(root, parent)), true, 'foreign-owned or changed parent must survive cancellation');
            assert.equal(failure.evidence.cleanup.complete, false); assert.equal(failure.evidence.cleanup.ownershipMismatch, true);
            assert.equal(failure.evidence.projectState, 'may_have_changed'); assert.equal(calls.filter((x) => x.name === 'refresh-asset').length, 0);
            if (mode === 'foreign-meta') assert.equal(JSON.parse(readFileSync(join(root, parent + '.meta'), 'utf8')).uuid, 'foreign-parent');
            if (mode === 'foreign-file') assert.equal(readFileSync(join(root, parent, 'External.txt'), 'utf8'), 'external');
        } else if (nativeFailure) {
            assert.equal(failure.evidence.cleanup.complete, false); assert.equal(failure.evidence.projectState, 'may_have_changed');
            const cleanupError: unknown = Reflect.get(failure, 'cleanupError');
            if (mode === 'query-error' || mode === 'refresh-error') assert.equal(cleanupError, original);
            else assert(cleanupError instanceof Error);
            assert.equal(existsSync(join(root, parent)), false, 'post-delete failure retains the actual changed disk fact');
        } else {
            assert.equal(existsSync(join(root, parent)), false);
            assert.equal(failure.evidence.cleanup.complete, true); assert.equal(failure.evidence.projectState, 'unchanged');
            assert.equal(cache.get(`db://${parent}`), undefined, 'native URL must not retain deleted parent');
            assert.equal(cache.get(parentUuid), undefined, 'native original UUID must not retain deleted parent');
            assert.equal(calls.filter((x) => x.name === 'refresh-asset').length, 1);
        }
        if (mode !== 'sibling-change') assert.equal(readFileSync(join(root, anchor, 'Keep.txt'), 'utf8'), 'keep');
        assert(!existsSync(join(root, target))); assert(!existsSync(join(root, target + '.meta')));
    });
}
