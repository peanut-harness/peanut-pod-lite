import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type {
    ILifecycleLogRunEvidence,
    ILifecycleRawLogSegment,
    LifecycleLogChannel,
    LifecycleLogStageName,
} from '../editor-stability/lifecycle-raw-log-validator.mjs';
import { LifecycleRawLogValidator } from '../editor-stability/lifecycle-raw-log-validator.mjs';

interface IInjectedDiagnostic {
    /**
     * @description 诊断应归属的阶段。
     */
    readonly stage: LifecycleLogStageName;
    /**
     * @description 合成诊断写入的原始通道。
     */
    readonly channel: LifecycleLogChannel;
    /**
     * @description 注入到内存字节流中的文本。
     */
    readonly contents: string;
}

interface IStageWindow {
    /**
     * @description 阶段开始时间。
     */
    readonly startedAt: string;
    /**
     * @description 阶段结束时间。
     */
    readonly endedAt: string;
}

const lifecycleChannels: readonly LifecycleLogChannel[] = ['stdout', 'stderr', 'project.log'];
const lifecycleStages: readonly LifecycleLogStageName[] = [
    'startup', 'operation', 'cooldown', 'exit', 'delayed_diagnostics',
];

class LifecycleLogEvidenceFactory {
    /**
     * @description 每个阶段必须记录的三个原始输出通道。
     */
    private static readonly channels: readonly LifecycleLogChannel[] = ['stdout', 'stderr', 'project.log'];
    /**
     * @description 按设计验收顺序生成的阶段。
     */
    private static readonly stageNames: readonly LifecycleLogStageName[] = [
        'startup', 'operation', 'cooldown', 'exit', 'delayed_diagnostics',
    ];
    /**
     * @description 确定性合成测试使用的非重叠阶段窗口。
     */
    private static readonly stageWindows: Readonly<Record<LifecycleLogStageName, IStageWindow>> = {
        startup: { startedAt: '2026-10-13T10:00:00.000Z', endedAt: '2026-10-13T10:01:00.000Z' },
        operation: { startedAt: '2026-10-13T10:01:00.000Z', endedAt: '2026-10-13T10:02:00.000Z' },
        cooldown: { startedAt: '2026-10-13T10:02:00.000Z', endedAt: '2026-10-13T10:03:00.000Z' },
        exit: { startedAt: '2026-10-13T10:03:00.000Z', endedAt: '2026-10-13T10:04:00.000Z' },
        delayed_diagnostics: { startedAt: '2026-10-13T10:04:00.000Z', endedAt: '2026-10-13T10:05:00.000Z' },
    };

    /**
     * @description 生成带连续字节偏移和完整摘要的内存验收证据。
     * @param injections 要注入到指定阶段和通道的合成文本。
     * @param projectName 隔离 Creator 工程名。
     * @returns 不含真实项目、宿主或历史日志内容的生命周期证据。
     */
    public static create(
        injections: readonly IInjectedDiagnostic[] = [],
        projectName = 'peanut-lite-lifecycle-387',
    ): ILifecycleLogRunEvidence {
        const offsets: Record<LifecycleLogChannel, number> = { stdout: 0, stderr: 0, 'project.log': 0 };
        const stages = this.stageNames.map((stageName) => {
            const window = this.stageWindows[stageName];
            const logs = this.channels.map((channel) => {
                const contents = injections.filter((entry) => entry.stage === stageName && entry.channel === channel)
                    .map((entry) => entry.contents).join('');
                const bytes = Buffer.from(contents, 'utf8');
                const offsetStart = offsets[channel];
                const offsetEnd = offsetStart + bytes.byteLength;
                offsets[channel] = offsetEnd;
                const reference = channel === 'project.log' ? 'raw/project.log' : `raw/${channel}.log`;
                return {
                    channel,
                    reference,
                    offsetStart,
                    offsetEnd,
                    capturedAt: window.endedAt,
                    byteLength: bytes.byteLength,
                    sha256: this.sha256(bytes),
                    bytes,
                };
            });
            return { name: stageName, startedAt: window.startedAt, endedAt: window.endedAt, logs };
        });

        return {
            runId: 'lifecycle-synthetic-run-01',
            projectName,
            hostSha256: 'a'.repeat(64),
            coreSha256: 'b'.repeat(64),
            stages,
        };
    }

    /**
     * @description 计算测试证据的原始 SHA-256。
     * @param bytes 原始日志字节。
     * @returns 小写十六进制 SHA-256。
     */
    private static sha256(bytes: Uint8Array): string {
        return createHash('sha256').update(bytes).digest('hex');
    }
}

const fixturePackage = readFileSync(new URL('../../tests/fixtures/editor-stability/lifecycle/peanut-lite-lifecycle-387/package.json', import.meta.url), 'utf8');

test('named isolated Creator fixture uses a valid project name and exact 3.8.7 profile', () => {
    const fixture: unknown = JSON.parse(fixturePackage);
    assert.deepEqual(fixture, {
        name: 'peanut-lite-lifecycle-387',
        uuid: '4ce1e72b-64b2-4c55-b2c2-34a3a8812fa3',
        creator: { version: '3.8.7' },
    });
});

