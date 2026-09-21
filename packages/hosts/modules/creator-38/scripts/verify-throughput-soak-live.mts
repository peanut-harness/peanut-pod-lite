import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { assertThroughputSoakReport } from './throughput-soak-evidence.mts';

const ACCEPTANCE_NORMAL_MS = 30 * 60_000;
const ACCEPTANCE_OVERLOAD_MS = 10 * 60_000;
const DEFAULT_COOLDOWN_MS = 5 * 60_000 + 35_000;
const PHASE_CYCLE_TARGET_MS = 1_000;
const MAX_LATENCY_SAMPLES = 4_096;
const MAX_HEALTH_SAMPLES = 256;
const MAX_TRACKED_TASK_IDS = 1_024;
const READ_OPERATION = 'peanut.editor-mcp.editor-query-version';
const WRITE_OPERATION = 'peanut.editor-mcp.asset-write-text';

const projectPath = resolve(readArgument('--project'));
const outputPath = resolve(readArgument('--output'));
const normalMs = readDuration('--normal-ms', ACCEPTANCE_NORMAL_MS);
const overloadMs = readDuration('--overload-ms', ACCEPTANCE_OVERLOAD_MS);
const cooldownMs = readDuration('--cooldown-ms', DEFAULT_COOLDOWN_MS);
const allowShort = process.argv.includes('--allow-short');
if (!allowShort && (normalMs < ACCEPTANCE_NORMAL_MS || overloadMs < ACCEPTANCE_OVERLOAD_MS)) {
    throw new Error('throughput_soak_acceptance_duration_required');
}

const descriptor = readJson(join(projectPath, '.peanut-ai', 'cocos-mcp.json'));
const hostStatus = readJson(join(projectPath, 'peanut-plugins', 'runtime', 'host-status.json'));
const smokeResults = readJson(join(projectPath, 'peanut-plugins', 'runtime', 'smoke-results.json'));
const logPath = join(projectPath, 'temp', 'logs', 'project.log');
const logOffset = existsSync(logPath) ? Buffer.byteLength(readFileSync(logPath)) : 0;
const startedAt = new Date().toISOString();
const owner = randomBytes(16).toString('hex');
const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const root = `assets/_peanut-throughput-soak/${runId}`;
const taskIds = new Set<string>();
const latencies = { read: [] as number[], write: [] as number[], control: [] as number[], batch: [] as number[] };
const counts = {
    readSucceeded: 0,
    writeSucceeded: 0,
    batchSucceeded: 0,
    overloadRejected: 0,
    retrySucceeded: 0,
    failed: 0,
};
const healthSamples: unknown[] = [];

assert.equal(hostStatus.ready, true);
assert.equal(hostStatus.creatorContext.version.raw, hostStatus.creatorContext.projectVersion.raw);
assert.equal(hostStatus.creatorContext.writesAllowed, true);
assert.deepEqual(hostStatus.artifacts, smokeResults.artifacts);
assert.ok(hostStatus.creatorContext.version.raw === '3.8.3' || hostStatus.creatorContext.version.raw === '3.8.7');
await request({ action: 'setPluginExposure', pluginId: 'peanut.editor-mcp', mode: 'all' });

const comparison = await compareSequentialAndBatch(100);
await runNormalPhase(normalMs);
await runOverloadPhase(overloadMs);
await delay(cooldownMs);

const retainedTaskIds = [];
for (const taskId of taskIds) {
    const payload = await rawRequest({ action: 'task.status', taskId, connectionId: owner });
    if (payload.ok === true) {
        retainedTaskIds.push(taskId);
    }
}
const logDelta = existsSync(logPath) ? readFileSync(logPath).subarray(logOffset).toString('utf8') : '';
const unexpectedLines = logDelta.split(/\r?\n/u).filter((line) => /\s-\s(?:error|warn):/iu.test(line));
const probeFiles = findProbeReferences(root);
const finishedAt = new Date().toISOString();
const report = {
    schema: 'peanut.creator38.throughput-soak.v1',
    startedAt,
    finishedAt,
    project: {
        name: projectPath.split('/').at(-1),
        creatorVersion: hostStatus.creatorContext.version.raw,
    },
    artifacts: hostStatus.artifacts,
    artifactAgreement: true,
    workload: {
        durations: { normalMs, overloadMs, cooldownMs },
        counts,
        latencyMs: {
            readP95: percentile(latencies.read, 0.95),
            writeP95: percentile(latencies.write, 0.95),
            controlP95: percentile(latencies.control, 0.95),
            batchP95: percentile(latencies.batch, 0.95),
        },
        comparison,
        healthSamples,
    },
    cleanup: { probeFiles, retainedTaskIds },
    projectLog: {
        startOffset: logOffset,
        deltaBytes: Buffer.byteLength(logDelta),
        unexpectedLines,
    },
    reportDigest: createHash('sha256').update(JSON.stringify({
        runId,
        artifacts: hostStatus.artifacts,
        counts,
        comparison,
        probeFiles,
        retainedTaskIds,
    })).digest('hex'),
};
assertThroughputSoakReport(report, { requireAcceptanceDurations: !allowShort });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
    outputPath,
    creatorVersion: report.project.creatorVersion,
    counts,
    comparison,
    controlP95Ms: report.workload.latencyMs.controlP95,
    reportDigest: report.reportDigest,
}));

