import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ComponentExistingAssetPlan } from './component-existing-asset-plan.mts';

const types = Array.from({ length: 99 }, (_, index) => `cc.Component${index}`);
const sourcePath = 'tests/fixtures/editor-stability/media/assets/image/checker.png';
const destination = 'assets/fixtures/media/assets/image/checker.png';

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function put(path: string, value: string): void {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value);
}

function fixture(): { repository: string; project: string; close: () => void } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'component-asset-plan-')));
    const repository = join(root, 'repository'); const project = join(root, 'project');
    mkdirSync(repository); mkdirSync(project);
    put(join(repository, sourcePath), 'verified-source');
    return { repository, project, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('source mapping records exact source and existing target hashes but remains incomplete', () => {
    const f = fixture();
    try {
        put(join(f.project, destination), 'existing-byte-content');
        const before = readFileSync(join(f.project, destination));
        const result = ComponentExistingAssetPlan.fromSources(f.repository, f.project, '3.8.3',
            [{ path: sourcePath, sha256: sha('verified-source') }], types);
        assert.equal(result.complete, false);
        assert.equal(result.executable, false);
        assert.deepEqual(result.files, [destination]);
        assert.deepEqual((result.sourceMappings as any[])[0], {
            sourcePath, sourceSha256: sha('verified-source'), destination,
            existingSize: before.length, existingSha256: sha('existing-byte-content'),
        });
        assert.equal((result.potentialFiles as any[]).length, 205);
        assert.ok((result.gaps as string[]).includes('native_generated_parent_and_asset_meta_unresolved'));
        assert.deepEqual(readFileSync(join(f.project, destination)), before);
    } finally { f.close(); }
});

test('cube meta destination follows the pinned old staging rule', () => {
    const f = fixture();
    try {
        const path = 'tests/fixtures/editor-stability/media/3.8.3/cube-source.hdr.meta';
        put(join(f.repository, path), 'cube-meta');
        const result = ComponentExistingAssetPlan.fromSources(f.repository, f.project, '3.8.3',
            [{ path, sha256: sha('cube-meta') }], types);
        assert.deepEqual(result.files, ['assets/fixtures/media/supplemental/hdr/equirect.hdr.meta']);
    } finally { f.close(); }
});

test('stale source, escaped path, linked target and conflicting destination fail before any write', () => {
    const f = fixture();
    try {
        const good = { path: sourcePath, sha256: sha('verified-source') };
        assert.throws(() => ComponentExistingAssetPlan.fromSources(f.repository, f.project, '3.8.3',
            [{ ...good, sha256: sha('old-source') }], types), /source_mismatch/);
        assert.throws(() => ComponentExistingAssetPlan.fromSources(f.repository, f.project, '3.8.3',
            [{ path: 'tests/fixtures/editor-stability/../outside', sha256: sha('verified-source') }], types), /path_invalid/);
        assert.throws(() => ComponentExistingAssetPlan.fromSources(f.repository, f.project, '3.8.3',
            [good], types.slice(1)), /denominator_invalid/);
        const cubeA = 'tests/fixtures/editor-stability/media/a/3.8.3/cube-source.hdr.meta';
        const cubeB = 'tests/fixtures/editor-stability/media/b/3.8.3/cube-source.hdr.meta';
        put(join(f.repository, cubeA), 'cube-a'); put(join(f.repository, cubeB), 'cube-b');
        assert.throws(() => ComponentExistingAssetPlan.fromSources(f.repository, f.project, '3.8.3', [
            { path: cubeA, sha256: sha('cube-a') }, { path: cubeB, sha256: sha('cube-b') },
        ], types), /destination_conflict/);
        put(join(f.project, 'outside.txt'), 'outside');
        mkdirSync(dirname(join(f.project, destination)), { recursive: true });
        symlinkSync(join(f.project, 'outside.txt'), join(f.project, destination));
        assert.throws(() => ComponentExistingAssetPlan.fromSources(f.repository, f.project, '3.8.3',
            [good], types), /plan_link/);
    } finally { f.close(); }
});

test('wrong Creator version is rejected before repository inspection', () => {
    assert.throws(() => ComponentExistingAssetPlan.inspect('/unreadable', '3.8.5', 'actor'), /version_invalid/);
});
