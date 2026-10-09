'use strict';

const { createHash } = require('crypto');
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('fs');
const { isAbsolute, join, relative, resolve, sep } = require('path');
const { createGunzip } = require('zlib');
const https = require('https');
const { RemotePackageDownloader, SignedPluginCatalogVerifier } = require('@peanut/pod-engine/installation');
const { CreatorContextResolver } = require('@peanut/pod-hosts');

const { LiteAccountController, createSignedOutAccount } = require('./account-controller');
const { CpmPackageStore } = require('./cpm-package-store');
const { createLiteGrantedRuntime, createLiteReadRuntime } = require('./lite-granted-runtime');
const {
    getPluginManagerKernel,
    getPluginManagerMethods,
    loadPluginManagerShell,
    unloadPluginManagerShell,
} = require('./plugin-manager-shell');
const { PluginServiceRegistry } = require('./plugin-service-registry');
const { listPremiumOffer } = require('./premium-offer-catalog');
const { SystemProtectedKeyStore } = require('./system-protected-key-store');

const CORE_PLUGIN_ID = 'peanut.pod-lite';
const PRO_PLUGIN_ID = 'peanut.cocos-mcp-pro';
const HUB_CAPABILITY_PLUGIN_ID = 'peanut.editor-mcp';
const RUNTIME_DIR_NAME = 'runtime';

let coreModule = null;
let coreTaskApi = null;
let proModule = null;
let toolHandlers = new Map();
let hubCapabilityDisposers = [];
let hubPublishedCount = 0;
const serviceRegistry = new PluginServiceRegistry();
let protectedKeyStore = null;
let accountController = null;
let coreArtifact = null;
let proArtifact = null;
let acceptanceCatalogTestCa = null;

const hostArtifact = resolveHostArtifactIdentity();
let hostStatus = createStoppedStatus();
let creatorContext = null;

function getEditor() {
    return globalThis.Editor;
}

function requireProjectPath() {
    const projectPath = getEditor()?.Project?.path;
    if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
        throw new Error('peanut_cocos_mcp_core_project_path_unavailable');
    }
    return projectPath;
}

function createRuntime() {
    return createLiteReadRuntime();
}

function readAcceptanceTrustedCatalog() {
    const verifiedCatalog = readVerifiedAcceptanceCatalog();
    if (verifiedCatalog == null) {
        return { status: 'unavailable', channel: null, generatedAt: null, products: [] };
    }
    const generatedAt = Date.parse(verifiedCatalog.generatedAt);
    return {
        status: Date.now() - generatedAt > 24 * 60 * 60 * 1000 ? 'stale' : 'available',
        channel: verifiedCatalog.channel,
        generatedAt: verifiedCatalog.generatedAt,
        products: verifiedCatalog.products.map((product) => ({
            productId: product.productId,
            version: product.version,
            channel: product.channel,
            creatorProfiles: product.creatorProfiles,
        })),
    };
}

function readVerifiedAcceptanceCatalog() {
    const projectPath = requireProjectPath();
    const fixtureRoot = resolve(projectPath, '.peanut-ai', 'lifecycle-acceptance');
    const fixtureEnabled = existsSync(join(fixtureRoot, 'enable-test-catalog'));
    const catalogPath = process.env.PEANUT_LITE_ACCEPTANCE_CATALOG_PATH
        ?? (fixtureEnabled ? join(fixtureRoot, 'catalog.json') : null);
    const trustAnchor = process.env.PEANUT_LITE_ACCEPTANCE_CATALOG_TRUST_ANCHOR
        ?? (fixtureEnabled ? readFileSync(join(fixtureRoot, 'trust-anchor.txt'), 'utf8').trim() : null);
    if (typeof catalogPath !== 'string' || catalogPath.trim().length === 0
        || typeof trustAnchor !== 'string' || trustAnchor.trim().length === 0) {
        acceptanceCatalogTestCa = null;
        return null;
    }
    const resolvedCatalogPath = resolve(catalogPath);
    const fixtureRelativePath = relative(fixtureRoot, resolvedCatalogPath);
    if (isAbsolute(fixtureRelativePath) || fixtureRelativePath === '..' || fixtureRelativePath.startsWith(`..${sep}`)) {
        throw new Error('acceptance_catalog_fixture_outside_project');
    }
    if (statSync(resolvedCatalogPath).size > 1024 * 1024) throw new Error('plugin_catalog_size_refused');
    acceptanceCatalogTestCa = fixtureEnabled ? readFileSync(join(fixtureRoot, 'test-ca.pem')) : null;
    const signedCatalog = JSON.parse(readFileSync(resolvedCatalogPath, 'utf8'));
    return new SignedPluginCatalogVerifier(trustAnchor).verify(signedCatalog);
}

