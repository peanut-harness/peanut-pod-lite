import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ComponentExistingSpriteMetaPlan } from './component-existing-sprite-meta-plan.mts';

function engine(version: string): string {
    return `/Applications/Cocos/Creator/${version}/CocosCreator.app/Contents/Resources/resources/3d/engine`;
}
function put(path: string, bytes: string | Buffer): void {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
}
function scratch(prefix: string): { root: string; close: () => void } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    return { root, close: () => rmSync(root, { recursive: true, force: true }) };
}
function directoryMeta(uuid: string): string {
    return JSON.stringify({ ver: '1.2.0', importer: 'directory', imported: false,
        uuid, files: [], subMetas: {}, userData: {} }) + '\n';
}

for (const version of ['3.8.3', '3.8.7']) {
    test(`${version} pins actual SDK package and three meta formats without reusing builtin UUID`, () => {
        const result = ComponentExistingSpriteMetaPlan.inspectSdk(version, engine(version));
        assert.equal(result.creatorVersion, version);
        assert.equal(result.executable, false);
        const templates = result.templates as { kind: string; importer: string; ver: string;
            templateUuidMustNotBeReused: boolean; identity: string }[];
        assert.deepEqual(templates.map(row => [row.kind, row.importer, row.ver]), [
            ['image', 'image', '1.0.27'], ['scene', 'scene', '1.1.50'], ['directory', 'directory', '1.2.0'],
        ]);
        assert.ok(templates.every(row => row.templateUuidMustNotBeReused && row.identity === 'sdk_builtin_only'));
        assert.ok(!JSON.stringify(result).includes('provisionalUuid'));
    });
}

test('wrong version, source drift, missing template and malformed schema refuse', () => {
    assert.throws(() => ComponentExistingSpriteMetaPlan.inspectSdk('3.8.5', engine('3.8.3')), /version_invalid/);
    assert.throws(() => ComponentExistingSpriteMetaPlan.inspectSdk('3.8.3', engine('3.8.7')), /package_sha_mismatch/);
    const f = scratch('component-meta-engine-');
    try {
        const root = join(f.root, 'engine'); mkdirSync(root);
        put(join(root, 'package.json'), readFileSync(join(engine('3.8.3'), 'package.json')));
        assert.throws(() => ComponentExistingSpriteMetaPlan.inspectSdk('3.8.3', root), /source_missing/);
        const rel = 'editor/assets/default_ui/default_sprite.png.meta';
        put(join(root, rel), 'changed-template');
        assert.throws(() => ComponentExistingSpriteMetaPlan.inspectSdk('3.8.3', root), /template_sha_mismatch/);
        assert.throws(() => ComponentExistingSpriteMetaPlan.assertTemplateShape('image', {
            ver: '1.0.27', importer: 'image', imported: true,
            uuid: '00000000-0000-4000-8000-000000000001', files: [], subMetas: {}, userData: { type: 'unknown' },
        }), /image_type_invalid/);
        assert.throws(() => ComponentExistingSpriteMetaPlan.assertTemplateShape('scene', {
            ver: 'unknown', importer: 'scene', imported: true,
            uuid: '00000000-0000-4000-8000-000000000001', files: [], subMetas: {}, userData: {},
        }), /schema_invalid/);
    } finally { f.close(); }
});

test('complete exact target list stays read only and missing parents block stage', () => {
    const f = scratch('component-meta-target-');
    try {
        mkdirSync(join(f.root, 'assets'));
        const result = ComponentExistingSpriteMetaPlan.inspectTargets(f.root, '3.8.3');
        assert.equal(result.executable, false);
        assert.equal((result.targets as unknown[]).length, 6);
        assert.deepEqual((result.parentMetas as { path: string; exists: boolean }[]).map(row => row.path),
            [...ComponentExistingSpriteMetaPlan.parentMetas]);
        assert.ok((result.parentMetas as { exists: boolean }[]).every(row => !row.exists));
        assert.ok((result.blockers as string[]).includes('missing_parent_meta_authoring'));
    } finally { f.close(); }
});

