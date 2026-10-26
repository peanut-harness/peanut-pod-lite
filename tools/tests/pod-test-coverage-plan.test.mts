import assert from 'node:assert/strict';
import test from 'node:test';

import { PodAcceptancePlan } from '../pod-test-coverage/acceptance-plan.mjs';
import { PodCoverageContracts } from '../pod-test-coverage/contracts.mjs';

const input = PodCoverageContracts.validateInput({ schemaVersion: 'pod-test-coverage-input.v1',
    candidate: { id: 'frozen-candidate', repositories: { 'peanut-pod-lite': { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } },
        environments: ['creator-3.8.3', 'creator-3.8.7'], inputDigests: {} },
    sources: [], capabilities: [], cases: [], workflows: [], results: [] });

test('minimum plan follows identity, ready, install, smoke, approved write, reopen, readback, cleanup', () => {
    for (const version of ['3.8.3', '3.8.7']) {
        const plan = PodAcceptancePlan.build(input, version, 'isolated-project', true);
        const steps = plan.steps as Readonly<Record<string, unknown>>[];
        assert.deepEqual(steps.map((step) => step.id), ['identity', 'host-ready', 'install', 'read-only-smoke',
            'approved-write', 'save-reopen', 'independent-readback', 'cleanup']);
        assert.equal(steps[4]?.status, 'planned');
        assert.equal(steps[5]?.blockReason, 'save_reopen_entry_undefined');
        assert.equal(steps[6]?.blockReason, 'dependency_blocked');
        assert.equal(steps[7]?.onFailure, 'inspect-and-clean');
        assert.match(String(plan.cleanupRule), /may_have_changed/u);
        assert.equal(plan.executionPerformed, false);
    }
});

test('missing project binding and write approval block dependent actions without auto authorization', () => {
    const plan = PodAcceptancePlan.build(input, '3.8.7');
    const steps = plan.steps as Readonly<Record<string, unknown>>[];
    assert.equal(steps[0]?.blockReason, 'isolated_project_not_bound');
    assert.equal(steps[4]?.status, 'blocked');
    assert.equal(steps[7]?.status, 'blocked');
    assert.throws(() => PodAcceptancePlan.build(input, '3.8.6'), /creator_version_invalid/u);
});
