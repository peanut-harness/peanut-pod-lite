import { ResourceStabilityNativeRuntime } from './resource-stability-native-runtime.mts';
import { CoverageManifestGenerator } from '../../../../../tools/editor-stability/coverage-manifest-generator.mts';
import type { ICoverageInventory } from '../../../../../tools/editor-stability/coverage-contracts.mts';
import type { IResourceCampaignExpectation, IResourceCampaignPlan, IResourceCasePlan, IResourceCommand,
    IResourceSessionIdentity } from './resource-stability-contracts.mts';
import { ResourceStabilityRunner } from './resource-stability-runner.mts';

/**
 * @description 已校验冻结夹具经过唯一身份暂存后的输入，不含原生通过结论。
 */
export interface IResourceNativeShardFixture {
    readonly kind: string;
    readonly caseId: string;
    readonly source: string;
    readonly sourceMeta: string;
    readonly filename: string;
    readonly initial: Readonly<Record<string, unknown>>;
    readonly patch: Readonly<Record<string, unknown>>;
    readonly expectedPatch: Readonly<Record<string, unknown>>;
    readonly field?: { readonly name: string; readonly initial: unknown; readonly expected: unknown;
        readonly patch: Readonly<Record<string, unknown>>; readonly invalidPatch: Readonly<Record<string, unknown>>; readonly rejectionCode: string };
}

/**
 * @description 显式保留完整分母的八类原生分片；不能交给完整 campaign validator 宣称 4.3 完成。
 */