async function installTrustedCatalogPackage({ productId, version }) {
    const catalog = readVerifiedAcceptanceCatalog();
    if (catalog == null) throw new Error('plugin_catalog_unavailable');
    const product = catalog.products.find((item) => item.productId === productId && item.version === version);
    if (product == null) throw new Error('plugin_catalog_product_not_found');
    if (!product.creatorProfiles.includes(creatorContext.version.raw)) throw new Error('plugin_catalog_creator_incompatible');

    const projectPath = requireProjectPath();
    const stagingRoot = join(projectPath, 'peanut-plugins', 'staging', 'remote-catalog');
    mkdirSync(stagingRoot, { recursive: true });
    const download = await new RemotePackageDownloader({ stagingDirectory: stagingRoot, fetch: fetchTrustedCatalogArchive }).download(product);
    const extractedPath = join(stagingRoot, `package-${productId}-${version}-${Date.now()}`);
    try {
        mkdirSync(extractedPath, { recursive: true });
        await extractTrustedTarGzipArchive(download.archivePath, extractedPath);
        const entries = readdirSync(extractedPath, { withFileTypes: true });
        const packagePath = entries.length === 1 && entries[0].isDirectory()
            ? join(extractedPath, entries[0].name)
            : extractedPath;
        const pluginManager = getPluginManagerKernel();
        const inspection = await pluginManager.inspectPackage(packagePath);
        if (!inspection.isValidStructure || inspection.manifest?.id !== productId
            || inspection.manifest?.version !== version || inspection.packageMeta?.digest !== product.packageDigest) {
            throw new Error('plugin_catalog_package_identity_mismatch');
        }
        const result = await pluginManager.installPackage(packagePath);
        return { pluginId: result.pluginId, version: result.version, installPath: result.installPath };
    } finally {
        download.dispose();
        rmSync(extractedPath, { recursive: true, force: true });
    }
}

function fetchTrustedCatalogArchive(url, init) {
    return new Promise((resolveResponse, rejectResponse) => {
        const target = new URL(url);
        const request = https.request(target, {
            method: 'GET',
            ...(acceptanceCatalogTestCa != null && target.hostname === 'localhost' ? { ca: acceptanceCatalogTestCa } : {}),
        }, (response) => {
            const iterator = response[Symbol.asyncIterator]();
            resolveResponse({
                ok: response.statusCode >= 200 && response.statusCode < 300,
                status: response.statusCode || 0,
                redirected: response.statusCode >= 300 && response.statusCode < 400,
                headers: { get: (name) => response.headers[name.toLowerCase()] ?? null },
                body: {
                    getReader: () => ({
                        read: async () => {
                            const next = await iterator.next();
                            return { done: next.done, ...(next.done ? {} : { value: new Uint8Array(next.value) }) };
                        },
                        cancel: async () => { response.destroy(); },
                    }),
                },
            });
        });
        request.on('error', rejectResponse);
        const signal = init?.signal;
        if (signal?.aborted) {
            request.destroy(new Error('plugin_download_cancelled'));
            rejectResponse(new Error('plugin_download_cancelled'));
            return;
        }
        signal?.addEventListener?.('abort', () => request.destroy(new Error('plugin_download_cancelled')), { once: true });
        request.end();
    });
}

async function extractTrustedTarGzipArchive(archivePath, destinationPath) {
    const compressed = readFileSync(archivePath);
    const decompressor = createGunzip();
    const chunks = [];
    let decompressedBytes = 0;
    const tar = await new Promise((resolveTar, rejectTar) => {
        decompressor.on('data', (chunk) => {
            decompressedBytes += chunk.length;
            if (decompressedBytes > 256 * 1024 * 1024) {
                decompressor.destroy(new Error('plugin_archive_expanded_size_refused'));
                return;
            }
            chunks.push(chunk);
        });
        decompressor.on('error', rejectTar);
        decompressor.on('end', () => resolveTar(Buffer.concat(chunks, decompressedBytes)));
        decompressor.end(compressed);
    });
    let offset = 0;
    let expandedBytes = 0;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) break;
        const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/u, '');
        const name = field(0, 100);
        const prefix = field(345, 155);
        const relativePath = [prefix, name].filter(Boolean).join('/').replace(/^\.\//u, '');
        const type = header[156];
        const sizeText = field(124, 12).trim();
        if (!/^[0-7]+$/u.test(sizeText || '0')) throw new Error('plugin_archive_tar_size_invalid');
        const size = Number.parseInt(sizeText || '0', 8);
        expandedBytes += size;
        if (!Number.isSafeInteger(size) || size < 0 || expandedBytes > 256 * 1024 * 1024) throw new Error('plugin_archive_expanded_size_refused');
        const segments = relativePath.split('/').filter(Boolean);
        if (segments.length === 0 || relativePath.includes('\\') || segments.some((segment) => segment === '.' || segment === '..')) {
            throw new Error('plugin_archive_path_invalid');
        }
        const outputPath = join(destinationPath, ...segments);
        const resolvedPath = resolve(outputPath);
        const fromRoot = relative(destinationPath, resolvedPath);
        if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) throw new Error('plugin_archive_path_invalid');
        const dataOffset = offset + 512;
        if (type === 53) {
            mkdirSync(outputPath, { recursive: true });
        } else if (type === 0 || type === 48) {
            if (dataOffset + size > tar.length) throw new Error('plugin_archive_tar_truncated');
            mkdirSync(join(outputPath, '..'), { recursive: true });
            writeFileSync(outputPath, tar.subarray(dataOffset, dataOffset + size), { flag: 'wx' });
        } else {
            throw new Error('plugin_archive_entry_type_refused');
        }
        offset = dataOffset + Math.ceil(size / 512) * 512;
    }
}

function resolveTrustedCreatorContext() {
    const hostVersion = getEditor()?.App?.version;
    if (typeof hostVersion !== 'string' || hostVersion.trim().length === 0) {
        throw new Error('creator_version_unavailable');
    }
    let projectVersion = null;
    try {
        const projectPackage = JSON.parse(readFileSync(join(requireProjectPath(), 'package.json'), 'utf8'));
        if (typeof projectPackage?.creator?.version === 'string') {
            projectVersion = projectPackage.creator.version;
        }
    } catch (error) {
        getEditor()?.warn?.(`[peanut-pod-lite] project_creator_version_unavailable:${normalizeError(error)}`);
    }
    const context = CreatorContextResolver.resolve(hostVersion, projectVersion);
    if (context.profileId !== 'creator-38') {
        throw new Error(`creator_profile_host_mismatch:${context.profileId}:creator-38`);
    }
    return context;
}

