import { readFileSync } from 'node:fs';
import { ResourceStabilityNativeFileScope } from './resource-stability-native-file-scope.mts';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import type { IResourceSemanticAuthority } from './resource-stability-contracts.mts';

/**
 * @description Fixed SDK AssetDB/meta/source readers for two ordinary source assets; never loads a runtime Asset.
 */
export class ResourceStabilityNativeSourceText {
    private readonly files: ResourceStabilityNativeFileScope;
    public static readonly kinds = Object.freeze(['text', 'json']);
    public static readonly infoSource = '837a1d8f233e39d681db0e60eb51b736a078ed8a832f0319d69607256e2dbda9';
    private static readonly inspectorSources: Readonly<Record<string, string>> = {
        text: '2a69b6d9bee1bdd42c01fa81fec42f4d590bb6e4a70d8d067d193887c8687c15',
        json: 'db5c15f85f0a92535e6f421eb4cb2349ae23e33179e91bf7d9e44640d362b6b6',
    };
    private static readonly assetTypes: Readonly<Record<string, string>> = { text: 'cc.TextAsset', json: 'cc.JsonAsset' };
    private static readonly typeSources: Readonly<Record<string, string>> = {
        text: '151c96b5358a157f417c16fe1de4f6b8936e14df309ea7a724e21050808ac0be',
        json: '73cab03f9137e80169e5894579750e52aaa04be801a8a645fba947510de4bea1',
    };
    private static readonly metaVersions: Readonly<Record<string, string>> = { text: '1.0.1', json: '2.0.1' };

    /**
     * @description Capture only this registered namespace and immutable plan bindings.
     */
    public constructor(project: string, namespace: string,
        private readonly bindings: ReadonlyMap<string, { kind: string; sha256: string }>,
        private readonly port: { info(uuid: string): Promise<unknown>; meta(uuid: string): Promise<unknown>; path(uuid: string): Promise<unknown> }) {
        this.files = new ResourceStabilityNativeFileScope(project, namespace);
        for (const [path, binding] of bindings) {
            this.files.scoped(path);
            if (!ResourceStabilityNativeSourceText.kinds.includes(binding.kind) || !/^[a-f0-9]{64}$/u.test(binding.sha256)
                || !path.endsWith(binding.kind === 'text' ? '.txt' : '.json')) throw new Error('resource_source_binding_invalid');
        }
    }

    /**
     * @description Exact version/source pins, including the public AssetDB query and depends contract.
     */
    public static assertSdk(engine: string, resources: string): void {
        if (JSON.parse(readFileSync(join(engine, 'package.json'), 'utf8')).version !== '3.8.3') throw new Error('resource_source_sdk_version');
        const pins = [
            ...Object.entries(this.typeSources).map(([kind, hash]) => [join(engine, 'cocos/asset/assets', kind + '-asset.ts'), hash]),
            ...Object.entries(this.inspectorSources).map(([kind, hash]) => [join(engine, 'editor/inspector/assets', kind + '.js'), hash]),
            [join(resources, 'app.asar/builtin/asset-db/@types/message.d.ts'), 'ca2bd55f577193f673ced652cc81c95cc739c3772bab81954363e46da4fdb5f4'],
            [join(resources, 'app.asar/builtin/asset-db/@types/public.d.ts'), this.infoSource],
        ];
        for (const [file, hash] of pins) if (this.hash(readFileSync(file!)) !== hash) throw new Error('resource_source_sdk_pin_changed');
    }

    /**
     * @description Source and metadata authorities remain distinct from runtime-object authority.
     */
    public static authority(kind: string, pointer: string): IResourceSemanticAuthority {
        if (!this.kinds.includes(kind) || !['/source', '/sourceSha256', '/importer', '/assetType'].includes(pointer)) throw new Error('resource_source_authority_unbound');
        if (pointer === '/assetType') return { kind: 'asset-db', creatorVersion: '3.8.3', sourceSha256: this.infoSource, readerId: 'creator383.AssetDB.info.type' };
        return { kind: pointer === '/importer' ? 'importer-meta' : 'source-text', creatorVersion: '3.8.3',
            sourceSha256: pointer === '/importer' ? this.infoSource : this.inspectorSources[kind]!,
            readerId: pointer === '/importer' ? 'creator383.AssetDB.meta.importer' : `creator383.AssetDB.source.${kind}.full-utf8` };
    }

