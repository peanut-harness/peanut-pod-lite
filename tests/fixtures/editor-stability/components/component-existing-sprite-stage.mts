import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { ComponentExistingProjectPlan } from './component-existing-project-plan.mts';

const CANDIDATE = Object.freeze({
    version: '0.2.1',
    testedSourceCommit: '660226aa28d0d96fc4766c81c3b58af71cd1a8f0',
    hostPackageDigest: '3954bec522639354ce249f594055e7a543854ee721c645994051cd094f534438',
    corePackageDigest: 'ef38d9ac7f12a6face2e353cbb02c538ce0546520d1cb3941a903c8a376d794f',
    hostArchiveSha256: '266589255eca7e6a8fa03f64171a329e607b8de514df79a0cdcf7418dbfb771f',
    coreArchiveSha256: 'cb037f16b57e38b38306f0066d6eb88ea94ef514cccfe92d5e49c49925ca64d0',
    frozenDescriptorSha256: '1a73441ae9abf86e15fda0434cb5ad51388a0fda589ad6ecc88b64e1eb2d3a40',
});
const SOURCE_IMAGE = 'tests/fixtures/editor-stability/media/assets/image/checker.png';
const SOURCE_IMAGE_SHA256 = '5dd37b0e2023a6fb9a50f4c10b2004ca06287895e43ab2accfd0acc565c9187b';
const DESTINATIONS = Object.freeze([
    'assets/fixtures/media/assets/image/checker.png',
    'assets/fixtures/media/assets/image/checker.png.meta',
    'assets/components/cc.Sprite.scene',
    'assets/components/cc.Sprite.scene.meta',
    'assets/components/cc.UIOpacity.scene',
    'assets/components/cc.UIOpacity.scene.meta',
    'assets/components.meta',
    'assets/fixtures.meta',
    'assets/fixtures/media.meta',
    'assets/fixtures/media/assets.meta',
    'assets/fixtures/media/assets/image.meta',
]);
const PROTECTED = Object.freeze([
    'package.json', 'acceptance-fixture.json',
    'extensions/peanut-pod-lite-host/package.json',
    'peanut-plugins/installed.json',
    'peanut-plugins/runtime/host-status.json',
]);
type Candidate = { [Key in keyof typeof CANDIDATE]: string };
type FileEntry = { path: string; sha256: string; sourcePath: string };
type ProtectedEntry = { path: string; sha256: string };
export type SpriteStageManifest = {
    schema: 'peanut.pod.component-existing-sprite-stage.v1';
    creatorVersion: '3.8.3' | '3.8.7';
    projectPath: string;
    candidate: Candidate;
    files: FileEntry[];
    protectedFiles: ProtectedEntry[];
};

function hash(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}
function present(path: string): boolean { return lstatSync(path, { throwIfNoEntry: false }) !== undefined; }

