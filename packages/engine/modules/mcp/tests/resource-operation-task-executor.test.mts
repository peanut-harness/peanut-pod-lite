import assert from 'node:assert/strict';
import test from 'node:test';

import { ResourceLockManager } from '@peanut/pod-engine/runtime';

import { ResourceOperationPlanner } from '../src/resource-operation-planner.js';
import { ResourceOperationTaskExecutor } from '../src/resource-operation-task-executor.js';

function request(id, input, timeoutMs) {
    return {
        requestId: id,
        pluginId: 'peanut.editor-mcp',
        scope: 'project',
        priority: 'normal',
        kind: ResourceOperationTaskExecutor.KIND,
        payload: { operation: 'lumen.setProps', input },
        mergePolicy: 'none',
        ...(timeoutMs == null ? {} : { timeoutMs }),
    };
}

function context() {
    return {
        owner: {
            pluginId: 'peanut.editor-mcp',
            connectionId: 'a'.repeat(32),
            projectKey: '/project',
            capability: 'peanut.editor-mcp.lumen-set-props',
        },
        signal: new AbortController().signal,
        recordEvidence: () => {},
    };
}

function executor(started, gates = new Map(), lockManager = new ResourceLockManager()) {
    return new ResourceOperationTaskExecutor({
        lockManager,
        plan: async (_operation, input) => ({
            projectKey: input.project,
            operation: 'lumen.setProps',
            resourceKeys: [input.resource],
            requiresProjectWriter: input.writer === true,
        }),
        execute: async (_operation, input) => {
            started.push(input.id);
            await gates.get(input.id)?.promise;
            return { id: input.id };
        },
    });
}

function gate() {
    let release;
    return {
        promise: new Promise((resolve) => { release = resolve; }),
        release: () => release(),
    };
}

test('resource executor preserves FIFO for the same resource', async () => {
    const started = [];
    const firstGate = gate();
    const instance = executor(started, new Map([['first', firstGate]]));
    const first = instance.execute(request('first', { id: 'first', project: '/p', resource: 'asset:a' }), context());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = instance.execute(request('second', { id: 'second', project: '/p', resource: 'asset:a' }), context());
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(started, ['first']);
    firstGate.release();
    await Promise.all([first, second]);
    assert.deepEqual(started, ['first', 'second']);
});

test('resource executor permits disjoint resources in one project concurrently', async () => {
    const started = [];
    const firstGate = gate();
    const secondGate = gate();
    const instance = executor(started, new Map([['first', firstGate], ['second', secondGate]]));
    const first = instance.execute(request('first', { id: 'first', project: '/p', resource: 'asset:a' }), context());
    const second = instance.execute(request('second', { id: 'second', project: '/p', resource: 'asset:b' }), context());
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(started.sort(), ['first', 'second']);
    firstGate.release();
    secondGate.release();
    await Promise.all([first, second]);
});

test('resource executor isolates project writer lanes across projects', async () => {
    const started = [];
    const firstGate = gate();
    const secondGate = gate();
    const instance = executor(started, new Map([['first', firstGate], ['second', secondGate]]));
    const first = instance.execute(request('first', { id: 'first', project: '/a', resource: 'asset:a', writer: true }), context());
    const second = instance.execute(request('second', { id: 'second', project: '/b', resource: 'asset:b', writer: true }), context());
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(started.sort(), ['first', 'second']);
    firstGate.release();
    secondGate.release();
    await Promise.all([first, second]);
});

test('resource executor shares the project writer lane across executor instances', async () => {
    const started = [];
    const firstGate = gate();
    const lockManager = new ResourceLockManager();
    const firstExecutor = executor(started, new Map([['first', firstGate]]), lockManager);
    const secondExecutor = executor(started, new Map(), lockManager);
    const first = firstExecutor.execute(
        request('first', { id: 'first', project: '/p', resource: 'asset:a', writer: true }),
        context(),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = secondExecutor.execute(
        request('second', { id: 'second', project: '/p', resource: 'asset:b', writer: true }),
        context(),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(started, ['first']);
    firstGate.release();
    await Promise.all([first, second]);
    assert.deepEqual(started, ['first', 'second']);
});

test('resource executor releases locks after worker failure', async () => {
    const lockManager = new ResourceLockManager();
    const failed = new ResourceOperationTaskExecutor({
        lockManager,
        plan: async () => ({
            projectKey: '/p',
            operation: 'lumen.setProps',
            resourceKeys: ['asset:a'],
            requiresProjectWriter: true,
        }),
        execute: async () => {
            throw new Error('expected_failure');
        },
    });
    await assert.rejects(
        failed.execute(request('failed', { id: 'failed', project: '/p', resource: 'asset:a' }), context()),
        /expected_failure/u,
    );
    const started = [];
    const recovered = executor(started, new Map(), lockManager);
    await recovered.execute(request('recovered', { id: 'recovered', project: '/p', resource: 'asset:a', writer: true }), context());
    assert.deepEqual(started, ['recovered']);
});

test('resource executor times out before commit and removes its waiter', async () => {
    const started = [];
    const firstGate = gate();
    const lockManager = new ResourceLockManager();
    const instance = executor(started, new Map([['first', firstGate]]), lockManager);
    const first = instance.execute(request('first', { id: 'first', project: '/p', resource: 'asset:a' }), context());
    await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(
        instance.execute(request('timed-out', { id: 'timed-out', project: '/p', resource: 'asset:a' }, 1), context()),
        /resource_lock_timeout/u,
    );
    firstGate.release();
    await first;
    await instance.execute(request('after', { id: 'after', project: '/p', resource: 'asset:a' }), context());
    assert.deepEqual(started, ['first', 'after']);
});

test('planner preserves asset sidecars and offline lumen parallelism', () => {
    const planner = new ResourceOperationPlanner();
    const writePlan = planner.plan('D:/projects/game', 'asset.writeText', { path: 'assets/ui/panel.ts' });
    assert.ok(writePlan.resourceKeys.includes('resource:db://assets/ui/panel.ts'));
    assert.ok(writePlan.resourceKeys.includes('resource:db://assets/ui/panel.ts.meta'));
    assert.ok(writePlan.resourceKeys.includes('directory:assets/ui'));
    assert.equal(writePlan.requiresProjectWriter, true);

    const offlinePlan = planner.plan('D:/projects/game', 'lumen.nodeSet', { prefabRelativePath: 'assets/ui/a.prefab' });
    const commitPlan = planner.plan('D:/projects/game', 'lumen.nodeSet', {
        prefabRelativePath: 'assets/ui/b.prefab',
        autoCommit: true,
    });
    assert.deepEqual(offlinePlan.resourceKeys, ['resource:db://assets/ui/a.prefab']);
    assert.equal(offlinePlan.requiresProjectWriter, false);
    assert.equal(commitPlan.requiresProjectWriter, true);
});
