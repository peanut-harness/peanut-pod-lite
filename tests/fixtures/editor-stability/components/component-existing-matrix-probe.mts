import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentMatrixScope } from './component-matrix-scope.mts';
import { ComponentTaskOwnership } from './component-task-ownership.mts';
import { ComponentCatalogAudit } from './component-catalog-audit.mts';
import { ComponentFieldFixtures } from './component-field-fixtures.mts';
import { ComponentNativeFieldContract } from './component-native-field-contract.mts';
import { ComponentResourceBindings } from './component-resource-bindings.mts';
import { ComponentProjectUrlFiles } from './component-project-url-files.ts';
import { ComponentSceneFixture } from './component-scene-fixture.mts';
import { ComponentLifecycleFixture } from './component-lifecycle-fixture.mts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';

type Version = '3.8.3' | '3.8.7';
const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export class ComponentExistingMatrixProbe {
    public static stage(version: Version, actor = process.env.CODEX_THREAD_ID ?? '') {
        if (version !== '3.8.3' && version !== '3.8.7') throw new Error('component_existing_probe_version_invalid');
        const owner = ComponentTaskOwnership.current(root, actor);
        const workspace = realpathSync(join(root, '../../..'));
        const project = join(workspace, `.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-${version}`);
        const output = join(root, 'evidence/task-5.1', `full51-existing-20261027-${version}`, 'existing-project-stage');
        if (realpathSync(project) !== project || realpathSync(output) !== output
            || !existsSync(join(output, 'stage-complete.json'))) throw new Error('component_existing_probe_stage_missing');
        const descriptor = JSON.parse(readFileSync(join(root, 'release/peanut.pod-lite-0.2.1/lite-release-descriptor.json'), 'utf8'));
        const plan = JSON.parse(readFileSync(join(root, 'docs/testing/pod/existing-project-editing-plan.json'), 'utf8'));
        const candidate = plan.candidate;
        if (descriptor.version !== '0.2.1' || descriptor.host.packageDigest !== candidate.hostPackageDigest
            || descriptor.core.packageDigest !== candidate.corePackageDigest) throw new Error('component_existing_probe_candidate_mismatch');
        const report = JSON.parse(readFileSync(join(root, 'evidence/task-5.1', `full51-existing-20261027-${version}`, 'scene-assembly-report.json'), 'utf8'));
        const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
        const byPath = new Map<string, string>(manifest.files.map((row: { destination: string; sha256: string }) => [row.destination, row.sha256]));
        for (const [destination, expected] of byPath) if (sha(readFileSync(join(project, destination))) !== expected)
            throw new Error(`component_existing_probe_fixture_changed:${destination}`);
        const engine = `/Applications/Cocos/Creator/${version}/CocosCreator.app/Contents/Resources/resources/3d/engine`;
        const audit = ComponentCatalogAudit.create(root, engine, version);
        const fields = ComponentFieldFixtures.create(root, version, audit.nativeDeclarations);
        const contract = ComponentNativeFieldContract.create(root, engine, fields, audit.nativeDeclarations);
        const candidateScenes: ReturnType<typeof ComponentLifecycleFixture.create>[] = [];
        const rows = report.rows.map((row: Record<string, unknown>) => {
            const type = String(row.componentType);
            if (row.status === 'blocked') {
                const blockers = Array.isArray(row.blockers) ? row.blockers.map(String) : [];
                const runtimeCandidates = blockers.length > 0 && blockers.every((blocker) =>
                    blocker.startsWith('active-physics-backend-unverified:')
                    || blocker === 'active-high-quality-render-pipeline-unverified');
                if (!runtimeCandidates) return { componentType: type, status: 'blocked', blockers };
                const fixture = fields.components.find((item) => item.componentType === type);
                if (!fixture) throw new Error('component_existing_probe_field_row_missing');
                const assembled = ComponentSceneFixture.create(root, version, fixture, audit.nativeDeclarations, true);
                if (assembled.status === 'blocked') throw new Error(`component_existing_probe_candidate_assembly_failed:${type}`);
                const lifecycle = ComponentLifecycleFixture.create(assembled.document, version, type);
                const scenePath = lifecycle.relativePath;
                const fullScenePath = join(project, scenePath);
                if (existsSync(fullScenePath)) throw new Error(`component_existing_probe_candidate_target_exists:${scenePath}`);
                candidateScenes.push(lifecycle);
                return { componentType: type, status: assembled.status, pendingRequirements: assembled.pendingRequirements,
                    targetPath: assembled.targetPath, nodePaths: assembled.nodePaths, scenePath,
                    stagedSha256: sha(JSON.stringify([...lifecycle.entries], null, 2) + '\n'), fieldStates: assembled.fieldStates,
                    presentation: { status: 'presentation-context-pending', scenePath: null, stagedSha256: null } };
            }
            const scenePath = `assets/components/_lifecycle/${type}.scene`;
            const presentationPath = `assets/components/${type}.scene`;
            return { componentType: type, status: row.status, pendingRequirements: [],
                targetPath: row.targetPath, nodePaths: row.nodePaths, scenePath,
                stagedSha256: byPath.get(scenePath), fieldStates: row.fieldStates,
                presentation: byPath.has(presentationPath)
                    ? { status: 'authored-presentation-native-pending', scenePath: presentationPath,
                        stagedSha256: byPath.get(presentationPath) }
                    : { status: 'presentation-context-pending', scenePath: null, stagedSha256: null } };
        });
        if (rows.length !== 99 || fields.componentCount !== 99 || fields.fieldCount !== 795)
            throw new Error('component_existing_probe_denominator_invalid');
        const registration = { kind: 'registered-existing-0.2.1-project', task: '5.1', owner,
            change: 'stabilize-editor-operations-and-bulk-file-io', projectPath: project, worktree: root,
            creatorVersion: version, creatorApp: `/Applications/Cocos/Creator/${version}/CocosCreator.app`,
            runId: `full51-existing-20261027-${version}`, evidenceOutput: output,
            engineModulesContext: 'sorting', offlineServiceProfile: false, startupSceneProfile: false,
            candidateSourceCommit: candidate.testedSourceCommit, hostSha256: descriptor.host.sha256,
            coreSha256: descriptor.core.sha256, hostPackageDigest: descriptor.host.packageDigest,
            corePackageDigest: descriptor.core.packageDigest };
        const probe = join(project, 'extensions/peanut-component-probe');
        const planned = [join(output, 'project-ownership.json'), join(output, 'component-matrix-staging.json'),
            join(output, 'staging-receipt.json'), ...['package.json', 'main.js', 'scene.js',
                'project-ownership.json', 'public-field-contract.json', 'project-url-files.json'].map(name => join(probe, name))];
        if ([...planned, ...candidateScenes.map(scene => join(project, scene.relativePath))].some(path => existsSync(path)))
            throw new Error('component_existing_probe_target_exists');
        const moduleRoot = fileURLToPath(new URL('./', import.meta.url));
        const bundles = Object.fromEntries([['component-native-main.ts', 'main.js'], ['component-native-scene.ts', 'scene.js']]
            .map(([source, destination]) => {
                const result = buildSync({ entryPoints: [join(moduleRoot, source)], bundle: true, platform: 'node', format: 'cjs',
                    target: 'node14', external: ['cc'], write: false });
                if (result.outputFiles?.length !== 1) throw new Error('component_existing_probe_bundle_missing');
                return [destination, Buffer.from(result.outputFiles[0].contents)];
            }));
        mkdirSync(probe, { recursive: true });
        for (const scene of candidateScenes) scene.save(project, false, LumenCocosVersion.parse(version));
        writeFileSync(join(output, 'project-ownership.json'), JSON.stringify(registration, null, 2) + '\n', { flag: 'wx' });
        writeFileSync(join(probe, 'project-ownership.json'), JSON.stringify(registration, null, 2) + '\n', { flag: 'wx' });
        ComponentProjectUrlFiles.stage(root, project, registration);
        writeFileSync(join(probe, 'package.json'), JSON.stringify({ package_version: 2, name: 'peanut-component-probe',
            version: '0.1.0', main: './main.js', contributions: { scene: { script: './scene.js' } } }, null, 2) + '\n', { flag: 'wx' });
        for (const [name, bytes] of Object.entries(bundles)) writeFileSync(join(probe, name), bytes, { flag: 'wx' });
        writeFileSync(join(probe, 'public-field-contract.json'), JSON.stringify(contract) + '\n', { flag: 'wx' });
        writeFileSync(join(output, 'component-matrix-staging.json'), JSON.stringify({ creatorVersion: version,
            componentCount: 99, fieldCount: 795, nativePassedRows: 0, rows }, null, 2) + '\n', { flag: 'wx' });
        writeFileSync(join(output, 'staging-receipt.json'), JSON.stringify({ creatorVersion: version,
            candidateSourceCommit: candidate.testedSourceCommit, fixtureProfile: 'component-matrix',
            bindings: ComponentResourceBindings.create(root, version), nativePassedRows: 0 }, null, 2) + '\n', { flag: 'wx' });
        ComponentMatrixScope.locate(root, project);
        return { project, output, creatorVersion: version, componentCount: 99, fieldCount: 795,
            probeMainSha256: sha(bundles['main.js']), probeSceneSha256: sha(bundles['scene.js']) };
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length !== 3 || !['3.8.3', '3.8.7'].includes(process.argv[2] ?? ''))
        throw new Error('component_existing_probe_arguments_invalid');
    process.stdout.write(JSON.stringify(ComponentExistingMatrixProbe.stage(process.argv[2] as Version)) + '\n');
}
