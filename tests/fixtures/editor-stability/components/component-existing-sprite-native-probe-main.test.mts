import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ComponentExistingSpriteNativeProbeMain } from './component-existing-sprite-native-probe-main.ts';

const sceneUuid = '00000000-0000-4000-8000-000000000001';
const controlUuid = '00000000-0000-4000-8000-000000000002';
const frameUuid = '00000000-0000-4000-8000-000000000003';
const owner = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const token = 'a'.repeat(64);
const sceneUrl = 'db://assets/components/cc.Sprite.scene';
const controlUrl = 'db://assets/components/cc.UIOpacity.scene';
const frameUrl = 'db://assets/fixtures/media/assets/image/checker.png/spriteFrame';

function fixture(request?: (target: string, method: string, ...args: unknown[]) => Promise<unknown>) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'component-native-main-')));
    const projectPath = join(root, 'synthetic-project'); mkdirSync(projectPath);
    const calls: { target: string; method: string; args: unknown[] }[] = [];
    const message = { request: async (target: string, method: string, ...args: unknown[]) => {
        calls.push({ target, method, args });
        if (request) return request(target, method, ...args);
        if (method === 'query-asset-info') {
            const url = args[0]; return { url, uuid: url === sceneUrl ? sceneUuid : controlUuid };
        }
        if (method === 'query-assets') return [{ url: frameUrl, uuid: frameUuid,
            type: 'cc.SpriteFrame', imported: true, invalid: false }];
        if (method === 'execute-scene-script') return { sceneUuid, frameUuid,
            targetPath: '/Root/Canvas/Target', grayscale: true, opacity: 128,
            frameValid: true, frameType: 'cc.SpriteFrame' };
        throw new Error('unexpected_mock_call');
    } };
    const context = { projectPath, creatorVersion: '3.8.3' as const, owner,
        runId: 'sprite-canary', pid: 12345, token, timeoutMs: 50, message };
    const input = { action: 'assetIdentity', projectPath, creatorVersion: '3.8.3',
        owner, runId: 'sprite-canary', pid: 12345, token };
    return { context, input, calls, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('asset and scene getters use only exact native reads and never return the token', async () => {
    const f = fixture();
    try {
        const probe = new ComponentExistingSpriteNativeProbeMain(f.context);
        const identities = await probe.dispatch(f.input);
        assert.deepEqual([identities.sceneUuid, identities.controlSceneUuid, identities.frameUuid],
            [sceneUuid, controlUuid, frameUuid]);
        assert.deepEqual(f.calls.map(row => [row.target, row.method]), [
            ['asset-db', 'query-asset-info'], ['asset-db', 'query-asset-info'], ['asset-db', 'query-assets'],
        ]);
        const fields = await probe.dispatch({ ...f.input, action: 'sceneFields',
            expectedSceneUuid: sceneUuid, expectedFrameUuid: frameUuid, expectOpacity: true });
        assert.equal(fields.opacity, 128);
        assert.equal(f.calls[3].target, 'scene');
        assert.equal(f.calls[3].method, 'execute-scene-script');
        assert.deepEqual(f.calls[3].args, [{ name: 'peanut-component-sprite-probe',
            method: 'snapshot', args: [sceneUuid, frameUuid, true] }]);
        assert.equal(JSON.stringify({ identities, fields }).includes(token), false);
        assert.equal(identities.nativeAccepted, false);
    } finally { f.close(); }
});

test('wrong identity, token, extra arguments and unknown action refuse before Editor calls', async () => {
    const f = fixture();
    try {
        const probe = new ComponentExistingSpriteNativeProbeMain(f.context);
        for (const input of [{ ...f.input, token: 'b'.repeat(64) },
            { ...f.input, projectPath: `${f.input.projectPath}-other` },
            { ...f.input, pid: 8 }, { ...f.input, runId: 'other-run' }])
            await assert.rejects(probe.dispatch(input), /identity_invalid/);
        await assert.rejects(probe.dispatch({ ...f.input, arbitrary: true }), /arguments_invalid/);
        await assert.rejects(probe.dispatch({ ...f.input, action: 'write' }), /action_invalid/);
        await assert.rejects(probe.dispatch({ ...f.input, action: 'sceneFields',
            expectedSceneUuid: 'bad', expectedFrameUuid: frameUuid, expectOpacity: true }), /arguments_invalid/);
        assert.equal(f.calls.length, 0);
    } finally { f.close(); }
});

test('rejected and unavailable native APIs remain failures, while an empty success is not identity', async () => {
    const failure = new Error('actual_asset_db_failure');
    const f = fixture(async () => { throw failure; });
    try {
        const probe = new ComponentExistingSpriteNativeProbeMain(f.context);
        await assert.rejects(probe.dispatch(f.input), error => error === failure);
        assert.throws(() => new ComponentExistingSpriteNativeProbeMain({ ...f.context,
            message: {} as typeof f.context.message }), /context_invalid/);
    } finally { f.close(); }
    const empty = fixture(async (_target, method, ...args) => method === 'query-assets' ? []
        : { url: args[0], uuid: args[0] === sceneUrl ? sceneUuid : controlUuid });
    try {
        await assert.rejects(new ComponentExistingSpriteNativeProbeMain(empty.context).dispatch(empty.input),
            /asset_identity_missing/);
    } finally { empty.close(); }
});

test('timeout, ambiguous or wrong type frame and oversized responses fail explicitly', async () => {
    const stalled = fixture(async () => new Promise(() => {}));
    try {
        const probe = new ComponentExistingSpriteNativeProbeMain({ ...stalled.context, timeoutMs: 5 });
        await assert.rejects(probe.dispatch(stalled.input), /timeout/);
    } finally { stalled.close(); }
    for (const rows of [[{ url: frameUrl, uuid: frameUuid, type: 'cc.Texture2D', imported: true }],
        [{ url: frameUrl, uuid: frameUuid, type: 'cc.SpriteFrame', imported: true },
            { url: frameUrl, uuid: frameUuid, type: 'cc.SpriteFrame', imported: true }]]) {
        const f = fixture(async (_target, method, ...args) => method === 'query-assets' ? rows
            : { url: args[0], uuid: args[0] === sceneUrl ? sceneUuid : controlUuid });
        try { await assert.rejects(new ComponentExistingSpriteNativeProbeMain(f.context).dispatch(f.input),
            /frame_identity_invalid|asset_identity_missing/); }
        finally { f.close(); }
    }
    const large = fixture(async () => ({ padding: 'x'.repeat(70000) }));
    try { await assert.rejects(new ComponentExistingSpriteNativeProbeMain(large.context).dispatch(large.input),
        /response_too_large/); }
    finally { large.close(); }
});

test('native scene response mismatch and absent opacity are never counted as readback', async () => {
    const f = fixture(async (_target, method, ...args) => {
        if (method !== 'execute-scene-script') return { url: args[0], uuid: sceneUuid };
        return { sceneUuid, frameUuid, targetPath: '/Root/Canvas/Target', grayscale: true,
            opacity: null, frameValid: true, frameType: 'cc.SpriteFrame' };
    });
    try {
        const probe = new ComponentExistingSpriteNativeProbeMain(f.context);
        await assert.rejects(probe.dispatch({ ...f.input, action: 'sceneFields',
            expectedSceneUuid: sceneUuid, expectedFrameUuid: frameUuid, expectOpacity: true }),
        /native_readback_mismatch/);
    } finally { f.close(); }
});

test('unexpected scene payload fields cannot leak into a readback result', async () => {
    const f = fixture(async () => ({ sceneUuid, frameUuid, targetPath: '/Root/Canvas/Target',
        grayscale: true, opacity: 128, frameValid: true, frameType: 'cc.SpriteFrame', token }));
    try {
        await assert.rejects(new ComponentExistingSpriteNativeProbeMain(f.context).dispatch({
            ...f.input, action: 'sceneFields', expectedSceneUuid: sceneUuid,
            expectedFrameUuid: frameUuid, expectOpacity: true,
        }), /native_readback_shape_invalid/);
    } finally { f.close(); }
});