function resolveHostArtifactIdentity() {
    const packageManifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    return Object.freeze({
        id: packageManifest.name,
        version: packageManifest.version,
        mainDigest: createHash('sha256').update(readFileSync(__filename)).digest('hex'),
        // 仅打包后的扩展（dist/main.js）可对照 release descriptor 的 Host 目录包摘要。
        packageDigest: __filename.endsWith(join('dist', 'main.js')) ? CpmPackageStore.hostPackageDigest(join(__dirname, '..')) : null,
    });
}

function resolvePackageArtifactIdentity(verified) {
    return Object.freeze({
        id: verified.manifest.id,
        version: verified.manifest.version,
        packageDigest: verified.manifest.package.digest,
        packedAt: typeof verified.manifest.package.packedAt === 'string' ? verified.manifest.package.packedAt : null,
    });
}

function artifactIdentitySnapshot() {
    return Object.freeze({ host: hostArtifact, core: coreArtifact, pro: proArtifact });
}


function disposeHubCapabilityRegistrations() {
    while (hubCapabilityDisposers.length > 0) {
        const dispose = hubCapabilityDisposers.pop();
        try {
            dispose?.();
        } catch (error) {
            getEditor()?.warn?.(`[peanut-pod-lite] hub_capability_dispose_failed:${normalizeError(error)}`);
        }
    }
    hubPublishedCount = 0;
}

function toHubCapabilityDefinition(definition) {
    if (definition == null || typeof definition.name !== 'string') {
        throw new Error('peanut_cocos_mcp_core_hub_definition_invalid');
    }
    if (!definition.name.startsWith(`${HUB_CAPABILITY_PLUGIN_ID}.`)) {
        throw new Error(`peanut_cocos_mcp_core_hub_name_not_scoped:${definition.name}`);
    }
    const readOnly = definition.readOnly === true;
    const risk = definition.risk === 'destructive' || definition.risk === 'write' || definition.risk === 'read'
        ? definition.risk
        : (readOnly ? 'read' : 'write');
    if ((risk === 'read') !== readOnly) {
        throw new Error(`peanut_cocos_mcp_core_hub_risk_mismatch:${definition.name}`);
    }
    const throughput = toHubThroughputProfile(definition, readOnly);
    return Object.freeze({
        name: definition.name,
        description: typeof definition.description === 'string' && definition.description.trim().length > 0
            ? definition.description
            : `Lite capability: ${definition.name}`,
        category: 'cocos',
        inputSchema: definition.inputSchema,
        ...(definition.outputSchema != null ? { outputSchema: definition.outputSchema } : {}),
        readOnly,
        risk,
        executionModel: definition.executionModel === 'managed_task' ? 'managed_task' : 'inline',
        ...(definition.lane != null ? { lane: definition.lane } : {}),
        ...(definition.aiHandling != null ? { aiHandling: definition.aiHandling } : {}),
        ...(throughput == null ? {} : { throughput }),
    });
}

function toHubThroughputProfile(definition, readOnly) {
    const profile = definition.throughput;
    if (profile == null) {
        return null;
    }
    const costClasses = new Set(['control', 'read_light', 'read_heavy', 'prepare', 'writer']);
    if (typeof profile !== 'object' || !costClasses.has(profile.costClass) || profile.operation !== definition.operation) {
        throw new Error(`peanut_cocos_mcp_core_throughput_invalid:${definition.name}`);
    }
    if (readOnly) {
        if (profile.read == null || profile.write != null) {
            throw new Error(`peanut_cocos_mcp_core_read_throughput_invalid:${definition.name}`);
        }
        return Object.freeze({
            operationId: definition.operation,
            costClass: profile.costClass,
            readCoalescing: profile.read.coalescing,
            readCache: profile.read.cache,
            readConsistency: profile.read.consistency,
        });
    }
    if (profile.write == null || profile.read != null) {
        throw new Error(`peanut_cocos_mcp_core_write_throughput_invalid:${definition.name}`);
    }
    return Object.freeze({
        operationId: definition.operation,
        costClass: profile.costClass,
        prepareEligible: profile.write.prepareEligible === true,
        explicitBatchEligible: profile.write.explicitBatchEligible === true,
        automaticBatchEligible: profile.write.automaticBatchEligible === true,
    });
}

/**
 * Bridge Lite CPM toolHandlers into Plugin Manager McpCapabilityRegistry so
 * CocosMcpHub (:52935) can list/call the same public surface as host-status.
 * pluginId must be peanut.editor-mcp because tool names are scoped that way
 * (same as the reference editor-mcp island + writeEnabledPluginIds settings).
 */

/**
 * Expose one-shot Lite local approval lease issuance to Hub callers.
 * Marked readOnly so Hub can issue a lease without already holding one.
 * Token is consumed via write-tool input.approvalId or approvalToken (Lite dispatcher; id preferred).
 */

/**
 * Late-bind Hub → Lite lease mirror so issueApprovalToken / approvePlanAndIssueToken
 * also write McpApprovalLeaseStore (same connection/resources/ops/risk). Not auto-approve.
 */
function bindHubLocalApprovalLeaseMirror() {
    const pluginManager = getPluginManagerKernel();
    const hubControl = pluginManager?.getMcpHubControl?.();
    if (hubControl == null || typeof hubControl.setLocalApprovalLeaseMirror !== 'function') {
        return false;
    }
    hubControl.setLocalApprovalLeaseMirror((request = {}) => {
        if (coreModule == null || typeof coreModule.issueApprovalLease !== 'function') {
            return null;
        }
        return coreModule.issueApprovalLease(withLiteOperationAliases(request));
    });
    return true;
}

