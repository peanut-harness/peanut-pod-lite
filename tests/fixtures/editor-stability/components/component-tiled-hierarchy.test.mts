import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ComponentTiledHierarchy } from './component-tiled-hierarchy.mts';
import { ComponentFieldFixtures } from './component-field-fixtures.mts';
import { ComponentSceneFixture } from './component-scene-fixture.mts';
import { ComponentLifecycleFixture } from './component-lifecycle-fixture.mts';
import { ComponentSceneIntegrity } from './component-scene-integrity.mts';
import { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/u, '');
const proof = JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/components/3.8.7/tiled-source-provenance.json'), 'utf8'));
const hashes = new Map<string, string>(proof.sdkSources.map((source: { path: string; sha256: string }) => ['/sdk/' + source.path, source.sha256]));
const audit = JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/components/3.8.7/component-assembly-audit.json'), 'utf8'));

test('dedicated TMX retains original input and requires actual SDK initialization; started/unknown/source-drift projects refuse before write', () => {
    const output = mkdtempSync('/private/tmp/pod-tiled-stage-'); const project = join(output, 'project');
    const original = readFileSync(join(root, 'tests/fixtures/editor-stability/media/assets/map/two-by-two.tmx'));
    const fields = ComponentFieldFixtures.create(root, '3.8.7', audit.nativeDeclarations);
    assert.equal(fields.componentCount, 99); assert.equal(fields.fieldCount, 795);
    const row = fields.components.find(row => row.componentType === 'cc.TiledMap'); assert(row);
    const scene = ComponentSceneFixture.create(root, '3.8.7', row, audit.nativeDeclarations, true);
    assert.notEqual(scene.status, 'blocked'); if (scene.status === 'blocked') throw Error('missing map carrier');
    const hash = (path: string): string => { const value = hashes.get(path); assert(value); return value; };
    mkdirSync(join(project, 'assets/fixtures/media/assets/map'), { recursive: true });
    ComponentLifecycleFixture.create(scene.document, '3.8.7', row.componentType).save(project, false);
    try {
        assert.throws(() => ComponentTiledHierarchy.stage(root, project, '/sdk', '3.8.3', scene.targetPath, hash), /version_unverified/u);
        assert.throws(() => ComponentTiledHierarchy.stage(root, project, '/sdk', '3.8.7', scene.targetPath, () => 'drift'), /sdk_source_mismatch/u);
        const input = join(project, 'assets/fixtures/media/assets/map/source-owned.tmx'); assert.equal(existsSync(input), false);
        ComponentTiledHierarchy.stage(root, project, '/sdk', '3.8.7', scene.targetPath, hash);
        const receipt = JSON.parse(readFileSync(join(output, 'tiled-source-staging.json'), 'utf8'));
        assert.equal(receipt.nativePassed, false); assert.match(readFileSync(input, 'utf8'), /objectgroup id="2" name="Objects"/u);
        const document = LumenPrefabDocument.open(project, receipt.scene); ComponentSceneIntegrity.assert(document);
        const entries = document.entries.filter(entry => entry.__type__ === 'cc.TiledMap'); assert.equal(entries.length, 1);
        assert.deepEqual(entries[0]?._tmxFile, { __uuid__: receipt.sourceUuid });
        document.findNodeIndex(scene.targetPath + '/Ground/OwnedTile');
        assert.equal(document.entries.some(entry => entry.__type__ === 'cc.TiledUserNodeData'), false);
        assert.deepEqual(readFileSync(join(root, 'tests/fixtures/editor-stability/media/assets/map/two-by-two.tmx')), original);
        mkdirSync(join(project, 'library'));
        assert.throws(() => ComponentTiledHierarchy.stage(root, project, '/sdk', '3.8.7', scene.targetPath, hash), /already_started/u);
    } finally { rmSync(output, { recursive: true, force: true }); }
});
