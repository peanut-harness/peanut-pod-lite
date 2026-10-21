import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ResourceStabilityNativeFileScope } from './resource-stability-native-file-scope.mts';
import type { IResourceCampaignPlan, IResourceCampaignExpectation, IResourceSemanticAuthority } from './resource-stability-contracts.mts';

/**
 * @description Fixed audio AssetDB/importer-meta reader; binary bytes are only immutable content identity, never source-text.
 */
export class ResourceStabilityNativeAudioMeta {
    public static readonly readonlyRefusalCode = 'lumen_audio_property_not_editable:audio:downloadMode:allowed=';
    public static readonly actions = Object.freeze(['import', 'query', 'inspect', 'copy', 'move', 'rename', 'refresh', 'delete']);
    public static readonly infoSource = '837a1d8f233e39d681db0e60eb51b736a078ed8a832f0319d69607256e2dbda9';
    private readonly files: ResourceStabilityNativeFileScope;

    /**
     * @description Capture exact staged audio paths and frozen byte digests without a runtime loader.
     */
    public constructor(project: string, namespace: string, private readonly bindings: ReadonlyMap<string, string>,
        private readonly port: { info(uuid: string): Promise<unknown>; meta(uuid: string): Promise<unknown>; path(uuid: string): Promise<unknown> }) {
        this.files = new ResourceStabilityNativeFileScope(project, namespace);
        for (const [path, sha] of bindings) {
            this.files.scoped(path);
            if (!path.endsWith('.wav') || !/^[a-f0-9]{64}$/u.test(sha)) throw new Error('resource_audio_binding_invalid');
        }
    }

    /**
     * @description Pin actual same-version public query/type contracts, without loading or playing the asset.
     */
    public static assertSdk(engine: string, resources: string): void {
        if (JSON.parse(readFileSync(join(engine, 'package.json'), 'utf8')).version !== '3.8.3') throw new Error('resource_audio_sdk_version');
        for (const [path, sha] of [
            [join(engine, 'cocos/audio/audio-clip.ts'), '5c1ce859abff579b70bb4b31bd6a903c28367b3cdecbfa194e85a63415702e2e'],
            [join(resources, 'app.asar/builtin/asset-db/@types/message.d.ts'), 'ca2bd55f577193f673ced652cc81c95cc739c3772bab81954363e46da4fdb5f4'],
            [join(resources, 'app.asar/builtin/asset-db/@types/public.d.ts'), this.infoSource],
        ]) if (this.hash(readFileSync(path!)) !== sha) throw new Error('resource_audio_sdk_pin_changed');
    }

    /**
     * @description Only actual public AssetDB type and raw importer metadata have semantic authority.
     */
    public static authority(pointer: string): IResourceSemanticAuthority {
        if (!['/assetType', '/importer', '/downloadMode'].includes(pointer)) throw new Error('resource_audio_authority_unbound');
        return { kind: pointer === '/assetType' ? 'asset-db' : 'importer-meta', creatorVersion: '3.8.3',
            sourceSha256: this.infoSource, readerId: pointer === '/assetType' ? 'creator383.AssetDB.info.type'
                : pointer === '/importer' ? 'creator383.AssetDB.meta.importer' : 'creator383.AssetDB.meta.userData.downloadMode' };
    }

    /**
     * @description Bind exact selected targets to the real import command's frozen private input, not a semantic binary hash.
     */
    public static bindings(staging: { plan: IResourceCampaignPlan; expected: IResourceCampaignExpectation }): ReadonlyMap<string, string> {
        const result = new Map<string, string>();
        for (const row of staging.plan.cases) {
            if (!/^3\.8\.3\|(?:asset:audio\|(?:import|query|inspect|copy|move|rename|refresh|delete)|field:asset:audio:downloadMode\|(?:read|reject_write))$/u.test(row.caseId)) continue;
            const imports = [...row.setup, row.command].filter(command => command.name === 'peanut.editor-mcp.asset-import');
            const sources = imports[0]?.input.sources;
            if (imports.length !== 1 || !Array.isArray(sources) || sources.length !== 1 || typeof sources[0] !== 'string') throw new Error('resource_audio_plan_source_missing');
            const sha = staging.expected.fixtureSources[sources[0]];
            if (!/^[a-f0-9]{64}$/u.test(sha ?? '')) throw new Error('resource_audio_plan_digest_missing');
            for (const path of [row.beforePath, row.afterPath]) {
                if (result.has(path) && result.get(path) !== sha) throw new Error('resource_audio_plan_conflict');
                result.set(path, sha!);
            }
        }
        return result;
    }

