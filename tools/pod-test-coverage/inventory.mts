import type { ICoverageInventory, ICoverageManifest } from '../editor-stability/coverage-contracts.mjs';
import { CoverageManifestGenerator } from '../editor-stability/coverage-manifest-generator.mjs';
import { PodCoverageContracts, type IPodCoverageInput } from './contracts.mjs';
import { PodCoverageInputReader } from './input-reader.mjs';

/**
 * @description 独立来源声明的一项能力；测试定义与结果均不能删除它。
 */
export interface IPodCoverageInventoryCapability {
    readonly id: string;
    readonly sourceId: string;
    readonly sourceSubject: string;
    readonly ownerRepo: string;
    readonly origin: string;
}

/**
 * @description 一个来源的读取和分母审阅状态。
 */
export interface IPodCoverageSourceAssessment {
    readonly id: string;
    readonly repository: string;
    readonly kind: string;
    readonly completeness: 'complete' | 'missing' | 'unverified';
    readonly reason: string | null;
    readonly capabilities: readonly IPodCoverageInventoryCapability[];
    readonly liteInventory: ICoverageInventory | null;
    readonly liteManifest: ICoverageManifest | null;
    /**
     * @description CPM stable 空清单明确不可用；非空未验签时未知。
     */
    readonly releaseAvailable?: boolean | null;
}

/**
 * @description 与用例执行结果无关的来源分母及候选绑定。
 */
export interface IPodCoverageInventoryAssessment {
    readonly sources: readonly IPodCoverageSourceAssessment[];
    readonly capabilities: readonly IPodCoverageInventoryCapability[];
    readonly missingRepositories: readonly string[];
    readonly missingSourceIds: readonly string[];
    readonly complete: boolean;
}

/**
 * @description 只读接收权威目录和人工审阅来源，不重新推断 Creator 原生分母。
 */
export class PodCoverageInventory {
    /**
     * @description 无损验证现有 Lite inventory 与由它生成的全 pending manifest。
     * @param bytes 原始草稿文件字节。
     * @returns 保留原目标、动作及动态未决集合的现有结构。
     */
    public static readLiteDraft(bytes: Uint8Array): { readonly inventory: ICoverageInventory; readonly manifest: ICoverageManifest } {
        const draft = PodCoverageContracts.record(this.parse(bytes), ['purpose', 'inventory', 'manifest'], 'lite_draft');
        if (draft.purpose !== 'unverified_coverage_draft') throw new Error('pod_coverage_lite_draft_purpose_invalid');
        const inventory = draft.inventory as ICoverageInventory;
        const manifest = draft.manifest as ICoverageManifest;
        CoverageManifestGenerator.assertInventory(inventory);
        const expected = CoverageManifestGenerator.createDraft(inventory);
        if (CoverageManifestGenerator.digest(manifest) !== CoverageManifestGenerator.digest(expected)) {
            throw new Error('pod_coverage_lite_draft_manifest_mismatch');
        }
        return { inventory, manifest };
    }

    /**
     * @description 读取显式来源引用并检查候选绑定，缺根保留为缺口。
     * @param input 已校验的覆盖输入。
     * @param reader 仅含调用方允许根的只读读取器。
     * @returns 独立分母和来源完整性状态。
     */
    public static inspect(input: IPodCoverageInput, reader: PodCoverageInputReader): IPodCoverageInventoryAssessment {
        const candidate = PodCoverageContracts.record(input.candidate, null, 'candidate');
        const repositories = PodCoverageContracts.record(candidate.repositories, null, 'candidate_repositories');
        const digests = PodCoverageContracts.record(candidate.inputDigests, null, 'candidate_input_digests');
        const environments = PodCoverageContracts.stringArray(candidate.environments, 'candidate_environments');
        const sources = input.sources.map((source) => this.inspectSource(source, reader, repositories, digests, environments));
        const declaredRepositories = Object.keys(repositories).sort();
        const sourceRepositories = new Set(input.sources.map((source) => String(source.repository)));
        const missingRepositories = declaredRepositories.filter((repository) => !sourceRepositories.has(repository));
        const sourceIds = new Set(sources.map((source) => source.id));
        const missingSourceIds = Object.keys(digests).filter((id) => !id.startsWith('test-source:') && !sourceIds.has(id)).sort();
        const capabilities = sources.flatMap((source) => source.capabilities);
        const ids = new Set<string>();
        for (const capability of capabilities) {
            if (ids.has(capability.id)) throw new Error('pod_coverage_inventory_capability_duplicate');
            ids.add(capability.id);
        }
        return { sources, capabilities, missingRepositories, missingSourceIds,
            complete: sources.length > 0 && missingRepositories.length === 0 && missingSourceIds.length === 0
                && sources.every((source) => source.completeness === 'complete') };
    }

