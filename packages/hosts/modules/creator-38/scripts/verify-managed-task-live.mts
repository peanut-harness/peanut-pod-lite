import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const projectPath = resolve(readArgument('--project'));
const outputPath = resolve(readArgument('--output'));
const descriptor = readJson(join(projectPath, '.peanut-ai', 'cocos-mcp.json'));
const hostStatus = readJson(join(projectPath, 'peanut-plugins', 'runtime', 'host-status.json'));
const smokeResults = readJson(join(projectPath, 'peanut-plugins', 'runtime', 'smoke-results.json'));
const logPath = join(projectPath, 'temp', 'logs', 'project.log');
const startedAt = new Date().toISOString();
const logOffset = existsSync(logPath) ? Buffer.byteLength(readFileSync(logPath)) : 0;
const owner = randomBytes(16).toString('hex');
const other = randomBytes(16).toString('hex');
const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const root = `assets/_peanut-managed-task-live/${runId}`;
let stage = 'startup';

assert.equal(hostStatus.ready, true);
assert.equal(hostStatus.creatorContext.version.raw, hostStatus.creatorContext.projectVersion.raw);
assert.equal(hostStatus.creatorContext.writesAllowed, true);
assert.deepEqual(hostStatus.artifacts, smokeResults.artifacts);

await request({ action: 'setPluginExposure', pluginId: 'peanut.editor-mcp', mode: 'all' });
const health = await request({ action: 'health' });
const catalog = await request({ action: 'catalog' });

markStage('cancellation');
const cancelShared = `${root}/cancel-shared.json`;
const cancelTarget = `${root}/cancel-target.json`;
const blockers = [];
for (let index = 0; index < 5; index += 1) {
    blockers.push(await approvedWrite(owner, [cancelShared], {
        path: cancelShared,
        content: JSON.stringify({ runId, index, padding: 'x'.repeat(32 * 1024) }),
        execution: { mode: 'async' },
    }));
}
const cancellable = await approvedWrite(owner, [cancelShared, cancelTarget], {
    files: [
        { path: cancelShared, content: JSON.stringify({ runId, source: 'cancelled' }) },
        { path: cancelTarget, content: JSON.stringify({ runId, shouldNotExist: true }) },
    ],
    execution: { mode: 'async' },
});
const nonOwnerCancel = await requestFailure({ action: 'task.cancel', taskId: cancellable.taskId, connectionId: other });
const ownerCancel = await request({ action: 'task.cancel', taskId: cancellable.taskId, connectionId: owner });
const cancelledStatus = await waitForTerminal(cancellable.taskId, owner);
const blockerStatuses = await Promise.all(blockers.map((blocker) => waitForTerminal(blocker.taskId, owner)));
assert.equal(nonOwnerCancel.error, 'cocos_mcp_task_unavailable');
assert.equal(ownerCancel.cancelled, true);
assert.equal(cancelledStatus.status, 'cancelled');
assert.ok(blockerStatuses.every((status) => status.status === 'succeeded'));
assert.equal(existsSync(join(projectPath, cancelTarget)), false);

markStage('fifo');
const fifoPath = `${root}/fifo.json`;
const fifoFirst = await approvedWrite(owner, [fifoPath], {
    path: fifoPath,
    content: JSON.stringify({ runId, order: 'first', padding: 'a'.repeat(8 * 1024) }),
    execution: { mode: 'async' },
});
const fifoSecond = await approvedWrite(owner, [fifoPath], {
    path: fifoPath,
    content: JSON.stringify({ runId, order: 'second' }),
    execution: { mode: 'async' },
});
const [fifoFirstStatus, fifoSecondStatus] = await Promise.all([
    waitForTerminal(fifoFirst.taskId, owner),
    waitForTerminal(fifoSecond.taskId, owner),
]);
assert.equal(fifoFirstStatus.status, 'succeeded');
assert.equal(fifoSecondStatus.status, 'succeeded');
assert.equal(JSON.parse(readFileSync(join(projectPath, fifoPath), 'utf8')).order, 'second');
assert.ok(Date.parse(fifoFirstStatus.updatedAt) <= Date.parse(fifoSecondStatus.updatedAt));

markStage('parallel');
const parallelPaths = [`${root}/parallel-a.json`, `${root}/parallel-b.json`];
const parallelStartedAt = Date.now();
const [parallelA, parallelB] = await Promise.all(parallelPaths.map((path, index) => approvedWrite(owner, [path], {
    path,
    content: JSON.stringify({ runId, index, padding: 'p'.repeat(8 * 1024) }),
    execution: { mode: 'async' },
})));
const [parallelAStatus, parallelBStatus] = await Promise.all([
    waitForTerminal(parallelA.taskId, owner),
    waitForTerminal(parallelB.taskId, owner),
]);
const parallelElapsedMs = Date.now() - parallelStartedAt;
assert.equal(parallelAStatus.status, 'succeeded');
assert.equal(parallelBStatus.status, 'succeeded');