test('all five lifecycle stages and three raw log sources pass when their original bytes are clean', () => {
    const result = LifecycleRawLogValidator.validate(LifecycleLogEvidenceFactory.create());
    assert.equal(result.ok, true);
    assert.deepEqual(result.stages.map((stage) => stage.name), [
        'startup', 'operation', 'cooldown', 'exit', 'delayed_diagnostics',
    ]);
    assert.ok(result.stages.every((stage) => stage.ok));
    assert.equal(result.sources.length, 3);
    assert.equal(result.sources.find((source) => source.channel === 'stdout')?.byteLength, 0);
    assert.equal(result.sources.find((source) => source.channel === 'stderr')?.byteLength, 0);
    assert.equal(result.sources.find((source) => source.channel === 'project.log')?.byteLength, 0);
});

for (const [index, stageName] of lifecycleStages.entries()) {
    for (const severity of ['warning', 'error'] as const) {
        test(`${stageName} ${severity} injection fails its own phase`, () => {
            const channel = lifecycleChannels[index % lifecycleChannels.length];
            assert.ok(channel);
            const token = severity === 'warning' ? '[WARN] synthetic warning' : '[ERROR] synthetic error';
            const run = LifecycleLogEvidenceFactory.create([{ stage: stageName, channel, contents: `${token}\n` }]);
            const result = LifecycleRawLogValidator.validate(run);
            assert.equal(result.ok, false);
            assert.equal(result.issues.some((issue) => issue.startsWith(`raw_${severity}:${stageName}:${channel}:`)), true);
            const target = result.stages.find((stage) => stage.name === stageName);
            assert.ok(target);
            assert.equal(target.ok, false);
            assert.deepEqual(result.stages.filter((stage) => stage.name !== stageName).map((stage) => stage.ok), [true, true, true, true]);
        });
    }
}

for (const channel of ['stdout', 'stderr', 'project.log'] as const) {
    test(`${channel} warning is attributed to the operation stage without a suppression rule`, () => {
        const run = LifecycleLogEvidenceFactory.create([
            { stage: 'operation', channel, contents: 'Creator emitted Warning: injected operation diagnostic\n' },
        ]);
        const result = LifecycleRawLogValidator.validate(run);
        assert.equal(result.ok, false);
        assert.equal(result.issues.some((issue) => issue.startsWith(`raw_warning:operation:${channel}:`)), true);
    });
}

test('destroyed-object errors in delayed diagnostics remain failures after normal exit', () => {
    const run = LifecycleLogEvidenceFactory.create([
        { stage: 'delayed_diagnostics', channel: 'project.log', contents: 'Object has been destroyed\n' },
    ]);
    const result = LifecycleRawLogValidator.validate(run);
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.startsWith('raw_error:delayed_diagnostics:project.log:')), true);
});

test('validation never rewrites the supplied raw byte buffers or their digests', () => {
    const run = LifecycleLogEvidenceFactory.create([
        { stage: 'startup', channel: 'stderr', contents: '[WARN] expected synthetic failure\r\n' },
        { stage: 'exit', channel: 'project.log', contents: 'Object has been destroyed\n' },
    ]);
    const before = run.stages.flatMap((stage) => stage.logs.map((log: ILifecycleRawLogSegment) => ({
        bytes: Buffer.from(log.bytes),
        sha256: createHash('sha256').update(log.bytes).digest('hex'),
    })));

    const result = LifecycleRawLogValidator.validate(run);
    const after = run.stages.flatMap((stage) => stage.logs.map((log) => ({
        bytes: Buffer.from(log.bytes),
        sha256: createHash('sha256').update(log.bytes).digest('hex'),
    })));

    assert.equal(result.ok, false);
    assert.deepEqual(after, before);
});

test('invalid project names, gaps, bad digests, and invalid stage windows fail closed', () => {
    const invalidName = LifecycleRawLogValidator.validate(LifecycleLogEvidenceFactory.create([], 'Peanut Lite Lifecycle 3.8.7'));
    assert.equal(invalidName.ok, false);
    assert.ok(invalidName.issues.includes('lifecycle_project_name_invalid'));

    const run = LifecycleLogEvidenceFactory.create();
    const malformed: ILifecycleLogRunEvidence = {
        ...run,
        stages: run.stages.map((stage, index) => index === 1 ? {
            ...stage,
            startedAt: '2026-10-13T10:00:30.000Z',
            logs: stage.logs.map((log) => log.channel === 'stdout' ? { ...log, offsetStart: 1, offsetEnd: 1 } : log),
        } : stage),
    };
    const result = LifecycleRawLogValidator.validate(malformed);
    assert.equal(result.ok, false);
    assert.ok(result.issues.includes('lifecycle_stage_window_invalid:operation'), JSON.stringify(result));
    assert.ok(result.issues.includes('lifecycle_source_offsets_invalid:stdout'));
    assert.equal(result.stages.find((stage) => stage.name === 'operation')?.ok, false);

    const digestMismatch: ILifecycleLogRunEvidence = {
        ...run,
        stages: run.stages.map((stage, index) => index === 0 ? {
            ...stage,
            logs: stage.logs.map((log) => log.channel === 'stdout' ? { ...log, sha256: '0'.repeat(64) } : log),
        } : stage),
    };
    const digestResult = LifecycleRawLogValidator.validate(digestMismatch);
    assert.equal(digestResult.ok, false);
    assert.ok(digestResult.issues.includes('lifecycle_source_digest_mismatch:stdout'));
});