async function compareSequentialAndBatch(resourceCount: number) {
    const resources = Array.from({ length: resourceCount }, (_, index) => `${root}/comparison-${index}.json`);
    const sequentialStartedAt = performance.now();
    for (const [index, path] of resources.entries()) {
        const receipt = await approvedWrite(path, { phase: 'sequential', index });
        await waitForTask(receipt.taskId);
    }
    const sequentialMs = performance.now() - sequentialStartedAt;
    const batchStartedAt = performance.now();
    for (let start = 0; start < resources.length; start += 25) {
        await submitBatch(resources.slice(start, start + 25), `comparison-${start / 25}`);
    }
    const batchedMs = performance.now() - batchStartedAt;
    return {
        resourceCount,
        sequentialMs: round(sequentialMs),
        batchedMs: round(batchedMs),
        throughputRatio: round(sequentialMs / batchedMs),
    };
}

async function runNormalPhase(durationMs: number) {
    const deadline = Date.now() + durationMs;
    let cycle = 0;
    while (Date.now() < deadline) {
        const cycleStartedAt = Date.now();
        await Promise.all(Array.from({ length: 16 }, () => measured('read', () => callRead())));
        const paths = Array.from({ length: 8 }, (_, index) => `${root}/normal-${index}.json`);
        await submitBatch(paths, `normal-${cycle}`);
        recordBounded(healthSamples, await request({ action: 'health' }), MAX_HEALTH_SAMPLES);
        cycle += 1;
        await delay(Math.max(0, PHASE_CYCLE_TARGET_MS - (Date.now() - cycleStartedAt)));
    }
}

async function runOverloadPhase(durationMs: number) {
    const deadline = Date.now() + durationMs;
    let cycle = 0;
    while (Date.now() < deadline) {
        const cycleStartedAt = Date.now();
        const burst = await Promise.all(Array.from({ length: 96 }, () => rawRequest({
            action: 'call',
            name: READ_OPERATION,
            connectionId: owner,
            input: {},
        })));
        const overloads = burst.filter((payload) => payload.failure?.category === 'overloaded');
        counts.readSucceeded += burst.filter((payload) => payload.ok === true).length;
        counts.overloadRejected += overloads.length;
        counts.failed += burst.length - overloads.length - burst.filter((payload) => payload.ok === true).length;
        for (const overload of overloads.slice(0, 8)) {
            const retryAfterMs = Number(overload.failure?.retryAfterMs ?? 25);
            await delay(Math.max(25, Math.min(retryAfterMs, 5_000)) + Math.floor(Math.random() * 25));
            const retry = await rawRequest({ action: 'call', name: READ_OPERATION, connectionId: owner, input: {} });
            if (retry.ok === true) {
                counts.retrySucceeded += 1;
            }
        }
        const paths = Array.from({ length: 32 }, (_, index) => `${root}/overload-${index}.json`);
        try {
            await submitBatch(paths, `overload-${cycle}`);
        } catch (error) {
            if (error instanceof Error && error.message === 'throughput_overloaded') {
                counts.overloadRejected += 1;
            } else {
                throw error;
            }
        }
        cycle += 1;
        await delay(Math.max(0, PHASE_CYCLE_TARGET_MS - (Date.now() - cycleStartedAt)));
    }
}

async function callRead() {
    await request({ action: 'call', name: READ_OPERATION, connectionId: owner, input: {} });
    counts.readSucceeded += 1;
}

