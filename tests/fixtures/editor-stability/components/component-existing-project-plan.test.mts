import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ComponentExistingProjectPlan } from './component-existing-project-plan.mts';

const owner = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const change = 'stabilize-editor-operations-and-bulk-file-io';
const worktreePath = `.worktrees/peanut-pod-lite/${change}`;
const projectPrefix = '.peanut-ai/pod-lifecycle-acceptance-2026-10-09';
const evidence = '.peanut-ai/pod-decouple-cpm-20261026/task-4.2-validation-registration/4.1-frozen-candidate';
const privateRoot = '.peanut-ai/pod-editor-operations-20261026/task-5.1';

function sha(value: Buffer | string): string {
    return createHash('sha256').update(value).digest('hex');
}

function put(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
}

function fixture(): { workspace: string; repository: string; project: string; close: () => void } {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'component-existing-plan-')));
    const repository = join(workspace, worktreePath);
    const project = join(workspace, projectPrefix, 'creator-3.8.3');
    mkdirSync(repository, { recursive: true }); mkdirSync(project, { recursive: true });
    const coreDigest = sha('core'); const hostDigest = sha('host');
    put(join(workspace, '.peanut-ai/worktree-registry.json'), { version: 1, entries: [{
        repo: 'peanut-pod-lite', change, path: worktreePath, branch: `change/${change}`,
        state: 'active', deliveryMode: 'coordinated', owner, checkpointOwner: owner, integrationOwner: owner,
    }] });
    put(join(repository, 'docs/testing/pod/existing-project-editing-plan.json'), {
        schema: 'peanut.pod.existing-project-editing-plan.v1', change: 'validate-pod-0-2-1-existing-project-editing',
        candidate: { version: '0.2.1', testedSourceCommit: 'frozen-source', hostPackageDigest: hostDigest,
            corePackageDigest: coreDigest, hostArchiveSha256: sha('host-archive'), coreArchiveSha256: sha('core-archive') },
        projects: ['3.8.3', '3.8.7'].map(version => ({ creatorVersion: version,
            path: join(workspace, projectPrefix, `creator-${version}`), immutableFixtureSha256: sha('fixture'),
            immutableManifestSha256: sha(JSON.stringify({ creator: { version } })) })),
    });
    put(join(project, 'package.json'), { creator: { version: '3.8.3' } });
    put(join(project, 'acceptance-fixture.json'), 'fixture');
    put(join(project, 'extensions/peanut-pod-lite-host/package.json'), { version: '0.2.1' });
    put(join(project, 'peanut-plugins/installed.json'), { schemaVersion: 2,
        plugins: [{ pluginId: 'peanut.pod-lite', activeVersion: '0.2.1' }] });
    put(join(project, 'peanut-plugins/plugins/peanut.pod-lite/0.2.1/peanut.pod-lite.manifest.json'),
        { package: { digest: coreDigest } });
    put(join(project, 'peanut-plugins/runtime/host-status.json'), { ready: true,
        creatorContext: { version: { raw: '3.8.3' } },
        artifacts: { host: { packageDigest: hostDigest }, core: { packageDigest: coreDigest } } });
    put(join(workspace, evidence, 'peanut-pod-lite-host-0.2.1.tar.gz'), 'host-archive');
    put(join(workspace, evidence, 'peanut-pod-lite-core-0.2.1.tar.gz'), 'core-archive');
    put(join(workspace, evidence, 'lite-release-descriptor.json'), 'unmatched-descriptor');
    return { workspace, repository, project, close: () => rmSync(workspace, { recursive: true, force: true }) };
}

