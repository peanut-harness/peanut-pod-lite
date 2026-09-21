import assert from 'node:assert/strict';

export interface IThroughputSoakValidationOptions {
    readonly requireAcceptanceDurations?: boolean;
}

/**
 * @description 校验 Creator 3.8 双版本吞吐 soak 报告的时长、正确性和脱敏边界。
 * @param report 待校验报告。
 * @param options 可选短时 harness 模式。
 */
export function assertThroughputSoakReport(
    report: Record<string, unknown>,
    options: IThroughputSoakValidationOptions = {},
): void {
    assert.equal(report.schema, 'peanut.creator38.throughput-soak.v1');
    const project = requireRecord(report.project, 'project');
    assert.ok(project.creatorVersion === '3.8.3' || project.creatorVersion === '3.8.7');
    assert.equal(report.artifactAgreement, true);
    const workload = requireRecord(report.workload, 'workload');
    const durations = requireRecord(workload.durations, 'workload.durations');
    const normalMs = requireNonNegativeNumber(durations.normalMs, 'normalMs');
    const overloadMs = requireNonNegativeNumber(durations.overloadMs, 'overloadMs');
    if (options.requireAcceptanceDurations !== false) {
        assert.ok(normalMs >= 30 * 60_000, 'throughput_soak_normal_duration_insufficient');
        assert.ok(overloadMs >= 10 * 60_000, 'throughput_soak_overload_duration_insufficient');
    }
    const counts = requireRecord(workload.counts, 'workload.counts');
    assert.ok(requireNonNegativeNumber(counts.readSucceeded, 'readSucceeded') > 0);
    assert.ok(requireNonNegativeNumber(counts.writeSucceeded, 'writeSucceeded') > 0);
    assert.ok(requireNonNegativeNumber(counts.batchSucceeded, 'batchSucceeded') > 0);
    assert.ok(requireNonNegativeNumber(counts.overloadRejected, 'overloadRejected') > 0);
    assert.ok(requireNonNegativeNumber(counts.retrySucceeded, 'retrySucceeded') > 0);
    const latency = requireRecord(workload.latencyMs, 'workload.latencyMs');
    assert.ok(requireNonNegativeNumber(latency.controlP95, 'controlP95') <= 1_000);
    const comparison = requireRecord(workload.comparison, 'workload.comparison');
    assert.ok(requireNonNegativeNumber(comparison.throughputRatio, 'throughputRatio') >= 2);
    assert.equal(requireNonNegativeNumber(comparison.resourceCount, 'resourceCount') >= 100, true);
    const cleanup = requireRecord(report.cleanup, 'cleanup');
    assert.deepEqual(cleanup.probeFiles, []);
    assert.deepEqual(cleanup.retainedTaskIds, []);
    const projectLog = requireRecord(report.projectLog, 'projectLog');
    assert.deepEqual(projectLog.unexpectedLines, []);
    const serialized = JSON.stringify(report);
    assert.equal(/approvalToken|x-peanut-mcp-token|"token"\s*:/iu.test(serialized), false);
}

function requireRecord(value: unknown, label: string): Record<string, any> {
    assert.equal(typeof value, 'object', `${label}:object_required`);
    assert.notEqual(value, null, `${label}:object_required`);
    assert.equal(Array.isArray(value), false, `${label}:object_required`);
    return value as Record<string, any>;
}

function requireNonNegativeNumber(value: unknown, label: string): number {
    assert.equal(typeof value, 'number', `${label}:number_required`);
    assert.ok(Number.isFinite(value) && value >= 0, `${label}:non_negative_required`);
    return value;
}