markStage('evidence');
const successfulTaskIds = [...blockers.map((blocker) => blocker.taskId), fifoFirst.taskId, fifoSecond.taskId, parallelA.taskId, parallelB.taskId];
const evidence = Object.fromEntries(await Promise.all(successfulTaskIds.map(async (taskId) => [
    taskId,
    await request({ action: 'task.evidence', taskId, connectionId: owner }),
])));
for (const taskEvidence of Object.values(evidence)) {
    assert.equal(taskEvidence.entries.filter((entry) => entry.kind === 'postflight').length, 1);
}

const logDelta = existsSync(logPath) ? readFileSync(logPath).subarray(logOffset).toString('utf8') : '';
const unexpectedLogLines = logDelta.split(/\r?\n/u).filter((line) => /\s-\s(?:error|warn):/iu.test(line));
assert.deepEqual(unexpectedLogLines, []);
const probeFiles = findProbeReferences(root);
assert.deepEqual(probeFiles, []);

const report = {
    schema: 'peanut.creator38.managed-task-live.v1',
    startedAt,
    finishedAt: new Date().toISOString(),
    project: { name: projectPath.split('/').at(-1), creatorVersion: hostStatus.creatorContext.version.raw },
    artifacts: hostStatus.artifacts,
    artifactAgreement: true,
    hub: { sessionId: health.sessionId, revision: health.revision, catalogRevision: catalog.revision },
    checks: {
        cancellation: { blockers: blockerStatuses, cancelled: cancelledStatus, nonOwnerError: nonOwnerCancel.error, ownerCancel, targetAbsent: true },
        fifo: { first: fifoFirstStatus, second: fifoSecondStatus, finalOrder: 'second' },
        parallel: { first: parallelAStatus, second: parallelBStatus, elapsedMs: parallelElapsedMs },
        postflight: { taskCount: successfulTaskIds.length, exactlyOnce: true },
        cleanup: { probeFiles, cancelledTargetAbsent: true },
        projectLog: { startOffset: logOffset, deltaBytes: Buffer.byteLength(logDelta), unexpectedLines: unexpectedLogLines },
    },
    evidence,
    reportDigest: createHash('sha256').update(JSON.stringify({ runId, artifacts: hostStatus.artifacts, successfulTaskIds })).digest('hex'),
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, creatorVersion: report.project.creatorVersion, checks: report.checks, reportDigest: report.reportDigest }));

async function approvedWrite(connectionId, resources, input) {
    const issued = await request({
        action: 'issueApprovalToken',
        connectionId,
        resources,
        operations: ['peanut.editor-mcp.asset-write-text'],
        maxRisk: 'write',
    });
    return request({
        action: 'call',
        name: 'peanut.editor-mcp.asset-write-text',
        connectionId,
        input: { ...input, resources, approvalToken: issued.approvalToken },
    });
}

async function waitForTerminal(taskId, connectionId) {
    for (let attempt = 0; attempt < 240; attempt += 1) {
        const status = await request({ action: 'task.status', taskId, connectionId });
        if (['succeeded', 'failed', 'cancelled'].includes(status.status)) return status;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    throw new Error(`managed_task_terminal_timeout:${taskId}`);
}

async function request(body) {
    let response;
    try {
        response = await fetch(`http://127.0.0.1:${descriptor.port}/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(45_000),
        });
    } catch (error) {
        throw new Error(`live_request_failed:${stage}:${String(body.action)}:${error instanceof Error ? error.message : String(error)}`);
    }
    const payload = await response.json();
    if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `hub_http_${response.status}`);
    return payload.result;
}

async function requestFailure(body) {
    try {
        await request(body);
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
    throw new Error('expected_hub_failure');
}

function findProbeReferences(relativeRoot) {
    const absoluteRoot = join(projectPath, relativeRoot);
    if (!existsSync(absoluteRoot)) return [];
    const stack = [absoluteRoot];
    const found = [];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of requireDirectory(current)) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) stack.push(path);
            else if (entry.name.includes('peanut-assetdb-registration-probe')) found.push(path.slice(projectPath.length + 1));
        }
    }
    return found.sort();
}

function requireDirectory(path) {
    return readdirSync(path, { withFileTypes: true });
}

function readArgument(name) {
    const index = process.argv.indexOf(name);
    if (index < 0 || process.argv[index + 1] == null) throw new Error(`missing_argument:${name}`);
    return process.argv[index + 1];
}

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function markStage(value) {
    stage = value;
    console.error(`managed-task-live:${value}`);
}
