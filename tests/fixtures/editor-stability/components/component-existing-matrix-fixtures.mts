import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentTaskOwnership } from './component-task-ownership.mts';
import { ComponentResourceBindings } from './component-resource-bindings.mts';
import { ComponentBlitScreenMaterial } from './component-blit-screen-material.mts';
import { ComponentCatalogAudit } from './component-catalog-audit.mts';
import { ComponentFieldFixtures } from './component-field-fixtures.mts';
import { ComponentPresentationFixture } from './component-presentation-fixture.mts';
import { LumenMetaImporterVersions } from '../../../../packages/engine/modules/lumen/source/schema/meta-importer-versions.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';

type Version = '3.8.3' | '3.8.7';
type PlannedFile = { source: string; destination: string; sha256: string; bytes: Buffer };
const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const workspace = resolve(root, '../../..');
const runId = 'full51-existing-20261027';
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function safeTarget(project: string, relative: string): string {
    if (!relative || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\')))
        throw new Error('component_existing_matrix_path_invalid');
    const target = resolve(project, relative);
    if (!target.startsWith(project + sep)) throw new Error('component_existing_matrix_path_escape');
    for (let parent = dirname(target); parent !== project; parent = dirname(parent)) {
        if (existsSync(parent) && (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent))
            throw new Error('component_existing_matrix_parent_link');
    }
    if (existsSync(target)) throw new Error(`component_existing_matrix_target_exists:${relative}`);
    return target;
}

function checkedSource(path: string): Buffer {
    const full = resolve(root, path);
    if (!full.startsWith(root + sep) || !lstatSync(full).isFile() || realpathSync(full) !== full)
        throw new Error('component_existing_matrix_source_invalid');
    return readFileSync(full);
}

export class ComponentExistingMatrixFixtures {
    public static prepare(version: Version, actor = process.env.CODEX_THREAD_ID ?? '') {
        if (version !== '3.8.3' && version !== '3.8.7') throw new Error('component_existing_matrix_version_invalid');
        const owner = ComponentTaskOwnership.current(root, actor);
        const project = join(workspace, `.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-${version}`);
        if (!existsSync(project) || realpathSync(project) !== project) throw new Error('component_existing_matrix_project_missing');
        const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
        const installed = JSON.parse(readFileSync(join(project, 'peanut-plugins/installed.json'), 'utf8'));
        const host = JSON.parse(readFileSync(join(project, 'extensions/peanut-pod-lite-host/package.json'), 'utf8'));
        const hostStatus = JSON.parse(readFileSync(join(project, 'peanut-plugins/runtime/host-status.json'), 'utf8'));
        const core = JSON.parse(readFileSync(join(project, 'peanut-plugins/plugins/peanut.pod-lite/0.2.1/peanut.pod-lite.manifest.json'), 'utf8'));
        const descriptor = JSON.parse(readFileSync(join(root, 'release/peanut.pod-lite-0.2.1/lite-release-descriptor.json'), 'utf8'));
        const active = installed.plugins?.filter((plugin: { pluginId: string }) => plugin.pluginId === 'peanut.pod-lite');
        if (manifest.creator?.version !== version || host.version !== '0.2.1' || active?.length !== 1
            || active[0].activeVersion !== '0.2.1' || descriptor.version !== '0.2.1'
            || core.package?.digest !== descriptor.core.packageDigest || hostStatus.ready !== true
            || hostStatus.artifacts?.host?.packageDigest !== descriptor.host.packageDigest
            || hostStatus.artifacts?.core?.packageDigest !== descriptor.core.packageDigest)
            throw new Error('component_existing_matrix_candidate_mismatch');
        const reportPath = join(root, 'evidence/task-5.1', `${runId}-${version}`, 'scene-assembly-report.json');
        const report = JSON.parse(readFileSync(reportPath, 'utf8'));
        if (report.creatorVersion !== version || report.componentCount !== 99 || report.fieldCount !== 795
            || report.rows?.length !== 99 || report.nativePassedRows !== 0)
            throw new Error('component_existing_matrix_report_invalid');
        const sourceMap = new Map<string, string>();
        for (const binding of Object.values(ComponentResourceBindings.create(root, version)))
            for (const source of (binding as { sources: { path: string; sha256: string }[] }).sources) {
                if (sourceMap.has(source.path) && sourceMap.get(source.path) !== source.sha256)
                    throw new Error('component_existing_matrix_source_conflict');
                sourceMap.set(source.path, source.sha256);
            }
        for (const source of ComponentBlitScreenMaterial.binding(root, version)?.sources ?? []) {
            if (sourceMap.has(source.path) && sourceMap.get(source.path) !== source.sha256)
                throw new Error('component_existing_matrix_source_conflict');
            sourceMap.set(source.path, source.sha256);
        }
        const ids = new Map<string, string>();
        const collect = (value: unknown): void => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) { value.forEach(collect); return; }
            for (const [key, item] of Object.entries(value)) {
                if (key === 'uuid' && typeof item === 'string') {
                    const base = item.split('@')[0];
                    if (base && !ids.has(base)) {
                        const hex = createHash('sha256').update(`peanut-51:${runId}:${version}:${base}`).digest('hex').slice(0, 32);
                        ids.set(base, `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
                    }
                }
                collect(item);
            }
        };
        for (const source of sourceMap.keys()) if (source.endsWith('.meta')) collect(JSON.parse(checkedSource(source).toString('utf8')));
        const remap = (value: unknown): unknown => {
            if (typeof value === 'string') {
                const base = value.split('@')[0]; const replacement = base ? ids.get(base) : undefined;
                return replacement ? replacement + value.slice(base.length) : value;
            }
            if (Array.isArray(value)) return value.map(remap);
            if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
            return value;
        };
        const files: PlannedFile[] = [];
        for (const [source, expected] of sourceMap) {
            const bytes = checkedSource(source);
            if (digest(bytes) !== expected) throw new Error('component_existing_matrix_source_hash_changed');
            const destination = source.endsWith(`/${version}/cube-source.hdr.meta`)
                ? 'assets/fixtures/media/supplemental/hdr/equirect.hdr.meta'
                : `assets/fixtures/${source.slice('tests/fixtures/editor-stability/'.length)}`;
            const authored = source.endsWith('.meta') || source.includes('/serialized/') && /\.(?:mtl|pmtl|anim|animgraph|prefab|scene)$/u.test(source)
                ? Buffer.from(JSON.stringify(remap(JSON.parse(bytes.toString('utf8'))), null, 2) + '\n') : bytes;
            files.push({ source, destination, sha256: digest(authored), bytes: authored });
        }
        const engine = `/Applications/Cocos/Creator/${version}/CocosCreator.app/Contents/Resources/resources/3d/engine`;
        const audit = ComponentCatalogAudit.create(root, engine, version);
        const fields = ComponentFieldFixtures.create(root, version, audit.nativeDeclarations);
        if (fields.componentCount !== 99 || fields.fieldCount !== 795) throw new Error('component_existing_matrix_field_denominator_invalid');
        const stagedRows = [];
        for (const row of report.rows as { status: string; componentType: string; scenePath?: string; sceneSha256?: string; blockers?: string[] }[]) {
            const field = fields.components.find(item => item.componentType === row.componentType);
            if (!field) throw new Error('component_existing_matrix_field_row_missing');
            if (row.status === 'blocked') { stagedRows.push({ componentType: row.componentType, status: 'blocked', blockers: row.blockers }); continue; }
            if (row.status !== 'assembled' || row.scenePath !== `assets/components/${row.componentType}.scene`)
                throw new Error('component_existing_matrix_scene_row_invalid');
            const source = join('evidence/task-5.1', `${runId}-${version}`, row.scenePath);
            const bytes = checkedSource(source);
            if (digest(bytes) !== row.sceneSha256) throw new Error('component_existing_matrix_scene_hash_changed');
            const lifecycle = `assets/components/_lifecycle/${row.componentType}.scene`;
            const authored = Buffer.from(JSON.stringify(remap(JSON.parse(bytes.toString('utf8'))), null, 2) + '\n');
            files.push({ source, destination: lifecycle, sha256: digest(authored), bytes: authored });
            const presentation = ComponentPresentationFixture.create(engine, version, field);
            if (presentation.status === 'authored-presentation-native-pending') {
                const document = presentation.document;
                const entries = structuredClone([...document.entries]);
                const scene = entries.find(entry => entry.__type__ === 'cc.Scene');
                const sceneAsset = entries[0];
                if (!scene || sceneAsset?.__type__ !== 'cc.SceneAsset') throw new Error('component_existing_matrix_presentation_invalid');
                const sceneUuid = randomUUID();
                scene._id = sceneUuid; sceneAsset._name = row.componentType;
                const presentationBytes = Buffer.from(JSON.stringify(entries, null, 2) + '\n');
                const presentationPath = `assets/components/${row.componentType}.scene`;
                files.push({ source: 'generated:sdk-presentation', destination: presentationPath,
                    sha256: digest(presentationBytes), bytes: presentationBytes });
                const meta = Buffer.from(JSON.stringify({ ver: LumenMetaImporterVersions.shared().resolve(LumenCocosVersion.parse(version), 'scene'),
                    importer: 'scene', imported: false,
                    uuid: sceneUuid, files: [], subMetas: {}, userData: {} }, null, 2) + '\n');
                files.push({ source: 'generated:sdk-presentation-meta', destination: presentationPath + '.meta',
                    sha256: digest(meta), bytes: meta });
            }
            stagedRows.push({ componentType: row.componentType, status: 'assembled', scenePath: lifecycle,
                presentation: presentation.status, fieldCount: field.cases.length });
        }
        if (new Set(files.map(item => item.destination)).size !== files.length)
            throw new Error('component_existing_matrix_target_collision');
        for (const item of files) safeTarget(project, item.destination);
        if (stagedRows.length !== 99 || stagedRows.reduce((sum, row) => sum +
            (fields.components.find(item => item.componentType === row.componentType)?.cases.length ?? 0), 0) !== 795)
            throw new Error('component_existing_matrix_staged_denominator_invalid');
        return { owner, project, version, descriptor, report, files, stagedRows };
    }

    public static stage(version: Version, actor = process.env.CODEX_THREAD_ID ?? ''): Record<string, unknown> {
        const prepared = this.prepare(version, actor);
        const processes = execFileSync('/bin/ps', ['-axo', 'args=', '-ww'], { encoding: 'utf8' });
        if (processes.split('\n').some(line => line.includes(`--project ${prepared.project}`)))
            throw new Error('component_existing_matrix_project_occupied');
        const output = join(root, 'evidence/task-5.1', `${runId}-${version}`, 'existing-project-stage');
        if (existsSync(output)) throw new Error('component_existing_matrix_stage_already_exists');
        mkdirSync(output, { recursive: true });
        const receipt = { schema: 'peanut.component-existing-matrix-fixtures.v1', creatorVersion: version,
            projectPath: prepared.project, owner: prepared.owner, candidateVersion: '0.2.1',
            hostPackageDigest: prepared.descriptor.host.packageDigest,
            corePackageDigest: prepared.descriptor.core.packageDigest,
            componentCount: 99, fieldCount: 795, assembledScenes: prepared.report.assembledComponents,
            blockedComponents: prepared.report.blockedComponents, nativePassedRows: 0,
            files: prepared.files.map(({ source, destination, sha256 }) => ({ source, destination, sha256 })) };
        writeFileSync(join(output, 'manifest.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
        for (const item of prepared.files) {
            const target = safeTarget(prepared.project, item.destination);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, item.bytes, { flag: 'wx' });
        }
        writeFileSync(join(output, 'stage-complete.json'), JSON.stringify({ fileCount: prepared.files.length,
            nativePassedRows: 0, at: new Date().toISOString() }) + '\n', { flag: 'wx' });
        return { project: prepared.project, output, fileCount: prepared.files.length,
            assembledScenes: prepared.report.assembledComponents, blockedComponents: prepared.report.blockedComponents };
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [mode, version] = process.argv.slice(2);
    if (!['plan', 'stage'].includes(mode ?? '') || !['3.8.3', '3.8.7'].includes(version ?? '') || process.argv.length !== 4)
        throw new Error('component_existing_matrix_arguments_invalid');
    const result = mode === 'stage' ? ComponentExistingMatrixFixtures.stage(version as Version)
        : ComponentExistingMatrixFixtures.prepare(version as Version);
    process.stdout.write(JSON.stringify(mode === 'stage' ? result : { project: result.project, version,
        fileCount: result.files.length, assembledScenes: result.report.assembledComponents,
        blockedComponents: result.report.blockedComponents, candidateVersion: '0.2.1' }) + '\n');
}
