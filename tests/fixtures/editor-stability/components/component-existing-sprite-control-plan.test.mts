import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ComponentExistingSpriteControlPlan } from './component-existing-sprite-control-plan.mts';

const repository = realpathSync(new URL('../../../../', import.meta.url));

function put(path: string, bytes: string | Buffer): void {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
}
function fixture(): { root: string; project: string; close: () => void } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'component-control-')));
    const project = join(root, 'synthetic-project'); mkdirSync(project);
    put(join(project, 'package.json'), JSON.stringify({ creator: { version: '3.8.3' } }));
    return { root, project, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('pinned old sources are read only and expose exact source roles', () => {
    const sources = ComponentExistingSpriteControlPlan.sources(repository);
    assert.equal(sources.length, 7);
    assert.ok(sources.every(row => typeof row.sha256 === 'string' && (row.sha256 as string).length === 64));
    assert.ok(sources.some(row => row.role === 'old_web_video_source'));
});

test('only three declared extension paths may be proposed, but closure remains incomplete', () => {
    const paths = [...ComponentExistingSpriteControlPlan.proposedExtension];
    const plan = ComponentExistingSpriteControlPlan.validateProposedPaths(paths);
    assert.equal(plan.complete, false); assert.equal(plan.executable, false);
    assert.throws(() => ComponentExistingSpriteControlPlan.validateProposedPaths(paths.slice(1)), /closure_incomplete/);
    assert.throws(() => ComponentExistingSpriteControlPlan.validateProposedPaths([paths[0], paths[0], paths[2]]), /closure_incomplete/);
    for (const extra of [ComponentExistingSpriteControlPlan.forbiddenLegacyExtras[0],
        ComponentExistingSpriteControlPlan.forbiddenLegacyExtras[1], '../project-ownership.json',
        'assets/fixtures/media/assets/video/blue.mp4', '.peanut-ai/unknown-control.json'])
        assert.throws(() => ComponentExistingSpriteControlPlan.validateProposedPaths([paths[0], paths[1], extra]), /unexpected_path/);
});

test('synthetic inspection reports sensitive descriptor presence without token or raw bytes', () => {
    const f = fixture();
    try {
        const secret = 'synthetic-test-token-do-not-report';
        put(join(f.project, '.peanut-ai/component-probe.json'), JSON.stringify({ token: secret }));
        put(join(f.root, 'project-ownership.json'), JSON.stringify({ secret }));
        const before = readFileSync(join(f.project, '.peanut-ai/component-probe.json'));
        const result = ComponentExistingSpriteControlPlan.inspectSynthetic(repository, f.project, '3.8.3');
        assert.equal(result.executable, false);
        assert.equal((result.oldProbe as any).unconditionalUrlManifest, true);
        assert.equal((result.hostConvenienceReads as any).independentSuccessEvidence, false);
        assert.equal((result.extension as unknown[]).length, 6);
        assert.ok((result.parentOutputs as any[]).some(row => row.path === 'project-ownership.json' && row.exists));
        assert.ok((result.controls as any[]).some(row => row.path === '.peanut-ai/component-probe.json'
            && row.exists && row.contentReported === false && row.sha256 === null));
        assert.equal(JSON.stringify(result).includes(secret), false);
        assert.deepEqual(readFileSync(join(f.project, '.peanut-ai/component-probe.json')), before);
        assert.ok((result.blockers as string[]).includes('independent_native_readback_unimplemented'));
        assert.ok((result.blockers as string[]).includes('probe_descriptor_already_present'));
        assert.ok((result.blockers as string[]).includes('parent_control_paths_already_present'));
    } finally { f.close(); }
});

test('wrong version, stale source and missing source refuse before any control proposal', () => {
    const f = fixture();
    try {
        assert.throws(() => ComponentExistingSpriteControlPlan.inspectSynthetic(repository, f.project, '3.8.7'), /project_version_mismatch/);
        const root = join(f.root, 'repository'); mkdirSync(root);
        assert.throws(() => ComponentExistingSpriteControlPlan.sources(root), /source_missing/);
        const path = 'tests/fixtures/editor-stability/components/component-native-project.mts';
        put(join(root, path), 'changed');
        assert.throws(() => ComponentExistingSpriteControlPlan.sources(root), /source_sha_mismatch/);
    } finally { f.close(); }
});

test('linked and dangling source, extension target and parent receipt refuse', () => {
    const f = fixture();
    try {
        const root = join(f.root, 'repository'); mkdirSync(root);
        const source = join(root, 'tests/fixtures/editor-stability/components/component-native-project.mts');
        mkdirSync(dirname(source), { recursive: true }); symlinkSync('missing-source', source);
        assert.throws(() => ComponentExistingSpriteControlPlan.sources(root), /path_link/);
        const extension = join(f.project, ComponentExistingSpriteControlPlan.proposedExtension[0]);
        mkdirSync(dirname(extension), { recursive: true }); symlinkSync('missing-package', extension);
        assert.throws(() => ComponentExistingSpriteControlPlan.inspectSynthetic(repository, f.project, '3.8.3'), /path_link/);
        rmSync(extension);
        symlinkSync('missing-receipt', join(f.root, 'project-ownership.json'));
        assert.throws(() => ComponentExistingSpriteControlPlan.inspectSynthetic(repository, f.project, '3.8.3'), /path_link/);
    } finally { f.close(); }
});

test('extra staged web or video assets and unknown controls are not silently accepted', () => {
    const f = fixture();
    try {
        const old = ComponentExistingSpriteControlPlan.forbiddenLegacyExtras;
        for (const path of old) {
            put(join(f.project, path), 'unexpected-old-control');
            assert.throws(() => ComponentExistingSpriteControlPlan.inspectSynthetic(repository, f.project, '3.8.3'), /extension_target_exists/);
            rmSync(join(f.project, path));
        }
        const result = ComponentExistingSpriteControlPlan.inspectSynthetic(repository, f.project, '3.8.3');
        assert.ok((result.blockers as string[]).includes('dynamic_control_side_effects_unbounded'));
    } finally { f.close(); }
});
