import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'node:util';
import type { ITaskRequest } from '@peanut/pod-protocol';
import { TextWritePreparationSnapshot } from './text-write-preparation-snapshot.js';

/** @description 原资源字段无写入准备的任务、输入和信号来源；不接受可序列化信任标记。 */
export class ResourceFieldPreparationProof {
    private static readonly scope = new AsyncLocalStorage<{ request: Readonly<ITaskRequest>; input: object;
        signal: AbortSignal; snapshot: NonNullable<ReturnType<typeof TextWritePreparationSnapshot.capture>>; active: boolean }>();
    private static readonly proofs = new WeakMap<object, { request: Readonly<ITaskRequest>; input: object;
        signal: AbortSignal; snapshot: NonNullable<ReturnType<typeof TextWritePreparationSnapshot.capture>>; code: string }>();
    private static readonly seen = new WeakSet<object>();

    /** @description 只允许已核实字段标识和固定codec约束词法；不公开路径、空白或动态输入值。 */
    public static isSafeCode(value: unknown): value is string {
        if (typeof value !== 'string' || value.length > 256) return false;
        const match = /^(lumen(?:_(?:physics_material|auto_atlas|label_atlas|render_flow|render_stage|audio|font|spine|cubemap|directory|particle|spriteatlas|javascript|animation_graph_variant|animation_mask|render_pipeline))?)_property_(type|range):([^:]+):([^:]+)$/u.exec(value);
        if (!match) return false;
        const fields = new Set(['name', 'friction', 'rollingFriction', 'spinningFriction', 'restitution', 'graph', 'clips',
            'original', 'substitution', 'tag', 'flows', 'flowUuids', 'joints', 'path', 'enabled', 'index', 'priority',
            'type', 'stageUuids', 'pack', 'maxWidth', 'maxHeight', 'padding', 'allowRotation', 'forceSquared', 'powerOfTwo',
            'algorithm', 'format', 'quality', 'contourBleed', 'paddingBleed', 'filterUnused', 'removeTextureInBundle',
            'removeImageInBundle', 'removeSpriteAtlasInBundle', 'texture', 'wrapModeS', 'wrapModeT', 'minfilter', 'magfilter',
            'mipfilter', 'anisotropy', 'useCompressTexture', 'presetId', 'compressSettings', 'spriteFrameUuid', 'itemWidth',
            'itemHeight', 'startChar', 'fontSize', 'downloadMode', 'textureUuid', 'atlasUuid', 'faces', 'left', 'right', 'top',
            'bottom', 'front', 'back', 'faceSize', 'mipBakeMode', 'isBundle', 'bundleName', 'compressionType', 'isRemoteBundle',
            'spriteFrames', 'isPlugin', 'loadPluginInEditor', 'loadPluginInWeb', 'loadPluginInNative', 'loadPluginInMiniGame']);
        if (!match[3]!.split('.').every(part => {
            const field = /^([A-Za-z][A-Za-z0-9]*)(?:\[(?:0|[1-9][0-9]{0,3})\])?$/u.exec(part);
            return field != null && fields.has(field[1]!);
        })) return false;
        return new Set(['string', 'boolean', 'number', 'number>=0', 'integer', 'array', 'object', 'uuid', 'uuid[]', 'missing',
            'duplicate', '0..16', '0..21', '0..64', '0..100', '1..4096', '1..8192', '1..512', '0..8192',
            '1|2|boolean', '0|1|WEB_AUDIO|DOM_AUDIO', 'MaxRects', 'png|jpg|jpeg|webp',
            'repeat|clamp-to-edge|mirrored-repeat', 'nearest|linear', 'none|nearest|linear']).has(match[4]!);
    }

    /** @description 仅原executor真实assetSet规划期建立有限来源，离开后禁止新登记。 */
    public static async run<T>(request: Readonly<ITaskRequest>, signal: AbortSignal, prepare: () => Promise<T>): Promise<T> {
        if (types.isProxy(request) || signal.aborted) return prepare();
        const payload: unknown = Object.getOwnPropertyDescriptor(request, 'payload')?.value;
        if (payload == null || typeof payload !== 'object' || types.isProxy(payload)
            || Object.getOwnPropertyDescriptor(request, 'kind')?.value !== 'editor-mcp.resource-operation'
            || Object.getOwnPropertyDescriptor(payload, 'operation')?.value !== 'lumen.assetSet') return prepare();
        const input: unknown = Object.getOwnPropertyDescriptor(payload, 'input')?.value;
        const snapshot = TextWritePreparationSnapshot.capture(input, request);
        if (snapshot == null || input == null || typeof input !== 'object') return prepare();
        const scope = { request, input, signal, snapshot, active: true };
        return this.scope.run(scope, async () => { try { return await prepare(); } finally { scope.active = false; } });
    }

    /** @description 仅真实无UUID、无save的字段codec捕获处登记原生输入契约错误；未知故障不签发。 */
    public static record(error: unknown, input: unknown): void {
        if (error == null || typeof error !== 'object' || types.isProxy(error) || !types.isNativeError(error)) return;
        if (this.seen.has(error)) { this.proofs.delete(error); return; }
        const scope = this.scope.getStore(); const code: unknown = Object.getOwnPropertyDescriptor(error, 'message')?.value;
        if (scope?.active !== true || scope.input !== input || scope.signal.aborted
            || !this.isSafeCode(code)
            || Object.getOwnPropertyDescriptor(error, 'projectState') != null
            || !TextWritePreparationSnapshot.matches(scope.snapshot)) return;
        this.seen.add(error); this.proofs.set(error, { request: scope.request, input: scope.input,
            signal: scope.signal, snapshot: scope.snapshot, code });
    }

    /** @description Runtime一次消费原Error并核对真实受理身份；错误副本、跨任务及取消均不成立。 */
    public static take(error: unknown, request: Readonly<ITaskRequest>, signal: AbortSignal): string | null {
        if (error == null || typeof error !== 'object' || types.isProxy(error) || !types.isNativeError(error)) return null;
        const proof = this.proofs.get(error); this.proofs.delete(error);
        if (!proof || proof.request !== request || proof.signal !== signal || signal.aborted
            || Object.getOwnPropertyDescriptor(error, 'message')?.value !== proof.code
            || Object.getOwnPropertyDescriptor(error, 'projectState') != null
            || Object.getOwnPropertyDescriptor(error, 'taskFailures') != null
            || !TextWritePreparationSnapshot.matches(proof.snapshot)) return null;
        const payload: unknown = request.payload;
        if (payload == null || typeof payload !== 'object' || types.isProxy(payload)
            || Object.getOwnPropertyDescriptor(payload, 'operation')?.value !== 'lumen.assetSet'
            || Object.getOwnPropertyDescriptor(payload, 'input')?.value !== proof.input) return null;
        return proof.code;
    }
}