    /**
     * @description 对单个来源核对原始摘要、仓库身份与类型固定的目录格式。
     * @param row 来源声明。
     * @param reader 安全读取器。
     * @param repositories 候选仓库身份。
     * @param digests 候选相关输入摘要。
     * @param environments 候选精确环境。
     * @returns 来源审阅结果。
     */
    private static inspectSource(row: Readonly<Record<string, unknown>>, reader: PodCoverageInputReader,
        repositories: Readonly<Record<string, unknown>>, digests: Readonly<Record<string, unknown>>,
        environments: readonly string[]): IPodCoverageSourceAssessment {
        const id = PodCoverageContracts.identifier(row.id);
        const repository = PodCoverageContracts.identifier(row.repository);
        const kind = String(row.kind);
        if (row.role !== 'current-product' && row.role !== 'fixed-dependency'
            || kind === 'pro-fixed-lite' && row.role !== 'fixed-dependency'
            || typeof row.commit !== 'string' || !/^[0-9a-f]{40,64}$/u.test(row.commit)
            || typeof row.tree !== 'string' || !/^[0-9a-f]{40,64}$/u.test(row.tree)) {
            throw new Error(`pod_coverage_source_identity_invalid:${id}`);
        }
        const blank = (reason: string): IPodCoverageSourceAssessment =>
            ({ id, repository, kind, completeness: reason === 'source_root_missing' || reason === 'source_file_missing' ? 'missing' : 'unverified',
                reason, capabilities: [], liteInventory: null, liteManifest: null });
        if (!this.supportedKinds.has(kind)) return blank('source_kind_unverified');
        const reference = PodCoverageContracts.reference(row.sourceRef);
        let bytes: Uint8Array;
        try {
            bytes = reader.readReference(reference);
        } catch (error) {
            if (error instanceof Error && error.message === 'pod_coverage_reference_root_missing') return blank('source_root_missing');
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return blank('source_file_missing');
            throw error;
        }
        const parsed = kind === 'lite-coverage-draft' ? this.readLiteDraft(bytes) : null;
        const document = parsed === null ? this.parse(bytes) : null;
        let capabilities: readonly IPodCoverageInventoryCapability[];
        try {
            capabilities = this.derive(kind, id, repository, document, parsed, reader);
        } catch (error) {
            if (error instanceof Error && error.message === 'pod_coverage_reference_root_missing') return blank('source_root_missing');
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return blank('source_file_missing');
            throw error;
        }
        const binding = repositories[repository];
        const identity = binding === undefined ? null : PodCoverageContracts.record(binding, null, 'candidate_repository');
        const commitMatch = identity?.commit === row.commit && identity?.tree === row.tree;
        if (digests[id] !== undefined && digests[id] !== row.sha256) {
            throw new Error(`pod_coverage_candidate_source_digest_changed:${id}`);
        }
        const digestMatch = digests[id] === row.sha256;
        const version = row.creatorVersion;
        const environmentMatch = version === null || typeof version === 'string'
            && (environments.includes(version) || environments.includes(`creator-${version}`));
        const reviewed = row.completeness === 'complete' || row.completeness === 'reviewed';
        const cpmReleases = kind === 'cpm-release-manifest-v2'
            ? PodCoverageContracts.record(document, null, 'cpm_release_manifest').releases as readonly unknown[] : null;
        const reason = !commitMatch ? 'candidate_repository_identity_missing_or_changed'
            : !digestMatch ? 'candidate_source_digest_missing_or_changed'
                : !environmentMatch ? 'candidate_creator_version_missing'
                    : !reviewed ? 'source_completeness_unverified'
                        : cpmReleases !== null && cpmReleases.length > 0 ? 'cpm_release_signature_and_install_unverified' : null;
        return { id, repository, kind, completeness: reason === null ? 'complete' : 'unverified', reason, capabilities,
            liteInventory: parsed?.inventory ?? null, liteManifest: parsed?.manifest ?? null,
            releaseAvailable: cpmReleases === null ? null : cpmReleases.length === 0 ? false : null };
    }