/**
 * Expand Hub capability names with the Lite operation IDs consumed by the
 * local execution dispatcher. Hub keeps its namespaced tool whitelist while
 * the mirrored lease accepts the corresponding internal operation as well.
 *
 * @param {Record<string, unknown>} request Hub approval lease request.
 * @returns {Record<string, unknown>} Request with stable Hub and Lite operation aliases.
 */
function withLiteOperationAliases(request) {
    if (!Array.isArray(request.operations) || request.operations.length === 0) {
        return request;
    }
    const operations = new Set();
    for (const operation of request.operations) {
        if (typeof operation !== 'string' || operation.trim().length === 0) {
            continue;
        }
        const normalized = operation.trim();
        operations.add(normalized);
        const liteOperation = toolHandlers.get(normalized)?.definition?.operation;
        if (typeof liteOperation === 'string' && liteOperation.trim().length > 0) {
            operations.add(liteOperation.trim());
        }
    }
    return Object.freeze({ ...request, operations: Object.freeze([...operations]) });
}

function registerLocalApprovalLeaseTool() {
    const name = `${HUB_CAPABILITY_PLUGIN_ID}.issue-local-approval-lease`;
    if (toolHandlers.has(name)) {
        return;
    }
    const definition = Object.freeze({
        name,
        description: 'Issue a one-shot local approval lease for Lite native writes (approvalId / approvalToken aliases).',
        inputSchema: Object.freeze({
            type: 'object',
            properties: Object.freeze({
                connectionId: Object.freeze({ type: 'string', description: 'Bridge connection id (32-hex). Defaults to invocation connectionId.' }),
                resources: Object.freeze({ type: 'array', description: 'Normalized resources this lease may touch.', items: Object.freeze({ type: 'string' }) }),
                operations: Object.freeze({ type: 'array', description: 'Optional operation/tool whitelist; empty means any write on this connection.', items: Object.freeze({ type: 'string' }) }),
                maxRisk: Object.freeze({ type: 'string', description: 'write or destructive.' }),
                idleLeaseMs: Object.freeze({ type: 'number', description: 'Idle lease ms.' }),
                maxHoldMs: Object.freeze({ type: 'number', description: 'Max hold ms from issue.' }),
                sessionBound: Object.freeze({ type: 'boolean', description: 'When true, use session-bound lease defaults (idle 5min / max 30min); explicit idle/max still win.' }),
            }),
            required: Object.freeze(['resources']),
            additionalProperties: false,
        }),
        readOnly: true,
        risk: 'read',
        requiresLocalApproval: false,
        operation: 'approval.issueLocalLease',
    });
    toolHandlers.set(name, Object.freeze({
        definition,
        handler: async (input = {}, invocation = {}) => {
            if (coreModule == null || typeof coreModule.issueApprovalLease !== 'function') {
                throw new Error('pod_lite_approval_leases_unavailable');
            }
            const connectionId =
                (typeof input.connectionId === 'string' && input.connectionId.trim().length > 0
                    ? input.connectionId.trim()
                    : null) ||
                (typeof invocation.connectionId === 'string' && invocation.connectionId.trim().length > 0
                    ? invocation.connectionId.trim()
                    : null) ||
                'creator-local';
            if (!Array.isArray(input.resources) || input.resources.length === 0) {
                throw new Error('mcp_approval_lease_resources_required');
            }
            const issued = coreModule.issueApprovalLease({
                connectionId,
                resources: input.resources,
                operations: Array.isArray(input.operations) ? input.operations : [],
                maxRisk: input.maxRisk === 'destructive' ? 'destructive' : 'write',
                idleLeaseMs: typeof input.idleLeaseMs === 'number' ? input.idleLeaseMs : undefined,
                maxHoldMs: typeof input.maxHoldMs === 'number' ? input.maxHoldMs : undefined,
                sessionBound: input.sessionBound === true,
            });
            return Object.freeze({
                approvalId: issued.token,
                approvalToken: issued.token,
                token: issued.token,
                expiresAt: issued.expiresAt,
                idleLeaseMs: issued.idleLeaseMs,
                maxHoldMs: issued.maxHoldMs,
                sessionBound: input.sessionBound === true,
                connectionId,
            });
        },
    }));
}
function publishToolsToHubRegistry() {
    disposeHubCapabilityRegistrations();
    const pluginManager = getPluginManagerKernel();
    if (pluginManager == null) {
        getEditor()?.warn?.('[peanut-pod-lite] hub_capability_registry_unavailable');
        return Object.freeze({ published: 0, error: 'plugin_manager_kernel_unavailable' });
    }
    const registry = pluginManager.getMcpCapabilityRegistry();
    if (registry == null || typeof registry.register !== 'function') {
        getEditor()?.warn?.('[peanut-pod-lite] hub_capability_registry_missing');
        return Object.freeze({ published: 0, error: 'mcp_capability_registry_missing' });
    }
    // Keep Hub settings as source of truth for write exposure (already applied at shell bootstrap).
    // Re-assert peanut.editor-mcp exposure if settings enabled writes so catalog is not read-only-only.
    try {
        const hubControl = pluginManager.getMcpHubControl?.();
        const writeEnabled = hubControl?.getStatus?.()?.writeEnabledPluginIds ?? [];
        if (Array.isArray(writeEnabled) && writeEnabled.includes(HUB_CAPABILITY_PLUGIN_ID)) {
            registry.setPluginExposure?.(HUB_CAPABILITY_PLUGIN_ID, 'all');
        }
    } catch (error) {
        getEditor()?.warn?.(`[peanut-pod-lite] hub_exposure_reassert_failed:${normalizeError(error)}`);
    }
    let published = 0;
    for (const entry of toolHandlers.values()) {
        if (!entry.definition.name.startsWith(`${HUB_CAPABILITY_PLUGIN_ID}.`)) {
            continue;
        }
        const definition = toHubCapabilityDefinition(entry.definition);
        const handler = entry.handler;
        hubCapabilityDisposers.push(
            registry.register(HUB_CAPABILITY_PLUGIN_ID, definition, async (input, invocation) => {
                if (definition.risk !== 'read' && creatorContext?.writesAllowed !== true) {
                    throw new Error(`creator_profile_write_unverified:${creatorContext?.profileId ?? 'unknown'}`);
                }
                return handler(input, invocation);
            }),
        );
        published += 1;
    }
    hubPublishedCount = published;
    getEditor()?.log?.(`[peanut-pod-lite] hub_capabilities_published:${published}`);
    return Object.freeze({ published, error: null });
}

