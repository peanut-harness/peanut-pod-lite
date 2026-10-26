import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ComponentExistingSpriteStage, type SpriteStageManifest } from './component-existing-sprite-stage.mts';

const image = 'tests/fixtures/editor-stability/media/assets/image/checker.png';
const authored = 'tests/fixtures/editor-stability/components/sprite-authored/';
const candidate = {
    version: '0.2.1', testedSourceCommit: '660226aa28d0d96fc4766c81c3b58af71cd1a8f0',
    hostPackageDigest: '3954bec522639354ce249f594055e7a543854ee721c645994051cd094f534438',
    corePackageDigest: 'ef38d9ac7f12a6face2e353cbb02c538ce0546520d1cb3941a903c8a376d794f',
    frozenDescriptorSha256: '1a73441ae9abf86e15fda0434cb5ad51388a0fda589ad6ecc88b64e1eb2d3a40',
} as const;
const protectedPaths = [
    'package.json', 'acceptance-fixture.json', 'extensions/peanut-pod-lite-host/package.json',
    'peanut-plugins/installed.json', 'peanut-plugins/runtime/host-status.json',
];

function sha(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex'); }
function put(path: string, value: Buffer | string): void {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value);
}

function fixture(): { repository: string; project: string; manifest: SpriteStageManifest; close: () => void } {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'component-sprite-stage-')));
    const repository = join(temp, 'repository'); const project = join(temp, 'synthetic-project');
    mkdirSync(repository); mkdirSync(project);
    const protectedFiles = protectedPaths.map(path => {
        const bytes = `original:${path}`; put(join(project, path), bytes);
        return { path, sha256: sha(bytes) };
    });
    const files = ComponentExistingSpriteStage.destinations.map((path, index) => {
        const sourcePath = index === 0 ? image : `${authored}${index}.bytes`;
        const bytes = `synthetic:${path}`; put(join(repository, sourcePath), bytes);
        return { path, sourcePath, sha256: sha(bytes) };
    });
    const manifest: SpriteStageManifest = {
        schema: 'peanut.pod.component-existing-sprite-stage.v1', creatorVersion: '3.8.3',
        projectPath: project, candidate, files, protectedFiles,
    };
    return { repository, project, manifest, close: () => rmSync(temp, { recursive: true, force: true }) };
}

test('complete synthetic byte plan remains dry run and does not create target files', () => {
    const f = fixture();
    try {
        const protectedBefore = readFileSync(join(f.project, protectedPaths[0]));
        const plan = ComponentExistingSpriteStage.planSyntheticDryRun(f.repository, f.project, f.manifest);
        assert.equal(plan.executable, false);
        assert.equal(plan.mode, 'read_only_dry_run');
        assert.equal((plan.files as unknown[]).length, 11);
        assert.ok((plan.blockers as string[]).includes('fresh_full_backup_required'));
        assert.ok((plan.blockers as string[]).includes('external_project_lease_required'));
        const bytes = ComponentExistingSpriteStage.fixtureBytes(f.repository, f.project, f.manifest);
        assert.equal(bytes.size, 11);
        assert.equal(sha(bytes.get(f.manifest.files[0].path)!), f.manifest.files[0].sha256);
        assert.ok(f.manifest.files.every(item => !existsSync(join(f.project, item.path))));
        assert.deepEqual(readFileSync(join(f.project, protectedPaths[0])), protectedBefore);
    } finally { f.close(); }
});

test('synthetic planner rejects a caller-selected nonfixture root', () => {
    const f = fixture();
    try {
        const other = join(dirname(f.project), 'other-project');
        mkdirSync(other);
        assert.throws(() => ComponentExistingSpriteStage.planSyntheticDryRun(f.repository, other, f.manifest),
            /synthetic_root_invalid/);
    } finally { f.close(); }
});

