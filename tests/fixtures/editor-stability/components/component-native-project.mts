import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';
import { PackagingApp } from '../../../../packages/engine/modules/installation/src/app/packaging-app.ts';
import { ComponentResourceBindings } from './component-resource-bindings.mts';
import { verifyReleaseCandidate } from '../../../../tools/release-candidate.mts';
import { ComponentCatalogAudit } from './component-catalog-audit.mts';
import { ComponentFieldFixtures } from './component-field-fixtures.mts';
import { ComponentSceneFixture } from './component-scene-fixture.mts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { ComponentNativeFieldContract } from './component-native-field-contract.mts';
import { ComponentLifecycleFixture } from './component-lifecycle-fixture.mts';
import { ComponentPresentationFixture } from './component-presentation-fixture.mts';
import { ComponentEngineProfile } from './component-engine-profile.mts';
import { ComponentEngineModules } from './component-engine-modules.mts';
import { ComponentSpriteImport } from './component-sprite-import.mts';
import { ComponentTerrainEffect } from './component-terrain-effect.mts';
import { ComponentProjectUrlFiles } from './component-project-url-files.ts';
import { ComponentTaskOwnership } from './component-task-ownership.mts';

const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const args = process.argv.slice(2);
const version = args[args.indexOf('--creator-version') + 1];
const app = args[args.indexOf('--creator-app') + 1];
const runId = args[args.indexOf('--run-id') + 1];
const owner = ComponentTaskOwnership.current(root);
const fixtureProfile = args.includes('--component-matrix') ? 'component-matrix'
    : args.includes('--sprite-roundtrip') ? 'sprite-roundtrip' : 'resource-import';
if (!['3.8.3', '3.8.7'].includes(version ?? '') || !app || !runId || !/^[a-z0-9][a-z0-9-]{1,63}$/u.test(runId)) throw new Error('component_native_project_arguments_invalid');
if (version !== '3.8.3' && version !== '3.8.7') throw new Error('component_native_version_unsupported');
const resources = join(realpathSync(app), 'Contents/Resources');
const engine = join(resources, 'resources/3d/engine');
if (JSON.parse(readFileSync(join(engine, 'package.json'), 'utf8')).version !== version) throw new Error('component_native_sdk_version_mismatch');
ComponentTerrainEffect.assertSdk(root, engine, version);
const descriptor = verifyReleaseCandidate(join(root, 'release/peanut.pod-lite-0.2.0'), {
    expectedVersion: '0.2.0', expectedSourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
});
const output = join(root, 'evidence/task-5.1', runId); const project = join(output, 'project');
if (existsSync(output)) throw new Error('component_native_project_must_be_new');
mkdirSync(project, { recursive: true });
const source = fileURLToPath(new URL('./component-creator-session.mts', import.meta.url));
const command = `node --import tsx '${source}' --phase `;
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: `peanut-component-native-${version.replaceAll('.', '')}`, uuid: randomUUID(),
    creator: { version }, scripts: { precreator: command + 'preflight', creator: command + 'launch', postcreator: command + 'post' } }, null, 2) + '\n');
cpSync(join(resources, 'templates/empty-quality/settings'), join(project, 'settings'), { recursive: true });
copyFileSync(join(resources, 'templates/empty-quality/tsconfig.json'), join(project, 'tsconfig.json'));
ComponentEngineProfile.configure(project, version);
if (fixtureProfile === 'component-matrix') ComponentEngineModules.stage(project, engine, version);
mkdirSync(join(project, 'node_modules'), { recursive: true });
cpSync(join(engine, 'node_modules/tslib'), join(project, 'node_modules/tslib'), { recursive: true });
const registration = { kind: 'worktree-local-validation-project', task: '5.1',
    owner, change: 'stabilize-editor-operations-and-bulk-file-io',
    projectPath: project, worktree: root, creatorVersion: version, creatorApp: realpathSync(app), runId,
    candidateSourceCommit: descriptor.sourceCommit, hostSha256: descriptor.host.sha256, coreSha256: descriptor.core.sha256,
    registeredAt: new Date().toISOString(), userAuthorization: '推进5.1真实导入、后端确认和原生加载验证；按Hub操作Cocos，只关闭自己实例' };