    /**
     * @description Exact registered/imported identity and raw metadata; no runtime validity, name, audio decode or playback claim.
     */
    public async read(path: string, initialInfo: Readonly<Record<string, unknown>>, diskMeta: Readonly<Record<string, unknown>>) {
        const expectedHash = this.bindings.get(path);
        if (!expectedHash) {
            if (initialInfo.importer === 'audio-clip' || diskMeta.importer === 'audio-clip') throw new Error('resource_audio_path_not_bound');
            return null;
        }
        const absolute = this.files.scoped(path); const uuid = diskMeta.uuid;
        if (typeof uuid !== 'string') throw new Error('resource_audio_uuid_missing');
        const metaBytes = this.files.readFile(path + '.meta');
        const independent = this.record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metaBytes)));
        const info = this.record(await this.port.info(uuid)); const meta = this.record(await this.port.meta(uuid)); const nativePath = await this.port.path(uuid);
        if (info.uuid !== uuid || initialInfo.uuid !== uuid || meta.uuid !== uuid || info.type !== 'cc.AudioClip' || initialInfo.type !== info.type
            || info.importer !== 'audio-clip' || initialInfo.importer !== info.importer || meta.importer !== info.importer || diskMeta.importer !== info.importer
            || info.url !== `db://${path}` || info.file !== absolute || nativePath !== absolute || info.isDirectory !== false
            || info.imported !== true || info.invalid !== false || meta.imported !== true || diskMeta.imported !== true
            || meta.ver !== '1.0.0' || diskMeta.ver !== meta.ver) throw new Error('resource_audio_sdk_identity_mismatch');
        if (!Array.isArray(info.depends)) throw new Error('resource_audio_dependencies_unobserved');
        if (info.depends.length) throw new Error('resource_audio_dependencies_unbound');
        for (const candidate of [meta, diskMeta, independent]) {
            if (!Array.isArray(candidate.files) || candidate.files.length > 64 || candidate.files.some(value => typeof value !== 'string' || !value || value.length > 256)) throw new Error('resource_audio_generated_files_unobserved');
            const userData = this.record(candidate.userData);
            if (Object.keys(this.record(candidate.subMetas)).length || Object.keys(userData).length !== 1
                || !Object.prototype.hasOwnProperty.call(userData, 'downloadMode') || userData.downloadMode !== 0) throw new Error('resource_audio_meta_configuration_unbound');
        }
        for (const key of ['uuid', 'importer', 'ver', 'imported', 'files', 'subMetas', 'userData']) {
            if (!isDeepStrictEqual(independent[key], meta[key]) || !isDeepStrictEqual(independent[key], diskMeta[key])) throw new Error('resource_audio_meta_changed');
        }
        if (ResourceStabilityNativeAudioMeta.hash(this.files.readFile(path)) !== expectedHash) throw new Error('resource_audio_content_not_frozen');
        if (!this.files.readFile(path + '.meta').equals(metaBytes)) throw new Error('resource_audio_meta_changed');
        const semantic = { assetType: info.type, importer: meta.importer, downloadMode: this.record(meta.userData).downloadMode };
        return { origin: 'creator-native' as const, actualUuid: uuid, valid: true, semantic, dependencies: [] as readonly string[],
            authorities: Object.fromEntries(Object.keys(semantic).map(key => ['/' + key, ResourceStabilityNativeAudioMeta.authority('/' + key)])) };
    }

    /**
     * @description Missing or malformed native records never become defaults.
     */
    private record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('resource_audio_record_missing');
        return value as Record<string, unknown>;
    }
    /**
     * @description Complete ordinary source content digest, not a semantic or decoded audio value.
     */
    private static hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
}