test('candidate, project identity, source digest and protected hash are exact', () => {
    const f = fixture();
    try {
        const plan = () => ComponentExistingSpriteStage.planSyntheticDryRun(f.repository, f.project, f.manifest);
        f.manifest.candidate = { ...candidate, version: '0.2.0' };
        assert.throws(plan, /candidate_mismatch/);
        f.manifest.candidate = candidate;
        f.manifest.projectPath = `${f.project}-other`;
        assert.throws(plan, /project_identity_invalid/);
        f.manifest.projectPath = f.project;
        put(join(f.repository, image), 'changed-image');
        assert.throws(plan, /source_mismatch/);
        put(join(f.repository, image), `synthetic:${f.manifest.files[0].path}`);
        put(join(f.project, protectedPaths[0]), 'changed-protected');
        assert.throws(plan, /protected_changed/);
    } finally { f.close(); }
});

test('partial, duplicate, escaped and nonallowlisted paths are rejected', () => {
    const f = fixture();
    try {
        const plan = () => ComponentExistingSpriteStage.planSyntheticDryRun(f.repository, f.project, f.manifest);
        const original = f.manifest.files;
        f.manifest.files = original.slice(1);
        assert.throws(plan, /manifest_incomplete/);
        f.manifest.files = [...original.slice(0, -1), original[0]];
        assert.throws(plan, /manifest_incomplete/);
        f.manifest.files = [...original];
        f.manifest.files[0] = { ...original[0], path: '../escape' };
        assert.throws(plan, /manifest_incomplete/);
        f.manifest.files[0] = { ...original[0], path: 'assets/other.png' };
        assert.throws(plan, /manifest_incomplete/);
        f.manifest.files = original;
        f.manifest.files[0] = { ...original[0], sourcePath: `${authored}../escape` };
        assert.throws(plan, /path_invalid/);
    } finally { f.close(); }
});

test('existing target and linked parent fail without touching either file', () => {
    const f = fixture();
    try {
        const path = f.manifest.files[0].path;
        put(join(f.project, path), 'already-here');
        assert.throws(() => ComponentExistingSpriteStage.planSyntheticDryRun(f.repository, f.project, f.manifest), /target_exists/);
        assert.equal(readFileSync(join(f.project, path), 'utf8'), 'already-here');
        rmSync(join(f.project, path));
        rmSync(join(f.project, 'assets'), { recursive: true });
        symlinkSync(dirname(join(f.project, protectedPaths[0])), join(f.project, 'assets'));
        assert.throws(() => ComponentExistingSpriteStage.planSyntheticDryRun(f.repository, f.project, f.manifest), /path_link/);
        assert.ok(!existsSync(join(f.project, path)));
    } finally { f.close(); }
});

test('linked source is rejected even when its bytes match the manifest', () => {
    const f = fixture();
    try {
        const source = join(f.repository, image);
        const bytes = readFileSync(source);
        const alternate = join(f.repository, 'alternate-image');
        put(alternate, bytes);
        rmSync(source);
        symlinkSync(alternate, source);
        assert.throws(() => ComponentExistingSpriteStage.planSyntheticDryRun(f.repository, f.project, f.manifest), /path_link/);
        assert.ok(f.manifest.files.every(item => !existsSync(join(f.project, item.path))));
    } finally { f.close(); }
});

test('unproven authored source and incomplete protected manifest cannot become a stage plan', () => {
    const f = fixture();
    try {
        const original = f.manifest.protectedFiles;
        f.manifest.protectedFiles = original.slice(1);
        assert.throws(() => ComponentExistingSpriteStage.planSyntheticDryRun(f.repository, f.project, f.manifest), /protected_incomplete/);
        f.manifest.protectedFiles = original;
        f.manifest.files[1] = { ...f.manifest.files[1], sourcePath: image,
            sha256: f.manifest.files[0].sha256 };
        assert.throws(() => ComponentExistingSpriteStage.planSyntheticDryRun(f.repository, f.project, f.manifest), /authored_source_unproven/);
    } finally { f.close(); }
});