writeFileSync(join(output, 'project-ownership.json'), JSON.stringify(registration, null, 2) + '\n');
cpSync(join(root, 'packages/hosts/modules/creator-38/release/peanut-pod-lite-host-0.2.0'), join(project, 'extensions/peanut-pod-lite-host'), { recursive: true });
const installed = await new PackagingApp({ projectPath: project }).install(join(root, 'packages/engine/modules/creator-plugin/release/peanut.pod-lite-0.2.0'));
writeFileSync(join(output, 'core-install-receipt.json'), JSON.stringify(installed, null, 2) + '\n');
const probe = join(project, 'extensions/peanut-component-probe'); mkdirSync(probe, { recursive: true });
writeFileSync(join(probe, 'package.json'), JSON.stringify({ package_version: 2, name: 'peanut-component-probe', version: '0.1.0',
    main: './main.js', contributions: { scene: { script: './scene.js' } } }, null, 2) + '\n');
for (const [input, destination] of [['component-native-main.ts', 'main.js'], ['component-native-scene.ts', 'scene.js']] as const) {
    buildSync({ entryPoints: [fileURLToPath(new URL(input, import.meta.url))], outfile: join(probe, destination),
        bundle: true, platform: 'node', format: 'cjs', target: 'node14', external: ['cc'] });
}
const allBindings = ComponentResourceBindings.create(root, version);
const bindings = fixtureProfile === 'sprite-roundtrip' ? Object.fromEntries(Object.entries(allBindings).filter(([type]) =>
    type === 'cc.SpriteFrame' || type === 'cc.Texture2D')) : fixtureProfile === 'component-matrix' && version === '3.8.3'
    ? Object.fromEntries(Object.entries(allBindings).filter(([type]) => type !== 'cc.TextureCube')) : allBindings;
