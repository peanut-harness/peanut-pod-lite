import assert from 'node:assert/strict';
import test from 'node:test';

import type { IResourceOperationTaskPlan } from '../src/resource-operation-contracts.js';
import { ResourceOperationPlanner } from '../src/resource-operation-planner.js';
import { ResourceOperationTaskError } from '../src/resource-operation-task-error.js';
import { ResourceOperationTaskQueue } from '../src/resource-operation-task-queue.js';

/**
 * @description 创建测试调度计划。
 * @param projectKey 工程隔离键。
 * @param operation operation。
 * @param resourceKeys 原子资源集合。
 * @param requiresProjectWriter 是否进入项目 writer。
 * @returns 不可变调度计划。
 * @oopException 测试数据工厂，无运行时状态与替换点。
 */
function createPlan(
    projectKey: string,
    operation: string,
    resourceKeys: readonly string[],
    requiresProjectWriter: boolean = false,
): IResourceOperationTaskPlan {
    return Object.freeze({ projectKey, operation, resourceKeys: Object.freeze([...resourceKeys]), requiresProjectWriter });
}

/**
 * @description 等待指定毫秒数。
 * @param milliseconds 等待时间。
 * @returns 等待 Promise。
 * @oopException 测试异步时序工具，无运行时状态与替换点。
 */
function delay(milliseconds: number): Promise<void> {
    return new Promise((resolveDelay) => {
        setTimeout(resolveDelay, milliseconds);
    });
}

test('same resource tasks execute in FIFO order', async (): Promise<void> => {
    const queue = new ResourceOperationTaskQueue();
    const plan = createPlan('project-a', 'lumen.compSet', ['resource:db://assets/a.prefab']);
    const order: string[] = [];
    const first = queue.run(plan, async () => {
        order.push('first:start');
        await delay(20);
        order.push('first:end');
        return 1;
    });
    const second = queue.run(plan, async () => {
        order.push('second');
        return 2;
    });

    const [firstRecord, secondRecord] = await Promise.all([first, second]);
    assert.deepEqual(order, ['first:start', 'first:end', 'second']);
    assert.equal(firstRecord.status, 'succeeded');
    assert.equal(secondRecord.status, 'succeeded');
    assert.equal(queue.get(firstRecord.taskId)?.status, 'succeeded');
});

test('different resources in one project execute in parallel', async (): Promise<void> => {
    const queue = new ResourceOperationTaskQueue();
    let inFlight = 0;
    let maxInFlight = 0;
    const worker = async (): Promise<void> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(20);
        inFlight -= 1;
    };
    await Promise.all([
        queue.run(createPlan('project-a', 'lumen.nodeSet', ['resource:a']), worker),
        queue.run(createPlan('project-a', 'lumen.nodeSet', ['resource:b']), worker),
    ]);
    assert.equal(maxInFlight, 2);
});

test('project writer serializes AssetDB work across independent router clients', async (): Promise<void> => {
    ResourceOperationTaskQueue.resetSharedForTests();
    const firstRouterQueue = ResourceOperationTaskQueue.shared();
    const secondRouterQueue = ResourceOperationTaskQueue.shared();
    assert.equal(firstRouterQueue, secondRouterQueue);
    const order: string[] = [];
    const first = firstRouterQueue.run(createPlan('project-a', 'asset.writeText', ['resource:a'], true), async () => {
        order.push('first:start');
        await delay(20);
        order.push('first:end');
    });
    const second = secondRouterQueue.run(createPlan('project-a', 'asset.reimport', ['resource:b'], true), async () => {
        order.push('second');
    });
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first:start', 'first:end', 'second']);
    ResourceOperationTaskQueue.resetSharedForTests();
});

test('project writer forms a barrier around resource-only work', async (): Promise<void> => {
    const queue = new ResourceOperationTaskQueue();
    const order: string[] = [];
    const first = queue.run(createPlan('project-a', 'lumen.nodeSet', ['resource:a']), async () => {
        order.push('resource:first:start');
        await delay(20);
        order.push('resource:first:end');
    });
    const writer = queue.run(createPlan('project-a', 'asset.catalog.refresh', ['resource:project'], true), async () => {
        order.push('writer');
    });
    const second = queue.run(createPlan('project-a', 'lumen.nodeSet', ['resource:b']), async () => {
        order.push('resource:second');
    });
    await Promise.all([first, writer, second]);
    assert.deepEqual(order, ['resource:first:start', 'resource:first:end', 'writer', 'resource:second']);
});

test('different projects keep independent writer lanes', async (): Promise<void> => {
    const queue = new ResourceOperationTaskQueue();
    let inFlight = 0;
    let maxInFlight = 0;
    const worker = async (): Promise<void> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(20);
        inFlight -= 1;
    };
    await Promise.all([
        queue.run(createPlan('project-a', 'asset.writeText', ['resource:a'], true), worker),
        queue.run(createPlan('project-b', 'asset.writeText', ['resource:a'], true), worker),
    ]);
    assert.equal(maxInFlight, 2);
});