test('existing parent meta is hashed and preserved; target meta, conflicting UUID and links refuse', () => {
    const f = scratch('component-meta-target-');
    try {
        mkdirSync(join(f.root, 'assets'));
        const one = ComponentExistingSpriteMetaPlan.parentMetas[0];
        const two = ComponentExistingSpriteMetaPlan.parentMetas[1];
        const uuid = '00000000-0000-4000-8000-000000000001';
        put(join(f.root, one), directoryMeta(uuid));
        const before = readFileSync(join(f.root, one));
        const result = ComponentExistingSpriteMetaPlan.inspectTargets(f.root, '3.8.3');
        assert.equal((result.parentMetas as { path: string; policy: string }[]).find(row => row.path === one)?.policy,
            'preserve_exact_bytes');
        assert.deepEqual(readFileSync(join(f.root, one)), before);
        put(join(f.root, two), directoryMeta(uuid));
        assert.throws(() => ComponentExistingSpriteMetaPlan.inspectTargets(f.root, '3.8.3'), /uuid_conflict/);
        rmSync(join(f.root, two));
        put(join(f.root, 'assets/components/cc.Sprite.scene.meta'), '{}');
        assert.throws(() => ComponentExistingSpriteMetaPlan.inspectTargets(f.root, '3.8.3'), /target_exists/);
        rmSync(join(f.root, 'assets/components/cc.Sprite.scene.meta'));
        put(join(f.root, 'outside'), 'outside');
        symlinkSync(join(f.root, 'outside'), join(f.root, 'assets/components/cc.Sprite.scene.meta'));
        assert.throws(() => ComponentExistingSpriteMetaPlan.inspectTargets(f.root, '3.8.3'), /path_link/);
        assert.deepEqual(readFileSync(join(f.root, one)), before);
    } finally { f.close(); }
});

test('missing assets root, alias and linked SDK template refuse without writes', () => {
    const f = scratch('component-meta-target-');
    try {
        assert.throws(() => ComponentExistingSpriteMetaPlan.inspectTargets(f.root, '3.8.3'), /assets_root_missing/);
        mkdirSync(join(f.root, 'assets'));
        symlinkSync(f.root, join(f.root, 'alias'));
        assert.throws(() => ComponentExistingSpriteMetaPlan.inspectTargets(join(f.root, 'alias'), '3.8.3'), /project_alias/);
        const sdk = join(f.root, 'engine'); mkdirSync(sdk);
        put(join(sdk, 'package.json'), readFileSync(join(engine('3.8.3'), 'package.json')));
        const rel = 'editor/assets/default_ui/default_sprite.png.meta';
        const path = join(sdk, rel); mkdirSync(dirname(path), { recursive: true });
        symlinkSync(join(engine('3.8.3'), rel), path);
        assert.throws(() => ComponentExistingSpriteMetaPlan.inspectSdk('3.8.3', sdk), /path_link/);
    } finally { f.close(); }
});

test('dangling links at target, parent meta and SDK source are never treated as absent', () => {
    const f = scratch('component-meta-dangling-');
    try {
        mkdirSync(join(f.root, 'assets'));
        const target = join(f.root, 'assets/components/cc.Sprite.scene.meta');
        mkdirSync(dirname(target), { recursive: true });
        symlinkSync('missing-meta', target);
        assert.throws(() => ComponentExistingSpriteMetaPlan.inspectTargets(f.root, '3.8.3'), /path_link/);
        rmSync(target);
        rmSync(join(f.root, 'assets/components'), { recursive: true });
        symlinkSync('missing-parent', join(f.root, 'assets/components.meta'));
        assert.throws(() => ComponentExistingSpriteMetaPlan.inspectTargets(f.root, '3.8.3'), /path_link/);
        const sdk = join(f.root, 'engine'); mkdirSync(sdk);
        put(join(sdk, 'package.json'), readFileSync(join(engine('3.8.3'), 'package.json')));
        const source = join(sdk, 'editor/assets/default_ui/default_sprite.png.meta');
        mkdirSync(dirname(source), { recursive: true }); symlinkSync('missing-source', source);
        assert.throws(() => ComponentExistingSpriteMetaPlan.inspectSdk('3.8.3', sdk), /path_link/);
    } finally { f.close(); }
});
