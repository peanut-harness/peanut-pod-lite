import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';

type Version = '3.8.3' | '3.8.7';
type Kind = 'image' | 'scene' | 'directory';
const SDK = Object.freeze({
    '3.8.3': {
        packageSha256: '9f5d065eb57e69c9f62c805eecbb668d85c4416f372ecf75e3dc0d5a713b5d63',
        imageSha256: 'a21b5642a07fd448da217fbf00a6ca3ec338edb50aa0a80a1e039b1c2ee9b816',
        sceneSha256: '8d989b1d1d2c4bb4f4d9073147d34dd95d5b65809458a2a8d931db4592e5727d',
        directorySha256: '419fbb72ea67fd1a49b1f21e2fa2941b21b0aec475d3a9a2ff21ed8130b4f156',
    },
    '3.8.7': {
        packageSha256: '14f5c51d349123656acd76652a03468f754a76df12874e61b176b2d8419926cf',
        imageSha256: 'ad84c0e50ade28419c7942d745606bf28b5e0e54b79afcb7df12d7fa28f22ec8',
        sceneSha256: '8d989b1d1d2c4bb4f4d9073147d34dd95d5b65809458a2a8d931db4592e5727d',
        directorySha256: '419fbb72ea67fd1a49b1f21e2fa2941b21b0aec475d3a9a2ff21ed8130b4f156',
    },
});
const SOURCE = Object.freeze({
    image: 'editor/assets/default_ui/default_sprite.png.meta',
    scene: 'editor/assets/default_file_content/scene/scene-2d.scene.meta',
    directory: 'editor/assets/default_ui.meta',
});
const FORMAT = Object.freeze({
    image: { importer: 'image', ver: '1.0.27' },
    scene: { importer: 'scene', ver: '1.1.50' },
    directory: { importer: 'directory', ver: '1.2.0' },
});
const TARGETS = Object.freeze([
    'assets/fixtures/media/assets/image/checker.png',
    'assets/fixtures/media/assets/image/checker.png.meta',
    'assets/components/cc.Sprite.scene',
    'assets/components/cc.Sprite.scene.meta',
    'assets/components/cc.UIOpacity.scene',
    'assets/components/cc.UIOpacity.scene.meta',
]);
const PARENTS = Object.freeze([
    'assets/components.meta', 'assets/fixtures.meta', 'assets/fixtures/media.meta',
    'assets/fixtures/media/assets.meta', 'assets/fixtures/media/assets/image.meta',
]);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;