test('multi-resource tasks reserve their complete set atomically', async (): Promise<void> => {
    const queue = new ResourceOperationTaskQueue();
    const order: string[] = [];
    const first = queue.run(createPlan('project-a', 'lumen.compSet', ['resource:a']), async () => {
        order.push('first:start');
        await delay(20);
        order.push('first:end');
    });
    const combined = queue.run(createPlan('project-a', 'lumen.commit', ['resource:a', 'resource:b']), async () => {
        order.push('combined');
    });
    const second = queue.run(createPlan('project-a', 'lumen.compSet', ['resource:b']), async () => {
        order.push('second');
    });
    await Promise.all([first, combined, second]);
    assert.deepEqual(order, ['first:start', 'first:end', 'combined', 'second']);
});

test('failed tasks release resources for subsequent work', async (): Promise<void> => {
    const queue = new ResourceOperationTaskQueue();
    const plan = createPlan('project-a', 'asset.writeText', ['resource:a'], true);
    await assert.rejects(
        queue.run(plan, async () => {
            throw new Error('expected_failure');
        }),
        (error: unknown): boolean => {
            assert.ok(error instanceof ResourceOperationTaskError);
            assert.equal(error.record.status, 'failed');
            assert.match(error.record.taskId, /^[0-9a-f-]+$/u);
            assert.match(error.message, /expected_failure/u);
            assert.equal(error.mcpFailure.code, 'expected_failure');
            assert.equal(error.mcpFailure.category, 'execution_failed');
            assert.equal(error.mcpFailure.state, 'unknown');
            assert.equal(error.mcpFailure.recommendedAction, 'stop');
            assert.equal(error.mcpFailure.taskId, error.record.taskId);
            assert.equal(error.mcpFailure.operation, 'asset.writeText');
            assert.equal(error.record.failure, error.mcpFailure);
            return true;
        },
    );
    const record = await queue.run(plan, async () => 'recovered');
    assert.equal(record.status, 'succeeded');
    assert.equal(record.result, 'recovered');
});

test('completed task history is bounded', async (): Promise<void> => {
    const queue = new ResourceOperationTaskQueue(1);
    const plan = createPlan('project-a', 'lumen.nodeSet', ['resource:a']);
    const first = await queue.run(plan, async () => 'first');
    const second = await queue.run(plan, async () => 'second');
    assert.equal(queue.get(first.taskId), null);
    assert.equal(queue.get(second.taskId)?.result, 'second');
});

test('planner expands asset writes to target, meta and parent directory closure', (): void => {
    const planner = new ResourceOperationPlanner();
    const writePlan = planner.plan('D:/projects/game', 'asset.writeText', { path: 'assets/ui/panel.ts' });
    assert.ok(writePlan.resourceKeys.includes('resource:db://assets/ui/panel.ts'));
    assert.ok(writePlan.resourceKeys.includes('resource:db://assets/ui/panel.ts.meta'));
    assert.ok(writePlan.resourceKeys.includes('directory:assets/ui'));
    assert.equal(writePlan.requiresProjectWriter, true);

    const movePlan = planner.plan('D:/projects/game', 'asset.move', {
        from: 'assets/ui/panel.ts',
        to: 'assets/scripts/panel.ts',
    });
    assert.ok(movePlan.resourceKeys.includes('resource:db://assets/ui/panel.ts'));
    assert.ok(movePlan.resourceKeys.includes('resource:db://assets/scripts/panel.ts'));
    assert.ok(movePlan.resourceKeys.includes('directory:assets/scripts'));
});

test('planner keeps offline lumen edits parallel-capable and autoCommit on writer lane', async (): Promise<void> => {
    const planner = new ResourceOperationPlanner();
    const firstOfflinePlan = planner.plan('D:/projects/game', 'lumen.nodeSet', { prefabRelativePath: 'assets/ui/a.prefab' });
    const secondOfflinePlan = planner.plan('D:/projects/game', 'lumen.nodeSet', { prefabRelativePath: 'assets/ui/b.prefab' });
    const commitPlan = planner.plan('D:/projects/game', 'lumen.nodeSet', {
        prefabRelativePath: 'assets/b.prefab',
        autoCommit: true,
    });
    assert.equal(firstOfflinePlan.requiresProjectWriter, false);
    assert.deepEqual(firstOfflinePlan.resourceKeys, ['resource:db://assets/ui/a.prefab']);
    assert.equal(commitPlan.requiresProjectWriter, true);

    const queue = new ResourceOperationTaskQueue();
    let inFlight = 0;
    let maxInFlight = 0;
    const worker = async (): Promise<void> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(20);
        inFlight -= 1;
    };
    await Promise.all([queue.run(firstOfflinePlan, worker), queue.run(secondOfflinePlan, worker)]);
    assert.equal(maxInFlight, 2);
});
