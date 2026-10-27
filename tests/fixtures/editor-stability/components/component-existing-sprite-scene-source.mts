import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { ComponentSceneFixture } from './component-scene-fixture.mts';
import { ComponentSceneIntegrity } from './component-scene-integrity.mts';

type Version = '3.8.3' | '3.8.7';
const INPUTS = Object.freeze({
    '3.8.3': {
        audit: '797f28aa577e1f481824b97137534a23c0627d36015d1931579f423c076d913d',
        fields: 'f79df4822dc9f265cc0b58034903afffa111e36c79d97ea7658304e8e43049f2',
        template: 'a5d385092ccca8fcf16377e4901a3e80d2128e2f0821c9f43c0b3b80509a4c53',
    },
    '3.8.7': {
        audit: '8ce5c9214cc72fc9db8c3ae5456ed0f61e6a69595363b2b88555e701c30ac27f',
        fields: 'e3e99cce744276a6ce0462e54df5e2a5c16b0b3d63ff6d5d7bf2a3576dbf8257',
        template: '2971097b9b2b6331ee2d0cdcbbf55e0930104870280eb60c23cdcb3f4eec78e9',
    },
});
const TYPES = ['cc.Sprite', 'cc.UIOpacity'] as const;
const PARENT_METAS = ['assets/components.meta', 'assets/fixtures.meta', 'assets/fixtures/media.meta',
    'assets/fixtures/media/assets.meta', 'assets/fixtures/media/assets/image.meta'] as const;

function sha(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function present(path: string): boolean { return lstatSync(path, { throwIfNoEntry: false }) !== undefined; }

function fixedFile(root: string, path: string): string {
    if (!path || isAbsolute(path) || path.split('/').some(part =>
        !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0')))
        throw new Error('component_sprite_scene_path_invalid');
    const absolute = resolve(root, path);
    if (!absolute.startsWith(`${root}${sep}`)) throw new Error('component_sprite_scene_path_escape');
    let parent = dirname(absolute);
    while (parent !== root) {
        if (present(parent) && (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent))
            throw new Error('component_sprite_scene_path_link');
        parent = dirname(parent);
    }
    if (present(absolute) && (!lstatSync(absolute).isFile() || realpathSync(absolute) !== absolute))
        throw new Error('component_sprite_scene_path_link');
    return absolute;
}

function pinnedJson(root: string, path: string, expected: string): Record<string, any> {
    const file = fixedFile(root, path);
    if (!present(file)) throw new Error('component_sprite_scene_input_missing');
    const bytes = readFileSync(file);
    if (sha(bytes) !== expected) throw new Error('component_sprite_scene_input_sha_mismatch');
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_sprite_scene_input_invalid');
    return value;
}

/**
 * Author only offline serialized scene candidates from pinned, same-version inputs.
 */
export class ComponentExistingSpriteSceneSource {
    public static readonly parentMetas = PARENT_METAS;

    public static author(repository: string, version: string): Record<string, unknown> {
        if (version !== '3.8.3' && version !== '3.8.7') throw new Error('component_sprite_scene_version_invalid');
        const root = realpathSync(repository);
        if (root !== resolve(repository)) throw new Error('component_sprite_scene_repository_alias');
        const pinned = INPUTS[version];
        const prefix = `tests/fixtures/editor-stability/components/${version}`;
        const audit = pinnedJson(root, `${prefix}/component-assembly-audit.json`, pinned.audit);
        const fixtures = pinnedJson(root, `${prefix}/component-field-fixtures.json`, pinned.fields);
        if (audit.creatorVersion !== version || fixtures.creatorVersion !== version
            || audit.curatedComponentCount !== 99 || audit.fieldCount !== 795
            || fixtures.componentCount !== 99 || fixtures.fieldCount !== 795
            || !Array.isArray(audit.nativeDeclarations) || !Array.isArray(fixtures.components))
            throw new Error('component_sprite_scene_catalog_invalid');
        const historical = TYPES.map(type => {
            const path = `evidence/task-5.1/checkpoint-510400c-${version}/assets/components/${type}.scene`;
            const file = fixedFile(root, path);
            const found = present(file);
            return { path, found, sha256: found ? sha(readFileSync(file)) : null,
                provenanceVerified: false };
        });
        const scenes = TYPES.map(type => {
            const rows = fixtures.components.filter((row: { componentType: string }) => row.componentType === type);
            if (rows.length !== 1 || !Array.isArray(rows[0]?.cases)
                || rows[0].cases.length !== (type === 'cc.Sprite' ? 12 : 1))
                throw new Error('component_sprite_scene_fields_unknown_or_missing');
            const built = ComponentSceneFixture.create(root, version, rows[0], audit.nativeDeclarations, false);
            if (built.status !== 'assembled' || built.nativePassed !== false || built.resourceFieldsBound !== false)
                throw new Error('component_sprite_scene_dependency_unresolved');
            const path = `assets/components/${type}.scene`;
            const targetPath = type === 'cc.Sprite' ? '/Root/Canvas/Target' : '/Root/Target';
            if (built.document.relativePath !== path || built.document.assetKind !== 'scene'
                || built.targetPath !== targetPath || built.template.sha256 !== pinned.template)
                throw new Error('component_sprite_scene_authoring_mismatch');
            const target = built.document.findNodeIndex(targetPath);
            for (const dependency of rows[0].dependencyPlan.attachOrder)
                built.document.findComponentIndex(target, dependency);
            ComponentSceneIntegrity.assert(built.document);
            const bytes = Buffer.from(JSON.stringify(built.document.entries, null, 2) + '\n');
            return { path, targetPath, componentType: type, dependencyOrder: rows[0].dependencyPlan.attachOrder,
                fieldCount: rows[0].cases.length, sourceSha256: sha(bytes), bytes,
                metaStatus: 'not_authored', assetDbUuid: null, nativeAccepted: false };
        });
        return { schema: 'peanut.pod.component-existing-sprite-scene-source.v1', creatorVersion: version,
            mode: 'offline_authored_candidate', executable: false, historical,
            inputs: { auditSha256: pinned.audit, fieldSha256: pinned.fields, templateSha256: pinned.template },
            scenes, parentMetas: PARENT_METAS,
            blockers: ['scene_meta_authoring_unverified', 'parent_meta_ownership_unverified',
                'assetdb_import_and_uuid_unverified', 'native_readback_unverified'] };
    }

    /**
     * Read exact scene, sidecar and ancestor meta states without creating any file.
     */
    public static inspectTargets(project: string, version: string): Record<string, unknown> {
        if (version !== '3.8.3' && version !== '3.8.7') throw new Error('component_sprite_scene_version_invalid');
        const root = realpathSync(project);
        if (root !== resolve(project)) throw new Error('component_sprite_scene_project_alias');
        const scenePaths = TYPES.flatMap(type => [`assets/components/${type}.scene`, `assets/components/${type}.scene.meta`]);
        const targets = scenePaths.map(path => {
            const file = fixedFile(root, path);
            if (present(file)) throw new Error('component_sprite_scene_target_exists');
            return { path, exists: false };
        });
        const parents = PARENT_METAS.map(path => {
            const file = fixedFile(root, path);
            const exists = present(file);
            return { path, exists, sha256: exists ? sha(readFileSync(file)) : null,
                policy: exists ? 'preserve_exact_bytes' : 'authoring_required_before_stage' };
        });
        return { creatorVersion: version, projectPath: root, mode: 'read_only', executable: false,
            targets, parentMetas: parents,
            blockers: ['fresh_backup_required', 'parent_meta_ownership_unverified', 'external_project_lease_required'] };
    }
}
