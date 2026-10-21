import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LifecycleRawLogValidator } from '../../../../../tools/editor-stability/lifecycle-raw-log-validator.mts';
import { ResourceStabilityFileEvidenceReader } from '../scripts/resource-stability-file-evidence.mts';

const createEnvelope = () => ({ runId: 'synthetic-file-evidence', projectName: 'peanut-resource-stability',
    hostSha256: 'a'.repeat(64), coreSha256: 'b'.repeat(64),
    stages: ['startup', 'operation', 'cooldown', 'exit', 'delayed_diagnostics'].map((name, index) => ({
        name, startedAt: new Date(Date.UTC(2026, 9, 13, 0, index)).toISOString(), endedAt: new Date(Date.UTC(2026, 9, 13, 0, index + 1)).toISOString(),
        logs: ['stdout', 'stderr', 'project.log'].map((channel) => ({ channel, reference: `raw/${channel}.log`, offsetStart: 0, offsetEnd: 0,
            capturedAt: new Date(Date.UTC(2026, 9, 13, 0, index + 1)).toISOString(), byteLength: 0,
            sha256: createHash('sha256').update('').digest('hex'), bytes: { untrusted: 'must never be consumed' } })),
    })) });

test('file reader restores original bytes instead of trusting envelope bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'resource-raw-'));
    try {
        mkdirSync(join(root, 'raw'));
        for (const channel of ['stdout', 'stderr', 'project.log']) writeFileSync(join(root, `raw/${channel}.log`), '');
        writeFileSync(join(root, 'envelope.json'), JSON.stringify(createEnvelope()));
        const reader = new ResourceStabilityFileEvidenceReader(root, 1024, 4096);
        assert.equal(LifecycleRawLogValidator.validate(reader.readLifecycle('envelope.json')).ok, true);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unclaimed trailing raw bytes cannot be hidden by empty logged slices', () => {
    const root = mkdtempSync(join(tmpdir(), 'resource-raw-'));
    try {
        mkdirSync(join(root, 'raw'));
        for (const channel of ['stdout', 'stderr', 'project.log']) writeFileSync(join(root, `raw/${channel}.log`), channel === 'stderr' ? 'Warning: hidden trailing diagnostic\n' : '');
        writeFileSync(join(root, 'envelope.json'), JSON.stringify(createEnvelope()));
        assert.throws(() => new ResourceStabilityFileEvidenceReader(root, 1024, 4096).readLifecycle('envelope.json'), /unattributed_trailing_bytes/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('corrupt raw hashes, invalid UTF8 and warning bytes remain failures', () => {
    for (const content of [Buffer.from('Warning: synthetic warning\n'), Buffer.from([0xff])]) {
        const root = mkdtempSync(join(tmpdir(), 'resource-raw-'));
        try {
            mkdirSync(join(root, 'raw'));
            for (const channel of ['stdout', 'stderr', 'project.log']) writeFileSync(join(root, `raw/${channel}.log`), channel === 'stderr' ? content : '');
            const envelope = createEnvelope();
            const last = envelope.stages[4]?.logs[1]; assert.ok(last);
            Object.assign(last, { offsetEnd: content.length, byteLength: content.length,
                sha256: createHash('sha256').update(content).digest('hex'), bytes: { untrusted: 'clean' } });
            writeFileSync(join(root, 'envelope.json'), JSON.stringify(envelope));
            const reader = new ResourceStabilityFileEvidenceReader(root, 1024, 4096);
            assert.equal(LifecycleRawLogValidator.validate(reader.readLifecycle('envelope.json')).ok, false);
            last.sha256 = '0'.repeat(64);
            writeFileSync(join(root, 'envelope.json'), JSON.stringify(envelope));
            assert.equal(LifecycleRawLogValidator.validate(reader.readLifecycle('envelope.json')).ok, false);
        } finally { rmSync(root, { recursive: true, force: true }); }
    }
});

test('byte budgets, source truncation, unsafe references and symlink escapes fail closed', () => {
    const root = mkdtempSync(join(tmpdir(), 'resource-raw-'));
    const outside = mkdtempSync(join(tmpdir(), 'resource-raw-outside-'));
    try {
        mkdirSync(join(root, 'raw'));
        for (const channel of ['stdout', 'stderr', 'project.log']) writeFileSync(join(root, `raw/${channel}.log`), '');
        writeFileSync(join(outside, 'secret.log'), 'private');
        symlinkSync(join(outside, 'secret.log'), join(root, 'raw', 'escape.log'));
        for (const reference of ['../outside.log', '/private/tmp/absolute', 'file:outside', 'raw/escape.log']) {
            const envelope = createEnvelope();
            const first = envelope.stages[0]?.logs[0]; assert.ok(first); first.reference = reference;
            writeFileSync(join(root, 'envelope.json'), JSON.stringify(envelope));
            assert.throws(() => new ResourceStabilityFileEvidenceReader(root, 1024, 4096).readLifecycle('envelope.json'));
        }
        const envelope = createEnvelope(); const first = envelope.stages[0]?.logs[0]; assert.ok(first);
        first.offsetEnd = 2000; first.byteLength = 2000;
        writeFileSync(join(root, 'envelope.json'), JSON.stringify(envelope));
        assert.throws(() => new ResourceStabilityFileEvidenceReader(root, 1024, 4096).readLifecycle('envelope.json'), /budget_exceeded/u);
        first.offsetEnd = 2; first.byteLength = 2;
        writeFileSync(join(root, 'envelope.json'), JSON.stringify(envelope));
        assert.throws(() => new ResourceStabilityFileEvidenceReader(root, 1024, 4096).readLifecycle('envelope.json'), /source_truncated/u);
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
