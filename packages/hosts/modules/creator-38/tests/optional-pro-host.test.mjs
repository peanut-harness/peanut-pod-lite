import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const host = require('../src/main.js');

test('optional Pro activation and corruption stay isolated from the required Core package', async () => {
    const temporaryRoot = resolve(import.meta.dirname, '..', '.test-temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const projectRoot = mkdtempSync(join(temporaryRoot, 'optional-pro-host-'));
    try {
        const core = writePackage(
            projectRoot,
            'peanut.pod-lite',
            '0.1.0',
            "module.exports.createPluginModule=()=>({manifest:{id:'peanut.pod-lite',version:'0.1.0'},activate:async(context)=>{context.mcp.register({name:'core.read'},async(input,invocation)=>({input,invocation}))},deactivate:async()=>{}});",
        );
        const pro = writePackage(
            projectRoot,
            'peanut.cocos-mcp-pro',
            '0.1.1',
            "module.exports.createPluginModule=()=>({manifest:{id:'peanut.cocos-mcp-pro',version:'0.1.1'},activate:async(context)=>{const key=await context.protectedKeys.getOrCreateHmacSha256Key('mcp-plan-digest-v1');if(key.extractable||key.usages.join(',')!=='sign')throw new Error('invalid_key');context.services.register('mcp.admit',async()=>true)},deactivate:async()=>{}});",
        );
        writeInstalledIndex(projectRoot, [core, pro]);
        globalThis.Editor = createEditor(projectRoot);
        await host.load();
        const status = host.methods.queryStatus();
        assert.equal(status.ready, true);
        assert.equal(status.coreVersion, '0.1.0');
        assert.match(status.artifacts.host.mainDigest, /^[a-f0-9]{64}$/u);
        assert.equal(status.artifacts.core.packageDigest, readManifest(core).package.digest);
        assert.equal(status.artifacts.pro.packageDigest, readManifest(pro).package.digest);
        assert.deepEqual(status.tools, ['core.read', 'peanut.editor-mcp.issue-local-approval-lease']);
        assert.deepEqual(status.pro, { state: 'active', version: '0.1.1', error: null, services: ['mcp.admit'] });
        assert.deepEqual(
            await host.methods.invokeTool(
                'core.read',
                { value: 1 },
                { connectionId: 'bridge-connection', resourceIds: ['db://assets/a.prefab'] },
            ),
            {
                input: { value: 1 },
                invocation: { connectionId: 'bridge-connection', resourceIds: ['db://assets/a.prefab'] },
            },
        );
        const hostReport = readJson(join(projectRoot, 'peanut-plugins', 'runtime', 'host-status.json'));
        const smokeReport = readJson(join(projectRoot, 'peanut-plugins', 'runtime', 'smoke-results.json'));
        assert.deepEqual(hostReport.artifacts, status.artifacts);
        assert.deepEqual(smokeReport.artifacts, status.artifacts);
        assert.equal(status.account.state, 'signed_out');
        assert.equal(status.account.recommendedAction, 'sign-in');
        writeFileSync(join(pro.packagePath, 'peanut.cocos-mcp-pro.bundle.js'), 'tampered');
        await host.load();
        const recovered = host.methods.queryStatus();
        assert.equal(recovered.ready, true);
        assert.deepEqual(recovered.tools, ['core.read', 'peanut.editor-mcp.issue-local-approval-lease']);
        assert.equal(recovered.pro.state, 'failed');
        assert.match(recovered.pro.error, /integrity_file_mismatch/u);
    } finally {
        await host.unload();
        delete globalThis.Editor;
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

function writePackage(projectRoot, pluginId, version, bundle) {
    const installPath = join('peanut-plugins', 'plugins', pluginId, version);
    const packagePath = resolve(projectRoot, installPath);
    mkdirSync(join(packagePath, 'libs'), { recursive: true });
    const packageJson = JSON.stringify({ type: 'commonjs' });
    writeFileSync(join(packagePath, `${pluginId}.bundle.js`), bundle);
    writeFileSync(join(packagePath, 'package.json'), packageJson);
    writeFileSync(join(packagePath, 'libs', '.keep'), '');
    const files = [
        { path: `${pluginId}.bundle.js`, digest: digest(bundle) },
        { path: 'libs/.keep', digest: digest('') },
        { path: 'package.json', digest: digest(packageJson) },
    ];
    const manifest = {
        id: pluginId,
        version,
        kind: 'tooling-plugin',
        main: `./${pluginId}.bundle.js`,
        package: {
            schemaVersion: 1,
            digest: digest([...files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => `${file.path}:${file.digest}`).join('\n')),
            files,
        },
    };
    writeFileSync(join(packagePath, `${pluginId}.manifest.json`), JSON.stringify(manifest));
    return { pluginId, activeVersion: version, versions: [{ version, installPath }], packagePath };
}

function writeInstalledIndex(projectRoot, packages) {
    const plugins = packages.map(({ packagePath: _packagePath, ...record }) => record);
    writeFileSync(join(projectRoot, 'peanut-plugins', 'installed.json'), JSON.stringify({ schemaVersion: 2, plugins }));
}

function digest(value) {
    return createHash('sha256').update(value).digest('hex');
}

function readManifest(plugin) {
    return readJson(join(plugin.packagePath, `${plugin.pluginId}.manifest.json`));
}

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function createEditor(projectRoot) {
    const safeStorage = {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'dpapi',
        encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
        decryptString: (value) => value.toString('utf8').slice('encrypted:'.length),
    };
    return {
        Project: { path: projectRoot, name: 'host-test' },
        App: { version: '3.8.7', safeStorage },
        Selection: { getSelected: () => [] },
        Message: { request: async () => ({}) },
        log: () => {},
        warn: () => {},
        error: () => {},
    };
}