function createRegistry() {
    return Object.freeze({
        register(definition, handler) {
            if (typeof definition?.name !== 'string' || typeof handler !== 'function') {
                throw new Error('peanut_cocos_mcp_core_tool_registration_invalid');
            }
            if (toolHandlers.has(definition.name)) {
                throw new Error(`peanut_cocos_mcp_core_tool_duplicate:${definition.name}`);
            }
            toolHandlers.set(definition.name, Object.freeze({ definition, handler }));
            return () => toolHandlers.delete(definition.name);
        },
    });
}

function loadVerifiedModule(verified, expectedPluginId) {
    const loaded = require(verified.mainPath);
    if (typeof loaded.createPluginModule !== 'function') {
        throw new Error(`peanut_cpm_entry_invalid:${expectedPluginId}`);
    }
    const pluginModule = loaded.createPluginModule();
    if (pluginModule?.manifest?.id !== expectedPluginId || pluginModule.manifest.version !== verified.manifest.version) {
        throw new Error(`peanut_cpm_module_manifest_mismatch:${expectedPluginId}`);
    }
    return pluginModule;
}

async function activateCore(packageStore) {
    const verified = packageStore.resolveActivePackage(CORE_PLUGIN_ID, true);
    coreArtifact = resolvePackageArtifactIdentity(verified);
    toolHandlers = new Map();
    coreModule = loadVerifiedModule(verified, CORE_PLUGIN_ID);
    const pluginManager = getPluginManagerKernel();
    if (pluginManager == null) {
        throw new Error('plugin_manager_kernel_unavailable');
    }
    coreTaskApi = pluginManager.createHostTaskApi(HUB_CAPABILITY_PLUGIN_ID, requireProjectPath());
    await coreModule.register?.({ logger: createLogger(CORE_PLUGIN_ID) });
    // Supply EditorMcp gateways through grantedRuntime. Lite policy still excludes
    // paid operations, while Pro remains optional through services.
    await coreModule.activate({
        runtime: createRuntime(),
        grantedRuntime: createLiteGrantedRuntime(),
        services: serviceRegistry.createApi(CORE_PLUGIN_ID),
        mcp: createRegistry(),
        logger: createLogger(CORE_PLUGIN_ID),
        connectionId: 'creator-local',
        tasks: coreTaskApi,
    });
    return verified.manifest.version;
}

async function deactivateOptionalPro() {
    try {
        await proModule?.deactivate?.();
    } catch (error) {
        getEditor()?.warn?.(`[peanut-pod-lite] pro_deactivate_failed:${normalizeError(error)}`);
    } finally {
        proModule = null;
        proArtifact = null;
        serviceRegistry.revokeProvider(PRO_PLUGIN_ID);
        protectedKeyStore?.clear();
        protectedKeyStore = null;
    }
}

async function activateOptionalPro(packageStore) {
    let verified;
    try {
        verified = packageStore.resolveActivePackage(PRO_PLUGIN_ID, false);
        if (verified === null) {
            return Object.freeze({ state: 'absent', version: null, error: null, services: [] });
        }
        proArtifact = resolvePackageArtifactIdentity(verified);
        proModule = loadVerifiedModule(verified, PRO_PLUGIN_ID);
        protectedKeyStore = new SystemProtectedKeyStore(requireProjectPath(), PRO_PLUGIN_ID, resolveSafeStorage);
        await proModule.register?.({ logger: createLogger(PRO_PLUGIN_ID) });
        await proModule.activate({
            plugin: Object.freeze({ id: PRO_PLUGIN_ID }),
            protectedKeys: protectedKeyStore,
            services: serviceRegistry.createApi(PRO_PLUGIN_ID),
        });
        return Object.freeze({
            state: 'active',
            version: verified.manifest.version,
            error: null,
            services: serviceRegistry.list(PRO_PLUGIN_ID),
        });
    } catch (error) {
        try {
            await proModule?.deactivate?.();
        } catch (deactivateError) {
            getEditor()?.warn?.(`[peanut-pod-lite] pro_deactivate_after_failure_failed:${normalizeError(deactivateError)}`);
        }
        proModule = null;
        serviceRegistry.revokeProvider(PRO_PLUGIN_ID);
        const message = normalizeError(error);
        getEditor()?.warn?.(`[peanut-pod-lite] optional_pro_failed:${message}`);
        return Object.freeze({ state: 'failed', version: verified?.manifest?.version ?? null, error: message, services: [] });
    }
}

