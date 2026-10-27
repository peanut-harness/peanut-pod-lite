import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { ComponentExistingProjectPlan } from './component-existing-project-plan.mts';

const SOURCE_PREFIX = 'tests/fixtures/editor-stability/components/';
const SOURCES = Object.freeze([
    { name: 'component-native-project.mts', sha256: 'aa880e0db464eace893c4fb51e3a442436cc21e0ca33655f6fdf1d2458fde018', role: 'old_stager' },
    { name: 'component-native-main.ts', sha256: '22f4d2792d1dca47bbec4e0756480f4a7920ff32356efd8cd330cbf95481f534', role: 'old_probe_main_source' },
    { name: 'component-native-scene.ts', sha256: '747443b66e51a35ce77b05c9325c711156ff2f64742b2db44a82341b01ef3476', role: 'old_scene_script_source' },
    { name: 'component-project-url-files.ts', sha256: '06af8d149acd2f6888cb921054f93f2f6838ad8292beb203c38790ad547c8f48', role: 'old_web_video_source' },
    { name: 'component-creator-session.mts', sha256: '590dc5253fc7236941abe68bc732b9c9302b974e2c37b9666d2e9a2ac69fbade', role: 'old_launcher' },
    { name: 'component-native-client.mts', sha256: '7e8ecdd589041ef182fa791556d8e0111ae7f89845ee098f17b23fca850f7819', role: 'old_client' },
    { name: 'component-native-roundtrip.mts', sha256: '72f0469f4a73074c639a3cb4791625e4e116202f8f476bd23ec4e60c489b28da', role: 'old_roundtrip' },
]);
const EXTENSION = Object.freeze([
    'extensions/peanut-component-probe/package.json',
    'extensions/peanut-component-probe/main.js',
    'extensions/peanut-component-probe/scene.js',
]);
const OLD_EXTRA = Object.freeze([
    'extensions/peanut-component-probe/project-url-files.json',
    'assets/fixtures/media/assets/video/blue.mp4',
    'assets/fixtures/components/fixtures/web/index.html',
]);
const CONTROL = Object.freeze([
    '.peanut-ai/component-probe.json',
    '.peanut-ai/cocos-mcp-attachments.json',
    'peanut-plugins/installed.json',
    'peanut-plugins/runtime/host-status.json',
]);
const PARENT = Object.freeze([
    'project-ownership.json', 'core-install-receipt.json', 'staging-receipt.json',
    'creator-owned-start.json', 'creator-owned-exit.json', 'sdk-metrics-at-probe-load.ndjson',
    'component-matrix-events.ndjson', 'component-roundtrip-start.json',
    'component-roundtrip-events.json', 'component-roundtrip-receipt.json',
    'stdout.log', 'stderr.log', 'launcher-stdout.log', 'launcher-stderr.log',
]);

