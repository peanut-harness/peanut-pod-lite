import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentTaskOwnership } from './component-task-ownership.mts';

const PROJECTS = {
    '3.8.3': '.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.3',
    '3.8.7': '.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.7',
} as const;
const CHANGE = 'stabilize-editor-operations-and-bulk-file-io';
const FROZEN_DESCRIPTOR_SHA256 = '1a73441ae9abf86e15fda0434cb5ad51388a0fda589ad6ecc88b64e1eb2d3a40';
const PRIVATE_ROOT = '.peanut-ai/pod-editor-operations-20261026/task-5.1';
const PROTECTED_FILES = [
    'package.json', 'acceptance-fixture.json', 'extensions/peanut-pod-lite-host/package.json',
    'peanut-plugins/installed.json', 'peanut-plugins/runtime/host-status.json',
    '.peanut-ai/cocos-mcp-attachments.json',
] as const;

type FileState = { path: string; exists: boolean; size: number | null; sha256: string | null };
type RecordValue = Record<string, unknown>;

/** Read-only prerequisite report. It never grants an external project lease. */
export class ComponentExistingProjectPlan {
    private static record(value: unknown): RecordValue {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_existing_plan_invalid');
        return value as RecordValue;
    }

    private static sha256(path: string): string {
        return createHash('sha256').update(readFileSync(path)).digest('hex');
    }

    private static regularFile(path: string): boolean {
        return existsSync(path) && lstatSync(path).isFile() && realpathSync(path) === path;
    }