export class ResourceStabilityNativeShard {
    public static readonly physicsFields = Object.freeze(['name', 'friction', 'rollingFriction', 'spinningFriction', 'restitution']);
    public static create(inventory: ICoverageInventory, session: IResourceSessionIdentity, namespace: string,
        fixtures: readonly IResourceNativeShardFixture[], fixtureSources: Readonly<Record<string, string>>) {
        const manifest = CoverageManifestGenerator.createDraft(inventory);
        const full = manifest.cases.filter((row) => row.targetId.startsWith('asset:') || row.targetId.startsWith('field:asset:'));
        const kinds = ResourceStabilityNativeRuntime.kinds;
        const supported = full.filter((row) => kinds.some((kind) => row.targetId === `asset:${kind}`)
            || this.physicsFields.some((field) => row.targetId === `field:asset:physicsMaterial:${field}`)
                && ['read', 'set', 'reject_invalid'].includes(row.action));
        if (fixtures.length !== supported.length || new Set(fixtures.map((row) => row.caseId)).size !== fixtures.length) {
            throw new Error('resource_native_shard_fixture_scope_mismatch');
        }
        const cases: IResourceCasePlan[] = supported.map((row) => {
            const fixture = fixtures.find((item) => item.caseId === row.id);
            if (!fixture || row.targetId !== `asset:${fixture.kind}` && row.targetId !== `field:asset:${fixture.kind}:${fixture.field?.name}`) {
                throw new Error('resource_native_shard_fixture_missing');
            }
            const folder = `${namespace}/${fixture.kind}/${row.action}`;
            const path = `${folder}/${fixture.filename}`;
            const command = (suffix: string, input: Record<string, unknown>, write: boolean, destructive = false): IResourceCommand => ({
                name: `peanut.editor-mcp.${suffix}`, input, write, destructive });
            const imported = command('asset-import', { sources: [fixture.source], target: `db://${folder}`,
                expandClosure: false, allowMissingDependencies: false, overwrite: false,
                resources: [fixture.source, fixture.sourceMeta, folder, path, `${path}.meta`] }, true);
            const commit = command('lumen-commit', { paths: [path], assetRelativePath: path, resources: [path, `${path}.meta`] }, true);
            const setup = ['create', 'import'].includes(row.action) ? [] : [imported];
            let actual = imported; let afterPath = path; let expectedSemantic = fixture.initial;
            let afterCommands: IResourceCommand[] = []; let expectedRejection = false; const rejectionCodes: string[] = [];
            switch (row.action) {
                case 'create': actual = command('lumen-scaffold', { assetRelativePath: path, template: 'empty',
                    rootName: fixture.filename.replace(/\.[^.]+$/u, ''), cocosVersion: inventory.creatorVersion,
                    autoCommit: false, resources: [path, `${path}.meta`] }, true); afterCommands = [commit];
                    // assets.json scaffoldRecord 的两个摩擦默认值为0.1，独立于导入样本的0。
                    if (fixture.kind === 'physicsMaterial') expectedSemantic = { ...fixture.initial,
                        '/rollingFriction': 0.1, '/spinningFriction': 0.1 };
                    break;
                case 'import': break;
                case 'query': actual = command('asset-query-info', { pathOrUuid: path }, false); break;
                case 'inspect': actual = command('lumen-inspect', { assetRelativePath: path }, false); break;
                case 'patch': actual = command('lumen-asset-set', { assetRelativePath: path, props: fixture.patch,
                    cocosVersion: inventory.creatorVersion, autoCommit: false, resources: [path, `${path}.meta`] }, true);
                    expectedSemantic = fixture.expectedPatch; afterCommands = [commit]; break;
                case 'read':
                    if (!fixture.field) throw new Error('resource_native_field_fixture_missing');
                    actual = command('lumen-inspect', { assetRelativePath: path }, false);
                    expectedSemantic = { [`/${fixture.field.name}`]: fixture.field.initial }; break;
                case 'set':
                    if (!fixture.field) throw new Error('resource_native_field_fixture_missing');
                    actual = command('lumen-asset-set', { assetRelativePath: path, props: fixture.field.patch,
                        cocosVersion: inventory.creatorVersion, autoCommit: false, resources: [path, `${path}.meta`] }, true);
                    expectedSemantic = { [`/${fixture.field.name}`]: fixture.field.expected }; afterCommands = [commit]; break;
                case 'reject_invalid':
                    if (!fixture.field) throw new Error('resource_native_field_fixture_missing');
                    actual = command('lumen-asset-set', { assetRelativePath: path, props: fixture.field.invalidPatch,
                        cocosVersion: inventory.creatorVersion, autoCommit: false, resources: [path, `${path}.meta`] }, true);
                    expectedSemantic = { [`/${fixture.field.name}`]: fixture.field.initial };
                    expectedRejection = true; rejectionCodes.push(fixture.field.rejectionCode); break;
                case 'copy': afterPath = `${folder}/copy/${fixture.filename}`;
                    setup.push(command('asset-create-folder', { path: `${folder}/copy`, resources: [`${folder}/copy`, `${folder}/copy.meta`] }, true));
                    actual = command('asset-copy', { paths: [path], targetDirectory: `${folder}/copy`,
                        resources: [path, `${path}.meta`, `${folder}/copy`, afterPath, `${afterPath}.meta`] }, true); break;
                case 'move': afterPath = `${folder}/moved/${fixture.filename}`;
                    setup.push(command('asset-create-folder', { path: `${folder}/moved`, resources: [`${folder}/moved`, `${folder}/moved.meta`] }, true));
                    actual = command('asset-move', { from: path, to: afterPath,
                        resources: [path, `${path}.meta`, afterPath, `${afterPath}.meta`] }, true); break;
                case 'rename': { const name = fixture.filename.replace(/(\.[^.]+)$/u, '-renamed$1'); afterPath = `${folder}/${name}`;
                    actual = command('asset-rename', { path, newName: name, resources: [path, `${path}.meta`, afterPath, `${afterPath}.meta`] }, true);
                    // 3.8.3八类native name-policy诊断及file-only rename合同；不能泛化其他版本或类型。
                    const preserve = ['animationGraph', 'animationGraphVariant', 'animationMask', 'physicsMaterial', 'renderPipeline'];
                    const filename = ['animationClip', 'renderTexture', 'terrain'];
                    if (inventory.creatorVersion !== '3.8.3' || ![...preserve, ...filename].includes(fixture.kind)) {
                        throw new Error('resource_native_rename_policy_unproven');
                    }
                    expectedSemantic = preserve.includes(fixture.kind) ? fixture.initial
                        : { ...fixture.initial, '/name': name.replace(/\.[^.]+$/u, '') }; break; }
                case 'refresh': actual = command('asset-reimport', { paths: [path], resources: [path, `${path}.meta`] }, true); break;
                case 'delete': actual = command('asset-delete', { paths: [path], confirmDestructive: true,
                    resources: [path, `${path}.meta`] }, true, true); break;
                default: throw new Error('resource_native_shard_action_blocked');
            }
            return { caseId: row.id, action: row.action, setup, command: actual, afterCommands, beforePath: path,
                afterPath, expectedSemantic, ...(row.action === 'rename' ? { expectedSourceContentSha256: fixtureSources[fixture.source] } : {}),
                expectedAuthorities: Object.fromEntries(Object.keys(expectedSemantic).map((pointer) =>
                    [pointer, ResourceStabilityNativeRuntime.authority(ResourceStabilityNativeRuntime.typeForKind(fixture.kind), pointer)])), expectedRejection, rejectionCodes };
        });
        const plan: IResourceCampaignPlan = { creatorVersion: inventory.creatorVersion as '3.8.3' | '3.8.7',
            inventorySha256: manifest.inventorySha256, namespace, cases };
        const expected: IResourceCampaignExpectation = { ...session, namespace, fixtureSources,
            inventorySha256: manifest.inventorySha256, requiredCaseIds: cases.map((row) => row.caseId) };
        ResourceStabilityRunner.validatePlan(plan, expected);
        return { plan, expected, fullResourceCaseIds: full.map((row) => row.id), task43Complete: false as const,
            blocked: full.filter((row) => !supported.some((item) => item.id === row.id)).map((row) => ({ caseId: row.id,
                reason: row.targetId.startsWith('field:') ? 'native_field_contract_not_bound' : 'native_inspector_type_not_bound' })) };
    }
}
