import { CoreCocosMcpCapabilityCatalog, type CoreCocosMcpOperation } from './core-cocos-mcp-capability-catalog.js';
import {
    CoreCocosNativeWriteCapabilityCatalog,
    type CoreCocosNativeWriteOperation,
    type CoreCocosNativeWriteRisk,
} from './core-cocos-native-write-capability-catalog.js';
import type { CoreCocosMcpPublicOperation } from './core-cocos-mcp-tool-name-resolver.js';

/** @description Lite admission 与执行流水线使用的稳定成本类别。 */
export type CoreCocosMcpThroughputCostClass = 'control' | 'read_light' | 'read_heavy' | 'prepare' | 'writer';

/** @description 读请求允许参与的短窗口合并范围。 */
export type CoreCocosMcpReadCoalescing = 'none' | 'project';

/** @description 读结果缓存策略；revision_lru 必须绑定工程 revision。 */
export type CoreCocosMcpReadCacheMode = 'none' | 'revision_lru';

/** @description 读请求在 writer 活跃时需要遵守的一致性策略。 */
export type CoreCocosMcpReadConsistency = 'revision_validated' | 'writer_barrier';

export interface ICoreCocosMcpReadExecutionProfile {
    readonly coalescing: CoreCocosMcpReadCoalescing;
    readonly cache: CoreCocosMcpReadCacheMode;
    readonly consistency: CoreCocosMcpReadConsistency;
}

export interface ICoreCocosMcpWriteExecutionProfile {
    /** @description operation 是否包含可在 writer 前并行完成的纯离线准备阶段。 */
    readonly prepareEligible: boolean;
    /** @description operation 是否允许进入显式批次；实际执行仍须通过资源、审批和 DAG 校验。 */
    readonly explicitBatchEligible: boolean;
    /** @description operation 是否允许进入短窗口自动微批；这是比显式批次更严格的 allow-list。 */
    readonly automaticBatchEligible: boolean;
}

/** @description 单项公开 operation 的 fail-closed 吞吐与执行画像。 */
export interface ICoreCocosMcpOperationThroughputProfile {
    readonly operation: CoreCocosMcpPublicOperation;
    readonly readOnly: boolean;
    readonly risk: 'read' | CoreCocosNativeWriteRisk;
    readonly costClass: CoreCocosMcpThroughputCostClass;
    readonly read: ICoreCocosMcpReadExecutionProfile | null;
    readonly write: ICoreCocosMcpWriteExecutionProfile | null;
}

interface IReadOverrides {
    readonly costClass: Extract<CoreCocosMcpThroughputCostClass, 'read_light' | 'read_heavy' | 'prepare'>;
    readonly coalescing?: CoreCocosMcpReadCoalescing;
    readonly cache?: CoreCocosMcpReadCacheMode;
    readonly consistency?: CoreCocosMcpReadConsistency;
}

const readOverrides: Readonly<Record<CoreCocosMcpOperation, IReadOverrides>> = Object.freeze({
    'editor.queryVersion': { costClass: 'read_light', coalescing: 'project', cache: 'revision_lru', consistency: 'revision_validated' },
    'editor.queryProject': { costClass: 'read_light', coalescing: 'project', cache: 'revision_lru', consistency: 'revision_validated' },
    'editor.querySelection': { costClass: 'read_light' },
    'asset.queryInfo': { costClass: 'read_light', coalescing: 'project' },
    'asset.catalog.summary': { costClass: 'read_light', coalescing: 'project' },
    'asset.catalog.lookup': { costClass: 'read_light', coalescing: 'project' },
    'asset.importPlan': { costClass: 'prepare', coalescing: 'project' },
    'asset.managedStatus': { costClass: 'read_light', coalescing: 'project' },
    'asset.queryDependencies': { costClass: 'read_heavy', coalescing: 'project' },
    'asset.waitReady': { costClass: 'read_heavy' },
    'asset.scanMissingReferences': { costClass: 'read_heavy', coalescing: 'project' },
    'asset.findReferencingNodes': { costClass: 'read_heavy', coalescing: 'project' },
    'asset.resolve': { costClass: 'read_light', coalescing: 'project' },
    'asset.search': { costClass: 'read_heavy', coalescing: 'project' },
    'asset.auditUnmanagedWrites': { costClass: 'read_heavy', coalescing: 'project' },
    'asset.queryPropertySchema': { costClass: 'read_light', coalescing: 'project', cache: 'revision_lru', consistency: 'revision_validated' },
    'asset.queryInheritance': { costClass: 'read_light', coalescing: 'project', cache: 'revision_lru', consistency: 'revision_validated' },
    'asset.queryCompatibleTypes': { costClass: 'read_light', coalescing: 'project', cache: 'revision_lru', consistency: 'revision_validated' },
    'scene.getCurrent': { costClass: 'read_light', coalescing: 'project' },
    'scene.getHierarchy': { costClass: 'read_heavy', coalescing: 'project' },
    'scene.queryCurrentEditorResource': { costClass: 'read_light', coalescing: 'project' },
    'scene.resolvePrefabRootUuid': { costClass: 'read_light', coalescing: 'project' },
    'scene.queryNode': { costClass: 'read_light', coalescing: 'project' },
    'prefab.getInfo': { costClass: 'read_heavy', coalescing: 'project' },
    'preview.query': { costClass: 'read_light' },
    'preview.queryErrors': { costClass: 'read_heavy' },
    'builder.queryPlatforms': { costClass: 'read_light', coalescing: 'project', cache: 'revision_lru', consistency: 'revision_validated' },
    'builder.querySchema': { costClass: 'read_light', coalescing: 'project', cache: 'revision_lru', consistency: 'revision_validated' },
    'builder.queryDefaultConfig': { costClass: 'read_light', coalescing: 'project', cache: 'revision_lru', consistency: 'revision_validated' },
    'lumen.schema': { costClass: 'read_light', coalescing: 'project', cache: 'revision_lru', consistency: 'revision_validated' },
    'lumen.templates': { costClass: 'read_light', coalescing: 'project', cache: 'revision_lru', consistency: 'revision_validated' },
    'lumen.tree': { costClass: 'read_heavy', coalescing: 'project' },
    'lumen.inspect': { costClass: 'read_light', coalescing: 'project' },
    'lumen.validateRefs': { costClass: 'read_heavy', coalescing: 'project' },
    'lumen.compileRecipe': { costClass: 'prepare', coalescing: 'project' },
    'lumen.cocosInfo': { costClass: 'read_heavy', coalescing: 'project' },
    'lumen.lodRecalcBounds': { costClass: 'prepare', coalescing: 'project' },
    'reference.queryImage': { costClass: 'read_light', coalescing: 'project' },
});

