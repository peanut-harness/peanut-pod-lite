import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentBlitScreenMaterial } from './component-blit-screen-material.mts';
import { ComponentExistingProjectPlan } from './component-existing-project-plan.mts';
import { ComponentResourceBindings } from './component-resource-bindings.mts';

type Version = '3.8.3' | '3.8.7';
type Source = { path: string; sha256: string };
type PlannedFile = { sourcePath: string; sourceSha256: string; destination: string;
    existingSize: number | null; existingSha256: string | null };

/**
 * Map only audited source files to exact old-stage destinations, without invoking a writer.
 */
export class ComponentExistingAssetPlan {
    private static readonly sourcePrefix = 'tests/fixtures/editor-stability/';

    private static safePath(root: string, relativePath: string): string {
        if (!relativePath || relativePath.startsWith('/') || relativePath.split('/').some(part =>
            !part || part === '.' || part === '..' || part.includes('\\'))) throw new Error('component_asset_plan_path_invalid');
        const absolute = resolve(root, relativePath);
        if (!absolute.startsWith(`${root}${sep}`)) throw new Error('component_asset_plan_path_escape');
        let parent = dirname(absolute);
        while (parent !== root) {
            if (dirname(parent) === parent) throw new Error('component_asset_plan_path_escape');
            if (existsSync(parent) && (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent))
                throw new Error('component_asset_plan_link');
            parent = dirname(parent);
        }
        if (existsSync(absolute) && (!lstatSync(absolute).isFile() || realpathSync(absolute) !== absolute))
            throw new Error('component_asset_plan_link');
        return absolute;
    }

    private static hash(path: string): string {
        return createHash('sha256').update(readFileSync(path)).digest('hex');
    }

    private static destination(sourcePath: string, version: Version): string {
        if (!sourcePath.startsWith(this.sourcePrefix)) throw new Error('component_asset_plan_source_out_of_scope');
        if (sourcePath.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\')))
            throw new Error('component_asset_plan_path_invalid');
        if (sourcePath.endsWith(`/${version}/cube-source.hdr.meta`))
            return 'assets/fixtures/media/supplemental/hdr/equirect.hdr.meta';
        return `assets/fixtures/${sourcePath.slice(this.sourcePrefix.length)}`;
    }

    /**
     * Pure planning core. A complete flag is intentionally unavailable until special paths are proven.
     */
    public static fromSources(repository: string, project: string, version: Version,
        sources: readonly Source[], componentTypes: readonly string[]): Record<string, unknown> {
        const root = realpathSync(repository);
        const existing = realpathSync(project);
        const byDestination = new Map<string, PlannedFile>();
        for (const source of sources) {
            const input = this.safePath(root, source.path);
            if (!input.startsWith(`${root}${sep}${this.sourcePrefix}`)
                || !/^[0-9a-f]{64}$/u.test(source.sha256) || this.hash(input) !== source.sha256)
                throw new Error('component_asset_plan_source_mismatch');
            const destination = this.destination(source.path, version);
            const target = this.safePath(existing, destination);
            const prior = byDestination.get(destination);
            if (prior && (prior.sourcePath !== source.path || prior.sourceSha256 !== source.sha256))
                throw new Error('component_asset_plan_destination_conflict');
            byDestination.set(destination, { sourcePath: source.path, sourceSha256: source.sha256, destination,
                existingSize: existsSync(target) ? lstatSync(target).size : null,
                existingSha256: existsSync(target) ? this.hash(target) : null });
        }
        if (componentTypes.length !== 99 || new Set(componentTypes).size !== 99
            || componentTypes.some(type => !/^(?:cc|sp|dragonBones)\.[A-Za-z0-9_.]+$/u.test(type)))
            throw new Error('component_asset_plan_component_denominator_invalid');
        const potentialScenes = componentTypes.flatMap(type => [
            `assets/components/${type}.scene`, `assets/components/_lifecycle/${type}.scene`,
        ]);
        const possibleControls = [
            'extensions/peanut-component-probe/package.json', 'extensions/peanut-component-probe/main.js',
            'extensions/peanut-component-probe/scene.js', 'extensions/peanut-component-probe/public-field-contract.json',
            'extensions/peanut-component-probe/project-url-files.json',
            '.peanut-ai/cocos-mcp-attachments.json', 'peanut-plugins/installed.json',
        ];
        const potentialFiles = [...new Set([...potentialScenes, ...possibleControls])].sort().map(path => {
            const absolute = this.safePath(existing, path);
            return { path, exists: existsSync(absolute), sha256: existsSync(absolute) ? this.hash(absolute) : null };
        });
        const gaps = [
            'component_scene_assembly_and_backend_selection_unresolved',
            'native_generated_parent_and_asset_meta_unresolved',
            'authored_uuid_remap_and_importer_subresources_unresolved',
            'sprite_import_and_project_url_sources_unresolved',
            'skinned_tiled_startup_and_postprocess_context_unresolved',
            'launcher_extension_and_control_write_set_unresolved',
        ];
        return {
            schema: 'peanut.pod.component-existing-asset-plan.v1', creatorVersion: version,
            projectPath: existing, complete: false, executable: false,
            files: [...byDestination.keys()].sort(),
            sourceMappings: [...byDestination.values()].sort((a, b) => a.destination.localeCompare(b.destination)),
            potentialFiles, gaps,
            denominator: { curatedComponents: 99, fieldsPerVersion: 795 },
        };
    }

    /**
     * Read only actual fixture sources and the two exact registered existing projects.
     */
    public static inspect(repository: string, version: string, actor: string): Record<string, unknown> {
        if (version !== '3.8.3' && version !== '3.8.7') throw new Error('component_asset_plan_version_invalid');
        const root = realpathSync(repository);
        const projectPlan = ComponentExistingProjectPlan.inspect(root, version, actor);
        const project = projectPlan.projectPath;
        if (typeof project !== 'string') throw new Error('component_asset_plan_project_invalid');
        const bindings = ComponentResourceBindings.create(root, version);
        const sourceMap = new Map<string, string>();
        for (const binding of Object.values(bindings)) for (const source of binding.sources) {
            const prior = sourceMap.get(source.path);
            if (prior && prior !== source.sha256) throw new Error('component_asset_plan_source_conflict');
            sourceMap.set(source.path, source.sha256);
        }
        for (const source of ComponentBlitScreenMaterial.binding(root, version)?.sources ?? []) {
            const prior = sourceMap.get(source.path);
            if (prior && prior !== source.sha256) throw new Error('component_asset_plan_source_conflict');
            sourceMap.set(source.path, source.sha256);
        }
        const audit = JSON.parse(readFileSync(join(root,
            `tests/fixtures/editor-stability/components/${version}/component-assembly-audit.json`), 'utf8'));
        if (audit.creatorVersion !== version || audit.curatedComponentCount !== 99 || audit.fieldCount !== 795
            || !Array.isArray(audit.rows)) throw new Error('component_asset_plan_audit_invalid');
        const componentTypes = audit.rows.map((row: { componentType: string }) => row.componentType);
        return this.fromSources(root, project, version,
            [...sourceMap].map(([path, sha256]) => ({ path, sha256 })), componentTypes);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
    const position = process.argv.indexOf('--creator-version');
    if (position < 0 || position !== process.argv.length - 2) throw new Error('component_asset_plan_arguments_invalid');
    process.stdout.write(JSON.stringify(ComponentExistingAssetPlan.inspect(root, process.argv[position + 1] ?? '',
        process.env.CODEX_THREAD_ID ?? ''), null, 2) + '\n');
}
