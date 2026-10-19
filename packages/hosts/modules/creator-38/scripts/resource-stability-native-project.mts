import { ResourceStabilityNativeRuntime } from './resource-stability-native-runtime.mts';
import { ResourceStabilityNativeFixture } from './resource-stability-native-fixture.mts';
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { buildSync } from 'esbuild';
import type { ICoverageInventory } from '../../../../../tools/editor-stability/coverage-contracts.mts';
import { CoverageManifestGenerator } from '../../../../../tools/editor-stability/coverage-manifest-generator.mts';
import { ComponentTaskOwnership } from '../../../../../tests/fixtures/editor-stability/components/component-task-ownership.mts';
import { ComponentEngineProfile } from '../../../../../tests/fixtures/editor-stability/components/component-engine-profile.mts';
import { ComponentServiceProfile } from '../../../../../tests/fixtures/editor-stability/components/component-service-profile.mts';
import { ResourceStabilityNativeInspector } from './resource-stability-native-inspector.mts';
import { ResourceStabilityNativeShard, type IResourceNativeShardFixture } from './resource-stability-native-shard.mts';

/**
 * @description 仅准备新的隔离工程，不启动 Creator，不将暂存或 source 检查标为 native passed。
 */
export class ResourceStabilityNativeProject {
    public static async prepare(options: { repository: string; creatorApp: string; runId: string; expectedSourceCommit: string }): Promise<string> {
        const root = realpathSync(options.repository); const app = realpathSync(options.creatorApp);
        if (!/^parallel-383-20261019[a-z0-9-]*$/u.test(options.runId) || !/^[a-f0-9]{40}$/u.test(options.expectedSourceCommit)) {
            throw new Error('resource_native_project_arguments_invalid');
        }
        const owner = ComponentTaskOwnership.current(root);
        const engine = join(app, 'Contents/Resources/resources/3d/engine'); ResourceStabilityNativeInspector.assertSdk(engine);
        const verifierUrl = new URL('../../../../../tools/release-candidate.mts', import.meta.url);
        const { verifyReleaseCandidate } = await import(verifierUrl.href) as { verifyReleaseCandidate: (path: string,
            expected: { expectedVersion: string; expectedSourceCommit: string }) => { sourceCommit: string;
                host: { sha256: string }; core: { sha256: string } } };
        const descriptor = verifyReleaseCandidate(join(root, 'release/peanut.pod-lite-0.2.0'), {
            expectedVersion: '0.2.0', expectedSourceCommit: options.expectedSourceCommit });
        const output = join(root, 'evidence/task-4.3', options.runId); const project = join(output, 'project');
        if (existsSync(output)) throw new Error('resource_native_project_must_be_new');
        mkdirSync(project, { recursive: true });
        const namespace = `assets/fixtures/resource-stability/${options.runId}`;
        mkdirSync(join(project, namespace), { recursive: true });
        const script = fileURLToPath(new URL('./resource-stability-creator-session.mts', import.meta.url));
        writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'peanut-resource-native-383', uuid: randomUUID(),
            creator: { version: '3.8.3' }, scripts: Object.fromEntries(['precreator', 'creator', 'postcreator'].map((name, index) =>
                [name, `node --import tsx '${script}' --phase ${['preflight', 'launch', 'post'][index]}`])) }, null, 2));
        cpSync(join(app, 'Contents/Resources/templates/empty-quality/settings'), join(project, 'settings'), { recursive: true });
        copyFileSync(join(app, 'Contents/Resources/templates/empty-quality/tsconfig.json'), join(project, 'tsconfig.json'));
        ComponentEngineProfile.configure(project, '3.8.3'); ComponentServiceProfile.stage(project, '3.8.3');
        const registration = { kind: 'worktree-local-validation-project', task: '4.3', owner, worktree: root,
            change: 'stabilize-editor-operations-and-bulk-file-io', projectPath: project, creatorVersion: '3.8.3', creatorApp: app,
            runId: options.runId, namespace, offlineServiceProfile: true, sdkSceneCacheCompat: true, sdkUiReadyCompat: true,
            sdkTimerTrace: false, sdkOwnedQuit: true, candidateSourceCommit: descriptor.sourceCommit, hostSha256: descriptor.host.sha256,
            coreSha256: descriptor.core.sha256, registeredAt: new Date().toISOString(),
            userAuthorization: '两个独立Creator并行；3.8.3做4.3；不开all、不过滤错误、只关闭自己实例；先验收分片，不冒充完整4.3' };
        writeFileSync(join(output, 'project-ownership.json'), JSON.stringify(registration, null, 2), { flag: 'wx' });
        cpSync(join(root, 'packages/hosts/modules/creator-38/release/peanut-pod-lite-host-0.2.0'),
            join(project, 'extensions/peanut-pod-lite-host'), { recursive: true });
        const packagingUrl = new URL('../../../../../packages/engine/modules/installation/src/app/packaging-app.ts', import.meta.url);
        const { PackagingApp } = await import(packagingUrl.href) as { PackagingApp: new (options: { projectPath: string }) => {
            install(path: string): Promise<unknown> } };
        const receipt = await new PackagingApp({ projectPath: project }).install(join(root, 'packages/engine/modules/creator-plugin/release/peanut.pod-lite-0.2.0'));
        writeFileSync(join(output, 'core-install-receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
        for (const [name, main, scene] of [
            ['peanut-resource-probe', 'resource-stability-native-main.mts', 'resource-stability-native-scene.mts'],
            ['peanut-component-cache-compat', 'resource-stability-sdk-scene-cache-main.mts', null],
            ['peanut-component-sdk-compat', 'resource-stability-sdk-timer-trace-main.mts', null],
        ] as const) {
            const folder = join(project, 'extensions', name); mkdirSync(folder, { recursive: true });
            writeFileSync(join(folder, 'package.json'), JSON.stringify({ package_version: 2, name, version: '0.1.0',
                main: './main.js', contributions: scene ? { scene: { script: './scene.js' } } : {} }, null, 2));
            for (const [input, destination] of [[main, 'main.js'], ...scene ? [[scene, 'scene.js']] : []] as const) {
                buildSync({ entryPoints: [fileURLToPath(new URL(input, import.meta.url))], outfile: join(folder, destination),
                    bundle: true, platform: 'node', format: 'cjs', target: 'node14', external: ['cc'] });
            }
        }
        buildSync({ entryPoints: [fileURLToPath(new URL('./resource-stability-sdk-ui-ready-window.mts', import.meta.url))],
            outfile: join(project, 'extensions/peanut-component-sdk-compat/ui-ready.js'), bundle: true,
            platform: 'node', format: 'cjs', target: 'node14' });
        const readerUrl = new URL('../../../../../tools/editor-stability/coverage-inventory-reader.mts', import.meta.url);
        const { CoverageInventoryReader } = await import(readerUrl.href) as { CoverageInventoryReader: { read(options: {
            repositoryRoot: string; creatorResourcesRoot: string; creatorVersion: string }): ICoverageInventory } };
        const inventory = CoverageInventoryReader.read({ repositoryRoot: root, creatorResourcesRoot: join(app, 'Contents/Resources'), creatorVersion: '3.8.3' });
        const manifest = CoverageManifestGenerator.createDraft(inventory);
        const catalog = JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/serialized/resource-fixtures.json'), 'utf8')) as {
            fixtures: { creatorVersion: string; assetKind: string; dependencies: unknown[];
                files: { source: { path: string; sha256: string }; meta: { path: string; sha256: string } };
                initialPublic: Record<string, unknown>; patch: { valid: Record<string, unknown>; expectedPublic: Record<string, unknown> };
                fieldCases?: Record<string, { initial: unknown; expected: unknown; patch: Record<string, unknown>; invalidPatch: Record<string, unknown> }> }[] };
        const fixtures: IResourceNativeShardFixture[] = []; const fixtureSources: Record<string, string> = {};
        for (const fixture of catalog.fixtures.filter((row) => row.creatorVersion === '3.8.3'
            && ResourceStabilityNativeRuntime.kinds.includes(row.assetKind))) {
            if (fixture.dependencies.length) throw new Error('resource_native_fixture_dependency_not_bound');
            const source = readFileSync(join(root, fixture.files.source.path)); const meta = readFileSync(join(root, fixture.files.meta.path));
            if (this.hash(source) !== fixture.files.source.sha256 || this.hash(meta) !== fixture.files.meta.sha256) throw new Error('resource_native_frozen_fixture_changed');
            for (const row of manifest.cases.filter((item) => item.targetId === `asset:${fixture.assetKind}`
                || fixture.assetKind === 'physicsMaterial' && ResourceStabilityNativeShard.physicsFields.some((field) =>
                    item.targetId === `field:asset:physicsMaterial:${field}`) && ['read', 'set', 'reject_invalid'].includes(item.action))) {
                const fieldName = row.targetId.startsWith('field:') ? row.targetId.split(':').at(-1) : undefined;
                const fieldCase = fieldName ? fixture.fieldCases?.[fieldName] : undefined;
                if (fieldName && !fieldCase) throw new Error('resource_native_field_fixture_missing');
                const folder = join(project, '.peanut-ai/resource-stability-inputs', options.runId, fixture.assetKind, row.action);
                mkdirSync(folder, { recursive: true });
                const filename = `${fixture.assetKind}-${fieldName ? `${fieldName}-` : ''}${row.action}${basename(fixture.files.source.path).match(/\.[^.]+$/u)?.[0] ?? ''}`;
                const name = filename.replace(/\.[^.]+$/u, '');
                const prepared = ResourceStabilityNativeFixture.prepare(fixture.assetKind, source, name, fixture.initialPublic);
                const metadata = JSON.parse(meta.toString('utf8')) as Record<string, unknown>;
                metadata.uuid = randomUUID(); metadata.imported = false; metadata.files = [];
                const input = join(folder, filename); writeFileSync(input, prepared.source); writeFileSync(`${input}.meta`, JSON.stringify(metadata));
                fixtureSources[input] = this.hash(readFileSync(input)); fixtureSources[`${input}.meta`] = this.hash(readFileSync(`${input}.meta`));
                fixtures.push({ kind: fixture.assetKind, caseId: row.id, filename, source: input, sourceMeta: `${input}.meta`,
                    initial: prepared.initial, patch: fixture.patch.valid, expectedPatch: fixture.patch.expectedPublic,
                    field: fieldName && fieldCase ? { name: fieldName, initial: fieldName === 'name' ? name : fieldCase.initial,
                        expected: fieldCase.expected, patch: fieldCase.patch, invalidPatch: fieldCase.invalidPatch,
                        rejectionCode: `lumen_property_type:${fieldName}:${fieldName === 'name' ? 'string' : 'number>=0'}` } : undefined });
            }
        }
        const shard = ResourceStabilityNativeShard.create(inventory, { ...registration, projectName: 'peanut-resource-native-383',
            creatorPid: 0, creatorStartedAt: 'not-started', sourceCommit: descriptor.sourceCommit }, namespace, fixtures, fixtureSources);
        writeFileSync(join(output, 'resource-native-staging.json'), JSON.stringify({ ...shard, executionRequiresLease: true,
            nativeAcceptance: false, allEnabled: false, fixtureIdentityPolicy: '新root UUID；imported=false/files=[]；源_name与唯一文件名一致；无外依赖',
            sourceProofs: ['component-sdk-scene-cache-compat.ts', 'component-sdk-ui-ready-compat.ts', 'component-sdk-ui-ready-phases.ts']
                .map((file) => ({ file: `tests/fixtures/editor-stability/components/${file}`,
                    sha256: this.hash(readFileSync(join(root, 'tests/fixtures/editor-stability/components', file))) })),
            sdkGetterSources: ['cocos/animation/marionette/animation-graph-variant.ts', 'cocos/animation/marionette/animation-mask.ts',
                'cocos/rendering/render-pipeline.ts', 'cocos/physics/framework/assets/physics-material.ts', 'cocos/asset/asset-manager/depend-util.ts']
                .map((file) => ({ file, sha256: this.hash(readFileSync(join(engine, file))) })),
            inputFixtureCatalogSha256: this.hash(readFileSync(join(root, 'tests/fixtures/editor-stability/serialized/resource-fixtures.json'))) }, null, 2), { flag: 'wx' });
        writeFileSync(join(output, 'coverage-inventory.json'), JSON.stringify(inventory, null, 2), { flag: 'wx' });
        return project;
    }
    /**
     * @description 实际输入 bytes 摘要，不沿用旧原生报告。
     */
    private static hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
}
