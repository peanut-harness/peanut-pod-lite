import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HostNativeCapabilities } from '../src/native-capabilities.mts';

test('missing optional native payload leaves Lite without a native registry', () => {
    assert.equal(HostNativeCapabilities.createRegistry(join(tmpdir(), 'peanut-missing-native-capability')), undefined);
});

test('Host accepts signed Canvas and rejects changed payload, bad signature and missing key', () => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-host-native-'));
    try {
        const capabilityRoot = join(root, 'native-capabilities');
        const target = `${process.platform}-${process.arch}`;
        const directory = join(capabilityRoot, 'canvas', '1.x', target);
        mkdirSync(directory, { recursive: true });
        const entry = 'index.cjs';
        const entrySource = 'module.exports = { createCanvas: (width, height) => ({ width, height }) };';
        writeFileSync(join(directory, entry), entrySource);
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const files = [{ path: entry, digest: createHash('sha256').update(entrySource).digest('hex') }];
        const manifest = { id: 'canvas', target, apiVersion: '1.0.0', entry, files, signature: sign(null, Buffer.from(`${entry}:${files[0].digest}`), privateKey).toString('base64') };
        writeFileSync(join(capabilityRoot, 'public-key.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
        writeFileSync(join(directory, 'capability.manifest.json'), JSON.stringify(manifest));
        const surface = HostNativeCapabilities.createRegistry(root)!.requireCanvas('^1.0.0').createSurface(4, 5);
        assert.equal(surface.width, 4);
        assert.equal(surface.height, 5);

        writeFileSync(join(directory, entry), `${entrySource}\n`);
        assert.throws(() => HostNativeCapabilities.createRegistry(root)!.requireCanvas('^1.0.0'), /native_capability_file_integrity_invalid:canvas/u);
        writeFileSync(join(directory, entry), entrySource);
        writeFileSync(join(directory, 'capability.manifest.json'), JSON.stringify({ ...manifest, signature: Buffer.alloc(64).toString('base64') }));
        assert.throws(() => HostNativeCapabilities.createRegistry(root)!.requireCanvas('^1.0.0'), /native_capability_signature_invalid:canvas/u);
        writeFileSync(join(directory, 'capability.manifest.json'), JSON.stringify(manifest));
        rmSync(join(capabilityRoot, 'public-key.pem'));
        assert.throws(() => HostNativeCapabilities.createRegistry(root)!.requireCanvas('^1.0.0'), /native_capability_signature_missing:canvas/u);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