function safeFile(root: string, path: string): string {
    if (!path || isAbsolute(path) || path.split('/').some(part =>
        !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0')))
        throw new Error('component_sprite_stage_path_invalid');
    const absolute = resolve(root, path);
    if (!absolute.startsWith(`${root}${sep}`)) throw new Error('component_sprite_stage_path_escape');
    let parent = dirname(absolute);
    while (parent !== root) {
        if (present(parent) && (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent))
            throw new Error('component_sprite_stage_path_link');
        parent = dirname(parent);
    }
    if (present(absolute) && (!lstatSync(absolute).isFile() || realpathSync(absolute) !== absolute))
        throw new Error('component_sprite_stage_path_link');
    return absolute;
}

function exactPaths(actual: readonly string[], expected: readonly string[], code: string): void {
    if (actual.length !== expected.length || new Set(actual).size !== actual.length
        || actual.some(path => !expected.includes(path))) throw new Error(code);
}

/**
 * Validate exact bytes and destination state. This module has no project writer or launch entry.
 */
export class ComponentExistingSpriteStage {
    public static readonly destinations = DESTINATIONS;

    public static planRegistered(repository: string, version: string, actor: string,
        manifest: SpriteStageManifest): Record<string, unknown> {
        const existing = ComponentExistingProjectPlan.inspect(repository, version, actor);
        if (manifest.creatorVersion !== version || manifest.projectPath !== existing.projectPath)
            throw new Error('component_sprite_stage_project_identity_invalid');
        const dryRun = this.planCore(repository, manifest.projectPath, manifest);
        return { ...dryRun, blockers: [...new Set([
            ...(dryRun.blockers as string[]), ...(existing.blockers as string[]),
        ])] };
    }

    public static planSyntheticDryRun(repository: string, project: string,
        manifest: SpriteStageManifest): Record<string, unknown> {
        const root = realpathSync(repository);
        const target = realpathSync(project);
        const parent = dirname(root);
        if (basename(root) !== 'repository' || basename(target) !== 'synthetic-project'
            || dirname(target) !== parent || !basename(parent).startsWith('component-sprite-stage-')
            || !parent.startsWith(`${realpathSync(tmpdir())}${sep}`))
            throw new Error('component_sprite_stage_synthetic_root_invalid');
        return this.planCore(root, target, manifest);
    }

    private static planCore(repository: string, project: string, manifest: SpriteStageManifest): Record<string, unknown> {
        const root = realpathSync(repository);
        const target = realpathSync(project);
        if (manifest.schema !== 'peanut.pod.component-existing-sprite-stage.v1'
            || !['3.8.3', '3.8.7'].includes(manifest.creatorVersion)
            || manifest.projectPath !== target) throw new Error('component_sprite_stage_project_identity_invalid');
        if (Object.keys(CANDIDATE).some(key => manifest.candidate?.[key as keyof Candidate] !== CANDIDATE[key as keyof Candidate]))
            throw new Error('component_sprite_stage_candidate_mismatch');
        if (!Array.isArray(manifest.files)) throw new Error('component_sprite_stage_manifest_incomplete');
        exactPaths(manifest.files.map(item => item.path), DESTINATIONS, 'component_sprite_stage_manifest_incomplete');
        if (!Array.isArray(manifest.protectedFiles)) throw new Error('component_sprite_stage_protected_incomplete');
        exactPaths(manifest.protectedFiles.map(item => item.path), PROTECTED, 'component_sprite_stage_protected_incomplete');
        const protectedStates = manifest.protectedFiles.map(item => {
            const path = safeFile(target, item.path);
            if (!present(path) || !/^[0-9a-f]{64}$/u.test(item.sha256)
                || hash(readFileSync(path)) !== item.sha256) throw new Error('component_sprite_stage_protected_changed');
            return { path: item.path, sha256: item.sha256 };
        });
        const files = manifest.files.map(item => {
            const destination = safeFile(target, item.path);
            if (present(destination)) throw new Error('component_sprite_stage_target_exists');
            const source = safeFile(root, item.sourcePath);
            if (!present(source) || !/^[0-9a-f]{64}$/u.test(item.sha256))
                throw new Error('component_sprite_stage_source_invalid');
            const bytes = readFileSync(source);
            if (hash(bytes) !== item.sha256) throw new Error('component_sprite_stage_source_mismatch');
            if (item.path === DESTINATIONS[0]
                && (item.sourcePath !== SOURCE_IMAGE || item.sha256 !== SOURCE_IMAGE_SHA256))
                throw new Error('component_sprite_stage_image_source_invalid');
            if (item.path !== DESTINATIONS[0]
                && !item.sourcePath.startsWith('tests/fixtures/editor-stability/components/sprite-authored/'))
                throw new Error('component_sprite_stage_authored_source_unproven');
            return { path: item.path, sourcePath: item.sourcePath, sha256: item.sha256, size: bytes.length };
        });
        return {
            schema: manifest.schema, creatorVersion: manifest.creatorVersion, projectPath: target,
            candidate: CANDIDATE, files, protectedFiles: protectedStates,
            mode: 'read_only_dry_run', executable: false,
            blockers: [
                'scene_and_meta_authoring_unproven', 'assetdb_readback_unproven',
                'parent_meta_ownership_unproven', 'control_side_effects_unbounded',
                'fresh_full_backup_required', 'fresh_process_and_port_occupancy_required',
                'external_project_lease_required',
            ],
        };
    }

    /**
     * Return audited source bytes in memory for synthetic tests only; never writes a project.
     */
    public static fixtureBytes(repository: string, project: string, manifest: SpriteStageManifest): ReadonlyMap<string, Buffer> {
        this.planSyntheticDryRun(repository, project, manifest);
        const root = realpathSync(repository);
        return new Map(manifest.files.map(item => {
            const bytes = readFileSync(safeFile(root, item.sourcePath));
            if (hash(bytes) !== item.sha256) throw new Error('component_sprite_stage_source_changed_after_plan');
            return [item.path, bytes] as const;
        }));
    }
}
