import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { buildSync } from 'esbuild';
import { PackagingApp } from '../../../../packages/engine/modules/installation/src/app/packaging-app.ts';
import { ComponentResourceBindings } from './component-resource-bindings.mts';
import { verifyReleaseCandidate } from '../../../../tools/release-candidate.mts';

const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const args = process.argv.slice(2);
const version = args[args.indexOf('--creator-version') + 1];
const app = args[args.indexOf('--creator-app') + 1];
const runId = args[args.indexOf('--run-id') + 1];
if (!['3.8.3', '3.8.7'].includes(version ?? '') || !app || !runId || !/^[a-z0-9][a-z0-9-]{1,63}$/u.test(runId)) throw new Error('component_native_project_arguments_invalid');
if (version !== '3.8.3' && version !== '3.8.7') throw new Error('component_native_version_unsupported');
const resources = join(realpathSync(app), 'Contents/Resources');
const engine = join(resources, 'resources/3d/engine');
if (JSON.parse(readFileSync(join(engine, 'package.json'), 'utf8')).version !== version) throw new Error('component_native_sdk_version_mismatch');
const descriptor = verifyReleaseCandidate(join(root, 'release/peanut.pod-lite-0.2.0'), {
    expectedVersion: '0.2.0', expectedSourceCommit: '510400c94a9cab9c12de24526bd0e97ecd38d60a',
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
mkdirSync(join(project, 'node_modules'), { recursive: true });
cpSync(join(engine, 'node_modules/tslib'), join(project, 'node_modules/tslib'), { recursive: true });
const registration = { kind: 'worktree-local-validation-project', task: '5.1',
    owner: '01a13478-7931-7e82-86a4-f4f2fcd47bb1', change: 'stabilize-editor-operations-and-bulk-file-io',
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
const bindings = ComponentResourceBindings.create(root, version);
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
const imageMetaSource = join(engine, 'editor/assets/default_ui/default_sprite.png.meta');
const imageMetaBytes = readFileSync(imageMetaSource);
const imageMeta = JSON.parse(imageMetaBytes.toString('utf8'));
if (imageMeta.importer !== 'image' || imageMeta.userData.type !== 'sprite-frame') throw new Error('component_native_image_import_template_invalid');
const importMeta = { ver: imageMeta.ver, importer: imageMeta.importer, imported: false, uuid: randomUUID(),
    files: [], subMetas: {}, userData: { type: imageMeta.userData.type } };
const importMetaPath = 'assets/fixtures/media/assets/image/checker.png.meta';
const importMetaBytes = Buffer.from(JSON.stringify(importMeta, null, 2) + '\n');
writeFileSync(join(project, importMetaPath), importMetaBytes, { flag: 'wx' });
const importMetaAuthoring = { source: imageMetaSource, sourceSha256: createHash('sha256').update(imageMetaBytes).digest('hex'),
    relativePath: importMetaPath, sha256: createHash('sha256').update(importMetaBytes).digest('hex'),
    derivation: '从精确 SDK image 元数据获取版本和 sprite-frame 导入选项；子资源完全交由实际 importer 生成，不复制内置图片尺寸或身份' };
const sceneSource = join(root, `evidence/task-5.1/checkpoint-510400c-${version}/assets/components/cc.Sprite.scene`);
mkdirSync(join(project, 'assets/components'), { recursive: true }); copyFileSync(sceneSource, join(project, 'assets/components/cc.Sprite.scene'));
writeFileSync(join(output, 'staging-receipt.json'), JSON.stringify({ creatorVersion: version, candidateSourceCommit: descriptor.sourceCommit,
    bindings, staged, importMetaAuthoring, authoringUuidRemaps: Object.fromEntries(ids), nativeRegistrationVerified: false,
    scope: '源与meta只在本新隔离副本重映射；UUID必须从真实AssetDB重新取得' }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ output, project, creatorVersion: version, sourceFiles: staged.length, installed, nativePassedRows: 0 }) + '\n');