const prepareEligibleWrites = new Set<CoreCocosNativeWriteOperation>([
    'asset.import', 'asset.replaceReferences', 'asset.copy', 'asset.move', 'asset.rename', 'asset.createFolder',
    'asset.delete', 'asset.reimport', 'asset.writeText', 'asset.ensureSpriteFramesBatch', 'scene.createNode',
    'prefab.createFromNode', 'lumen.scaffold', 'lumen.structure', 'lumen.nodeAdd', 'lumen.nodeRm',
    'lumen.nodeRename', 'lumen.nodeReorder', 'lumen.compAdd', 'lumen.compRm', 'lumen.compSet',
    'lumen.assetSet', 'lumen.nodeSet', 'lumen.bindClick', 'lumen.bindSprite', 'lumen.bindSpriteBatch',
    'lumen.bindRef', 'lumen.bindController', 'reference.setImage',
]);

const explicitBatchEligibleWrites = new Set<CoreCocosNativeWriteOperation>([
    'asset.import', 'asset.copy', 'asset.move', 'asset.rename', 'asset.createFolder', 'asset.reimport', 'asset.writeText',
    'asset.ensureSpriteFramesBatch', 'scene.createNode', 'prefab.createFromNode', 'lumen.scaffold', 'lumen.structure',
    'lumen.nodeAdd', 'lumen.nodeRm', 'lumen.nodeRename', 'lumen.nodeReorder', 'lumen.compAdd', 'lumen.compRm',
    'lumen.compSet', 'lumen.assetSet', 'lumen.nodeSet', 'lumen.bindClick', 'lumen.bindSprite',
    'lumen.bindSpriteBatch', 'lumen.bindRef', 'lumen.bindController', 'reference.setImage',
]);

const automaticBatchEligibleWrites = new Set<CoreCocosNativeWriteOperation>([
    'lumen.nodeAdd', 'lumen.nodeRename', 'lumen.nodeReorder', 'lumen.compAdd', 'lumen.compSet', 'lumen.assetSet',
    'lumen.nodeSet', 'lumen.bindClick', 'lumen.bindSprite', 'lumen.bindSpriteBatch', 'lumen.bindRef',
    'lumen.bindController',
]);

/**
 * @description 由 38 读与 45 写权威账本生成吞吐画像，并在构造时校验完整性。
 * 默认值保持保守：读等待 writer、无缓存/合并；写不允许合批，只有显式 allow-list 才放宽。
 */
export class CoreCocosMcpOperationThroughputProfileCatalog {
    private readonly profiles: readonly ICoreCocosMcpOperationThroughputProfile[];
    private readonly byOperation: ReadonlyMap<CoreCocosMcpPublicOperation, ICoreCocosMcpOperationThroughputProfile>;