const sources = new Map(Object.values(bindings).flatMap((binding) => binding.sources).map((item) => [item.path, item]));
const ids = new Map<string, string>();
const collect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(collect); return; }
    for (const [key, item] of Object.entries(value)) {
        if (key === 'uuid' && typeof item === 'string') {
            const base = item.split('@')[0]; if (base && !ids.has(base)) ids.set(base, randomUUID());
        }
        collect(item);
    }
};
for (const source of sources.values()) if (source.path.endsWith('.meta')) collect(JSON.parse(readFileSync(join(root, source.path), 'utf8')));
const remap = (value: unknown): unknown => {
    if (typeof value === 'string') {
        const base = value.split('@')[0]; const replacement = base ? ids.get(base) : undefined;
        return replacement && base ? replacement + value.slice(base.length) : value;
    }
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
    return value;
};
const staged = [];
for (const source of sources.values()) {
    const cubeMeta = source.path.endsWith(`/${version}/cube-source.hdr.meta`);
    const relativePath = cubeMeta ? 'assets/fixtures/media/supplemental/hdr/equirect.hdr.meta'
        : `assets/fixtures/${source.path.replace('tests/fixtures/editor-stability/', '')}`;
    const absolute = join(project, relativePath); mkdirSync(dirname(absolute), { recursive: true });
    const bytes = readFileSync(join(root, source.path));
    if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error('component_native_source_hash_mismatch');
    let authored: Buffer = bytes;
    if (source.path.endsWith('.meta') || source.path.includes('/serialized/') && /\.(?:mtl|pmtl|anim|animgraph|prefab|scene)$/u.test(source.path)) {
        authored = Buffer.from(JSON.stringify(remap(JSON.parse(bytes.toString('utf8'))), null, 2) + '\n');
    }
    const derivation = cubeMeta ? '将已冻结的版本精确 cube-source.hdr.meta 配对到 HDR 副本旁；保留 texture cube 导入配置，只重映射身份' : null;
    writeFileSync(absolute, authored, { flag: 'wx' });
    staged.push({ source, relativePath, sha256: createHash('sha256').update(authored).digest('hex'), originalUnchanged: true, derivation });
}
const importMetaAuthoring = ComponentSpriteImport.stage(project, engine);
ComponentProjectUrlFiles.stage(root, project, registration);
const sceneSource = join(root, `evidence/task-5.1/checkpoint-510400c-${version}/assets/components/cc.Sprite.scene`);
mkdirSync(join(project, 'assets/components'), { recursive: true }); copyFileSync(sceneSource, join(project, 'assets/components/cc.Sprite.scene'));
const controlSource = join(root, `evidence/task-5.1/checkpoint-510400c-${version}/assets/components/cc.UIOpacity.scene`);
copyFileSync(controlSource, join(project, 'assets/components/cc.UIOpacity.scene'));
let matrixStaging: unknown = null;
if (fixtureProfile === 'component-matrix') {
    const audit = ComponentCatalogAudit.create(root, engine, version);
    ComponentCatalogAudit.validate(JSON.parse(readFileSync(join(root, `tests/fixtures/editor-stability/components/${version}/component-assembly-audit.json`), 'utf8')), audit);
    const fields = ComponentFieldFixtures.create(root, version, audit.nativeDeclarations);
    const rows = fields.components.map((row) => {
        const assembled = ComponentSceneFixture.create(root, version, row, audit.nativeDeclarations, true);
        if (assembled.status === 'blocked') return { componentType: row.componentType, status: 'blocked', blockers: assembled.blockers };
        const lifecycle = ComponentLifecycleFixture.create(assembled.document, version, row.componentType);
        lifecycle.save(project, false, LumenCocosVersion.parse(version));
        const presentation = ComponentPresentationFixture.create(engine, version, row);
        if (presentation.status === 'authored-presentation-native-pending') ComponentPresentationFixture.saveForNativeImport(presentation.document, project, version);
        const { document: presentationDocument, ...presentationEvidence } = presentation.status === 'authored-presentation-native-pending'
            ? presentation : { ...presentation, document: null };
        return { componentType: row.componentType, status: assembled.status, pendingRequirements: assembled.pendingRequirements,
            targetPath: assembled.targetPath, nodePaths: assembled.nodePaths, scenePath: lifecycle.relativePath,
            stagedSha256: createHash('sha256').update(readFileSync(join(project, lifecycle.relativePath))).digest('hex'),
            presentation: { ...presentationEvidence, scenePath: presentationDocument?.relativePath ?? null,
                stagedSha256: presentationDocument ? createHash('sha256').update(readFileSync(join(project, presentationDocument.relativePath))).digest('hex') : null },
            fieldStates: assembled.fieldStates };
    });
    matrixStaging = { creatorVersion: version, componentCount: fields.componentCount, fieldCount: fields.fieldCount, rows, nativePassedRows: 0 };
    writeFileSync(join(output, 'component-matrix-staging.json'), JSON.stringify(matrixStaging, null, 2) + '\n', { flag: 'wx' });
    const contract = ComponentNativeFieldContract.create(root, engine, fields, audit.nativeDeclarations);
    writeFileSync(join(probe, 'public-field-contract.json'), JSON.stringify(contract) + '\n', { flag: 'wx' });
}
writeFileSync(join(output, 'staging-receipt.json'), JSON.stringify({ creatorVersion: version, candidateSourceCommit: descriptor.sourceCommit,
    fixtureProfile, matrixStaging, fullResourceTypeCount: Object.keys(allBindings).length,
    hierarchySources: [sceneSource, controlSource].map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })),
    bindings, staged, importMetaAuthoring, authoringUuidRemaps: Object.fromEntries(ids), nativeRegistrationVerified: false,
    scope: '源与meta只在本新隔离副本重映射；UUID必须从真实AssetDB重新取得' }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ output, project, creatorVersion: version, sourceFiles: staged.length, installed, nativePassedRows: 0 }) + '\n');