async function load() {
    await deactivateModules();
    try {
        creatorContext = resolveTrustedCreatorContext();
        // Load the Plugin Manager shell before activating the Lite runtime.
        await loadPluginManagerShell(creatorContext, {
            readTrustedCatalog: readAcceptanceTrustedCatalog,
            installTrustedCatalogPackage,
        });
        const packageStore = new CpmPackageStore(requireProjectPath());
        const coreVersion = await activateCore(packageStore);
        // Publish first-class tools into Plugin Manager registry so Hub list/status
        // matches host toolCount (reference island path: editor-mcp context.mcp.register).
        registerLocalApprovalLeaseTool();
        bindHubLocalApprovalLeaseMirror();
        publishToolsToHubRegistry();
        const pro = await activateOptionalPro(packageStore);
        accountController = new LiteAccountController({
            projectPath: requireProjectPath(),
            safeStorageProvider: resolveSafeStorage,
        });
        let account = createSignedOutAccount();
        try {
            account = await accountController.restore(pro);
        } catch (error) {
            account = Object.freeze({
                ...createSignedOutAccount(),
                state: 'error',
                error: normalizeError(error),
            });
        }
        hostStatus = Object.freeze({
            ready: true,
            error: null,
            coreVersion,
            artifacts: artifactIdentitySnapshot(),
            creatorContext,
            tools: [...toolHandlers.keys()].sort(),
            pro,
            account,
        });
        getEditor()?.log?.(`[peanut-pod-lite] lite_host_ready:${hostStatus.tools.length}:pro_${pro.state}:account_${account.state}`);
        writeHostStatusReport();
        await runStartupSmokeAndWriteReport();
    } catch (error) {
        await deactivateModules();
        try {
            await unloadPluginManagerShell();
        } catch {
            // ignore nested unload errors
        }
        hostStatus = Object.freeze({
            ready: false,
            error: normalizeError(error),
            coreVersion: null,
            artifacts: artifactIdentitySnapshot(),
            creatorContext,
            tools: [],
            pro: Object.freeze({ state: 'not_checked', version: null, error: null, services: [] }),
            account: createSignedOutAccount(),
        });
        getEditor()?.error?.(`[peanut-pod-lite] lite_host_failed:${hostStatus.error}`);
        writeHostStatusReport();
        throw error;
    }
}

async function deactivateModules() {
    const deactivationErrors = [];
    try {
        await deactivateOptionalPro();
    } catch (error) {
        deactivationErrors.push(`pro:${normalizeError(error)}`);
    }
    try {
        await coreModule?.deactivate?.();
    } catch (error) {
        deactivationErrors.push(`core:${normalizeError(error)}`);
    } finally {
        try {
            await getPluginManagerKernel()?.deactivateHostTaskApi?.(HUB_CAPABILITY_PLUGIN_ID);
        } catch (error) {
            deactivationErrors.push(`core-tasks:${normalizeError(error)}`);
        }
        disposeHubCapabilityRegistrations();
        coreModule = null;
        coreTaskApi = null;
        coreArtifact = null;
        toolHandlers = new Map();
        serviceRegistry.clear();
        protectedKeyStore?.clear();
        protectedKeyStore = null;
    accountController = null;
    creatorContext = null;
    }
    if (deactivationErrors.length > 0) {
        getEditor()?.warn?.(`[peanut-pod-lite] host_deactivate_failed:${deactivationErrors.join(',')}`);
    }
}

async function unload() {
    await deactivateModules();
    try {
        await unloadPluginManagerShell();
    } catch (error) {
        getEditor()?.warn?.(`[peanut-pod-lite] plugin_manager_unload_failed:${normalizeError(error)}`);
    }
    hostStatus = createStoppedStatus();
}

function createLogger(pluginId) {
    return Object.freeze({ info: (message) => getEditor()?.log?.(`[${pluginId}] ${message}`) });
}

function createStoppedStatus() {
    return Object.freeze({
        ready: false,
        error: null,
        coreVersion: null,
        artifacts: artifactIdentitySnapshot(),
        tools: [],
        pro: Object.freeze({ state: 'not_checked', version: null, error: null, services: [] }),
        account: createSignedOutAccount(),
    });
}

function normalizeError(error) {
    return error instanceof Error ? error.message : String(error);
}

function runtimeDirectory() {
    return join(requireProjectPath(), 'peanut-plugins', RUNTIME_DIR_NAME);
}

