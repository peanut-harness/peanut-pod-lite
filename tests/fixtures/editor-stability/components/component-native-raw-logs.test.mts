import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ComponentNativeLogGuard } from './component-native-log-guard.mts';
import { ComponentNativeRawLogs } from './component-native-raw-logs.mts';

const create = () => {
    const root = realpathSync(mkdtempSync('/private/tmp/pod-native-raw-')); const project = join(root, 'project');
    mkdirSync(join(project, 'temp/logs'), { recursive: true }); writeFileSync(join(project, 'temp/logs/project.log'), '');
    writeFileSync(join(root, 'creator-owned-start.json'), JSON.stringify({ project, launchMethod: 'open-new-instance-wait' }));
    for (const name of ['stdout.log', 'stderr.log', 'launcher-stdout.log', 'launcher-stderr.log']) writeFileSync(join(root, name), '');
    return { root, project };
};

test('raw renderer GL errors reject an otherwise clean project.log after a single action', async () => {
    const f = create(); const events: Record<string, unknown>[] = []; let calls = 0;
    try {
        await assert.rejects(ComponentNativeLogGuard.run(f.project, 'scene-open', async () => {
            calls++; appendFileSync(join(f.root, 'stderr.log'), 'ERROR:gl_utils.cc GL_INVALID_OPERATION: uniform buffer too small\n'); return true;
        }, event => events.push(event)), /component_native_log_failed/);
        assert.equal(calls, 1); const result = events[0]?.result as { newErrorCount: number; verified: boolean; rawSources: unknown[] };
        assert.equal(result.newErrorCount, 1); assert.equal(result.verified, false); assert.equal(result.rawSources.length, 4);
        assert.equal(readFileSync(join(f.project, 'temp/logs/project.log'), 'utf8'), '');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('typed Node warnings and SDK timing failures cannot disappear outside project.log', async () => {
    for (const [name, message, key] of [
        ['stdout.log', '[Scene] cc.TiledMap.initWithXML(): Map not found. Please check the filename.\n', 'newErrorCount'],
        ['stdout.log', '[Scene] cocos2d: TMXFormat: Unsupported TMX version: 1.10\n', 'newWarningCount'],
        ['stderr.log', '[Assets] the importer version need to upgrade.\n', 'newWarningCount'],
        ['stderr.log', '(node:1) MaxListenersExceededWarning: 11 add listeners\n', 'newWarningCount'],
        ['stdout.log', 'trackTimeEnd failed! Can not find the track time start\n', 'newErrorCount'],
        ['launcher-stderr.log', 'Warning: launch diagnostic\n', 'newWarningCount'],
    ]) {
        const f = create(); const events: Record<string, unknown>[] = [];
        try {
            await assert.rejects(ComponentNativeLogGuard.run(f.project, 'native-read', async () => {
                appendFileSync(join(f.root, name!), message!); return true;
            }, event => events.push(event)), /component_native_log_failed/);
            assert.equal(Reflect.get(Object(events[0]?.result), key!), 1);
        } finally { rmSync(f.root, { recursive: true, force: true }); }
    }
});

test('delayed raw diagnostic is caught without repeating the native action', async () => {
    const f = create(); let timer: ReturnType<typeof setTimeout> | undefined; let calls = 0;
    try {
        await assert.rejects(ComponentNativeLogGuard.run(f.project, 'native-read', async () => {
            calls++; timer = setTimeout(() => appendFileSync(join(f.root, 'stderr.log'), 'Error: delayed renderer\n'), 50); return true;
        }, () => {}), /component_native_log_failed/); assert.equal(calls, 1);
    } finally { clearTimeout(timer); rmSync(f.root, { recursive: true, force: true }); }
});

test('missing or linked required raw sources stop before any action and lost sources stop acceptance', async () => {
    for (const mode of ['missing', 'linked', 'removed', 'truncated']) {
        const f = create(); let calls = 0; const path = join(f.root, 'stderr.log');
        try {
            if (mode === 'missing' || mode === 'linked') rmSync(path);
            if (mode === 'linked') symlinkSync(join(f.root, 'stdout.log'), path);
            if (mode === 'truncated') writeFileSync(path, 'old content\n');
            await assert.rejects(ComponentNativeLogGuard.run(f.project, 'native-read', async () => {
                calls++; if (mode === 'removed') rmSync(path); if (mode === 'truncated') writeFileSync(path, ''); return true;
            }, () => {}), /component_native_raw_log_(unavailable|truncated)/);
            assert.equal(calls, ['missing', 'linked'].includes(mode) ? 0 : 1);
        } finally { rmSync(f.root, { recursive: true, force: true }); }
    }
});

test('historical raw errors remain stored while only new bytes determine action delta', async () => {
    const f = create(); const events: Record<string, unknown>[] = [];
    try {
        const path = join(f.root, 'stdout.log'); const historical = 'Error: preserved historical failure\n'; writeFileSync(path, historical);
        assert.equal(await ComponentNativeLogGuard.run(f.project, 'native-read', async () => {
            appendFileSync(path, 'native observation complete\n'); return 42;
        }, event => events.push(event)), 42);
        assert.equal(Reflect.get(Object(events[0]?.result), 'newErrorCount'), 0); assert(readFileSync(path, 'utf8').startsWith(historical));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('partial raw lines and same-inode prefix rewrites are conservatively detected', () => {
    const f = create();
    try {
        const path = join(f.root, 'stdout.log'); writeFileSync(path, 'trackTimeEnd ');
        const before = ComponentNativeRawLogs.checkpoint(f.project); appendFileSync(path, 'failed! start missing\n');
        const delta = ComponentNativeRawLogs.readDelta(before); assert.equal(delta.newErrors.length, 1);
        assert.equal(delta.sources[0]?.offset, Buffer.byteLength('trackTimeEnd '));
        const checkpoint = ComponentNativeRawLogs.checkpoint(f.project); writeFileSync(path, 'x'.repeat(100));
        assert.throws(() => ComponentNativeRawLogs.readDelta(checkpoint), /prefix_changed/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('registered native project cannot silently fall back to project.log when its lease is missing', () => {
    const f = create();
    try {
        rmSync(join(f.root, 'creator-owned-start.json')); writeFileSync(join(f.root, 'project-ownership.json'), '{}');
        assert.throws(() => ComponentNativeRawLogs.checkpoint(f.project), /raw_lease_missing/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('whole-session preflight rejects historical startup diagnostics even when a fresh action delta is clean', async () => {
    const f = create();
    try {
        appendFileSync(join(f.root, 'stdout.log'), 'trackTimeEnd failed! startup\n');
        appendFileSync(join(f.project, 'temp/logs/project.log'), 'warning: startup\n');
        const all = ComponentNativeRawLogs.readAll(f.project);
        assert.equal(all.newErrors.length, 1); assert.equal(all.newWarnings.length, 1); assert.equal(all.sources.length, 5);
        assert.equal(await ComponentNativeLogGuard.run(f.project, 'read-only-observation', async () => 42, () => {}), 42);
        assert.equal(ComponentNativeRawLogs.readAll(f.project).newErrors.length, 1);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});
