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
        enterCommitWindow: () => true,
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

    const scaffoldPlan = planner.plan('D:/projects/game', 'lumen.scaffold', {
        prefabRelativePath: 'assets/ui/NewPanel.prefab',
        rootName: 'NewPanel',
    });
    assert.equal(scaffoldPlan.workerManagedCommitWindow, true);
    assert.equal(scaffoldPlan.requiresProjectWriter, false);
    assert.ok(scaffoldPlan.resourceKeys.includes('resource:db://assets/ui/NewPanel.prefab'));
    assert.ok(scaffoldPlan.resourceKeys.includes('resource:db://assets/ui/NewPanel.prefab.meta'));
    assert.ok(scaffoldPlan.resourceKeys.includes('directory:assets/ui'));
    assert.ok(scaffoldPlan.resourceKeys.includes('resource:db://assets/ui.meta'));

    const nativePrefabPlan = planner.plan('D:/projects/game', 'prefab.createFromNode', {
        nodePath: 'Canvas/Panel',
        prefabPath: 'db://assets/ui/NewPanel.prefab',
    });
    assert.equal(nativePrefabPlan.workerManagedCommitWindow, true);
    assert.equal(nativePrefabPlan.requiresProjectWriter, true);
    assert.ok(nativePrefabPlan.resourceKeys.includes('resource:db://assets/ui/NewPanel.prefab'));
});

test('resource executor lets first-creation worker enter commit only at publication', async () => {
    let enterCalls = 0;
    let workerObservedEnterCalls = -1;
    const instance = new ResourceOperationTaskExecutor({
        plan: async () => ({
            projectKey: '/p',
            operation: 'lumen.scaffold',
            resourceKeys: ['resource:db://assets/New.prefab'],
            requiresProjectWriter: false,
            workerManagedCommitWindow: true,
        }),
        execute: async (_operation, _input, taskContext) => {
            workerObservedEnterCalls = enterCalls;
            assert.equal(taskContext.enterCommitWindow(), true);
            return { ok: true };
        },
    });
    const taskContext = {
        ...context(),
        enterCommitWindow: () => {
            enterCalls += 1;
            return true;
        },
    };
    await instance.execute(request('create', { id: 'create', project: '/p', resource: 'asset:new' }), taskContext);
    assert.equal(workerObservedEnterCalls, 0);
    assert.equal(enterCalls, 1);
});

test('resource executor records exactly one authoritative postflight on success and worker failure', async () => {
    for (const shouldFail of [false, true]) {
        const evidence: Array<{ readonly id: string; readonly status: string }> = [];
        const instance = new ResourceOperationTaskExecutor({
            plan: async () => ({
                projectKey: '/p',
                operation: 'asset.writeText',
                resourceKeys: ['resource:db://assets/a.txt'],
                requiresProjectWriter: true,
            }),
            execute: async () => {
                if (shouldFail) throw new Error('postflight_expected_failure');
                return { ok: true };
            },
        });
        const taskContext = {
            ...context(),
            recordEvidence: (entry: { readonly id: string; readonly status: string }) => evidence.push(entry),
        };
        if (shouldFail) {
            await assert.rejects(
                instance.execute(request('failure', { id: 'failure', project: '/p', resource: 'asset:a' }), taskContext),
                /postflight_expected_failure/u,
            );
        } else {
            await instance.execute(request('success', { id: 'success', project: '/p', resource: 'asset:a' }), taskContext);
        }
        const postflight = evidence.filter((entry) => entry.id === 'postflight');
        assert.equal(postflight.length, 1);
        assert.equal(postflight[0]?.status, shouldFail ? 'failed' : 'completed');
    }
});

test('resource batch bounds prepare concurrency and records one batch postflight', async () => {
    let activePlans = 0;
    let maxActivePlans = 0;
    const committed = [];
    const evidence = [];
    const instance = new ResourceOperationTaskExecutor({
        plan: async (_operation, input) => {
            activePlans += 1;
            maxActivePlans = Math.max(maxActivePlans, activePlans);
            await new Promise((resolve) => setTimeout(resolve, 5));
            activePlans -= 1;
            return {
                projectKey: '/p',
                operation: 'lumen.setProps',
                resourceKeys: [`asset:${input.id}`],
                requiresProjectWriter: true,
            };
        },
        execute: async (_operation, input) => {
            committed.push(input.id);
            return { id: input.id };
        },
    });
    const requests = Array.from({ length: 6 }, (_, index) =>
        request(`batch-${index}`, { id: `item-${index}`, project: '/p', resource: `asset:${index}`, writer: true }));
    const contexts = requests.map((_, index) => ({
        ...context(),
        recordEvidence: (entry) => evidence.push({ index, ...entry }),
    }));

    const results = await instance.executeBatch(requests, contexts, 'batch:bounded');

    assert.equal(maxActivePlans, 4);
    assert.deepEqual(committed, requests.map((_, index) => `item-${index}`));
    assert.deepEqual(results, requests.map((_, index) => ({ id: `item-${index}` })));
    assert.equal(evidence.filter((entry) => entry.id === 'batch-postflight').length, 1);
});

