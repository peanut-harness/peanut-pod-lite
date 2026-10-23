import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { ComponentCatalogAudit } from './component-catalog-audit.mts';
import { ComponentFieldFixtures } from './component-field-fixtures.mts';
import { ComponentSceneFixture } from './component-scene-fixture.mts';
import { ComponentSceneIntegrity } from './component-scene-integrity.mts';

const args = process.argv.slice(2);
const version = args[args.indexOf('--creator-version') + 1];
const resources = args[args.indexOf('--creator-resources-root') + 1];
if (!args.includes('--creator-version') || !['3.8.3', '3.8.7'].includes(version ?? '')
    || !args.includes('--creator-resources-root') || !resources) throw new Error('component_scene_exact_version_and_source_required');
const creatorVersion = version as '3.8.3' | '3.8.7';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('./', import.meta.url));
const auditPath = join(fixtureRoot, creatorVersion, 'component-assembly-audit.json');
const fieldsPath = join(fixtureRoot, creatorVersion, 'component-field-fixtures.json');
const audit = ComponentCatalogAudit.create(root, join(resources, 'resources/3d/engine'), creatorVersion);
ComponentCatalogAudit.validate(JSON.parse(readFileSync(auditPath, 'utf8')), audit);
const fields = ComponentFieldFixtures.create(root, creatorVersion, audit.nativeDeclarations);
if (!isDeepStrictEqual(JSON.parse(readFileSync(fieldsPath, 'utf8')), fields)) throw new Error('component_scene_fields_drift_or_missing_rows');
const runId = args.includes('--run-id') ? args[args.indexOf('--run-id') + 1] : 'scene-assembly';
if (!runId || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(runId)) throw new Error('component_scene_run_id_invalid');
const output = join(root, 'evidence/task-5.1', `${runId}-${creatorVersion}`);
const checking = args.includes('--check');
if (!checking && existsSync(output)) throw new Error('component_scene_output_already_exists');
const digest = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
// _id is a newly authored scene/node identity; all graph links and authored values remain compared.
const semanticDigest = (entries: unknown): string => digest(JSON.stringify(entries, (key, value: unknown) => key === '_id' ? undefined : value));
const inputFiles = [auditPath, fieldsPath, ...['component-scene-command.mts', 'component-scene-fixture.mts',
    'component-scene-integrity.mts', 'component-assembly-requirements.mts', 'component-field-fixtures.mts']
    .map((name) => join(fixtureRoot, name)), join(root, 'packages/engine/modules/lumen/source/hierarchy/prefab-document.ts')];
const inputDigests = inputFiles.map((path) => ({ path: path.slice(root.length), sha256: digest(readFileSync(path)) }));
const rows = fields.components.map((row) => {
    const assembled = ComponentSceneFixture.create(root, creatorVersion, row, audit.nativeDeclarations);
    if (assembled.status === 'blocked') return { componentType: row.componentType, status: assembled.status,
        blockers: assembled.blockers, fieldStates: row.cases.map((field) => ({ id: field.id, status: 'component-precondition-blocked' })) };
    const scenePath = assembled.document.relativePath;
    if (checking) {
        const reopened = LumenPrefabDocument.open(output, scenePath);
        ComponentSceneIntegrity.assert(reopened);
        if (semanticDigest(reopened.entries) !== semanticDigest(assembled.document.entries)) throw new Error(`component_scene_semantic_drift:${row.componentType}`);
    } else assembled.document.save(output, false, LumenCocosVersion.parse(creatorVersion));
    return { componentType: row.componentType, status: assembled.status, blockers: assembled.blockers,
        scenePath, sceneSha256: digest(readFileSync(join(output, scenePath))), targetPath: assembled.targetPath,
        templateSha256: assembled.template.sha256, nodePaths: assembled.nodePaths, fieldStates: assembled.fieldStates };
});
const statusCounts: Record<string, number> = {};
for (const row of rows) for (const field of row.fieldStates) statusCounts[field.status] = (statusCounts[field.status] ?? 0) + 1;
const report = { schemaVersion: 'peanut.component-authored-scenes.v1', creatorVersion,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    inputDigests, componentCount: rows.length, fieldCount: rows.reduce((n, row) => n + row.fieldStates.length, 0),
    assembledComponents: rows.filter((row) => row.status === 'assembled').length,
    blockedComponents: rows.filter((row) => row.status === 'blocked').length, fieldStatusCounts: statusCounts,
    nativePassedRows: 0, task51Complete: false, rows,
    acceptanceBoundary: '实际场景源与公共字段已装配；原生资源导入、后端确认和加载均待实机，不能算原生通过' };
const reportPath = join(output, 'scene-assembly-report.json');
if (report.componentCount !== 99 || report.fieldCount !== 795) throw new Error('component_scene_matrix_incomplete');
if (checking) {
    if (!isDeepStrictEqual(JSON.parse(readFileSync(reportPath, 'utf8')), report)) throw new Error('component_scene_report_drift');
} else {
    mkdirSync(output, { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
process.stdout.write(JSON.stringify({ creatorVersion, checking, assembledComponents: report.assembledComponents,
    blockedComponents: report.blockedComponents, componentCount: report.componentCount, fieldCount: report.fieldCount,
    fieldStatusCounts: statusCounts, nativePassedRows: 0, task51Complete: false, reportPath }) + '\n');