async function approvedWrite(path: string, value: Record<string, unknown>) {
    const issued = await request({
        action: 'issueApprovalToken',
        connectionId: owner,
        resources: [path],
        operations: [WRITE_OPERATION],
        maxRisk: 'write',
    });
    const receipt = await measured('write', () => request({
        action: 'call',
        name: WRITE_OPERATION,
        connectionId: owner,
        input: {
            path,
            content: JSON.stringify({ runId, ...value }),
            resources: [path],
            approvalToken: issued.approvalToken,
            execution: { mode: 'async' },
        },
    }));
    rememberTaskId(receipt.taskId);
    return receipt;
}

async function submitBatch(resources: string[], requestId: string) {
    const issued = await request({
        action: 'issueApprovalToken',
        connectionId: owner,
        resources,
        operations: [WRITE_OPERATION],
        maxRisk: 'write',
    });
    const receipt = await measured('batch', () => request({
        action: 'batch.submit',
        connectionId: owner,
        batch: {
            requestId: `${runId}:${requestId}`,
            items: resources.map((path, index) => ({
                itemId: `item-${index}`,
                operation: WRITE_OPERATION,
                input: {
                    path,
                    content: JSON.stringify({ runId, requestId, index }),
                    resources: [path],
                    approvalToken: issued.approvalToken,
                },
            })),
        },
    }));
    receipt.items.forEach((item: { taskId: string }) => rememberTaskId(item.taskId));
    while (true) {
        const status = await measured('control', () => request({
            action: 'batch.status',
            connectionId: owner,
            batchId: receipt.batchId,
        }));
        if (status.stage === 'terminal') {
            if (status.status !== 'succeeded') {
                throw new Error(`throughput_soak_batch_failed:${status.projectState}`);
            }
            counts.batchSucceeded += 1;
            counts.writeSucceeded += status.completed;
            return status;
        }
        await delay(25);
    }
}

async function waitForTask(taskId: string) {
    while (true) {
        const status = await measured('control', () => request({
            action: 'task.status',
            taskId,
            connectionId: owner,
        }));
        if (['succeeded', 'failed', 'cancelled'].includes(status.status)) {
            if (status.status !== 'succeeded') {
                throw new Error(`throughput_soak_task_failed:${JSON.stringify(status)}`);
            }
            counts.writeSucceeded += 1;
            return status;
        }
        await delay(25);
    }
}

async function measured<T>(kind: keyof typeof latencies, action: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
        return await action();
    } finally {
        recordBounded(latencies[kind], performance.now() - started, MAX_LATENCY_SAMPLES);
    }
}

async function request(body: Record<string, unknown>): Promise<any> {
    const payload = await rawRequest(body);
    if (payload.ok !== true) {
        throw new Error(payload.error ?? 'throughput_soak_request_failed');
    }
    return payload.result;
}

async function rawRequest(body: Record<string, unknown>): Promise<any> {
    const response = await fetch(`http://127.0.0.1:${descriptor.port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
    });
    return response.json();
}

function findProbeReferences(relativeRoot: string): string[] {
    const absoluteRoot = join(projectPath, relativeRoot);
    if (!existsSync(absoluteRoot)) {
        return [];
    }
    const stack = [absoluteRoot];
    const found: string[] = [];
    while (stack.length > 0) {
        const current = stack.pop();
        if (current == null) {
            continue;
        }
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(path);
            } else if (entry.name.includes('peanut-assetdb-registration-probe') || entry.name.includes('__peanut_assetdb_register_')) {
                found.push(path.slice(projectPath.length + 1));
            }
        }
    }
    return found.sort();
}

function percentile(values: readonly number[], quantile: number): number {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0);
}

function rememberTaskId(taskId: string): void {
    while (taskIds.size >= MAX_TRACKED_TASK_IDS) {
        const oldest = taskIds.values().next().value;
        if (oldest == null) {
            break;
        }
        taskIds.delete(oldest);
    }
    taskIds.add(taskId);
}

function recordBounded<T>(values: T[], value: T, limit: number): void {
    if (values.length >= limit) {
        values.shift();
    }
    values.push(value);
}

function round(value: number): number {
    return Number(value.toFixed(3));
}

function delay(durationMs: number): Promise<void> {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

function readArgument(name: string): string {
    const index = process.argv.indexOf(name);
    if (index < 0 || process.argv[index + 1] == null) {
        throw new Error(`missing_argument:${name}`);
    }
    return process.argv[index + 1] as string;
}

function readDuration(name: string, fallback: number): number {
    const index = process.argv.indexOf(name);
    if (index < 0) {
        return fallback;
    }
    const value = Number(process.argv[index + 1]);
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`invalid_duration:${name}`);
    }
    return value;
}

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, 'utf8'));
}
