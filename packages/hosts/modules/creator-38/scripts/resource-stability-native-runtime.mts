import type { IResourceSemanticAuthority } from './resource-stability-contracts.mts';

/**
 * @description 精确3.8.3的有界公开getter映射；不读取私有源字段、像素、任意属性或执行动画。
 */
export class ResourceStabilityNativeRuntime {
    public static readonly kinds = Object.freeze(['physicsMaterial', 'animationGraphVariant', 'renderPipeline', 'animationMask',
        'animationClip', 'animationGraph', 'renderTexture', 'terrain']);
    public static readonly sources = Object.freeze([
        ['cc.PhysicsMaterial', 'cocos/physics/framework/assets/physics-material.ts', 'df1969ce10256b317f1769a3091d1305f0bedf62719a8695e29da8511b96d959'],
        ['cc.animation.AnimationGraphVariant', 'cocos/animation/marionette/animation-graph-variant.ts', '8b9e9588936fac51a328922e710454751e2dc31d2d07e8fdbd1bb08160a3f7bb'],
        ['cc.animation.AnimationMask', 'cocos/animation/marionette/animation-mask.ts', '209830c54fc0a9ed123858aed139659d042e72b358cede34d6d06e912872ac71'],
        ['cc.RenderPipeline', 'cocos/rendering/render-pipeline.ts', 'b8114151825f91847dde8297e9b413989aee0b4c6eedac2974bfa2549b3d62eb'],
        ['cc.Material', 'cocos/asset/assets/material.ts', 'd61486c5991bedfd975f4cf30ea2f88d34dc1dce0de4fc81d011b207b828fac5'],
        ['cc.AnimationClip', 'cocos/animation/animation-clip.ts', '020b432bbf600d5b31f8f96e3a64d6afcd941aa2e39b317b103cd206128f4cd9'],
        ['cc.TerrainAsset', 'cocos/terrain/terrain-asset.ts', '6b358b6b6e8660a0ceb80e0d79e8fee5819e9e5f518c93a5c2af5c5e8a6565c0'],
        ['cc.animation.AnimationGraph', 'cocos/animation/marionette/animation-graph.ts', '73e7d7119d3b9bc70be164670303d9af7f75cdee9bbd3136ec6ed98814a052c1'],
        ['cc.RenderTexture', 'cocos/asset/assets/render-texture.ts', 'c6d233025e892cd6b37d9554ab303311e44d8b71a4c90947258e44371dcd93a1'],
        ['cc.EffectAsset', 'cocos/asset/assets/effect-asset.ts', '8a65aff59005941989e95dbb0a7ca6bda5d2304414c4384be360c1822e77b217'],
        ['RenderFlow', 'cocos/rendering/render-flow.ts', 'a43189a03aaa5823c6cc6b2ad4c51e6f1d0ab3c76da82286d94a764bcbb3c384'],
        ['RenderStage', 'cocos/rendering/render-stage.ts', '683fe587993d25a88df86314b779c7adf166aee5233e8cfcd536b66c1b2e8a7b'],
    ] as const);
    public static readonly publicNameSource = Object.freeze({ file: 'cocos/core/data/object.ts',
        sha256: '82d8cf40c23eecb1208d966d5fa1dcb0f6b67d51e0beb152f1f05381b1ba613d' });

    /**
     * @description 夹具kind映射到固定SDK类名，非运行时/未知种类必须另行声明权威来源。
     */
    public static typeForKind(kind: string): string {
        const types: Record<string, string> = { physicsMaterial: 'cc.PhysicsMaterial', animationGraphVariant: 'cc.animation.AnimationGraphVariant',
            animationMask: 'cc.animation.AnimationMask', renderPipeline: 'cc.RenderPipeline', material: 'cc.Material',
            animationClip: 'cc.AnimationClip', terrain: 'cc.TerrainAsset', animationGraph: 'cc.animation.AnimationGraph', renderTexture: 'cc.RenderTexture',
            effect: 'cc.EffectAsset', renderFlow: 'RenderFlow', renderStage: 'RenderStage' };
        const type = types[kind]; if (!type) throw new Error('resource_native_kind_not_bound'); return type;
    }

    /**
     * @description 每个公开指针精确绑定字段声明源；name getter实际来自CCObject，不误归为资产私有字段。
     */
    public static authority(type: string, pointer: string): IResourceSemanticAuthority {
        const source = this.sources.find(([name]) => name === type);
        if (!source) throw new Error('resource_native_authority_type_missing');
        const inheritedName = pointer === '/name' && !['RenderFlow', 'RenderStage'].includes(type);
        return { kind: 'runtime-object', creatorVersion: '3.8.3', sourceSha256: inheritedName ? this.publicNameSource.sha256 : source[2],
            readerId: inheritedName ? 'creator383.runtime.CCObject.name' : `creator383.runtime.${type}` };
    }

