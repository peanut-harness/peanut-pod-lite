import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { assertThroughputSoakReport } from '../scripts/throughput-soak-evidence.mts';

function report() {
    return {
        schema: 'peanut.creator38.throughput-soak.v1',
        project: { creatorVersion: '3.8.7' },
        artifactAgreement: true,
        workload: {
            durations: { normalMs: 1, overloadMs: 1 },
            counts: {
                readSucceeded: 10,
                writeSucceeded: 100,
                batchSucceeded: 4,
                overloadRejected: 5,
                retrySucceeded: 2,
            },
            latencyMs: { controlP95: 250 },
            comparison: { resourceCount: 100, throughputRatio: 2.5 },
        },
        cleanup: { probeFiles: [], retainedTaskIds: [] },
        projectLog: { unexpectedLines: [] },
    };
}

test('throughput soak evidence enforces correctness and excludes secrets', () => {
    assert.doesNotThrow(() => assertThroughputSoakReport(report(), { requireAcceptanceDurations: false }));
    assert.throws(
        () => assertThroughputSoakReport({ ...report(), token: 'must-not-leak' }, { requireAcceptanceDurations: false }),
        /false/u,
    );
    assert.throws(
        () => assertThroughputSoakReport({
            ...report(),
            workload: {
                ...report().workload,
                latencyMs: { controlP95: 1_001 },
            },
        }, { requireAcceptanceDurations: false }),
        /controlP95/u,
    );
});

test('throughput soak live runner completes against a bounded mock Bridge', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-throughput-soak-'));
    const outputPath = join(projectPath, 'throughput-report.json');
    const artifacts = {
        host: { digest: 'a'.repeat(64) },
        core: { digest: 'b'.repeat(64) },
    };
    mkdirSync(join(projectPath, '.peanut-ai'), { recursive: true });
    mkdirSync(join(projectPath, 'peanut-plugins/runtime'), { recursive: true });
    mkdirSync(join(projectPath, 'temp/logs'), { recursive: true });
    writeFileSync(join(projectPath, 'peanut-plugins/runtime/host-status.json'), JSON.stringify({
        ready: true,
        creatorContext: {
            version: { raw: '3.8.7' },
            projectVersion: { raw: '3.8.7' },
            writesAllowed: true,
        },
        artifacts,
    }));
    writeFileSync(join(projectPath, 'peanut-plugins/runtime/smoke-results.json'), JSON.stringify({ artifacts }));
    writeFileSync(join(projectPath, 'temp/logs/project.log'), '');

    let taskSequence = 0;
    let readSequence = 0;
    const queriedTasks = new Set<string>();
    const batchSizes = new Map<string, number>();
    const server = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) {
            chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const result = dispatch(body);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result));
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');
    writeFileSync(join(projectPath, '.peanut-ai/cocos-mcp.json'), JSON.stringify({
        port: (address as { port: number }).port,
        token: 'mock-token',
    }));

    try {
        const scriptPath = resolve(import.meta.dirname, '../scripts/verify-throughput-soak-live.mts');
        const result = await run(process.execPath, [
            scriptPath,
            '--project', projectPath,
            '--output', outputPath,
            '--normal-ms', '1',
            '--overload-ms', '1',
            '--cooldown-ms', '0',
            '--allow-short',
        ]);
        assert.equal(result.code, 0, result.stderr);
        const evidence = JSON.parse(readFileSync(outputPath, 'utf8'));
        assertThroughputSoakReport(evidence, { requireAcceptanceDurations: false });
        assert.equal(evidence.workload.comparison.resourceCount, 100);
        assert.equal(evidence.cleanup.retainedTaskIds.length, 0);
    } finally {
        await new Promise<void>((resolveClose, rejectClose) => server.close((error) => {
            if (error == null) {
                resolveClose();
            } else {
                rejectClose(error);
            }
        }));
        rmSync(projectPath, { recursive: true, force: true });
    }

    function dispatch(body: Record<string, any>): Record<string, unknown> {
        if (body.action === 'call' && body.name === 'peanut.editor-mcp.editor-query-version') {
            readSequence += 1;
            if (readSequence > 16 && readSequence % 2 === 0) {
                return {
                    ok: false,
                    error: 'throughput_overloaded',
                    failure: { category: 'overloaded', retryAfterMs: 25 },
                };
            }
            return { ok: true, result: { version: '3.8.7' } };
        }
        if (body.action === 'call') {
            taskSequence += 1;
            return { ok: true, result: { taskId: `single:${taskSequence}` } };
        }
        if (body.action === 'task.status') {
            if (String(body.taskId).startsWith('batch:task:') || queriedTasks.has(body.taskId)) {
                return { ok: false, error: 'cocos_mcp_task_unavailable' };
            }
            queriedTasks.add(body.taskId);
            return { ok: true, result: { taskId: body.taskId, status: 'succeeded' } };
        }
        if (body.action === 'batch.submit') {
            const batchId = `batch:${batchSizes.size + 1}`;
            batchSizes.set(batchId, body.batch.items.length);
            return {
                ok: true,
                result: {
                    batchId,
                    items: body.batch.items.map((item: { itemId: string }, index: number) => ({
                        itemId: item.itemId,
                        taskId: `batch:task:${batchSizes.size}:${index}`,
                    })),
                },
            };
        }
        if (body.action === 'batch.status') {
            const total = batchSizes.get(body.batchId) ?? 0;
            return {
                ok: true,
                result: {
                    batchId: body.batchId,
                    stage: 'terminal',
                    status: 'succeeded',
                    completed: total,
                    projectState: 'may_have_changed',
                },
            };
        }
        if (body.action === 'issueApprovalToken') {
            return { ok: true, result: { approvalToken: 'approval' } };
        }
        if (body.action === 'health') {
            return { ok: true, result: { sessionId: 'mock', revision: 1 } };
        }
        return { ok: true, result: {} };
    }
});

async function run(command: string, args: string[]): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolveRun, rejectRun) => {
        const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', rejectRun);
        child.on('close', (code) => resolveRun({ code, stderr }));
    });
}
