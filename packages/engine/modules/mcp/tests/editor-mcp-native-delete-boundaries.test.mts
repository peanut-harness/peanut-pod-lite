import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SilentAssetDelete } from '@peanut/pod-engine/assets';
import { EditorMcpAssetDbDeletionCoordinator } from '../src/editor-mcp-asset-db-deletion-coordinator.js';
import type { IEditorMcpAssetDbTransactionMessagePort } from '../src/editor-mcp-asset-db-transaction.js';

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'pod-delete-boundary-'));
    const parent = 'assets/Generated', target = parent + '/Delete.rt';
    mkdirSync(join(root, parent), { recursive: true });
    writeFileSync(join(root, parent + '.meta'), JSON.stringify({ uuid: 'parent' }));
    writeFileSync(join(root, target), '[]');
    writeFileSync(join(root, target + '.meta'), JSON.stringify({ uuid: 'main', subMetas: { frame: { uuid: 'main@frame' } } }));
    writeFileSync(join(root, parent, 'Keep.json'), '{}');
    const present = new Map<string, { uuid: string }>([[`db://${parent}`, { uuid: 'parent' }], [`db://${target}`, { uuid: 'main' }], ['main', { uuid: 'main' }], ['main@frame', { uuid: 'main@frame' }]]);
    const calls: { message: string; key: string }[] = [];
    let override: ((message: string, key: string) => unknown | Promise<unknown>) | undefined;
    const message: IEditorMcpAssetDbTransactionMessagePort = { request: async (_target, message, key) => {
        const value = String(key); calls.push({ message, key: value });
        if (override) return override(message, value);
        if (message === 'query-asset-info') return present.get(value) ?? null;
        if (message === 'refresh-asset') { assert.equal(value, `db://${parent}`); clear(); return null; }
        throw new Error('unexpected_message');
    } };
    const clear = () => { for (const key of [`db://${target}`, 'main', 'main@frame']) present.delete(key); };
    const coordinator = new EditorMcpAssetDbDeletionCoordinator(root, message, { watcherMs: 0, timeoutMs: 100, pollIntervalMs: 20 });
    return { root, parent, target, present, calls, clear, message, coordinator, override: (f: typeof override) => { override = f; }, remove: () => new SilentAssetDelete().delete({ projectRoot: root, relativePaths: [target] }).deleted };
}

for (const mode of ['watcher', 'subasset', 'query-error', 'refresh-error', 'refresh-false', 'refresh-invalid', 'parent-uuid', 'parent-meta', 'sibling', 'physical-recreated', 'stale-timeout', 'mismatch'] as const) {
    test(`native deletion boundary: ${mode}`, async (context) => {
        const f = fixture(); context.after(() => rmSync(f.root, { recursive: true, force: true }));
        await f.coordinator.prepare([f.target]);
        const deleted = f.remove(), original = new Error('original_native_failure');
        if (mode === 'watcher') f.clear();
        if (mode === 'subasset') { f.present.delete(`db://${f.target}`); f.present.delete('main'); }
        if (mode === 'parent-uuid') f.present.set(`db://${f.parent}`, { uuid: 'foreign-parent' });
        if (mode === 'parent-meta') writeFileSync(join(f.root, f.parent + '.meta'), JSON.stringify({ uuid: 'foreign-parent' }));
        if (mode === 'sibling') writeFileSync(join(f.root, f.parent, 'Keep.json'), '{"changed":true}');
        if (mode === 'physical-recreated') symlinkSync('/nonexistent-delete-test-target', join(f.root, f.target));
        if (['query-error', 'refresh-error', 'refresh-false', 'refresh-invalid', 'stale-timeout'].includes(mode)) f.override(async (message, key) => {
            if (mode === 'query-error' && message === 'query-asset-info' && key === 'main@frame') throw original;
            if (message === 'query-asset-info') return f.present.get(key) ?? null;
            if (mode === 'refresh-error') throw original;
            if (mode === 'refresh-false') return false;
            if (mode === 'refresh-invalid') return { success: true };
            return null;
        });
        if (mode === 'watcher' || mode === 'subasset') {
            const evidence = await f.coordinator.commit(deleted) as { phase: string };
            assert.equal(evidence.phase, 'assetdb_deleted');
            assert.ok(f.calls.some((call) => call.key === 'main@frame'));
            assert.equal(f.calls.filter((call) => call.message === 'refresh-asset').length, mode === 'watcher' ? 0 : 1);
            assert.equal(readFileSync(join(f.root, f.parent, 'Keep.json'), 'utf8'), '{}');
        } else {
            await assert.rejects(f.coordinator.commit(mode === 'mismatch' ? [] : deleted), (error: unknown) => {
                if (mode === 'query-error' || mode === 'refresh-error') return error === original;
                const reasons = { 'refresh-false': 'refresh_rejected', 'refresh-invalid': 'refresh_rejected', 'parent-uuid': 'parent_uuid_changed', 'parent-meta': 'parent_changed', sibling: 'parent_changed', 'physical-recreated': 'physical_remaining', 'stale-timeout': 'registration_pending', mismatch: 'result_mismatch' };
                return error instanceof Error && error.message.includes(reasons[mode]);
            });
            if (['parent-uuid', 'parent-meta', 'sibling', 'physical-recreated', 'query-error', 'mismatch'].includes(mode)) assert.equal(f.calls.filter((call) => call.message === 'refresh-asset').length, 0);
            assert.equal(existsSync(join(f.root, f.target + '.meta')), false, 'post-delete failures must preserve the actual changed disk fact');
        }
        await assert.rejects(f.coordinator.commit(deleted), /commit_not_prepared/u);
    });
}

for (const mode of ['invalid-query', 'source-changed', 'symlink', 'root', 'option', 'reuse'] as const) {
    test(`native deletion prepare before mutation: ${mode}`, async (context) => {
        const f = fixture(); context.after(() => rmSync(f.root, { recursive: true, force: true }));
        if (mode === 'invalid-query') f.override(async () => false);
        if (mode === 'source-changed') f.override(async (_message, key) => {
            if (key === `db://${f.parent}`) writeFileSync(join(f.root, f.target), 'changed-during-query');
            return f.present.get(key) ?? null;
        });
        if (mode === 'symlink') { rmSync(join(f.root, f.target)); symlinkSync(join(f.root, f.parent, 'Keep.json'), join(f.root, f.target)); }
        if (mode === 'option') assert.throws(() => new EditorMcpAssetDbDeletionCoordinator(f.root, f.message, { timeoutMs: NaN }), /wait_option_invalid/u);
        else if (mode === 'reuse') { await f.coordinator.prepare([f.target]); await assert.rejects(f.coordinator.prepare([f.target]), /prepare_reused/u); }
        else await assert.rejects(f.coordinator.prepare([mode === 'root' ? 'assets' : f.target]));
        assert.equal(existsSync(join(f.root, f.target)), true);
        assert.equal(existsSync(join(f.root, f.target + '.meta')), true);
        assert.equal(f.calls.filter((call) => call.message === 'refresh-asset').length, 0);
    });
}
