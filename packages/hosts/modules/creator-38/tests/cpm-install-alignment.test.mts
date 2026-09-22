import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { CpmPackageStore } = require('../src/cpm-package-store.js');
const compareReleaseIdentity = CpmPackageStore.compareReleaseIdentity;
const hostPackageDigest = CpmPackageStore.hostPackageDigest;
const releaseRoot = resolve(import.meta.dirname, '../../../../../release/peanut.pod-lite-0.2.0');
const descriptor = JSON.parse(readFileSync(join(releaseRoot, 'lite-release-descriptor.json'), 'utf8'));
const coreId = descriptor.productId;
const proId = 'peanut.cocos-mcp-pro';

// The packed Host bundle is loaded once per process; each scenario reloads it against the same project.
const projectRoot = createCpmLayoutProject();
const host = require(join(projectRoot, 'extensions/peanut-pod-lite-host/dist/main.js'));

test.after(async () => {
    await host.unload();
    delete globalThis.Editor;
    rmSync(projectRoot, { recursive: true, force: true });
});

test('packed Host loads a CPM-installed Core and reports artifacts matching the release descriptor', async () => {
    writeIndex([coreRecord()]);
    globalThis.Editor = createEditor(projectRoot);
    await host.load();
    const status = host.methods.queryStatus();
    assert.equal(status.ready, true, status.error);
    assert.equal(status.coreVersion, descriptor.version);
    assert.equal(status.pro.state, 'absent');
    assert.equal(status.artifacts.host.packageDigest, hostPackageDigest(join(projectRoot, 'extensions/peanut-pod-lite-host')));
    assert.deepEqual(compareReleaseIdentity(status.artifacts, descriptor), []);
    assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, 'peanut-plugins/installed.json'), 'utf8')).plugins.map((plugin) => plugin.pluginId), [coreId]);
});

test('a failed optional Pro package stays isolated from the CPM-installed Core', async () => {
    const pro = writeProPackage();
    writeIndex([coreRecord(), pro]);
    writeFileSync(join(pro.packagePath, `${proId}.bundle.js`), 'tampered');
    globalThis.Editor = createEditor(projectRoot);
    await host.load();
    const status = host.methods.queryStatus();
    assert.equal(status.ready, true, status.error);
    assert.equal(status.pro.state, 'failed');
    assert.match(status.pro.error, /integrity_file_mismatch/u);
    assert.deepEqual(compareReleaseIdentity(status.artifacts, descriptor), []);
});

test('release identity comparison rejects mismatched Host or Core identities', async () => {
    writeIndex([coreRecord()]);
    globalThis.Editor = createEditor(projectRoot);
    await host.load();
    const { artifacts } = host.methods.queryStatus();
    assert.deepEqual(compareReleaseIdentity(artifacts, { ...descriptor, version: '9.9.9' }), ['host.version', 'core.version']);
    assert.deepEqual(compareReleaseIdentity(artifacts, { ...descriptor, host: { ...descriptor.host, packageDigest: '0'.repeat(64) } }), ['host.packageDigest']);
    assert.deepEqual(compareReleaseIdentity(artifacts, { ...descriptor, core: { ...descriptor.core, packageDigest: '0'.repeat(64) } }), ['core.packageDigest']);
    assert.deepEqual(compareReleaseIdentity({ ...artifacts, core: null }, descriptor), ['core.id', 'core.version', 'core.packageDigest']);
});

test('Host package digest ignores Finder metadata and refuses development checkouts', () => {
    const root = mkdtempSync(join(resolve(import.meta.dirname, '..', '.test-temp'), 'host-digest-'));
    try {
        mkdirSync(join(root, 'dist'));
        writeFileSync(join(root, 'dist/main.js'), 'main');
        writeFileSync(join(root, 'package.json'), '{}');
        const expected = createHash('sha256').update([`dist/main.js:${sha256('main')}`, `package.json:${sha256('{}')}`].join('\n')).digest('hex');
        assert.equal(hostPackageDigest(root), expected);
        writeFileSync(join(root, '.DS_Store'), 'finder');
        assert.equal(hostPackageDigest(root), expected);
        mkdirSync(join(root, 'node_modules'));
        assert.equal(hostPackageDigest(root), null);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

function createCpmLayoutProject() {
    const temporaryRoot = resolve(import.meta.dirname, '..', '.test-temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const root = mkdtempSync(join(temporaryRoot, 'cpm-install-alignment-'));
    const extensions = join(root, 'extensions');
    const plugins = join(root, 'peanut-plugins', 'plugins', coreId);
    mkdirSync(extensions, { recursive: true });
    mkdirSync(plugins, { recursive: true });
    extract(join(releaseRoot, descriptor.host.archive), extensions);
    renameSync(join(extensions, `peanut-pod-lite-host-${descriptor.version}`), join(extensions, 'peanut-pod-lite-host'));
    extract(join(releaseRoot, descriptor.core.archive), plugins);
    renameSync(join(plugins, `${coreId}-${descriptor.version}`), join(plugins, descriptor.version));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cpm-alignment', creator: { version: '3.8.7' } }));
    return root;
}

function extract(archive, destination) {
    const result = spawnSync('tar', ['-xzf', archive, '-C', destination], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
}

function coreRecord() {
    const installPath = join('peanut-plugins', 'plugins', coreId, descriptor.version);
    return { pluginId: coreId, activeVersion: descriptor.version, versions: [{ version: descriptor.version, installPath }] };
}

function writeIndex(records) {
    const plugins = records.map(({ packagePath: _packagePath, ...record }) => record);
    writeFileSync(join(projectRoot, 'peanut-plugins', 'installed.json'), `${JSON.stringify({ schemaVersion: 2, plugins }, null, 4)}\n`);
}

function writeProPackage() {
    const version = '0.1.1';
    const installPath = join('peanut-plugins', 'plugins', proId, version);
    const packagePath = resolve(projectRoot, installPath);
    rmSync(packagePath, { recursive: true, force: true });
    mkdirSync(join(packagePath, 'libs'), { recursive: true });
    const bundle = `module.exports.createPluginModule=()=>({manifest:{id:'${proId}',version:'${version}'},activate:async()=>{},deactivate:async()=>{}});`;
    const packageJson = JSON.stringify({ type: 'commonjs' });
    writeFileSync(join(packagePath, `${proId}.bundle.js`), bundle);
    writeFileSync(join(packagePath, 'package.json'), packageJson);
    writeFileSync(join(packagePath, 'libs', '.keep'), '');
    const files = [
        { path: `${proId}.bundle.js`, digest: sha256(bundle) },
        { path: 'libs/.keep', digest: sha256('') },
        { path: 'package.json', digest: sha256(packageJson) },
    ];
    const packageDigest = sha256([...files].sort((left, right) => (left.path < right.path ? -1 : 1)).map((file) => `${file.path}:${file.digest}`).join('\n'));
    writeFileSync(join(packagePath, `${proId}.manifest.json`), JSON.stringify({ id: proId, version, kind: 'tooling-plugin', main: `./${proId}.bundle.js`, package: { schemaVersion: 1, digest: packageDigest, files } }));
    return { pluginId: proId, activeVersion: version, versions: [{ version, installPath }], packagePath };
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function createEditor(root) {
    const safeStorage = {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'dpapi',
        encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
        decryptString: (value) => value.toString('utf8').slice('encrypted:'.length),
    };
    return {
        Project: { path: root, name: 'cpm-alignment' },
        App: { version: '3.8.7', safeStorage },
        Selection: { getSelected: () => [] },
        Message: { request: async () => ({}) },
        log: () => {},
        warn: () => {},
        error: () => {},
    };
}