function writeJsonReport(fileName, value) {
    const directory = runtimeDirectory();
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeHostStatusReport() {
    try {
        writeJsonReport('host-status.json', {
            writtenAt: new Date().toISOString(),
            ready: hostStatus.ready,
            error: hostStatus.error,
            coreVersion: hostStatus.coreVersion,
            artifacts: hostStatus.artifacts,
            creatorContext: hostStatus.creatorContext ?? null,
            toolCount: hostStatus.tools.length,
            hubPublishedCount,
            tools: hostStatus.tools,
            pro: hostStatus.pro,
            account: {
                state: hostStatus.account?.state ?? null,
                recommendedAction: hostStatus.account?.recommendedAction ?? null,
                error: hostStatus.account?.error ?? null,
            },
        });
    } catch (error) {
        getEditor()?.warn?.(`[peanut-pod-lite] host_status_report_failed:${normalizeError(error)}`);
    }
}

async function runStartupSmokeAndWriteReport() {
    const startedAt = new Date().toISOString();
    const results = [];
    // Reads only: writes stay fail-closed without an explicit local approval lease.
    const smokeTools = hostStatus.tools.filter((name) => toolHandlers.get(name)?.definition?.readOnly === true);
    for (const name of smokeTools) {
        const entry = toolHandlers.get(name);
        const item = { name, ok: false, error: null, resultType: null, preview: null };
        try {
            if (entry === undefined) {
                throw new Error('tool_handler_missing');
            }
            // Prefer empty input; skip tools that need required fields (they fail with schema errors).
            const result = await entry.handler({}, { connectionId: 'creator-local', resourceIds: [] });
            item.resultType = result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result;
            item.preview = previewSmokeValue(result);
            if (name === 'peanut.editor-mcp.asset-catalog-summary'
                && result?.available === false && result?.availability === 'refused'
                && result?.code === 'asset_catalog_not_initialized'
                && result?.recommendedAction === 'asset.catalog.refresh') {
                item.error = result.code;
                item.refused = true;
                item.skipped = true;
            } else {
                item.ok = true;
            }
        } catch (error) {
            const message = normalizeError(error);
            item.error = message;
            // Empty-input smoke: missing required fields are skips, not product failures.
            if (isExpectedEmptyInputRefusal(message)) {
                item.skipped = true;
            }
        }
        results.push(item);
    }
    const proChecks = await runProFailClosedSmoke();
    const failed = results.filter((item) => !item.ok && item.skipped !== true);
    const skipped = results.filter((item) => item.skipped === true);
    const report = {
        writtenAt: new Date().toISOString(),
        startedAt,
        ready: hostStatus.ready,
        toolCount: hostStatus.tools.length,
        hubPublishedCount,
        gatewayWired: hostStatus.tools.length >= 83,
        artifacts: hostStatus.artifacts,
        passed: results.filter((item) => item.ok).length,
        failed: failed.length,
        skipped: skipped.length,
        results,
        proChecks,
        knownGaps: [
            hostStatus.tools.length < 83
                ? 'creator_host_does_not_inject_editor_mcp_gateway_yet_only_9_reads'
                : null,
        ].filter(Boolean),
    };
    try {
        writeJsonReport('smoke-results.json', report);
    } catch (error) {
        getEditor()?.warn?.(`[peanut-pod-lite] smoke_report_failed:${normalizeError(error)}`);
    }
    getEditor()?.log?.(
        `[peanut-pod-lite] startup_smoke:${report.passed}_passed:${report.failed}_failed:tools_${report.toolCount}`,
    );
}

function previewSmokeValue(value) {
    try {
        const text = JSON.stringify(value);
        if (typeof text !== 'string') {
            return String(value);
        }
        return text.length > 500 ? `${text.slice(0, 500)}…` : text;
    } catch {
        return String(value);
    }
}

function isExpectedEmptyInputRefusal(message) {
    return (
        /_required\b/u.test(message) ||
        /requires_/u.test(message) ||
        /schema_invalid/u.test(message) ||
        /must be/iu.test(message)
    );
}

async function runProFailClosedSmoke() {
    const checks = [];
    if (hostStatus.pro?.state !== 'active') {
        checks.push({
            name: 'pro.services.present',
            ok: false,
            error: `pro_state_${hostStatus.pro?.state ?? 'unknown'}`,
        });
        return checks;
    }
    const expected = [
        'mcp.admit',
        'mcp.snowb.bmfont.export',
        'mcp.preview.capture',
        'mcp.sdf.font.generate',
        'mcp.sdf.font.import',
        'mcp.ui-prefab.importDesign',
        'mcp.ui-prefab.generate',
        'mcp.asset-version-mover',
        'mcp.content-delivery',
    ];
    const missing = expected.filter((serviceId) => !hostStatus.pro.services.includes(serviceId));
    checks.push({
        name: 'pro.services.complete',
        ok: missing.length === 0,
        error: missing.length === 0 ? null : `missing:${missing.join(',')}`,
        preview: JSON.stringify(hostStatus.pro.services),
    });
    // Unauthorized Lite caller must not execute paid ops.
    try {
        await serviceRegistry.request(CORE_PLUGIN_ID, PRO_PLUGIN_ID, 'mcp.preview.capture', {
            capture: {},
            resourceIds: [],
            hasLocalApproval: false,
            signedPlan: null,
        });
        checks.push({ name: 'pro.preview.capture.refuse_non_editor_mcp_caller', ok: false, error: 'expected_refusal' });
    } catch (error) {
        checks.push({
            name: 'pro.preview.capture.refuse_non_editor_mcp_caller',
            ok: true,
            error: null,
            preview: normalizeError(error),
        });
    }
    // Even the entitled editor-mcp caller must refuse without a signed plan / local approval.
    try {
        await serviceRegistry.request('peanut.editor-mcp', PRO_PLUGIN_ID, 'mcp.preview.capture', {
            capture: {},
            resourceIds: ['db://assets/scene.scene'],
            hasLocalApproval: false,
            signedPlan: null,
        });
        checks.push({ name: 'pro.preview.capture.refuse_without_plan', ok: false, error: 'expected_refusal' });
    } catch (error) {
        checks.push({
            name: 'pro.preview.capture.refuse_without_plan',
            ok: true,
            error: null,
            preview: normalizeError(error),
        });
    }
    return checks;
}

function resolveSafeStorage() {
    const injected = getEditor()?.App?.safeStorage;
    if (injected !== undefined) {
        return injected;
    }
    try {
        return require('electron').safeStorage;
    } catch {
        throw new Error('peanut_cpm_system_protected_storage_unavailable');
    }
}

const methods = {
    ...getPluginManagerMethods(),
    queryStatus() {
        return hostStatus;
    },
    listTools() {
        return hostStatus.tools;
    },
    queryPremiumOffer() {
        return accountController?.offer() ?? listPremiumOffer();
    },
    async setPodEndpoint(endpoint) {
        requireReadyAccount();
        accountController.setEndpoint(endpoint);
        hostStatus = withAccount(await accountController.restore(hostStatus.pro));
        return hostStatus.account;
    },
    async setAccessToken(token) {
        requireReadyAccount();
        hostStatus = withAccount(await accountController.setAccessToken(token, hostStatus.pro));
        return hostStatus.account;
    },
    clearAccount() {
        requireReadyAccount();
        hostStatus = withAccount(accountController.clear(hostStatus.pro));
        return hostStatus.account;
    },
    async querySubscription() {
        requireReadyAccount();
        hostStatus = withAccount(await accountController.refresh(hostStatus.pro));
        return hostStatus.account;
    },
    async startCheckout() {
        requireReadyAccount();
        const checkout = await accountController.startCheckout(hostStatus.pro);
        hostStatus = withAccount(accountController.status());
        return checkout;
    },
    async refreshPro() {
        if (!hostStatus.ready) {
            throw new Error('peanut_cocos_mcp_core_host_not_ready');
        }
        if (accountController == null) {
            throw new Error('peanut_pro_entitlement_required');
        }
        await accountController.requireProEntitlement();
        await deactivateOptionalPro();
        const pro = await activateOptionalPro(new CpmPackageStore(requireProjectPath()));
        const account = accountController?.withPro(pro) ?? createSignedOutAccount();
        hostStatus = Object.freeze({ ...hostStatus, artifacts: artifactIdentitySnapshot(), pro, account });
        return hostStatus;
    },
    async assertProEntitlement() {
        requireReadyAccount();
        return accountController.requireProEntitlement();
    },
    async openAccount() {
        await getEditor()?.Panel?.open?.('peanut-pod-lite-host.account');
    },
        issueApprovalLease(request = {}) {
        if (!hostStatus.ready || coreModule == null || typeof coreModule.issueApprovalLease !== 'function') {
            throw new Error('pod_lite_approval_leases_unavailable');
        }
        const issued = coreModule.issueApprovalLease(request);
        return Object.freeze({
            token: issued.token,
            approvalId: issued.token,
            approvalToken: issued.token,
            expiresAt: issued.expiresAt,
        });
    },
    /**
     * Invoke a registered Lite tool and preserve the bridge invocation context.
     *
     * The plugin handler receives this as its second argument so write tools can
     * bind approval leases to the authenticated connection and resource scope.
     * Keeping the context outside `input` prevents callers from spoofing it via
     * MCP business parameters.
     *
     * @param {string} name Registered tool name.
     * @param {Record<string, unknown>} input Tool input payload.
     * @param {{ connectionId?: string, resourceIds?: readonly string[] }} invocation Bridge invocation context.
     * @returns {Promise<unknown>} Tool result.
     */
    async invokeTool(name, input = {}, invocation = {}) {
        if (!hostStatus.ready) {
            throw new Error('peanut_cocos_mcp_core_host_not_ready');
        }
        const entry = toolHandlers.get(name);
        if (entry === undefined) {
            throw new Error(`peanut_cocos_mcp_core_tool_unknown:${name}`);
        }
        const registry = getPluginManagerKernel()?.getMcpCapabilityRegistry?.();
        if (registry?.getRegisteredProviderPluginId?.(name) === HUB_CAPABILITY_PLUGIN_ID) {
            const hub = getPluginManagerKernel()?.getMcpHubControl?.();
            if ((name === 'asset.readText' || name.endsWith('.asset-read-text')) && typeof hub?.invokeFromHost !== 'function') {
                throw new Error('text_file_io_consistency_unavailable');
            }
            const result = typeof hub?.invokeFromHost === 'function'
                ? await hub.invokeFromHost(name, input, invocation)
                : await registry.invokeFromHost(name, input, invocation);
            if (isRecord(result) && typeof result.taskId === 'string') {
                getPluginManagerKernel()?.getMcpTaskControl?.().attachCapability(
                    result.taskId,
                    name,
                    requireConnectionId(invocation),
                );
            }
            return result;
        }
        return entry.handler(input, invocation);
    },
    /** @description 查询当前 Bridge 连接拥有的任务。 */
    async queryTaskStatus(taskId, invocation = {}) {
        return requireTaskControl().getStatus(taskId, requireConnectionId(invocation));
    },
    /** @description 取消当前 Bridge 连接拥有的任务。 */
    async cancelTask(taskId, invocation = {}) {
        return requireTaskControl().cancel(taskId, requireConnectionId(invocation));
    },
    /** @description 查询当前 Bridge 连接拥有的安全证据索引。 */
    async queryTaskEvidence(taskId, invocation = {}) {
        return requireTaskControl().getEvidence(taskId, requireConnectionId(invocation));
    },
};

function requireTaskControl() {
    if (!hostStatus.ready) {
        throw new Error('peanut_cocos_mcp_core_host_not_ready');
    }
    const pluginManager = getPluginManagerKernel();
    if (pluginManager == null) {
        throw new Error('plugin_manager_kernel_unavailable');
    }
    return pluginManager.getMcpTaskControl();
}

function requireConnectionId(invocation) {
    const connectionId = invocation?.connectionId;
    if (typeof connectionId !== 'string' || connectionId.trim().length === 0) {
        throw new Error('cocos_mcp_connection_id_invalid');
    }
    return connectionId.trim();
}

function isRecord(value) {
    return typeof value === 'object' && value != null && !Array.isArray(value);
}

function requireReadyAccount() {
    if (!hostStatus.ready || accountController == null) {
        throw new Error('peanut_cocos_mcp_core_host_not_ready');
    }
}

function withAccount(account) {
    return Object.freeze({ ...hostStatus, account });
}

module.exports = { load, unload, methods };