    /**
     * @description Accept only the immutable selected plan's exact before/after target paths and source digest.
     */
    public static bindings(staging: { plan: { cases: readonly { caseId: string; beforePath: string; afterPath: string;
        expectedSemantic: Readonly<Record<string, unknown>> }[] } }): ReadonlyMap<string, { kind: string; sha256: string }> {
        const result = new Map<string, { kind: string; sha256: string }>();
        for (const row of staging.plan.cases) {
            const match = /^3\.8\.3\|asset:(text|json)\|(import|query|inspect|copy|move|rename|refresh|delete)$/u.exec(row.caseId);
            if (!match) continue;
            const sha256 = row.expectedSemantic['/sourceSha256']; if (typeof sha256 !== 'string') throw new Error('resource_source_plan_digest_missing');
            for (const path of [row.beforePath, row.afterPath]) {
                const previous = result.get(path);
                if (previous && (previous.kind !== match[1] || previous.sha256 !== sha256)) throw new Error('resource_source_plan_conflict');
                result.set(path, { kind: match[1]!, sha256 });
            }
        }
        return result;
    }

    /**
     * @description Runtime targets return null; declared source targets fail closed on missing SDK identity/dependencies.
     */
    public async read(path: string, initialInfo: Readonly<Record<string, unknown>>, diskMeta: Readonly<Record<string, unknown>>) {
        const binding = this.bindings.get(path);
        if (!binding) {
            if ([initialInfo.importer, diskMeta.importer].some(value => typeof value === 'string' && ResourceStabilityNativeSourceText.kinds.includes(value))) throw new Error('resource_source_path_not_bound');
            return null;
        }
        const absolute = this.files.scoped(path); const uuid = diskMeta.uuid;
        if (typeof uuid !== 'string') throw new Error('resource_source_uuid_missing');
        const info = this.record(await this.port.info(uuid)); const meta = this.record(await this.port.meta(uuid));
        const nativePath = await this.port.path(uuid);
        if (info.uuid !== uuid || initialInfo.uuid !== uuid || meta.uuid !== uuid || info.importer !== binding.kind || meta.importer !== binding.kind
            || info.type !== ResourceStabilityNativeSourceText.assetTypes[binding.kind]
            || diskMeta.importer !== binding.kind || info.url !== `db://${path}` || info.file !== absolute || nativePath !== absolute
            || info.imported !== true || info.invalid === true || info.isDirectory !== false
            || meta.imported !== true || diskMeta.imported !== true || meta.ver !== ResourceStabilityNativeSourceText.metaVersions[binding.kind]
            || diskMeta.ver !== meta.ver) throw new Error('resource_source_sdk_identity_mismatch');
        if (!Array.isArray(info.depends)) throw new Error('resource_source_dependencies_unobserved');
        if (info.depends.length) throw new Error('resource_source_dependencies_unbound');
        for (const candidate of [meta, diskMeta]) {
            if (!Array.isArray(candidate.files) || candidate.files.length > 64 || candidate.files.some(value => typeof value !== 'string' || !value || value.length > 256)) {
                throw new Error('resource_source_generated_files_unobserved');
            }
            if (Object.keys(this.record(candidate.subMetas)).length || Object.keys(this.record(candidate.userData)).length) {
                throw new Error('resource_source_meta_configuration_unbound');
            }
        }
        const metaBytes = this.files.readFile(path + '.meta');
        const independent = this.record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metaBytes)));
        for (const key of ['uuid', 'importer', 'ver', 'imported', 'files', 'subMetas', 'userData']) {
            if (!isDeepStrictEqual(independent[key], meta[key]) || !isDeepStrictEqual(independent[key], diskMeta[key])) throw new Error('resource_source_meta_changed');
        }
        const bytes = this.files.readFile(path); const hash = ResourceStabilityNativeSourceText.hash(bytes);
        if (hash !== binding.sha256) throw new Error('resource_source_content_not_frozen');
        const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (binding.kind === 'json') this.json(JSON.parse(source));
        if (!this.files.readFile(path + '.meta').equals(metaBytes)) throw new Error('resource_source_meta_changed');
        const semantic = { source, sourceSha256: hash, importer: String(meta.importer), assetType: String(info.type) };
        // valid is registered/imported AssetDB identity with exact public type, never runtime Asset.isValid.
        return { origin: 'creator-native' as const, actualUuid: uuid, valid: true, semantic,
            dependencies: [] as readonly string[], authorities: Object.fromEntries(Object.keys(semantic).map(key =>
                ['/' + key, ResourceStabilityNativeSourceText.authority(binding.kind, '/' + key)])) };
    }

    /**
     * @description JSON is data only: bound structure and reject prototype-shaped keys without evaluating it.
     */
    private json(root: unknown): void {
        let nodes = 0;
        const visit = (value: unknown, depth: number): void => {
            if (++nodes > 4096 || depth > 16) throw new Error('resource_source_json_budget');
            if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
                if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('resource_source_json_key'); visit(child, depth + 1);
            }
        }; visit(root, 0);
    }
    /**
     * @description SDK DTOs must actually be records; absent fields never become invented defaults.
     */
    private record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('resource_source_record_missing');
        return value as Record<string, unknown>;
    }
    /**
     * @description Full source digest, never a truncated preview digest.
     */
    private static hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
}
