import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

test('release contains a Creator extension entry', () => {
    const extensionRoot = resolve(import.meta.dirname, '..');
    const manifest = JSON.parse(readFileSync(resolve(extensionRoot, 'package.json'), 'utf8'));
    const root = resolve(extensionRoot, 'release', `${manifest.name}-${manifest.version}`);
    const mainPath = resolve(root, 'dist/main.js');
    assert.equal(existsSync(mainPath), true);
    assert.equal(existsSync(resolve(root, 'dist/scene.js')), true);
    assert.equal(existsSync(resolve(root, 'panel/account/index.js')), true);
    const packedManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    assert.equal(packedManifest.package_version, 2);
    assert.equal(packedManifest.version, manifest.version);
    assert.equal(packedManifest.panels.account.main, 'panel/account/index.js');
    const mainBundle = readFileSync(mainPath, 'utf8');
    assert.doesNotMatch(mainBundle, /(?:require|import)\(\s*['"]node:/u);
    assert.doesNotMatch(mainBundle, /Object\.hasOwn|\.replaceAll\(|\.at\(\s*-1\s*\)|AbortSignal\.timeout/u);
    assert.match(mainBundle, /class PolyfillAbortController/u);
});