    /**
     * @description 从来源自己的目录项派生稳定能力标识，绝不从测试结果扩充或缩小分母。
     * @param kind 固定来源类型。
     * @param sourceId 来源标识。
     * @param repository 责任仓库。
     * @param document 已解析的来源 JSON。
     * @param lite 已核对的 Lite 既有草稿。
     * @param reader 显式根读取器，用于复核 Server 审阅清单绑定。
     * @returns 每项独立目录能力。
     */
    private static derive(kind: string, sourceId: string, repository: string, document: unknown,
        lite: { readonly inventory: ICoverageInventory; readonly manifest: ICoverageManifest } | null,
        reader: PodCoverageInputReader): readonly IPodCoverageInventoryCapability[] {
        const capability = (subject: string, origin: string): IPodCoverageInventoryCapability =>
            ({ id: `${sourceId}:${PodCoverageContracts.sha256(Buffer.from(`${origin}\0${subject}`))}`, sourceId,
                sourceSubject: subject, ownerRepo: repository, origin });
        if (kind === 'lite-coverage-draft') {
            if (lite === null) throw new Error('pod_coverage_lite_draft_missing');
            return lite.inventory.targets.flatMap((target) => target.actions.map((action) =>
                capability(`${target.id}|${action}`, 'lite-target-action')));
        }
        const record = PodCoverageContracts.record(document, null, 'source_document');
        if (kind === 'pro-core-catalog' || kind === 'pro-premium-catalog') {
            if (record.schemaVersion !== 1 || !Array.isArray(record.operations)
                || record.operationCount !== record.operations.length) throw new Error('pod_coverage_pro_catalog_invalid');
            const operations = this.uniqueStrings(record.operations, 'pro_operations');
            return operations.map((operation) => capability(operation, kind));
        }
        if (kind === 'pro-plugin-manifest') {
            const pluginId = PodCoverageContracts.identifier(record.id);
            if (typeof record.version !== 'string' || record.version.length === 0) throw new Error('pod_coverage_plugin_version_invalid');
            const contributions = PodCoverageContracts.record(record.contributions, null, 'plugin_contributions');
            const panels = contributions.panels === undefined ? [] : this.arrayRecords(contributions.panels, 'plugin_panels');
            return [capability(`plugin:${pluginId}`, kind), ...panels.map((panel) =>
                capability(`panel:${PodCoverageContracts.identifier(panel.id)}`, kind))];
        }
        if (kind === 'pro-package' || kind === 'cpm-package') {
            const name = typeof record.name === 'string' && record.name.length > 0 && record.name.length <= 256
                ? record.name : null;
            if (name === null) throw new Error('pod_coverage_package_name_invalid');
            if (typeof record.version !== 'string' || record.version.length === 0) throw new Error('pod_coverage_package_version_invalid');
            const scripts = record.scripts === undefined ? {} : PodCoverageContracts.record(record.scripts, null, 'package_scripts');
            const entries = kind === 'cpm-package' ? Object.keys(scripts).filter((key) => /release|bootstrap|install/u.test(key)) : [];
            return [capability(`package:${name}`, kind), ...entries.map((entry) => capability(`script:${name}:${entry}`, kind))];
        }
        if (kind === 'cpm-release-manifest-v2') {
            const keys = Object.keys(record);
            if (record.schemaVersion !== 2 || record.channel !== 'stable' || !Array.isArray(record.releases)
                || record.releases.length > PodCoverageContracts.maxCases
                || keys.some((key) => !['schemaVersion', 'channel', 'publicKey', 'releases'].includes(key))
                || !['schemaVersion', 'channel', 'releases'].every((key) => Object.hasOwn(record, key))) {
                throw new Error('pod_coverage_cpm_release_manifest_invalid');
            }
            const releases = this.arrayRecords(record.releases, 'cpm_releases');
            if (releases.length > 0) {
                const key = PodCoverageContracts.record(record.publicKey,
                    ['keyId', 'algorithm', 'format', 'value'], 'cpm_public_key');
                if (typeof key.keyId !== 'string' || key.algorithm !== 'ed25519' || key.format !== 'spki-der-base64'
                    || typeof key.value !== 'string' || key.value.length === 0) {
                    throw new Error('pod_coverage_cpm_public_key_invalid');
                }
            } else if (record.publicKey !== undefined && record.publicKey !== null) {
                throw new Error('pod_coverage_cpm_empty_public_key_invalid');
            }
            const identities = new Set<string>();
            const items = releases.map((release) => {
                PodCoverageContracts.record(release, ['id', 'version', 'channel', 'url', 'sha256', 'signature'], 'cpm_release');
                const id = PodCoverageContracts.identifier(release.id);
                const version = String(release.version);
                if (!/^\d+\.\d+\.\d+$/u.test(version) || release.channel !== 'stable'
                    || !PodCoverageContracts.digest(release.sha256) || typeof release.signature !== 'string'
                    || release.signature.length === 0 || release.signature.length > 4096) {
                    throw new Error('pod_coverage_cpm_release_invalid');
                }
                let url: URL;
                try { url = new URL(String(release.url)); }
                catch { throw new Error('pod_coverage_cpm_release_url_invalid'); }
                if (url.protocol !== 'https:' || url.username || url.password || url.hash || typeof release.url !== 'string') {
                    throw new Error('pod_coverage_cpm_release_url_invalid');
                }
                const identity = `${id}@${version}`;
                if (identities.has(identity)) throw new Error('pod_coverage_cpm_release_duplicate');
                identities.add(identity);
                return capability(`release:${identity}:unverified`, kind);
            });
            return [capability('channel:stable:public-release-unavailable-or-unverified', kind), ...items];
        }
        if (kind === 'pro-fixed-lite') {
            const productId = PodCoverageContracts.identifier(record.productId);
            if (typeof record.version !== 'string' || record.version.length === 0) throw new Error('pod_coverage_fixed_lite_invalid');
            return [capability(`fixed-lite:${productId}:${record.version}`, kind)];
        }
        if (kind === 'server-reviewed-routes') {
            if (record.schemaVersion !== 'pod-server-review.v1' || typeof record.reviewer !== 'string'
                || record.reviewer.length === 0 || !Array.isArray(record.limitations)) {
                throw new Error('pod_coverage_server_review_invalid');
            }
            const routes = this.arrayRecords(record.routes, 'server_routes');
            const subjects = new Set<string>();
            for (const route of routes) {
                const routeId = PodCoverageContracts.identifier(route.id);
                if (subjects.has(routeId) || typeof route.method !== 'string' || typeof route.path !== 'string') {
                    throw new Error('pod_coverage_server_route_invalid');
                }
                subjects.add(routeId);
                if (!Array.isArray(route.implementationRefs) || route.implementationRefs.length === 0) {
                    throw new Error('pod_coverage_server_route_unbound');
                }
                for (const ref of route.implementationRefs) reader.readReference(ref);
            }
            return routes.map((route) => capability(`route:${String(route.id)}`, kind));
        }
        if (kind === 'curated-business') {
            if (record.schemaVersion !== 'pod-business-capabilities.v1') throw new Error('pod_coverage_curated_schema_invalid');
            const entries = this.arrayRecords(record.capabilities, 'curated_capabilities');
            return entries.map((entry) => capability(PodCoverageContracts.identifier(entry.id), kind));
        }
        throw new Error('pod_coverage_source_kind_invalid');
    }

