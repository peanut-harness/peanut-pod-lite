import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ResourceOwnedCreatorQuit as Quit } from '../scripts/resource-stability-owned-quit.mts';
const registration = { task: '4.3', creatorVersion: '3.8.3', sdkOwnedQuit: true, owner: 'actor', runId: 'run', projectPath: '/owned/project' };
const lease = { pid: 300, owner: 'actor', runId: 'run', project: '/owned/project' };
const runtime = { pid: 300, creatorVersion: '3.8.3', projectPath: '/owned/project' };
const input = { pid: 300, owner: 'actor', runId: 'run', projectPath: '/owned/project' };
test('normal SDK quit authorization is limited to original registered process, owner, run and project', () => {
    assert.deepEqual(Quit.authorize(registration, lease, input, runtime), {
        accepted: true, pid: 300, owner: 'actor', runId: 'run', method: 'original-sdk-public-App.quit', forced: false,
    });
    for (const change of [{ pid: 301 }, { owner: 'other' }, { runId: 'other' }, { projectPath: '/foreign' }, { code: 'anything' }, { api: 'quit' }])
        assert.throws(() => Quit.authorize(registration, lease, { ...input, ...change }, runtime), /identity_invalid/u);
    assert.throws(() => Quit.authorize(registration, { ...lease, pid: 301 }, input, runtime), /identity_invalid/u);
    assert.throws(() => Quit.authorize(registration, lease, input, { ...runtime, pid: 301 }), /identity_invalid/u);
    assert.throws(() => Quit.authorize(registration, lease, null, runtime), /request_invalid/u);
});
test('unregistered or other SDKs cannot acquire the owned SDK quit entry point', () => {
    for (const change of [{ sdkOwnedQuit: false }, { task: '5.2' }, { creatorVersion: '3.8.7' }])
        assert.throws(() => Quit.authorize({ ...registration, ...change }, lease, input, runtime), /identity_invalid/u);
    assert.throws(() => Quit.authorize(registration, lease, input, { ...runtime, creatorVersion: '3.8.7' }), /identity_invalid/u);
});
test('SDK source observation never calls or evaluates the recorded quit method', () => {
    let calls = 0; const quit = (): void => { calls++; };
    const observed = Quit.inspect({ App: { version: '3.8.3', quit }, Project: { path: '/owned/project' } });
    assert.equal(observed.source, Function.prototype.toString.call(quit));
    assert.equal(observed.sha256, createHash('sha256').update(observed.source ?? '').digest('hex'));
    assert.equal(calls, 0);
});