    private static projectFile(project: string, path: string): string {
        if (!path || isAbsolute(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\')))
            throw new Error('component_existing_path_invalid');
        const absolute = resolve(project, path);
        if (!absolute.startsWith(`${project}${sep}`)) throw new Error('component_existing_path_escape');
        let parent = dirname(absolute);
        while (parent !== project) {
            if (existsSync(parent) && (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent))
                throw new Error('component_existing_path_link');
            parent = dirname(parent);
        }
        if (existsSync(absolute) && (!lstatSync(absolute).isFile() || realpathSync(absolute) !== absolute))
            throw new Error('component_existing_path_link');
        return absolute;
    }

    private static state(project: string, path: string): FileState {
        const absolute = this.projectFile(project, path);
        if (!existsSync(absolute)) return { path, exists: false, size: null, sha256: null };
        return { path, exists: true, size: lstatSync(absolute).size, sha256: this.sha256(absolute) };
    }

    private static proposedPath(path: string): boolean {
        if (isAbsolute(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\')))
            return false;
        return path.startsWith('assets/components/') || path.startsWith('assets/fixtures/')
            || path.startsWith('extensions/peanut-component-')
            || path === '.peanut-ai/cocos-mcp-attachments.json'
            || path === 'peanut-plugins/installed.json'
            || path.startsWith('peanut-plugins/plugins/peanut.pod-lite/0.2.1/')
            || path.startsWith('peanut-plugins/runtime/');
    }

    /** Inspect the two registered projects from fixed workspace locations; no caller-selected project root. */
    public static inspect(repository: string, version: string, actor: string): RecordValue {
        if (version !== '3.8.3' && version !== '3.8.7') throw new Error('component_existing_version_invalid');
        const root = realpathSync(repository);
        const workspace = resolve(root, '../../..');
        ComponentTaskOwnership.current(root, actor);
        const project = join(workspace, PROJECTS[version]);
        if (!existsSync(project) || !lstatSync(project).isDirectory() || realpathSync(project) !== project)
            throw new Error('component_existing_project_unregistered');
        const sourcePlan = this.record(JSON.parse(readFileSync(join(root, 'docs/testing/pod/existing-project-editing-plan.json'), 'utf8')));
        if (sourcePlan.schema !== 'peanut.pod.existing-project-editing-plan.v1'
            || sourcePlan.change !== 'validate-pod-0-2-1-existing-project-editing')
            throw new Error('component_existing_source_plan_invalid');
        const projectRows = sourcePlan.projects;
        if (!Array.isArray(projectRows) || projectRows.length !== 2) throw new Error('component_existing_project_list_invalid');
        const row = this.record(projectRows.find(item => this.record(item).creatorVersion === version));
        if (row.path !== project || row.creatorVersion !== version) throw new Error('component_existing_project_list_invalid');
        const frozen = this.record(sourcePlan.candidate);
        if (frozen.version !== '0.2.1' || typeof frozen.testedSourceCommit !== 'string')
            throw new Error('component_existing_candidate_invalid');
        const blockers: string[] = [];
        const manifestFile = this.state(project, 'package.json');
        const projectManifest = this.record(JSON.parse(readFileSync(this.projectFile(project, 'package.json'), 'utf8')));
        if (this.record(projectManifest.creator).version !== version) blockers.push('creator_version_mismatch');
        const fixture = this.state(project, 'acceptance-fixture.json');
        if (fixture.sha256 !== row.immutableFixtureSha256) blockers.push('fixture_baseline_mismatch');
        const immutableManifestVerified = manifestFile.sha256 === row.immutableManifestSha256;
        if (!immutableManifestVerified) blockers.push('immutable_manifest_mismatch');
        const installed = this.record(JSON.parse(readFileSync(this.projectFile(project, 'peanut-plugins/installed.json'), 'utf8')));
        const plugins = installed.plugins;
        const lite = Array.isArray(plugins) ? plugins.map(item => this.record(item)).filter(item => item.pluginId === 'peanut.pod-lite') : [];
        if (installed.schemaVersion !== 2 || lite.length !== 1 || lite[0]?.activeVersion !== '0.2.1')
            blockers.push('installed_core_version_mismatch');
        const hostManifest = this.record(JSON.parse(readFileSync(this.projectFile(project, 'extensions/peanut-pod-lite-host/package.json'), 'utf8')));
        if (hostManifest.version !== '0.2.1') blockers.push('installed_host_version_mismatch');
        const coreManifest = this.record(JSON.parse(readFileSync(this.projectFile(project,
            'peanut-plugins/plugins/peanut.pod-lite/0.2.1/peanut.pod-lite.manifest.json'), 'utf8')));
        if (this.record(coreManifest.package).digest !== frozen.corePackageDigest) blockers.push('installed_core_digest_mismatch');
        const hostStatus = this.record(JSON.parse(readFileSync(this.projectFile(project, 'peanut-plugins/runtime/host-status.json'), 'utf8')));
        const artifacts = this.record(hostStatus.artifacts);
        if (hostStatus.ready !== true || this.record(this.record(hostStatus.creatorContext).version).raw !== version)
            blockers.push('host_status_not_ready_or_wrong_creator');
        if (this.record(artifacts.host).packageDigest !== frozen.hostPackageDigest
            || this.record(artifacts.core).packageDigest !== frozen.corePackageDigest)
            blockers.push('installed_package_digest_mismatch');
        if (version === '3.8.7') {
            const pro = this.record(hostStatus.pro);
            if (pro.state !== 'active' || pro.version !== '0.1.1') blockers.push('protected_pro_identity_mismatch');
        }
        const archiveRoot = join(workspace, '.peanut-ai/pod-decouple-cpm-20261026/task-4.2-validation-registration/4.1-frozen-candidate');
        const archives = [
            ['host', 'peanut-pod-lite-host-0.2.1.tar.gz', frozen.hostArchiveSha256],
            ['core', 'peanut-pod-lite-core-0.2.1.tar.gz', frozen.coreArchiveSha256],
        ].map(([kind, name, expected]) => {
            const path = join(archiveRoot, String(name));
            const actual = this.regularFile(path) ? this.sha256(path) : null;
            if (actual !== expected) blockers.push(`${kind}_archive_unavailable_or_mismatch`);
            return { kind, verified: actual === expected };
        });
        const descriptor = join(archiveRoot, 'lite-release-descriptor.json');
        const descriptorVerified = this.regularFile(descriptor) && this.sha256(descriptor) === FROZEN_DESCRIPTOR_SHA256;
        if (!descriptorVerified) blockers.push('frozen_descriptor_unavailable_or_mismatch');
        const assetPlanPath = join(workspace, PRIVATE_ROOT, `${version}-asset-plan.json`);
        let proposedFiles: FileState[] = [];
        if (this.regularFile(assetPlanPath)) {
            const assetPlan = this.record(JSON.parse(readFileSync(assetPlanPath, 'utf8')));
            const files = assetPlan.files;
            if (assetPlan.schema !== 'peanut.pod.component-existing-asset-plan.v1' || assetPlan.creatorVersion !== version
                || assetPlan.projectPath !== project || assetPlan.complete !== true || !Array.isArray(files)
                || files.length === 0 || new Set(files).size !== files.length
                || !files.every(path => typeof path === 'string' && this.proposedPath(path)))
                blockers.push('exact_asset_plan_invalid');
            else proposedFiles = files.map(path => this.state(project, path));
        } else blockers.push('exact_asset_plan_missing');
        const protectedFiles = PROTECTED_FILES.map(path => this.state(project, path));
        let checkoutHeadCommit: string | null = null;
        let checkoutDirty: boolean | null = null;
        try {
            checkoutHeadCommit = execFileSync('git', ['-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD'],
                { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            checkoutDirty = execFileSync('git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain'],
                { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
        } catch { /* A missing Git checkout never becomes candidate identity. */ }
        // A read-only plan cannot establish a fresh backup, occupancy or external write lease.
        blockers.push('fresh_full_backup_required', 'fresh_process_and_port_occupancy_required', 'external_project_lease_required');
        return {
            schema: 'peanut.pod.component-existing-project-plan.v1', change: CHANGE,
            creatorVersion: version, projectPath: project, mode: 'read_only_dry_run', executable: false,
            frozenCandidate: { version: '0.2.1', testedSourceCommit: frozen.testedSourceCommit,
                hostPackageDigest: frozen.hostPackageDigest, corePackageDigest: frozen.corePackageDigest,
                descriptorSha256: FROZEN_DESCRIPTOR_SHA256, descriptorVerified, archives },
            checkoutHeadCommit, checkoutDirty,
            protectedFiles, proposedFiles, proposedFilesComplete: proposedFiles.length > 0,
            proProtected: true, immutableManifestVerified,
            occupancy: 'unobserved', backup: 'unverified', runtimeLease: 'absent',
            blockers: [...new Set(blockers)],
        };
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
    const position = process.argv.indexOf('--creator-version');
    if (position < 0 || position !== process.argv.length - 2) throw new Error('component_existing_arguments_invalid');
    process.stdout.write(JSON.stringify(ComponentExistingProjectPlan.inspect(root, process.argv[position + 1] ?? '',
        process.env.CODEX_THREAD_ID ?? ''), null, 2) + '\n');
}
