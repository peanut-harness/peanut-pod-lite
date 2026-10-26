import { createHash, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const SCENE = 'db://assets/components/cc.Sprite.scene';
const CONTROL = 'db://assets/components/cc.UIOpacity.scene';
const FRAME = 'db://assets/fixtures/media/assets/image/checker.png/spriteFrame';
const FRAME_PATTERN = 'db://assets/fixtures/media/assets/image/checker.png/**';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const COMMON = ['action', 'projectPath', 'creatorVersion', 'owner', 'runId', 'pid', 'token'] as const;
type Action = 'assetIdentity' | 'sceneFields';
type Request = { action: Action; projectPath: string; creatorVersion: string; owner: string;
    runId: string; pid: number; token: string; expectedSceneUuid?: string;
    expectedFrameUuid?: string; expectOpacity?: boolean };
type Context = { projectPath: string; creatorVersion: '3.8.3' | '3.8.7'; owner: string;
    runId: string; pid: number; token: string; timeoutMs: number;
    message: { request(target: string, method: string, ...args: unknown[]): Promise<unknown> } };

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('component_sprite_probe_response_invalid');
    return value as Record<string, unknown>;
}
function validUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function digest(value: string): Buffer { return createHash('sha256').update(value).digest(); }

/**
 * Bounded, authenticated read-only dispatch. A future listener and descriptor need separate registration.
 */
export class ComponentExistingSpriteNativeProbeMain {
    private readonly context: Context;

    public constructor(context: Context) {
        const project = realpathSync(context.projectPath);
        if (project !== resolve(context.projectPath) || !['3.8.3', '3.8.7'].includes(context.creatorVersion)
            || !/^[a-f0-9-]{36}$/iu.test(context.owner) || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(context.runId)
            || !Number.isSafeInteger(context.pid) || context.pid <= 0
            || !/^[a-f0-9]{64}$/iu.test(context.token)
            || !Number.isInteger(context.timeoutMs) || context.timeoutMs < 1 || context.timeoutMs > 5000
            || typeof context.message?.request !== 'function')
            throw new Error('component_sprite_probe_context_invalid');
        this.context = { ...context, projectPath: project };
    }

    public async dispatch(value: unknown): Promise<Record<string, unknown>> {
        const input = record(value) as Request;
        if (input.action !== 'assetIdentity' && input.action !== 'sceneFields')
            throw new Error('component_sprite_probe_action_invalid');
        const keys = input.action === 'assetIdentity' ? COMMON : [...COMMON,
            'expectedSceneUuid', 'expectedFrameUuid', 'expectOpacity'];
        if (Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key as typeof COMMON[number])))
            throw new Error('component_sprite_probe_arguments_invalid');
        const supplied = typeof input.token === 'string' && input.token.length <= 128 ? input.token : '';
        if (input.projectPath !== this.context.projectPath || input.creatorVersion !== this.context.creatorVersion
            || input.owner !== this.context.owner || input.runId !== this.context.runId
            || input.pid !== this.context.pid || !timingSafeEqual(digest(supplied), digest(this.context.token)))
            throw new Error('component_sprite_probe_identity_invalid');
        if (JSON.stringify(input).length > 16384) throw new Error('component_sprite_probe_request_too_large');
        if (input.action === 'assetIdentity') return this.assetIdentity();
        if (!validUuid(input.expectedSceneUuid) || !validUuid(input.expectedFrameUuid)
            || typeof input.expectOpacity !== 'boolean') throw new Error('component_sprite_probe_arguments_invalid');
        return this.sceneFields(input.expectedSceneUuid, input.expectedFrameUuid, input.expectOpacity);
    }

    private async call(target: string, method: string, ...args: unknown[]): Promise<unknown> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const response = await Promise.race([
                Promise.resolve().then(() => this.context.message.request(target, method, ...args)),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('component_sprite_probe_timeout')), this.context.timeoutMs);
                }),
            ]);
            const serialized = JSON.stringify(response);
            if (serialized === undefined || Buffer.byteLength(serialized) > 65536)
                throw new Error('component_sprite_probe_response_too_large_or_invalid');
            return response;
        } finally { if (timer) clearTimeout(timer); }
    }

    private async assetIdentity(): Promise<Record<string, unknown>> {
        const sprite = record(await this.call('asset-db', 'query-asset-info', SCENE));
        const control = record(await this.call('asset-db', 'query-asset-info', CONTROL));
        if (sprite.url !== SCENE || control.url !== CONTROL || !validUuid(sprite.uuid)
            || !validUuid(control.uuid) || sprite.uuid === control.uuid)
            throw new Error('component_sprite_probe_scene_identity_missing');
        const raw = await this.call('asset-db', 'query-assets', { pattern: FRAME_PATTERN });
        if (!Array.isArray(raw)) throw new Error('component_sprite_probe_asset_list_invalid');
        const matches = raw.filter(item => item && typeof item === 'object' && item.url === FRAME);
        if (matches.length !== 1) throw new Error('component_sprite_probe_asset_identity_missing');
        const frame = record(matches[0]);
        if (frame.type !== 'cc.SpriteFrame' || frame.imported !== true || frame.invalid === true
            || !validUuid(frame.uuid) || frame.uuid === sprite.uuid || frame.uuid === control.uuid)
            throw new Error('component_sprite_probe_frame_identity_invalid');
        return { schema: 'peanut.pod.sprite-native-asset-identity.v1', sceneUuid: sprite.uuid,
            controlSceneUuid: control.uuid, frameUuid: frame.uuid, frameUrl: FRAME,
            nativeAccepted: false };
    }

    private async sceneFields(sceneUuid: string, frameUuid: string, expectOpacity: boolean): Promise<Record<string, unknown>> {
        const snapshot = record(await this.call('scene', 'execute-scene-script', {
            name: 'peanut-component-sprite-probe', method: 'snapshot', args: [sceneUuid, frameUuid, expectOpacity],
        }));
        const expectedKeys = ['sceneUuid', 'frameUuid', 'targetPath', 'grayscale', 'opacity', 'frameValid', 'frameType'];
        if (Object.keys(snapshot).length !== expectedKeys.length
            || Object.keys(snapshot).some(key => !expectedKeys.includes(key)))
            throw new Error('component_sprite_probe_native_readback_shape_invalid');
        if (snapshot.sceneUuid !== sceneUuid || snapshot.frameUuid !== frameUuid
            || snapshot.targetPath !== '/Root/Canvas/Target' || typeof snapshot.grayscale !== 'boolean'
            || snapshot.frameValid !== true || snapshot.frameType !== 'cc.SpriteFrame'
            || (expectOpacity ? !Number.isInteger(snapshot.opacity) || Number(snapshot.opacity) < 0
                || Number(snapshot.opacity) > 255 : snapshot.opacity !== null))
            throw new Error('component_sprite_probe_native_readback_mismatch');
        return { schema: 'peanut.pod.sprite-native-scene-fields.v1',
            sceneUuid: snapshot.sceneUuid, frameUuid: snapshot.frameUuid, targetPath: snapshot.targetPath,
            grayscale: snapshot.grayscale, opacity: snapshot.opacity,
            frameValid: true, frameType: 'cc.SpriteFrame', nativeAccepted: false };
    }
}
