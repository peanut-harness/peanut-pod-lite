import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

function fixture(request?: (target: string, method: string, ...args: unknown[]) => Promise<unknown>,
    version: '3.8.3' | '3.8.7' = '3.8.3') {
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
    const context = { projectPath, creatorVersion: version, owner,
        runId: 'sprite-canary', pid: 12345, token, timeoutMs: 50, message };
    const input = { action: 'assetIdentity', projectPath, creatorVersion: version,
        owner, runId: 'sprite-canary', pid: 12345, token };
    return { context, input, calls, close: () => rmSync(root, { recursive: true, force: true }) };
}

function seedExisting(project: string, version: '3.8.3' | '3.8.7') {
    const relative = 'assets/peanut-pod-upgrade-0-2-1/probe.json';
    const actual = `/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-${version}`;
    mkdirSync(dirname(join(project, relative)), { recursive: true });
    for (const name of [relative, `${relative}.meta`])
        writeFileSync(join(project, name), readFileSync(join(actual, name)));
    return relative;
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

test('fixed preexisting JSON asset uses one exact native query and version-specific UUID', async () => {
    for (const [version, uuid] of [['3.8.3', '83213e97-04f5-48f9-9d1c-a4af0ba54c1d'],
        ['3.8.7', '4ab4daed-90ec-434e-a5d6-7193d386540b']] as const) {
        const url = 'db://assets/peanut-pod-upgrade-0-2-1/probe.json';
        const f = fixture(async (_target, _method, argument) => ({ url: argument, uuid,
            type: 'cc.JsonAsset', invalid: false }), version);
        try {
            seedExisting(f.context.projectPath, version);
            const result = await new ComponentExistingSpriteNativeProbeMain(f.context).dispatch({
                ...f.input, action: 'existingAssetIdentity',
            });
            assert.equal(result.uuid, uuid);
            assert.equal(result.nativeAccepted, false);
            assert.deepEqual(f.calls, [{ target: 'asset-db', method: 'query-asset-info', args: [url] }]);
        } finally { f.close(); }
    }
});

test('fixed asset refuses wrong URL, UUID, type, null and native error without fallback', async () => {
    const url = 'db://assets/peanut-pod-upgrade-0-2-1/probe.json';
    for (const response of [{ url: `${url}-other`, uuid: '83213e97-04f5-48f9-9d1c-a4af0ba54c1d', type: 'cc.JsonAsset' },
        { url, uuid: '4ab4daed-90ec-434e-a5d6-7193d386540b', type: 'cc.JsonAsset' },
        { url, uuid: '83213e97-04f5-48f9-9d1c-a4af0ba54c1d', type: 'json' }, null]) {
        const f = fixture(async () => response);
        try {
            seedExisting(f.context.projectPath, '3.8.3');
            await assert.rejects(new ComponentExistingSpriteNativeProbeMain(f.context).dispatch({
                ...f.input, action: 'existingAssetIdentity',
            }), /existing_identity_mismatch|response_invalid/);
        } finally { f.close(); }
    }
    const failure = new Error('real_asset_db_rejection');
    const f = fixture(async () => { throw failure; });
    try {
        seedExisting(f.context.projectPath, '3.8.3');
        await assert.rejects(new ComponentExistingSpriteNativeProbeMain(f.context).dispatch({
            ...f.input, action: 'existingAssetIdentity',
        }), error => error === failure);
    } finally { f.close(); }
});

test('fixed asset source/meta drift and caller-selected URL fail before Editor requests', async () => {
    const f = fixture(async () => { throw new Error('should_not_call'); });
    try {
        const relative = seedExisting(f.context.projectPath, '3.8.3');
        const probe = new ComponentExistingSpriteNativeProbeMain(f.context);
        await assert.rejects(probe.dispatch({ ...f.input, action: 'existingAssetIdentity',
            url: 'db://assets/other' }), /arguments_invalid/);
        writeFileSync(join(f.context.projectPath, relative), '{}');
        await assert.rejects(probe.dispatch({ ...f.input, action: 'existingAssetIdentity' }), /existing_source_invalid/);
        seedExisting(f.context.projectPath, '3.8.3');
        writeFileSync(join(f.context.projectPath, `${relative}.meta`), '{}');
        await assert.rejects(probe.dispatch({ ...f.input, action: 'existingAssetIdentity' }), /existing_source_invalid/);
        assert.equal(f.calls.length, 0);
    } finally { f.close(); }
});

test('3.8.7 refuses 3.8.3 existing-asset bytes before native lookup', async () => {
    const f = fixture(async () => { throw new Error('should_not_call'); }, '3.8.7');
    try {
        seedExisting(f.context.projectPath, '3.8.3');
        await assert.rejects(new ComponentExistingSpriteNativeProbeMain(f.context).dispatch({
            ...f.input, action: 'existingAssetIdentity',
        }), /existing_source_invalid/);
        assert.equal(f.calls.length, 0);
    } finally { f.close(); }
});

test('3.8.3 compatibility pilot admits only fixed existing asset action', async () => {
    const url = 'db://assets/peanut-pod-upgrade-0-2-1/probe.json';
    const f = fixture(async (_target, _method, argument) => ({ url: argument,
        uuid: '83213e97-04f5-48f9-9d1c-a4af0ba54c1d', type: 'cc.JsonAsset' }));
    try {
        seedExisting(f.context.projectPath, '3.8.3');
        const probe = new ComponentExistingSpriteNativeProbeMain({ ...f.context,
            allowedActions: ['existingAssetIdentity'] });
        for (const action of ['assetIdentity', 'sceneFields', 'write'])
            await assert.rejects(probe.dispatch({ ...f.input, action }), /action_denied|action_invalid/u);
        await assert.rejects(probe.dispatch({ ...f.input, action: 'existingAssetIdentity', url }), /arguments_invalid/u);
        assert.equal(f.calls.length, 0);
        const result = await probe.dispatch({ ...f.input, action: 'existingAssetIdentity' });
        assert.equal(result.nativeAccepted, false);
        assert.deepEqual(f.calls.map(row => [row.target, row.method, row.args]),
            [['asset-db', 'query-asset-info', [url]]]);
        assert.throws(() => new ComponentExistingSpriteNativeProbeMain({ ...f.context,
            creatorVersion: '3.8.7', allowedActions: ['existingAssetIdentity'] }), /context_invalid/u);
    } finally { f.close(); }
});