    /**
     * @description 用固定上限解析 UTF-8 JSON 来源，不执行其中的任何代码。
     * @param bytes 原始来源字节。
     * @returns 有界 JSON 值。
     */
    private static parse(bytes: Uint8Array): unknown {
        let value: unknown;
        try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
        catch { throw new Error('pod_coverage_source_json_invalid'); }
        PodCoverageContracts.assertJsonBounds(value);
        return value;
    }

    /**
     * @description 收窄有界无重复字符串集合。
     * @param value 来源数组。
     * @param label 错误标识。
     * @returns 原始顺序的字符串。
     */
    private static uniqueStrings(value: unknown, label: string): readonly string[] {
        const values = PodCoverageContracts.stringArray(value, label);
        if (new Set(values).size !== values.length || values.some((item) => item.length === 0)) {
            throw new Error(`pod_coverage_${label}_duplicate_or_empty`);
        }
        return values;
    }

    /**
     * @description 收窄有界对象列表。
     * @param value 来源数组。
     * @param label 错误标识。
     * @returns 对象列表。
     */
    private static arrayRecords(value: unknown, label: string): readonly Readonly<Record<string, unknown>>[] {
        if (!Array.isArray(value) || value.length > PodCoverageContracts.maxCases) throw new Error(`pod_coverage_${label}_invalid`);
        return value.map((item) => PodCoverageContracts.record(item, null, label));
    }

    /**
     * @description 本版本唯一允许给予目录解释权的来源类型。
     */
    private static readonly supportedKinds = new Set(['lite-coverage-draft', 'pro-core-catalog', 'pro-premium-catalog',
        'pro-plugin-manifest', 'pro-package', 'pro-fixed-lite', 'server-reviewed-routes', 'cpm-package',
        'cpm-release-manifest-v2', 'curated-business']);
}
