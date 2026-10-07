import assert from 'node:assert/strict';
import test from 'node:test';
import type { ITaskRequest } from '@peanut/pod-protocol';
import { ResourceOperationPlanner } from '../src/resource-operation-planner.js';
import { ResourceOperationTaskExecutor } from '../src/resource-operation-task-executor.js';

for (const extension of ['mtl', 'anim', 'pmtl', 'rt']) {
    test(`typed native creation commit window: ${extension}`, async () => {
        const planner = new ResourceOperationPlanner();
        const input = { assetRelativePath: `assets/new/Native.${extension}`, autoCommit: true };
        const plan = planner.plan('/project', 'lumen.scaffold', input);
        assert.equal(plan.workerManagedCommitWindow, true);
        assert.ok(plan.resourceKeys.includes(`resource:db://assets/new/Native.${extension}.meta`));
        assert.ok(plan.resourceKeys.includes('resource:db://assets/new.meta'));
        let enterCalls = 0;
        const executor = new ResourceOperationTaskExecutor({ plan: async () => plan, execute: async (_operation, _input, context) => {
            assert.equal(enterCalls, 0, 'native initial-ready and parent preparation remain cancellable');
            assert.equal(context.enterCommitWindow(), true);
            return { published: true };
        } });
        const request: ITaskRequest = { requestId: extension, pluginId: 'peanut.editor-mcp', scope: 'project', priority: 'normal', kind: ResourceOperationTaskExecutor.KIND, payload: { operation: 'lumen.scaffold', input }, mergePolicy: 'none' };
        const result = await executor.execute(request, {
            owner: { pluginId: 'peanut.editor-mcp', connectionId: 'a'.repeat(32), projectKey: '/project', capability: 'peanut.editor-mcp.lumen-scaffold' },
            signal: new AbortController().signal,
            enterCommitWindow: () => { enterCalls += 1; return true; },
            recordEvidence: () => {},
        });
        assert.deepEqual(result, { published: true });
        assert.equal(enterCalls, 1);
    });
}

test('typed native creation commit window: reset and unrelated kinds keep existing boundary', () => {
    const planner = new ResourceOperationPlanner();
    for (const extension of ['mtl', 'anim', 'pmtl', 'rt']) {
        assert.equal(planner.plan('/project', 'lumen.scaffold', { assetRelativePath: `assets/a.${extension}`, reset: true }).workerManagedCommitWindow, undefined);
    }
    assert.equal(planner.plan('/project', 'lumen.scaffold', { assetRelativePath: 'assets/a.json' }).workerManagedCommitWindow, undefined);
});
