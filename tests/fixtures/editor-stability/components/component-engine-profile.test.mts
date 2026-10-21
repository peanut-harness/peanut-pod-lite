import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { ComponentEngineProfile } from './component-engine-profile.mts';

for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' isolated project pins builtin engines and refuses inherited custom configuration', () => {
        const root = mkdtempSync(join(tmpdir(), 'component-engine-profile-'));
        try {
            ComponentEngineProfile.configure(root, version);
            ComponentEngineProfile.assertProject(root, version);
            const path = join(root, 'profiles/v2/packages/engine.json'); const before = readFileSync(path);
            assert.throws(() => ComponentEngineProfile.configure(root, version), /EEXIST/);
            assert.deepEqual(readFileSync(path), before);
            for (const value of [undefined, {}, { engine: {} }, { engine: { [version.replaceAll('.', '')]: {
                javascript: { builtin: false, custom: '/other-engine' }, native: { builtin: true } } } }]) {
                assert.throws(() => ComponentEngineProfile.assertBuiltin(value, version), /builtin_engine_not_confirmed/);
            }
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}
test('engine identity refuses unsupported versions before creating profiles', () => {
    assert.throws(() => ComponentEngineProfile.configure('/invalid', '3.8.4'), /engine_version_unsupported/);
});
