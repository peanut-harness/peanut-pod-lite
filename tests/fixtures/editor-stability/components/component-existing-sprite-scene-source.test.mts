import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ComponentExistingSpriteSceneSource } from './component-existing-sprite-scene-source.mts';

const repository = realpathSync(new URL('../../../../', import.meta.url));
const types = ['cc.Sprite', 'cc.UIOpacity'];

function put(path: string, bytes: string | Buffer): void {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
}

for (const version of ['3.8.3', '3.8.7']) {
    test(`${version} authors two sealed offline scenes without claiming original or native identity`, () => {
        const result = ComponentExistingSpriteSceneSource.author(repository, version);
        assert.equal(result.mode, 'offline_authored_candidate');
        assert.equal(result.executable, false);
        const historical = result.historical as { found: boolean; provenanceVerified: boolean }[];
        assert.deepEqual(historical.map(row => row.found), [false, false]);
        assert.ok(historical.every(row => row.provenanceVerified === false));
        const scenes = result.scenes as { path: string; targetPath: string; componentType: string;
            dependencyOrder: string[]; bytes: Buffer; metaStatus: string; assetDbUuid: null; nativeAccepted: boolean }[];
        assert.deepEqual(scenes.map(row => row.path), types.map(type => `assets/components/${type}.scene`));
        assert.deepEqual(scenes.map(row => row.targetPath), ['/Root/Canvas/Target', '/Root/Target']);
        assert.deepEqual(scenes[0].dependencyOrder, ['cc.UITransform', 'cc.Sprite']);
        assert.deepEqual(scenes[1].dependencyOrder, ['cc.UIOpacity']);
        for (const scene of scenes) {
            assert.ok(Array.isArray(JSON.parse(scene.bytes.toString('utf8'))));
            assert.equal(scene.metaStatus, 'not_authored');
            assert.equal(scene.assetDbUuid, null);
            assert.equal(scene.nativeAccepted, false);
        }
        assert.ok((result.blockers as string[]).includes('assetdb_import_and_uuid_unverified'));
    });
}

test('unknown version, absent input, changed dependency or unknown field reject before authoring', () => {
    assert.throws(() => ComponentExistingSpriteSceneSource.author(repository, '3.8.5'), /version_invalid/);
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'component-scene-source-')));
    try {
        const prefix = 'tests/fixtures/editor-stability/components/3.8.3';
        const audit = `${prefix}/component-assembly-audit.json`;
        const fields = `${prefix}/component-field-fixtures.json`;
        assert.throws(() => ComponentExistingSpriteSceneSource.author(scratch, '3.8.3'), /input_missing/);
        put(join(scratch, audit), readFileSync(join(repository, audit)));
        put(join(scratch, fields), readFileSync(join(repository, fields)));
        const changed = JSON.parse(readFileSync(join(scratch, audit), 'utf8'));
        changed.nativeDeclarations = [];
        put(join(scratch, audit), JSON.stringify(changed));
        assert.throws(() => ComponentExistingSpriteSceneSource.author(scratch, '3.8.3'), /input_sha_mismatch/);
        put(join(scratch, audit), readFileSync(join(repository, audit)));
        const unknown = JSON.parse(readFileSync(join(scratch, fields), 'utf8'));
        unknown.components.find((row: { componentType: string }) => row.componentType === 'cc.Sprite')
            .cases.push({ selector: ['unknownField'] });
        put(join(scratch, fields), JSON.stringify(unknown));
        assert.throws(() => ComponentExistingSpriteSceneSource.author(scratch, '3.8.3'), /input_sha_mismatch/);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('linked or changed pinned input is refused before source candidate creation', () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'component-scene-source-')));
    try {
        const audit = 'tests/fixtures/editor-stability/components/3.8.7/component-assembly-audit.json';
        const path = join(scratch, audit);
        mkdirSync(dirname(path), { recursive: true }); symlinkSync(join(repository, audit), path);
        assert.throws(() => ComponentExistingSpriteSceneSource.author(scratch, '3.8.7'), /path_link/);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('repository and project aliases are refused before inspecting their contents', () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'component-scene-alias-')));
    try {
        const alias = join(scratch, 'alias');
        symlinkSync(repository, alias);
        assert.throws(() => ComponentExistingSpriteSceneSource.author(alias, '3.8.3'), /repository_alias/);
        assert.throws(() => ComponentExistingSpriteSceneSource.inspectTargets(alias, '3.8.3'), /project_alias/);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('dangling input, scene target and ancestor links are rejected rather than absent', () => {
    const f = realpathSync(mkdtempSync(join(tmpdir(), 'component-scene-dangling-')));
    try {
        const audit = join(f, 'tests/fixtures/editor-stability/components/3.8.3/component-assembly-audit.json');
        mkdirSync(dirname(audit), { recursive: true }); symlinkSync('missing-audit', audit);
        assert.throws(() => ComponentExistingSpriteSceneSource.author(f, '3.8.3'), /path_link/);
        mkdirSync(join(f, 'assets'));
        const target = join(f, 'assets/components/cc.Sprite.scene');
        mkdirSync(dirname(target), { recursive: true }); symlinkSync('missing-scene', target);
        assert.throws(() => ComponentExistingSpriteSceneSource.inspectTargets(f, '3.8.3'), /path_link/);
        rmSync(target); rmSync(join(f, 'assets/components'), { recursive: true });
        symlinkSync('missing-parent', join(f, 'assets/components'));
        assert.throws(() => ComponentExistingSpriteSceneSource.inspectTargets(f, '3.8.3'), /path_link/);
    } finally { rmSync(f, { recursive: true, force: true }); }
});

test('scene and sidecar targets must be absent, while existing parent meta stays protected', () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'component-scene-target-')));
    try {
        const meta = 'assets/components.meta'; const original = '{"existing":true}\n';
        put(join(scratch, meta), original);
        const result = ComponentExistingSpriteSceneSource.inspectTargets(scratch, '3.8.3');
        assert.equal(result.executable, false);
        assert.deepEqual((result.parentMetas as { path: string; policy: string }[])
            .find(row => row.path === meta)?.policy, 'preserve_exact_bytes');
        assert.equal(readFileSync(join(scratch, meta), 'utf8'), original);
        put(join(scratch, 'assets/components/cc.Sprite.scene.meta'), '{}');
        assert.throws(() => ComponentExistingSpriteSceneSource.inspectTargets(scratch, '3.8.3'), /target_exists/);
        rmSync(join(scratch, 'assets/components/cc.Sprite.scene.meta'));
        put(join(scratch, 'elsewhere'), 'scene');
        symlinkSync(join(scratch, 'elsewhere'), join(scratch, 'assets/components/cc.Sprite.scene'));
        assert.throws(() => ComponentExistingSpriteSceneSource.inspectTargets(scratch, '3.8.3'), /path_link/);
        assert.equal(readFileSync(join(scratch, meta), 'utf8'), original);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
});
