import { ResourceStabilityNativeRuntime } from '../scripts/resource-stability-native-runtime.mts';
import { ResourceStabilityNativeFixture } from '../scripts/resource-stability-native-fixture.mts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceStabilityNativeShard, type IResourceNativeShardFixture } from '../scripts/resource-stability-native-shard.mts';
import type { ICoverageInventory } from '../../../../../tools/editor-stability/coverage-contracts.mts';
import { CoverageManifestGenerator } from '../../../../../tools/editor-stability/coverage-manifest-generator.mts';
import type { IResourceSessionIdentity } from '../scripts/resource-stability-contracts.mts';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real catalog manifest prepares all 95 fixture names, including serialized arrays and reject_invalid', () => {
    const repository = new URL('../../../../../', import.meta.url);
    const catalog = JSON.parse(readFileSync(new URL('tests/fixtures/editor-stability/serialized/resource-fixtures.json', repository), 'utf8')) as {
        fixtures: { creatorVersion: string; assetKind: string; files: { source: { path: string } };
            initialPublic: Record<string, unknown> }[] };
    const fixtures = catalog.fixtures.filter((row) => row.creatorVersion === '3.8.3'
        && ResourceStabilityNativeRuntime.kinds.includes(row.assetKind));
    assert.equal(fixtures.length, 8);
    const assets = JSON.parse(readFileSync(new URL('packages/engine/modules/lumen/bundled/schema/assets.json', repository), 'utf8')) as {
        entries: { assetKind: string; scaffold: boolean; fields: { apiName: string; kind: string; writable?: boolean }[] }[] };
    const targets: ICoverageInventory['targets'][number][] = assets.entries.filter((entry) =>
        ResourceStabilityNativeRuntime.kinds.includes(entry.assetKind)).flatMap((entry) => [{
            id: `asset:${entry.assetKind}`, domain: 'asset' as const, subject: entry.assetKind,
            actions: [...entry.scaffold ? ['create'] : [], 'import', 'query', 'inspect', 'patch', 'copy', 'move', 'rename', 'refresh', 'delete'],
            fieldKind: null, availability: 'unverified' as const, availabilitySourceId: null,
        }, ...entry.assetKind !== 'physicsMaterial' ? [] : entry.fields.map((field) => ({
            id: `field:asset:physicsMaterial:${field.apiName}`, domain: 'field' as const, subject: `asset:physicsMaterial.${field.apiName}`,
            actions: field.writable === false ? ['read', 'reject_write'] : ['read', 'set', 'reject_invalid'],
            fieldKind: field.kind, availability: 'unverified' as const, availabilitySourceId: null,
        }))]);
    const manifest = CoverageManifestGenerator.createDraft({ creatorVersion: '3.8.3', targets,
        sources: [{ id: 'product/assets.json', kind: 'product_catalog', creatorVersion: null, sha256: CoverageManifestGenerator.digest(assets) }],
        nativeImporterModules: [], nativeRegisteredClasses: [], nativeRegistrationAlternatives: [], nativeUnresolvedRegistrations: [],
        nativeComponentDeclarations: [], nativeAbstractComponentDeclarations: [], curatedComponentsWithoutDeclaration: [] });
    assert.equal(manifest.cases.length, 95); let preparedCount = 0; let invalidCount = 0;
    for (const fixture of fixtures) {
      for (const row of manifest.cases.filter((item) => item.targetId === `asset:${fixture.assetKind}`
          || fixture.assetKind === 'physicsMaterial' && item.targetId.startsWith('field:asset:physicsMaterial:'))) {
        const source = readFileSync(new URL(fixture.files.source.path, repository));
        const field = row.targetId.startsWith('field:') ? row.targetId.split(':').at(-1) : undefined;
        const original = Buffer.from(source); const name = `${fixture.assetKind}-${field ? `${field}-` : ''}${row.action}`;
        const prepared = ResourceStabilityNativeFixture.prepare(fixture.assetKind, source, name, fixture.initialPublic);
        preparedCount += 1; if (row.action === 'reject_invalid') invalidCount += 1;
        assert.deepEqual(source, original, 'frozen input bytes must remain unchanged');
        if (fixture.assetKind === 'terrain') {
            assert.deepEqual(prepared.source, source); assert.deepEqual(prepared.initial, fixture.initialPublic); continue;
        }
        const expected = JSON.parse(source.toString('utf8')) as Record<string, unknown> | Record<string, unknown>[];
        const root = Array.isArray(expected) ? expected[0]! : expected;
        const hasName = Object.hasOwn(root, '_name');
        if (hasName) root._name = name;
        assert.deepEqual(JSON.parse(prepared.source.toString('utf8')), expected, 'all non-root-name data must remain unchanged');
        if (Object.hasOwn(fixture.initialPublic, '/name')) assert.equal(prepared.initial['/name'], root._name);
        else assert.deepEqual(prepared.initial, fixture.initialPublic);
        if (fixture.assetKind === 'animationGraph' || fixture.assetKind === 'animationGraphVariant') {
            assert.ok(Array.isArray(expected)); assert.equal(root._name, name);
            assert.equal(prepared.initial['/name'], name);
        }
        if (!hasName) assert.deepEqual(prepared.source, source);
      }
    }
    assert.equal(preparedCount, 95); assert.equal(invalidCount, 5);
});