    public constructor() {
        const profiles: ICoreCocosMcpOperationThroughputProfile[] = [
            ...CoreCocosMcpCapabilityCatalog.list().map((capability) => this.createReadProfile(capability.operation)),
            ...CoreCocosNativeWriteCapabilityCatalog.list().map((capability) => this.createWriteProfile(capability.operation, capability.risk)),
        ];
        CoreCocosMcpOperationThroughputProfileCatalog.validate(profiles);
        this.profiles = Object.freeze(profiles);
        this.byOperation = new Map(profiles.map((profile) => [profile.operation, profile]));
    }

    public list(): readonly ICoreCocosMcpOperationThroughputProfile[] {
        return this.profiles;
    }

    public find(operation: unknown): ICoreCocosMcpOperationThroughputProfile | null {
        return typeof operation === 'string'
            ? (this.byOperation.get(operation as CoreCocosMcpPublicOperation) ?? null)
            : null;
    }

    /**
     * @description 对外提供构建期校验入口，供发布校验捕获缺失、重复和读写分类漂移。
     * @param profiles 待校验的 operation 画像。
     */
    public static validate(profiles: readonly ICoreCocosMcpOperationThroughputProfile[]): void {
        const canonical = new Map<CoreCocosMcpPublicOperation, { readonly readOnly: boolean; readonly risk: 'read' | CoreCocosNativeWriteRisk }>();
        for (const capability of CoreCocosMcpCapabilityCatalog.list()) {
            canonical.set(capability.operation, { readOnly: true, risk: 'read' });
        }
        for (const capability of CoreCocosNativeWriteCapabilityCatalog.list()) {
            if (canonical.has(capability.operation)) {
                throw new Error(`core_cocos_mcp_throughput_profile_catalog_duplicate:${capability.operation}`);
            }
            canonical.set(capability.operation, { readOnly: false, risk: capability.risk });
        }

        const seen = new Set<CoreCocosMcpPublicOperation>();
        let readCount = 0;
        let writeCount = 0;
        for (const profile of profiles) {
            const expected = canonical.get(profile.operation);
            if (expected == null) {
                throw new Error(`core_cocos_mcp_throughput_profile_unknown:${profile.operation}`);
            }
            if (seen.has(profile.operation)) {
                throw new Error(`core_cocos_mcp_throughput_profile_duplicate:${profile.operation}`);
            }
            seen.add(profile.operation);
            if (profile.readOnly !== expected.readOnly || profile.risk !== expected.risk) {
                throw new Error(`core_cocos_mcp_throughput_profile_classification_mismatch:${profile.operation}`);
            }
            if (profile.readOnly) {
                readCount += 1;
                if (profile.read == null || profile.write != null || profile.costClass === 'control' || profile.costClass === 'writer') {
                    throw new Error(`core_cocos_mcp_throughput_profile_read_shape_invalid:${profile.operation}`);
                }
                if (profile.read.cache === 'revision_lru' && profile.read.coalescing === 'none') {
                    throw new Error(`core_cocos_mcp_throughput_profile_cache_without_coalescing:${profile.operation}`);
                }
            } else {
                writeCount += 1;
                if (profile.read != null || profile.write == null || profile.costClass !== 'writer') {
                    throw new Error(`core_cocos_mcp_throughput_profile_write_shape_invalid:${profile.operation}`);
                }
                if (profile.write.automaticBatchEligible && !profile.write.explicitBatchEligible) {
                    throw new Error(`core_cocos_mcp_throughput_profile_auto_batch_without_explicit:${profile.operation}`);
                }
            }
        }

        for (const operation of canonical.keys()) {
            if (!seen.has(operation)) {
                throw new Error(`core_cocos_mcp_throughput_profile_missing:${operation}`);
            }
        }
        if (profiles.length !== 83 || readCount !== 38 || writeCount !== 45) {
            throw new Error(`core_cocos_mcp_throughput_profile_count_mismatch:${profiles.length}:${readCount}:${writeCount}`);
        }
    }

    private createReadProfile(operation: CoreCocosMcpOperation): ICoreCocosMcpOperationThroughputProfile {
        const overrides = readOverrides[operation];
        const read = Object.freeze({
            coalescing: overrides.coalescing ?? 'none',
            cache: overrides.cache ?? 'none',
            consistency: overrides.consistency ?? 'writer_barrier',
        });
        return Object.freeze({ operation, readOnly: true, risk: 'read', costClass: overrides.costClass, read, write: null });
    }

    private createWriteProfile(
        operation: CoreCocosNativeWriteOperation,
        risk: CoreCocosNativeWriteRisk,
    ): ICoreCocosMcpOperationThroughputProfile {
        const write = Object.freeze({
            prepareEligible: prepareEligibleWrites.has(operation),
            explicitBatchEligible: explicitBatchEligibleWrites.has(operation),
            automaticBatchEligible: automaticBatchEligibleWrites.has(operation),
        });
        return Object.freeze({ operation, readOnly: false, risk, costClass: 'writer', read: null, write });
    }
}