function sha(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function present(path: string): boolean { return lstatSync(path, { throwIfNoEntry: false }) !== undefined; }
function safeFile(root: string, path: string): string {
    if (!path || isAbsolute(path) || path.split('/').some(part =>
        !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0')))
        throw new Error('component_sprite_control_path_invalid');
    const absolute = resolve(root, path);
    if (!absolute.startsWith(`${root}${sep}`)) throw new Error('component_sprite_control_path_escape');
    let parent = dirname(absolute);
    while (parent !== root) {
        if (present(parent) && (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent))
            throw new Error('component_sprite_control_path_link');
        parent = dirname(parent);
    }
    if (present(absolute) && (!lstatSync(absolute).isFile() || realpathSync(absolute) !== absolute))
        throw new Error('component_sprite_control_path_link');
    return absolute;
}

/**
 * Audit old probe outputs and bound control paths without staging or starting any extension.
 */
export class ComponentExistingSpriteControlPlan {
    public static readonly proposedExtension = EXTENSION;
    public static readonly forbiddenLegacyExtras = OLD_EXTRA;

    public static sources(repository: string): Record<string, unknown>[] {
        const root = realpathSync(repository);
        if (root !== resolve(repository)) throw new Error('component_sprite_control_repository_alias');
        return SOURCES.map(row => {
            const path = `${SOURCE_PREFIX}${row.name}`;
            const file = safeFile(root, path);
            if (!present(file)) throw new Error('component_sprite_control_source_missing');
            if (sha(readFileSync(file)) !== row.sha256) throw new Error('component_sprite_control_source_sha_mismatch');
            return { path, sha256: row.sha256, role: row.role };
        });
    }

    public static validateProposedPaths(paths: readonly string[]): Record<string, unknown> {
        if (!Array.isArray(paths) || new Set(paths).size !== paths.length)
            throw new Error('component_sprite_control_closure_incomplete');
        if (paths.some(path => typeof path !== 'string' || !EXTENSION.includes(path)))
            throw new Error('component_sprite_control_unexpected_path');
        if (paths.length !== EXTENSION.length) throw new Error('component_sprite_control_closure_incomplete');
        return { paths: [...EXTENSION], complete: false, executable: false,
            blockers: ['probe_bundle_and_runtime_side_effects_unproven',
                'independent_native_readback_unimplemented', 'external_project_lease_required'] };
    }

    public static inspectRegistered(repository: string, version: string, actor: string): Record<string, unknown> {
        const existing = ComponentExistingProjectPlan.inspect(repository, version, actor);
        if (typeof existing.projectPath !== 'string') throw new Error('component_sprite_control_project_invalid');
        return this.inspectCore(repository, existing.projectPath, version);
    }

    public static inspectSynthetic(repository: string, project: string, version: string): Record<string, unknown> {
        const root = realpathSync(project);
        if (root !== resolve(project) || basename(root) !== 'synthetic-project'
            || !basename(dirname(root)).startsWith('component-control-'))
            throw new Error('component_sprite_control_synthetic_root_invalid');
        return this.inspectCore(repository, root, version);
    }

    private static inspectCore(repository: string, project: string, version: string): Record<string, unknown> {
        if (version !== '3.8.3' && version !== '3.8.7') throw new Error('component_sprite_control_version_invalid');
        const root = realpathSync(project);
        const manifest = JSON.parse(readFileSync(safeFile(root, 'package.json'), 'utf8'));
        if (manifest?.creator?.version !== version) throw new Error('component_sprite_control_project_version_mismatch');
        const sources = this.sources(repository);
        const extension = [...EXTENSION, ...OLD_EXTRA].map(path => {
            const file = safeFile(root, path);
            if (present(file)) throw new Error('component_sprite_control_extension_target_exists');
            return { path, role: OLD_EXTRA.includes(path) ? 'forbidden_legacy_extra' : 'unbuilt_probe_candidate', exists: false };
        });
        const controls = CONTROL.map(path => {
            const file = safeFile(root, path); const exists = present(file);
            if (path === '.peanut-ai/component-probe.json')
                return { path, exists, role: 'secret_runtime_descriptor', contentReported: false, sha256: null };
            return { path, exists, role: path.includes('attachments') ? 'capability_attachment' : 'protected_product_control',
                sha256: exists ? sha(readFileSync(file)) : null };
        });
        const parent = dirname(root);
        const parentOutputs = PARENT.map(path => {
            const file = safeFile(parent, path); const exists = present(file);
            return { path, location: 'project_parent', exists,
                role: path.endsWith('.log') || path.endsWith('.ndjson') ? 'raw_log' : 'ownership_or_receipt',
                sha256: exists ? sha(readFileSync(file)) : null };
        });
        const blockers = ['old_probe_not_minimal', 'dynamic_control_side_effects_unbounded',
            'probe_bundle_dependency_closure_unverified', 'probe_bundle_unbuilt_and_unverified',
            'independent_native_readback_unimplemented', 'fresh_backup_occupancy_and_lease_required'];
        if (controls.some(row => row.path === '.peanut-ai/component-probe.json' && row.exists))
            blockers.push('probe_descriptor_already_present');
        if (controls.some(row => row.path === '.peanut-ai/cocos-mcp-attachments.json' && row.exists))
            blockers.push('capability_attachment_preexisting');
        if (parentOutputs.some(row => row.exists)) blockers.push('parent_control_paths_already_present');
        return { schema: 'peanut.pod.component-existing-sprite-control-plan.v1', creatorVersion: version,
            projectPath: root, mode: 'read_only', executable: false, sources, extension, controls, parentOutputs,
            oldProbe: { unconditionalUrlManifest: true, webVideoFixtures: true, parentOwnershipRead: true,
                parentMetricsAppend: true, loopbackListener: true, secretDescriptorWrite: true,
                directAssetDbQueryErrorsPreserved: true },
            legacySourceToDestination: [
                { source: `${SOURCE_PREFIX}component-native-project.mts`, destination: EXTENSION[0],
                    transformation: 'inline_manifest_generated', outputSha256: null },
                { source: `${SOURCE_PREFIX}component-native-main.ts`, destination: EXTENSION[1],
                    transformation: 'esbuild_bundle', outputSha256: null },
                { source: `${SOURCE_PREFIX}component-native-scene.ts`, destination: EXTENSION[2],
                    transformation: 'esbuild_bundle', outputSha256: null },
                { source: `${SOURCE_PREFIX}component-project-url-files.ts`,
                    destinations: OLD_EXTRA, transformation: 'manifest_and_web_video_copies', outputSha256: null },
            ],
            assetMetaDependencies: ['assets/components.meta', 'assets/fixtures.meta',
                'assets/fixtures/media.meta', 'assets/fixtures/media/assets.meta',
                'assets/fixtures/media/assets/image.meta'],
            runtimeUnknown: ['temp/**', 'library/**', 'settings/**', 'other Creator generated paths'],
            candidateHostCoreAndProtectedProUnchanged: true, probeIdentitySeparateFromCandidate: true,
            hostConvenienceReads: { errorsCollapsedToNullOrEmpty: true, independentSuccessEvidence: false },
            blockers };
    }
}