    /**
     * @description 只为固定getter已返回的有界语义添加来源，不从源文件生成运行时值。
     */
    public static authorities(type: string, semantic: Readonly<Record<string, unknown>>): Readonly<Record<string, IResourceSemanticAuthority>> {
        const result: Record<string, IResourceSemanticAuthority> = {}; let count = 0;
        const visit = (value: unknown, pointer: string, depth: number): void => {
            if (++count > 16384 || depth > 16) throw new Error('resource_native_semantic_budget_exceeded');
            if (pointer) result[pointer] = this.authority(type, pointer);
            if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
                visit(child, `${pointer}/${key.replace(/~/gu, '~0').replace(/\//gu, '~1')}`, depth + 1);
            }
        };
        visit(semantic, '', 0); return result;
    }

    /**
     * @description 未建字段映射的依赖仍可读原生身份，不能因此伪造根资源的公开语义。
     */
    public static supports(type: string): boolean {
        return this.sources.some(([name]) => name === type)
            || ['cc.PhysicsMaterial', 'cc.animation.AnimationMask', 'cc.animation.AnimationGraphVariant', 'cc.RenderPipeline'].includes(type);
    }

    /**
     * @description 只接受已验证原生对象和精确类名，返回公开语义，不把getter缺失改写成默认值。
     */
    public static read(asset: object, type: string): Record<string, unknown> {
        const value = (key: string): unknown => Reflect.get(asset, key);
        const name = (): string => { const result = value('name');
            if (typeof result !== 'string') throw new Error('resource_native_name_getter_missing'); return result; };
        const number = (key: string): number => { const result = value(key);
            if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error(`resource_native_numeric_getter_missing:${key}`); return result; };
        if (type === 'cc.PhysicsMaterial') return { name: name(), friction: number('friction'), rollingFriction: number('rollingFriction'),
            spinningFriction: number('spinningFriction'), restitution: number('restitution') };
        if (type === 'cc.AnimationClip') return { name: name(), sample: number('sample'), speed: number('speed') };
        if (type === 'cc.RenderTexture') return { name: name(), width: number('width'), height: number('height') };
        if (type === 'cc.Material') return { name: name(), technique: number('technique') };
        if (type === 'cc.EffectAsset') return { name: name() };
        if (type === 'RenderStage') return { name: name(), priority: number('priority'), tag: number('tag') };
        if (type === 'RenderFlow') return { name: name(), priority: number('priority'), tag: number('tag'),
            stageUuids: this.array(value('stages'), 4096).map((stage) => this.uuid(this.object(stage))) };
        if (type === 'cc.animation.AnimationMask') return { name: name(), joints: this.array(value('joints'), 4096)
            .map((joint) => ({ path: Reflect.get(this.object(joint), 'path'), enabled: Reflect.get(this.object(joint), 'enabled') })) };
        if (type === 'cc.animation.AnimationGraphVariant') {
            const graph = value('original');
            return { name: name(), graph: graph ? { uuid: this.uuid(this.object(graph)) } : null,
                clips: this.array(value('clipOverrides'), 4096).map((entry) => ({ original: this.uuid(this.object(Reflect.get(this.object(entry), 'original'))),
                    substitution: this.uuid(this.object(Reflect.get(this.object(entry), 'substitution'))) })) };
        }
        if (type === 'cc.animation.AnimationGraph') {
            const layers = this.array(value('layers'), 4096);
            return { name: name(), layers: layers.map((layer) => {
                const weight = Reflect.get(this.object(layer), 'weight');
                if (typeof weight !== 'number' || !Number.isFinite(weight)) throw new Error('resource_native_graph_weight_missing');
                return { weight };
            }) };
        }
        if (type === 'cc.RenderPipeline') return { name: name(), tag: number('tag'), flows: this.array(value('flows'), 4096)
            .map((flow) => ({ name: Reflect.get(this.object(flow), 'name') })) };
        if (type === 'cc.TerrainAsset') {
            const blocks = this.array(value('blockCount'), 2);
            if (blocks.length !== 2 || blocks.some((block) => typeof block !== 'number' || !Number.isInteger(block) || block < 1 || block > 128)) {
                throw new Error('resource_native_terrain_blocks_invalid');
            }
            const heights = this.array(value('heights'), 1024 * 1024);
            const required = (Number(blocks[0]) * 32 + 1) * (Number(blocks[1]) * 32 + 1);
            if (heights.length !== required) throw new Error('resource_native_terrain_height_count_mismatch');
            let heightMin = Infinity; let heightMax = -Infinity;
            for (const raw of heights) {
                if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 65535) throw new Error('resource_native_terrain_height_invalid');
                const height = (raw - 32768) / 128; heightMin = Math.min(heightMin, height); heightMax = Math.max(heightMax, height);
            }
            const layerInfos = this.array(value('layerInfos'), 256);
            if (layerInfos.length) throw new Error('resource_native_terrain_layer_contract_not_bound');
            return { name: name(), tileSize: number('tileSize'), blockCount: blocks, heightMin, heightMax, layerInfos: [] };
        }
        throw new Error(`resource_native_runtime_type_blocked:${type}`);
    }

    /**
     * @description 有限迭代，避免任意或无限 iterable 被Array.from提前全部载入。
     */
    private static array(value: unknown, limit: number): unknown[] {
        const object = this.object(value); const iterator = Reflect.get(object, Symbol.iterator);
        if (typeof iterator !== 'function') throw new Error('resource_native_iterable_getter_missing');
        const result: unknown[] = [];
        for (const item of value as Iterable<unknown>) {
            if (result.length >= limit) throw new Error('resource_native_iterable_budget_exceeded'); result.push(item);
        }
        return result;
    }
    private static object(value: unknown): object {
        if (!value || typeof value !== 'object') throw new Error('resource_native_object_getter_missing'); return value;
    }
    private static uuid(value: object): string {
        const uuid = Reflect.get(value, '_uuid');
        if (typeof uuid !== 'string' || !uuid) throw new Error('resource_native_reference_identity_missing'); return uuid;
    }
}
