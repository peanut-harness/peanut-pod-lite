import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

test('release contains a Creator extension entry', () => {
    const root = resolve(import.meta.dirname, '..', 'release', 'peanut-pod-lite-host-0.1.0');
    const mainPath = resolve(root, 'dist/main.js');
    assert.equal(existsSync(mainPath), true);
    assert.equal(existsSync(resolve(root, 'dist/scene.js')), true);
    assert.equal(existsSync(resolve(root, 'panel/account/index.js')), true);
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    assert.equal(manifest.package_version, 2);
    assert.equal(manifest.panels.account.main, 'panel/account/index.js');
    const mainBundle = readFileSync(mainPath, 'utf8');
    assert.doesNotMatch(mainBundle, /(?:require|import)\(\s*['"]node:/u);
    assert.doesNotMatch(mainBundle, /Object\.hasOwn|\.replaceAll\(|\.at\(\s*-1\s*\)|AbortSignal\.timeout/u);
    assert.match(mainBundle, /class PolyfillAbortController/u);
});