test('resource batch holds its union resource set through the full commit window', async () => {
    const started = [];
    const firstGate = gate();
    const lockManager = new ResourceLockManager();
    const batch = executor(started, new Map([['first', firstGate]]), lockManager);
    const competing = executor(started, new Map(), lockManager);
    const batchPromise = batch.executeBatch([
        request('first', { id: 'first', project: '/p', resource: 'asset:a', writer: true }),
        request('second', { id: 'second', project: '/p', resource: 'asset:b', writer: true }),
    ], [context(), context()], 'batch:union');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const competingPromise = competing.execute(
        request('competing', { id: 'competing', project: '/p', resource: 'asset:b', writer: true }),
        context(),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(started, ['first']);
    firstGate.release();
    await batchPromise;
    await competingPromise;
    assert.deepEqual(started, ['first', 'second', 'competing']);
});

test('resource batch reports conservative project state across failure boundaries', async () => {
    const unchanged = new ResourceOperationTaskExecutor({
        plan: async () => {
            throw new Error('prepare_failed');
        },
        execute: async () => ({ ok: true }),
    });
    await assert.rejects(
        unchanged.executeBatch(
            [request('prepare', { id: 'prepare', project: '/p', resource: 'asset:a' })],
            [context()],
            'batch:prepare',
        ),
        (error) => error instanceof Error && error.message === 'prepare_failed' && error.projectState === 'unchanged',
    );

    const mayHaveChanged = new ResourceOperationTaskExecutor({
        plan: async () => ({
            projectKey: '/p',
            operation: 'asset.writeText',
            resourceKeys: ['asset:a'],
            requiresProjectWriter: true,
        }),
        execute: async () => {
            throw new Error('commit_failed');
        },
    });
    await assert.rejects(
        mayHaveChanged.executeBatch(
            [request('commit', { id: 'commit', project: '/p', resource: 'asset:a' })],
            [context()],
            'batch:commit',
        ),
        (error) => error instanceof Error && error.message === 'commit_failed' && error.projectState === 'may_have_changed',
    );

    const rolledBack = new ResourceOperationTaskExecutor({
        plan: async () => ({
            projectKey: '/p',
            operation: 'asset.writeText',
            resourceKeys: ['asset:a'],
            requiresProjectWriter: true,
        }),
        execute: async () => {
            throw Object.assign(new Error('commit_rolled_back'), { projectState: 'rolled_back' });
        },
    });
    await assert.rejects(
        rolledBack.executeBatch(
            [request('rollback', { id: 'rollback', project: '/p', resource: 'asset:a' })],
            [context()],
            'batch:rollback',
        ),
        (error) => error instanceof Error && error.message === 'commit_rolled_back' && error.projectState === 'rolled_back',
    );

    const cancelled = executor([], new Map());
    await assert.rejects(
        cancelled.executeBatch(
            [request('cancelled', { id: 'cancelled', project: '/p', resource: 'asset:a' })],
            [{ ...context(), enterCommitWindow: () => false }],
            'batch:cancelled',
        ),
        (error) => error instanceof Error
            && error.message === 'editor_mcp_batch_cancelled_before_commit'
            && error.projectState === 'unchanged',
    );
});

test('resource batch yields to control work at the 200ms safe item boundary', async () => {
    const committed = [];
    let observedCommittedCount = -1;
    const instance = new ResourceOperationTaskExecutor({
        plan: async (_operation, input) => ({
            projectKey: '/p',
            operation: 'asset.writeText',
            resourceKeys: [`asset:${input.id}`],
            requiresProjectWriter: true,
        }),
        execute: async (_operation, input) => {
            committed.push(input.id);
            if (input.id === 'first') {
                const deadline = Date.now() + 205;
                while (Date.now() < deadline) {
                    // 模拟不可中断的同步 Creator 提交片段。
                }
            }
            return { id: input.id };
        },
    });
    setTimeout(() => {
        observedCommittedCount = committed.length;
    }, 0);

    await instance.executeBatch([
        request('first', { id: 'first', project: '/p', resource: 'asset:a', writer: true }),
        request('second', { id: 'second', project: '/p', resource: 'asset:b', writer: true }),
    ], [context(), context()], 'batch:yield');

    assert.equal(observedCommittedCount, 1);
    assert.deepEqual(committed, ['first', 'second']);
});