function sha(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function present(path: string): boolean { return lstatSync(path, { throwIfNoEntry: false }) !== undefined; }

function safeFile(root: string, path: string): string {
    if (!path || isAbsolute(path) || path.split('/').some(part =>
        !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0')))
        throw new Error('component_sprite_meta_path_invalid');
    const absolute = resolve(root, path);
    if (!absolute.startsWith(`${root}${sep}`)) throw new Error('component_sprite_meta_path_escape');
    let parent = dirname(absolute);
    while (parent !== root) {
        if (present(parent) && (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent))
            throw new Error('component_sprite_meta_path_link');
        parent = dirname(parent);
    }
    if (present(absolute) && (!lstatSync(absolute).isFile() || realpathSync(absolute) !== absolute))
        throw new Error('component_sprite_meta_path_link');
    return absolute;
}

function readRegular(root: string, path: string): Buffer {
    const file = safeFile(root, path);
    if (!present(file)) throw new Error('component_sprite_meta_source_missing');
    return readFileSync(file);
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_sprite_meta_schema_invalid');
    return value as Record<string, unknown>;
}

/**
 * Read only the pinned SDK meta formats and existing target states. No UUID is allocated here.
 */
export class ComponentExistingSpriteMetaPlan {
    public static readonly targets = TARGETS;
    public static readonly parentMetas = PARENTS;

    public static assertTemplateShape(kind: Kind, value: unknown): Record<string, unknown> {
        const meta = record(value);
        if (meta.importer !== FORMAT[kind].importer || meta.ver !== FORMAT[kind].ver
            || meta.imported !== true || typeof meta.uuid !== 'string' || !UUID.test(meta.uuid)
            || !Array.isArray(meta.files) || !meta.subMetas || typeof meta.subMetas !== 'object' || Array.isArray(meta.subMetas)
            || !meta.userData || typeof meta.userData !== 'object' || Array.isArray(meta.userData))
            throw new Error('component_sprite_meta_schema_invalid');
        if (kind === 'image' && (meta.userData as Record<string, unknown>).type !== 'sprite-frame')
            throw new Error('component_sprite_meta_image_type_invalid');
        return meta;
    }

    public static inspectSdk(version: string, engineRoot: string): Record<string, unknown> {
        if (version !== '3.8.3' && version !== '3.8.7') throw new Error('component_sprite_meta_version_invalid');
        const root = realpathSync(engineRoot);
        if (root !== resolve(engineRoot) || basename(root) !== 'engine')
            throw new Error('component_sprite_meta_sdk_root_invalid');
        const pinned = SDK[version];
        const packageBytes = readRegular(root, 'package.json');
        if (sha(packageBytes) !== pinned.packageSha256) throw new Error('component_sprite_meta_sdk_package_sha_mismatch');
        const manifest = record(JSON.parse(packageBytes.toString('utf8')));
        if (manifest.name !== 'cocos-creator' || manifest.version !== version)
            throw new Error('component_sprite_meta_sdk_version_mismatch');
        const templates = (Object.keys(SOURCE) as Kind[]).map(kind => {
            const path = SOURCE[kind]; const bytes = readRegular(root, path);
            const expected = pinned[`${kind}Sha256`];
            if (sha(bytes) !== expected) throw new Error('component_sprite_meta_sdk_template_sha_mismatch');
            const meta = this.assertTemplateShape(kind, JSON.parse(bytes.toString('utf8')));
            return { kind, path, sha256: expected, importer: meta.importer, ver: meta.ver,
                templateUuidMustNotBeReused: true, identity: 'sdk_builtin_only' };
        });
        return { schema: 'peanut.pod.component-existing-sprite-meta-sdk.v1', creatorVersion: version,
            sdkPackageSha256: pinned.packageSha256, templates, executable: false,
            blockers: ['new_asset_uuid_unallocated', 'assetdb_import_and_subresource_readback_unverified'] };
    }

    public static inspectTargets(project: string, version: string): Record<string, unknown> {
        if (version !== '3.8.3' && version !== '3.8.7') throw new Error('component_sprite_meta_version_invalid');
        const root = realpathSync(project);
        if (root !== resolve(project)) throw new Error('component_sprite_meta_project_alias');
        const assets = resolve(root, 'assets');
        if (!present(assets) || !lstatSync(assets).isDirectory() || realpathSync(assets) !== assets)
            throw new Error('component_sprite_meta_assets_root_missing');
        const targets = TARGETS.map(path => {
            const file = safeFile(root, path);
            if (present(file)) throw new Error('component_sprite_meta_target_exists');
            return { path, role: path.endsWith('.meta') ? 'new_asset_meta' : 'new_asset', exists: false };
        });
        const uuids = new Set<string>();
        const parentMetas = PARENTS.map(path => {
            const file = safeFile(root, path);
            if (!present(file)) return { path, role: 'parent_meta', exists: false, sha256: null,
                policy: 'missing_parent_meta_blocks_stage' };
            const bytes = readFileSync(file); const meta = record(JSON.parse(bytes.toString('utf8')));
            if (meta.importer !== 'directory' || meta.ver !== FORMAT.directory.ver
                || typeof meta.uuid !== 'string' || !UUID.test(meta.uuid)
                || typeof meta.imported !== 'boolean' || !Array.isArray(meta.files)
                || !meta.subMetas || typeof meta.subMetas !== 'object' || Array.isArray(meta.subMetas)
                || !meta.userData || typeof meta.userData !== 'object' || Array.isArray(meta.userData))
                throw new Error('component_sprite_meta_existing_parent_invalid');
            if (uuids.has(meta.uuid)) throw new Error('component_sprite_meta_uuid_conflict');
            uuids.add(meta.uuid);
            return { path, role: 'parent_meta', exists: true, sha256: sha(bytes),
                policy: 'preserve_exact_bytes' };
        });
        return { schema: 'peanut.pod.component-existing-sprite-meta-targets.v1', creatorVersion: version,
            projectPath: root, mode: 'read_only', executable: false, targets, parentMetas,
            blockers: ['missing_parent_meta_authoring', 'new_asset_uuid_unallocated',
                'assetdb_import_and_subresource_readback_unverified', 'external_project_lease_required'] };
    }
}
