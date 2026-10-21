import type { IResourceSemanticAuthority } from './resource-stability-contracts.mts';
import { ResourceStabilityNativeRuntime } from './resource-stability-native-runtime.mts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const contracts = [
    ['cc.PhysicsMaterial', 'query-physics-material', 'physics-material.js', 'b7bddb15fe0d510c9d6885920e1e20f9bd18ceabced2a474f7e59886604b90f2'],
    ['cc.animation.AnimationGraphVariant', 'query-animation-graph-variant', 'animation-graph-variant.js', 'a37d4cb334ce19b48f3048bc9713a3413d24b7ade0712a6a41f82fb35ef49c20'],
    ['cc.RenderPipeline', 'query-render-pipeline', 'render-pipeline.js', '415a7020d728a2706e384fd104bf1f337ba7c95fb4156fcf313844579e6d2d1d'],
    ['cc.animation.AnimationMask', 'query-animation-mask', 'animation-mask.js', 'b99b2ff5861ce9f75cb74239c50d446a8db1aa6f64bbdd4924343edd5796fa4c'],
] as const;

/**
 * @description 固定查询函数来自同版 Inspector；业务层不可传入消息名或替换查询。
 */
export interface IResourceNativeInspectorQueries {
    physicsMaterial(uuid: string): Promise<unknown>;
    animationGraphVariant(uuid: string): Promise<unknown>;
    renderPipeline(uuid: string): Promise<unknown>;
    animationMask(uuid: string): Promise<unknown>;
    loadIdentity(uuid: string): Promise<{ actualUuid: string; type: string; valid: boolean; semantic?: Readonly<Record<string, unknown>> }>;
}

/**
 * @description 独立原生 Inspector 读回，未核实的资源类型明确 blocked，不能降级读取序列化文件。
 */
export class ResourceStabilityNativeInspector {
    public constructor(private readonly queries: IResourceNativeInspectorQueries) {}

    /**
     * @description 安装前核对精确 3.8.3 官方 Inspector 来源及实际资产加载实现，变化即停止。
     */
    public static assertSdk(engine: string): void {
        if ((JSON.parse(readFileSync(join(engine, 'package.json'), 'utf8')) as { version?: string }).version !== '3.8.3') {
            throw new Error('resource_native_inspector_sdk_version_mismatch');
        }
        for (const [, method, file, hash] of contracts) {
            const bytes = readFileSync(join(engine, 'editor/inspector/assets', file));
            if (createHash('sha256').update(bytes).digest('hex') !== hash
                || !bytes.toString('utf8').includes(`Editor.Message.request('scene', '${method}', uuid)`)) {
                throw new Error('resource_native_inspector_source_mismatch');
            }
        }
        for (const [file, sha256] of [
            ['cocos/animation/marionette/animation-graph-variant.ts', '8b9e9588936fac51a328922e710454751e2dc31d2d07e8fdbd1bb08160a3f7bb'],
            ['cocos/animation/marionette/animation-mask.ts', '209830c54fc0a9ed123858aed139659d042e72b358cede34d6d06e912872ac71'],
            ['cocos/rendering/render-pipeline.ts', 'b8114151825f91847dde8297e9b413989aee0b4c6eedac2974bfa2549b3d62eb'],
            ['cocos/physics/framework/assets/physics-material.ts', 'df1969ce10256b317f1769a3091d1305f0bedf62719a8695e29da8511b96d959'],
            ['cocos/asset/asset-manager/depend-util.ts', 'd64f587ad1ec6a8f76523fc1beb692b14dfc9c000eb95b59564535c0dd66e8b7'],
        ]) {
            if (!file || createHash('sha256').update(readFileSync(join(engine, file))).digest('hex') !== sha256) {
                throw new Error('resource_native_getter_source_mismatch');
            }
        }
        for (const [, file, sha256] of ResourceStabilityNativeRuntime.sources) {
            if (createHash('sha256').update(readFileSync(join(engine, file))).digest('hex') !== sha256) throw new Error('resource_native_runtime_source_mismatch');
        }
        if (createHash('sha256').update(readFileSync(join(engine, ResourceStabilityNativeRuntime.publicNameSource.file))).digest('hex') !== ResourceStabilityNativeRuntime.publicNameSource.sha256) throw new Error('resource_native_name_source_mismatch');
        const loader = readFileSync(join(engine, 'cocos/asset/asset-manager/asset-manager.ts'));
        if (createHash('sha256').update(loader).digest('hex') !== '01b1310ccd5a4e37fe83372e2ca181d732fed1765ba47951c157bf444185ac19') {
            throw new Error('resource_native_loader_source_mismatch');
        }
    }

    /**
     * @description 返回真实根身份与未改写的原生 dump；语义指针由完整计划绑定，不猜测字段。
     */
    public async read(uuid: string): Promise<{ origin: 'creator-native'; actualUuid: string; valid: boolean;
        semantic: Readonly<Record<string, unknown>>; authorities: Readonly<Record<string, IResourceSemanticAuthority>> }> {
        const identity = await this.queries.loadIdentity(uuid);
        if (!identity.valid || identity.actualUuid !== uuid) throw new Error('resource_native_inspector_identity_mismatch');
        const index = contracts.findIndex(([type]) => type === identity.type);
        if (index < 0) {
            if (!ResourceStabilityNativeRuntime.sources.some(([type]) => type === identity.type) || !identity.semantic || Object.keys(identity.semantic).length === 0) {
                throw new Error(`resource_native_inspector_type_blocked:${identity.type}`);
            }
            return { origin: 'creator-native', actualUuid: identity.actualUuid, valid: true, semantic: identity.semantic, authorities: ResourceStabilityNativeRuntime.authorities(identity.type, identity.semantic) };
        }
        const readers = [this.queries.physicsMaterial, this.queries.animationGraphVariant,
            this.queries.renderPipeline, this.queries.animationMask];
        const reader = readers[index];
        if (!reader) throw new Error('resource_native_inspector_reader_missing');
        const value = await reader.call(this.queries, uuid);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('resource_native_inspector_dump_missing');
        const semantic = identity.semantic ?? Object.fromEntries(Object.entries(value));
        return { origin: 'creator-native', actualUuid: identity.actualUuid, valid: true, semantic,
            authorities: ResourceStabilityNativeRuntime.authorities(identity.type, semantic) };
    }
}