test('fixture derivation refuses a wrong root, nested name or unsupported binary name expectation', () => {
    const encode = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
    assert.throws(() => ResourceStabilityNativeFixture.prepare('animationGraph', encode([
        { __type__: 'cc.animation.Layer', _name: 'child' }, { __type__: 'cc.animation.AnimationGraph', _name: '' },
    ]), 'graph-copy', { '/name': '' }), /resource_native_fixture_root_type_mismatch/u);
    assert.throws(() => ResourceStabilityNativeFixture.prepare('animationGraph', encode({
        __type__: 'cc.animation.AnimationGraph', nested: { _name: '' },
    }), 'graph-copy', { '/name': '' }), /resource_native_fixture_root_name_missing/u);
    assert.throws(() => ResourceStabilityNativeFixture.prepare('terrain', Buffer.from([8, 0]), 'terrain-copy',
        { '/name': '' }), /resource_native_fixture_binary_name_unsupported/u);
});

test('native shard keeps every full denominator row and follows the real public import target contract', async () => {
    const kinds = ResourceStabilityNativeRuntime.kinds;
    const actions = ['create', 'import', 'query', 'inspect', 'patch', 'copy', 'move', 'rename', 'refresh', 'delete'];
    const inventory: ICoverageInventory = { creatorVersion: '3.8.3',
        sources: [{ id: 'unit/catalog', kind: 'product_catalog', creatorVersion: null, sha256: 'a'.repeat(64) }],
        nativeImporterModules: [], nativeRegisteredClasses: [], nativeRegistrationAlternatives: [], nativeUnresolvedRegistrations: [],
        nativeComponentDeclarations: [], nativeAbstractComponentDeclarations: [], curatedComponentsWithoutDeclaration: [],
        targets: [...[...kinds, 'newNativeKind'].map((kind) => ({ id: `asset:${kind}`, domain: 'asset' as const, subject: kind, actions,
            fieldKind: null, availability: 'unverified' as const, availabilitySourceId: null })),
            ...ResourceStabilityNativeShard.physicsFields.map((name) => ({ id: `field:asset:physicsMaterial:${name}`, domain: 'field' as const,
                subject: `asset:physicsMaterial.${name}`, actions: ['read', 'set', 'reject_invalid'], fieldKind: name === 'name' ? 'string' : 'number',
                availability: 'unverified' as const, availabilitySourceId: null }))],
    };
    const identity: IResourceSessionIdentity = { creatorVersion: '3.8.3', owner: 'unit-owner', change: 'unit-change', projectPath: '/private/tmp/unit',
        projectName: 'unit', runId: 'unit', creatorPid: 12, creatorStartedAt: '2026-10-19T00:00:00Z',
        hostSha256: 'b'.repeat(64), coreSha256: 'c'.repeat(64), sourceCommit: 'd'.repeat(40) };
    const fixtures: IResourceNativeShardFixture[] = kinds.flatMap((kind) => actions.map((action) => ({ kind,
        caseId: `3.8.3|asset:${kind}|${action}`, source: `/private/tmp/inputs/${kind}-${action}.pmtl`,
        sourceMeta: `/private/tmp/inputs/${kind}-${action}.pmtl.meta`, filename: `${kind}-${action}.pmtl`,
        initial: { '/name': `${kind}-${action}` }, patch: { name: 'patched' }, expectedPatch: { '/name': 'patched' } })));
    for (const name of ResourceStabilityNativeShard.physicsFields) for (const action of ['read', 'set', 'reject_invalid']) {
        fixtures.push({ kind: 'physicsMaterial', caseId: `3.8.3|field:asset:physicsMaterial:${name}|${action}`,
            source: `/private/tmp/inputs/${name}-${action}.pmtl`, sourceMeta: `/private/tmp/inputs/${name}-${action}.pmtl.meta`,
            filename: `${name}-${action}.pmtl`, initial: { '/name': 'initial' }, patch: {}, expectedPatch: {},
            field: { name, initial: name === 'name' ? 'initial' : 0.5, expected: name === 'name' ? 'changed' : 0.7,
                patch: { [name]: name === 'name' ? 'changed' : 0.7 }, invalidPatch: { [name]: name === 'name' ? false : 'invalid' },
                rejectionCode: `lumen_property_type:${name}:${name === 'name' ? 'string' : 'number>=0'}` } });
    }
    const hashes = Object.fromEntries(fixtures.flatMap((item) => [[item.source, 'e'.repeat(64)], [item.sourceMeta, 'f'.repeat(64)]]));
    const result = ResourceStabilityNativeShard.create(inventory, identity, 'assets/fixtures/resource-stability/unit', fixtures, hashes);
    assert.equal(result.plan.cases.length, 95); assert.equal(result.fullResourceCaseIds.length, 105);
    assert.equal(result.plan.cases.filter((row) => row.expectedRejection).length, 5);
    assert.ok(result.plan.cases.filter((row) => row.expectedRejection).every((row) => row.afterCommands?.length === 0 && row.rejectionCodes.length === 1));
    assert.equal(result.blocked.length, 10); assert.equal(result.task43Complete, false);
    const preserve = ['animationGraph', 'animationGraphVariant', 'animationMask', 'physicsMaterial', 'renderPipeline'];
    for (const kind of kinds) {
        const renamed = result.plan.cases.find((row) => row.caseId === `3.8.3|asset:${kind}|rename`)!;
        assert.equal(renamed.expectedSemantic['/name'], `${kind}-rename${preserve.includes(kind) ? '' : '-renamed'}`);
        assert.equal(renamed.expectedSourceContentSha256, 'e'.repeat(64));
    }
    const unproved = { ...hashes }; delete unproved['/private/tmp/inputs/animationGraph-rename.pmtl'];
    assert.throws(() => ResourceStabilityNativeShard.create(inventory, identity, 'assets/fixtures/resource-stability/unit', fixtures, unproved), /rename_source_proof_invalid/u);
    const otherVersion = { ...inventory, creatorVersion: '3.8.7' };
    const otherFixtures = fixtures.map((row) => ({ ...row, caseId: row.caseId.replace('3.8.3|', '3.8.7|') }));
    assert.throws(() => ResourceStabilityNativeShard.create(otherVersion, { ...identity, creatorVersion: '3.8.7' },
        'assets/fixtures/resource-stability/unit', otherFixtures, hashes), /rename_policy_unproven/u);
    assert.throws(() => ResourceStabilityNativeShard.create(inventory, identity, 'assets/fixtures/resource-stability/unit',
        fixtures.map((row) => row.caseId === '3.8.3|asset:animationGraph|rename' ? { ...row, kind: 'unmeasuredNativeKind' } : row), hashes), /fixture_missing/u);
    assert.ok(result.plan.cases.filter((row) => ['create', 'patch'].includes(row.action)).every((row) => row.afterCommands?.length === 1));
    const catalog = JSON.parse(readFileSync(new URL('../../../../../tests/fixtures/editor-stability/serialized/resource-fixtures.json', import.meta.url), 'utf8')) as {
        fixtures: { creatorVersion: string; assetKind: string; initialPublic: Record<string, unknown>; files: { source: { path: string } } }[] };
    const frozen = catalog.fixtures.find((row) => row.creatorVersion === '3.8.3' && row.assetKind === 'physicsMaterial')!;
    const realFixtures = fixtures.map((row) => row.kind === 'physicsMaterial' && !row.field
        ? { ...row, initial: { ...frozen.initialPublic, '/name': row.initial['/name'] } } : row);
    const realPlan = ResourceStabilityNativeShard.create(inventory, identity, 'assets/fixtures/resource-stability/unit', realFixtures, hashes).plan;
    const created = realPlan.cases.find((row) => row.caseId === '3.8.3|asset:physicsMaterial|create')!;
    const imported = realPlan.cases.find((row) => row.caseId === '3.8.3|asset:physicsMaterial|import')!;
    const registryUrl = new URL('../../../../../packages/engine/modules/lumen/source/standalone/registry.ts', import.meta.url);
    const { LumenStandaloneAsset } = await import(registryUrl.href) as { LumenStandaloneAsset: {
        createEmpty(path: string, name: string, template: string): { inspect(): Record<string, unknown> };
        open(root: string, path: string): { inspect(): Record<string, unknown> } } };
    const actual = LumenStandaloneAsset.createEmpty(created.afterPath, String(created.command.input.rootName), 'empty').inspect();
    const frozenSource = LumenStandaloneAsset.open(new URL('../../../../../', import.meta.url).pathname, frozen.files.source.path).inspect();
    for (const field of ['rollingFriction', 'spinningFriction']) {
        assert.equal(created.expectedSemantic[`/${field}`], 0.1);
        assert.equal(actual[field], created.expectedSemantic[`/${field}`], 'actual pure scaffolder must match the independent create contract');
        assert.equal(imported.expectedSemantic[`/${field}`], 0);
        assert.equal(frozenSource[field], 0, 'frozen import sample stays distinct from create defaults');
    }
    assert.equal(realFixtures.find((row) => row.caseId === created.caseId)!.initial['/rollingFriction'], 0);
    const imports = result.plan.cases.flatMap((row) => [...row.setup, row.command])
        .filter((command) => command.name === 'peanut.editor-mcp.asset-import');
    assert.ok(imports.length > 0);
    assert.ok(imports.every((command) => typeof command.input.target === 'string'
        && command.input.target.startsWith('db://assets/fixtures/resource-stability/unit/')));
    const executorUrl = new URL('../../../../../packages/engine/modules/lumen/source/asset-import/asset-import-batch-executor.ts', import.meta.url);
    const { AssetImportBatchExecutor } = await import(executorUrl.href) as { AssetImportBatchExecutor: new (port: {
        request(target: string, message: string, ...args: unknown[]): Promise<unknown> }) => {
            importBatch(request: { sources: readonly string[]; target: string; expandClosure: boolean }): Promise<unknown> } };
    const temporary = mkdtempSync(join(tmpdir(), 'resource-import-contract-')); let sdkCalls = 0;
    try {
        const source = join(temporary, 'source.pmtl'); writeFileSync(source, '{"__type__":"cc.PhysicsMaterial"}');
        const target = String(imports[0]?.input.target);
        const executor = new AssetImportBatchExecutor({ request: async (channel, method, ...args) => {
            sdkCalls += 1; assert.equal(channel, 'asset-db'); assert.equal(method, 'import-asset');
            assert.equal(args[1], `${target}/source.pmtl`);
            throw new Error('offline_native_boundary_not_executed');
        } });
        await assert.rejects(executor.importBatch({ sources: [source], target: target.slice(5), expandClosure: false }),
            /asset_import_target_must_be_db_assets/u);
        assert.equal(sdkCalls, 0);
        await assert.rejects(executor.importBatch({ sources: [source], target, expandClosure: false }),
            /offline_native_boundary_not_executed/u);
        assert.equal(sdkCalls, 1);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
    assert.throws(() => ResourceStabilityNativeShard.create(inventory, identity, 'assets/fixtures/resource-stability/unit', fixtures.slice(1), hashes), /fixture_scope_mismatch/u);
    const expanded = { ...inventory, targets: [...inventory.targets, { id: 'field:asset:physicsMaterial:newField', domain: 'field' as const,
        subject: 'asset:physicsMaterial.newField', actions: ['read'], fieldKind: 'number', availability: 'unverified' as const, availabilitySourceId: null }] };
    const fresh = ResourceStabilityNativeShard.create(expanded, identity, 'assets/fixtures/resource-stability/unit', fixtures, hashes);
    assert.equal(fresh.fullResourceCaseIds.length, 106);
    assert.ok(fresh.blocked.some((row) => row.caseId.endsWith('newField|read') && row.reason === 'native_field_contract_not_bound'));
});