test('existing project inspection is read only and keeps frozen identity separate from current source', () => {
    const f = fixture();
    try {
        const before = readFileSync(join(f.project, 'acceptance-fixture.json'));
        const result = ComponentExistingProjectPlan.inspect(f.repository, '3.8.3', owner);
        assert.equal(result.projectPath, f.project);
        assert.equal(result.mode, 'read_only_dry_run');
        assert.equal(result.executable, false);
        assert.equal((result.frozenCandidate as any).testedSourceCommit, 'frozen-source');
        assert.equal(result.checkoutHeadCommit, null);
        assert.deepEqual((result.frozenCandidate as any).archives.map((row: any) => row.verified), [true, true]);
        assert.ok((result.blockers as string[]).includes('external_project_lease_required'));
        assert.ok((result.blockers as string[]).includes('exact_asset_plan_missing'));
        assert.ok((result.blockers as string[]).includes('frozen_descriptor_unavailable_or_mismatch'));
        assert.deepEqual(readFileSync(join(f.project, 'acceptance-fixture.json')), before);
        assert.equal(JSON.stringify(result).includes('approvalToken'), false);
    } finally { f.close(); }
});

test('only the exact registered project and current coordinated owner are accepted', () => {
    const f = fixture();
    try {
        assert.throws(() => ComponentExistingProjectPlan.inspect(f.repository, '3.8.3', 'previous-owner'), /owner_mismatch/);
        assert.throws(() => ComponentExistingProjectPlan.inspect(f.repository, '3.8.5', owner), /version_invalid/);
        const source = join(f.repository, 'docs/testing/pod/existing-project-editing-plan.json');
        const plan = JSON.parse(readFileSync(source, 'utf8'));
        plan.projects[0].path = join(f.workspace, 'other-project'); put(source, plan);
        assert.throws(() => ComponentExistingProjectPlan.inspect(f.repository, '3.8.3', owner), /project_list_invalid/);
    } finally { f.close(); }
});

test('changed installed identity and immutable manifest stay blocked', () => {
    const f = fixture();
    try {
        put(join(f.project, 'package.json'), { creator: { version: '3.8.3' }, changed: true });
        const status = join(f.project, 'peanut-plugins/runtime/host-status.json');
        const changed = JSON.parse(readFileSync(status, 'utf8'));
        changed.artifacts.host.packageDigest = sha('another-host'); put(status, changed);
        const result = ComponentExistingProjectPlan.inspect(f.repository, '3.8.3', owner);
        assert.ok((result.blockers as string[]).includes('immutable_manifest_mismatch'));
        assert.ok((result.blockers as string[]).includes('installed_package_digest_mismatch'));
        assert.equal(result.executable, false);
    } finally { f.close(); }
});

test('proposed paths get exact hashes while traversal, links and incomplete plans never become executable', () => {
    const f = fixture();
    try {
        const target = 'assets/components/cc.Sprite.scene';
        put(join(f.project, target), 'protected-scene');
        const planPath = join(f.workspace, privateRoot, '3.8.3-asset-plan.json');
        put(planPath, { schema: 'peanut.pod.component-existing-asset-plan.v1', creatorVersion: '3.8.3',
            projectPath: f.project, complete: true, files: [target] });
        const result = ComponentExistingProjectPlan.inspect(f.repository, '3.8.3', owner);
        assert.equal(result.proposedFilesComplete, true);
        assert.deepEqual(result.proposedFiles, [{ path: target, exists: true,
            size: Buffer.byteLength('protected-scene'), sha256: sha('protected-scene') }]);
        assert.equal(result.executable, false);
        put(planPath, { schema: 'peanut.pod.component-existing-asset-plan.v1', creatorVersion: '3.8.3',
            projectPath: f.project, complete: true, files: ['assets/components/../outside.scene'] });
        assert.ok((ComponentExistingProjectPlan.inspect(f.repository, '3.8.3', owner).blockers as string[])
            .includes('exact_asset_plan_invalid'));
        rmSync(join(f.project, target)); symlinkSync(join(f.project, 'package.json'), join(f.project, target));
        put(planPath, { schema: 'peanut.pod.component-existing-asset-plan.v1', creatorVersion: '3.8.3',
            projectPath: f.project, complete: true, files: [target] });
        assert.throws(() => ComponentExistingProjectPlan.inspect(f.repository, '3.8.3', owner), /path_link/);
    } finally { f.close(); }
});
