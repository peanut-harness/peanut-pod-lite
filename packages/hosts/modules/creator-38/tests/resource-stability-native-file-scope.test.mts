import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { ResourceStabilityNativeFileScope } from '../scripts/resource-stability-native-file-scope.mts';

/**
 * @description Real ordinary files exercise shared no-follow/stability semantics without semantic projection.
 */
function fixture() {
    const project = fs.realpathSync(fs.mkdtempSync('/private/tmp/resource434-fd-')); const namespace = 'assets/fixtures/resource-stability/fd-test';
    const path = namespace + '/audio/tone.wav'; const absolute = join(project, path);
    fs.mkdirSync(join(project, namespace, 'audio'), { recursive: true }); fs.writeFileSync(absolute, Buffer.from([0xff, 0, 0x80, 1]));
    return { project, namespace, path, absolute, reader: new ResourceStabilityNativeFileScope(project, namespace), cleanup: () => fs.rmSync(project, { recursive: true, force: true }) };
}

test('binary bytes remain exact without UTF8 conversion; scope and ordinary-file budget are enforced', () => {
    const f = fixture(); try {
        assert.deepEqual(f.reader.readFile(f.path), Buffer.from([0xff, 0, 0x80, 1]));
        for (const path of ['assets/other/a', f.namespace + '/../escape', f.namespace + '/a%2fb', f.namespace + '/a\\b']) assert.throws(() => f.reader.readFile(path), /path_denied/u);
        fs.writeFileSync(f.absolute, Buffer.alloc(1024 * 1024 + 1)); assert.throws(() => f.reader.readFile(f.path), /budget_or_type/u);
        fs.rmSync(f.absolute); fs.mkdirSync(f.absolute); assert.throws(() => f.reader.readFile(f.path), /budget_or_type/u);
    } finally { f.cleanup(); }
});

test('leaf and ancestor links cannot read any external bytes', () => {
    const f = fixture(); try {
        fs.rmSync(f.absolute); fs.symlinkSync('/etc/hosts', f.absolute); assert.throws(() => f.reader.readFile(f.path), /symlink/u);
        fs.rmSync(join(f.project, f.namespace, 'audio'), { recursive: true });
        fs.symlinkSync('/private/tmp', join(f.project, f.namespace, 'audio')); assert.throws(() => f.reader.readFile(f.path), /symlink/u);
    } finally { f.cleanup(); }
});

test('real descriptor content mutation and short read are rejected, not truncated into a digest', () => {
    const f = fixture(); const original = fs.readSync;
    try {
        Reflect.set(fs, 'readSync', (...args: unknown[]) => { const n = Reflect.apply(original, fs, args); fs.appendFileSync(f.absolute, 'changed'); return n; });
        syncBuiltinESMExports(); assert.throws(() => f.reader.readFile(f.path), /read_changed/u);
        Reflect.set(fs, 'readSync', () => 0); syncBuiltinESMExports(); assert.throws(() => f.reader.readFile(f.path), /short_read/u);
    } finally { Reflect.set(fs, 'readSync', original); syncBuiltinESMExports(); f.cleanup(); }
});
