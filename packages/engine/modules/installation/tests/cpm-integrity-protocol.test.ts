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
