import assert from 'node:assert/strict';
import test from 'node:test';

import { CpmIntegrityProtocol, CpmManifestValidator } from '../src/index.js';

test('sorts records and calculates the canonical CPM package digest', () => {
    const records = [
        { path: 'package.json', digest: CpmIntegrityProtocol.sha256('{}') },
        { path: 'libs/runtime.js', digest: CpmIntegrityProtocol.sha256('runtime') },
    ];
    assert.deepEqual(CpmIntegrityProtocol.sortRecords([...records].reverse()), [...records].sort((left, right) => left.path.localeCompare(right.path)));
    assert.equal(CpmIntegrityProtocol.digest(records), CpmIntegrityProtocol.digest([...records].reverse()));
});

test('rejects CPM traversal, invalid digests, and duplicate paths', () => {
    assert.equal(CpmIntegrityProtocol.isSafePath('../escape'), false);
    assert.equal(CpmIntegrityProtocol.isSafePath('/absolute'), false);
    assert.equal(CpmIntegrityProtocol.isSafePath('assets/Directional Light.prefab'), true);
    assert.throws(() => CpmIntegrityProtocol.sortRecords([{ path: 'ok.js', digest: 'bad' }]), /cpm_file_record_invalid/u);
    const digest = CpmIntegrityProtocol.sha256('same');
    assert.throws(
        () => CpmIntegrityProtocol.sortRecords([{ path: 'same.js', digest }, { path: 'same.js', digest }]),
        /cpm_file_record_invalid/u,
    );
});

test('validates a CPM manifest and rejects a changed package digest', () => {
    const files = [{ path: 'libs/.keep', digest: CpmIntegrityProtocol.sha256('') }];
    const manifest = {
        id: 'demo.plugin',
        version: '1.2.3',
        kind: 'tooling-plugin',
        main: './demo.plugin.bundle.js',
        package: { schemaVersion: 1, digest: CpmIntegrityProtocol.digest(files), files },
    };
    const parsed = CpmManifestValidator.validate(manifest);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.manifest?.id, 'demo.plugin');
    assert.equal(CpmManifestValidator.validate({ ...manifest, package: { ...manifest.package, digest: '0'.repeat(64) } }).ok, false);
});

test('orders digest records by code unit and still accepts legacy localeCompare manifests', () => {
    const records = [
        { path: 'bundled/default_prefab_24/2d-camera.prefab', digest: CpmIntegrityProtocol.sha256('camera') },
        { path: 'bundled/default_prefab/2d.meta', digest: CpmIntegrityProtocol.sha256('meta') },
    ];
    const payload = (ordered: typeof records): string => CpmIntegrityProtocol.sha256(ordered.map((record) => `${record.path}:${record.digest}`).join('\n'));
    const legacy = payload([...records].sort((left, right) => left.path.localeCompare(right.path)));
    assert.deepEqual(CpmIntegrityProtocol.sortRecords(records).map((record) => record.path), ['bundled/default_prefab/2d.meta', 'bundled/default_prefab_24/2d-camera.prefab']);
    assert.notEqual(CpmIntegrityProtocol.digest(records), legacy);
    assert.equal(CpmIntegrityProtocol.matchesDigest(records, CpmIntegrityProtocol.digest(records)), true);
    assert.equal(CpmIntegrityProtocol.matchesDigest(records, legacy), true);
    assert.equal(CpmIntegrityProtocol.matchesDigest(records, CpmIntegrityProtocol.sha256('other')), false);
});
