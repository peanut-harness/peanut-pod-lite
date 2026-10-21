import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { ComponentNativeLogGuard } from './component-native-log-guard.mts';

for (const level of ['warn', 'error']) {
    test('native getter ' + level + ' prevents success and preserves postflight evidence without replay', async () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-log-guard-'))); const events: Record<string, unknown>[] = []; let calls = 0;
        try {
            mkdirSync(join(root, 'temp/logs'), { recursive: true }); const log = join(root, 'temp/logs/project.log'); writeFileSync(log, '');
            await assert.rejects(ComponentNativeLogGuard.run(root, 'component-fields', async () => {
                calls++; appendFileSync(log, `10-15-2026 10:47:00 - ${level}: getter diagnostic\n`); return { present: true };
            }, event => events.push(event)), /component_native_log_failed/);
            assert.equal(calls, 1); assert.equal(events.length, 1);
            assert.equal(Reflect.get(Object(events[0]?.result), level === 'warn' ? 'newWarningCount' : 'newErrorCount'), 1);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}
test('delayed getter warning is caught before returning a successful read', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-log-delay-'))); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        mkdirSync(join(root, 'temp/logs'), { recursive: true }); const log = join(root, 'temp/logs/project.log'); writeFileSync(log, '');
        await assert.rejects(ComponentNativeLogGuard.run(root, 'component-fields', async () => {
            timer = setTimeout(() => appendFileSync(log, '10-15-2026 10:47:00 - warn: delayed getter\n'), 50); return true;
        }, () => {}), /component_native_log_failed/);
    } finally { clearTimeout(timer); rmSync(root, { recursive: true, force: true }); }
});
test('a normal process exit still rejects a delayed GuestView shutdown error and keeps physical exit evidence', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-close-log-')));
    let timer: ReturnType<typeof setTimeout> | undefined; let calls = 0; const events: Record<string, unknown>[] = [];
    try {
        mkdirSync(join(root, 'temp/logs'), { recursive: true }); const log = join(root, 'temp/logs/project.log'); writeFileSync(log, '');
        const receipt = join(root, 'closed.json');
        await assert.rejects(ComponentNativeLogGuard.run(root, 'creator-normal-close', async () => {
            calls++; writeFileSync(receipt, JSON.stringify({ originalProcessGone: true, forced: false }));
            timer = setTimeout(() => appendFileSync(log, "10-15-2026 19:51:39 - error: Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL': Error: Invalid guestInstanceId: 6\n"), 50);
            return { code: 0 };
        }, event => events.push(event)), /component_native_log_failed:creator-normal-close/);
        assert.equal(calls, 1); assert.equal(events[0]?.actionSucceeded, true);
        assert.equal(Reflect.get(Object(events[0]?.result), 'newErrorCount'), 1);
        assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')), { originalProcessGone: true, forced: false });
    } finally { clearTimeout(timer); rmSync(root, { recursive: true, force: true }); }
});
test('missing, removed or truncated log cannot be accepted as zero diagnostics', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-log-missing-')));
    try {
        mkdirSync(join(root, 'temp/logs'), { recursive: true }); const log = join(root, 'temp/logs/project.log');
        await assert.rejects(ComponentNativeLogGuard.run(root, 'component-fields', async () => { throw Error('must-not-run'); }, () => {}), /log_unavailable/);
        writeFileSync(log, 'old log\n');
        await assert.rejects(ComponentNativeLogGuard.run(root, 'component-fields', async () => { writeFileSync(log, ''); }, () => {}), /log_truncated/);
        await assert.rejects(ComponentNativeLogGuard.run(root, 'component-fields', async () => { rmSync(log); }, () => {}), /log_unavailable/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
test('historical warnings are retained but do not masquerade as a new getter warning', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-log-clean-'))); const events: Record<string, unknown>[] = [];
    try {
        mkdirSync(join(root, 'temp/logs'), { recursive: true }); const log = join(root, 'temp/logs/project.log');
        writeFileSync(log, '10-14-2026 10:47:00 - warn: historical\n');
        assert.equal(await ComponentNativeLogGuard.run(root, 'component-fields', async () => {
            appendFileSync(log, '10-15-2026 10:47:00 - log: read completed\n'); return 42;
        }, event => events.push(event)), 42);
        assert.equal(Reflect.get(Object(events[0]?.result), 'verified'), true);
        assert.equal(events[0]?.actionSucceeded, true);
        await assert.rejects(ComponentNativeLogGuard.run(root, 'component-fields', async () => { throw Error('native-read-refused'); }, event => events.push(event)), /native-read-refused/);
        assert.equal(events[1]?.actionSucceeded, false);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
