import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentCreatorDiagnostics } from './component-creator-diagnostics.mts';

test('Creator diagnostics enable only the verified metric output option without suppressing warnings', () => {
    assert.deepEqual(ComponentCreatorDiagnostics.args(true, '3.8.7'), ['--metric']);
    assert.deepEqual(ComponentCreatorDiagnostics.args(false, '3.8.7'), []);
    assert.deepEqual(ComponentCreatorDiagnostics.args(undefined, '3.8.3'), []);
    assert.throws(() => ComponentCreatorDiagnostics.args(true, '3.8.3'), /version_unverified/);
    for (const value of ['--no-warnings', '--all', 1, {}, ['--metric']])
        assert.throws(() => ComponentCreatorDiagnostics.args(value, '3.8.7'), /diagnostics_invalid/);
});
