import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { HostResourceFieldPreparation } from '../src/resource-field-preparation.ts';

test('Host fixed field producer keeps actual root/version and source bytes, refusing proxy/getter/escape declarations', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'host-field-producer-'))); mkdirSync(join(root, 'assets'));
    const source = join(root, 'assets/one.pmtl'); const bytes = Buffer.from('{"__type__":"cc.PhysicsMaterial","_friction":0.5}');
    writeFileSync(source, bytes); const producer = new HostResourceFieldPreparation(root, '3.8.3');
    const input = { assetRelativePath: 'assets/one.pmtl', props: { friction: 'invalid' }, cocosVersion: '3.8.3' };
    try {
        await assert.rejects(producer.prepare(root, input), /lumen_property_type:friction:number>=0/u);
        assert.deepEqual(readFileSync(source), bytes);
        await assert.rejects(producer.prepare(tmpdir(), input), /root_mismatch/u);
        await assert.rejects(producer.prepare(root, { ...input, cocosVersion: '3.8.7' }), /version_mismatch/u);
        await assert.rejects(producer.prepare(root, { ...input, prefabRelativePath: 'assets/other.pmtl' }), /editor_mcp_lumen_path_conflict/u);
        await assert.rejects(producer.prepare(root, { ...input, prefabRelativePath: input.assetRelativePath }), /lumen_property_type:friction:number>=0/u);
        let getterCalls = 0; const getter = Object.defineProperty({}, 'props', { get: () => { getterCalls++; return {}; } });
        await assert.rejects(producer.prepare(root, getter), /input_invalid/u); assert.equal(getterCalls, 0);
        await assert.rejects(producer.prepare(root, new Proxy(input, {})), /input_invalid/u);
        symlinkSync(source, join(root, 'assets/linked.pmtl'));
        for (const path of ['assets/../outside.pmtl', 'outside.pmtl', 'assets/linked.pmtl']) {
            await assert.rejects(producer.prepare(root, { ...input, assetRelativePath: path }), /path_invalid/u);
        }
        assert.deepEqual(readFileSync(source), bytes);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const withPackedSchema of [false, true]) {
    test(`Host packaged producer ${withPackedSchema ? 'uses actual packed schema for exact field refusal' : 'fails explicitly without Host schema'}`, async () => {
        const extensionRoot = fileURLToPath(new URL('../', import.meta.url));
        const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
        const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8')) as { name: string; version: string };
        const packedHost = join(extensionRoot, 'release', `${manifest.name}-${manifest.version}`);
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'host-packed-field-')));
        try {
            const host = join(root, 'host'); const project = join(root, 'project');
            mkdirSync(join(host, 'dist'), { recursive: true }); mkdirSync(join(project, 'assets'), { recursive: true });
            if (withPackedSchema) {
                const schema = join(packedHost, 'bundled/schema');
                assert.ok(existsSync(schema), `actual packed Host schema required: ${schema}`);
                cpSync(schema, join(host, 'bundled/schema'), { recursive: true });
                assert.equal(existsSync(join(host, 'bundled/default_prefab')), false);
            }
            const modules: Record<string, string> = { '@peanut/pod-hosts': 'packages/hosts',
                '@peanut/pod-engine/kernel': 'packages/engine/modules/kernel', '@peanut/pod-engine/runtime': 'packages/engine/modules/runtime',
                '@peanut/pod-engine/mcp': 'packages/engine/modules/mcp', '@peanut/pod-engine/lumen': 'packages/engine/modules/lumen',
                '@peanut/pod-engine/installation': 'packages/engine/modules/installation', '@peanut/pod-protocol': 'packages/protocol',
                '@peanut/pod-sdk': 'packages/sdk', '@peanut/pod-engine/assets': 'packages/engine/modules/assets' };
            const bundle = join(host, 'dist/producer.cjs');
            await build({ bundle: true, entryPoints: [join(extensionRoot, 'src/resource-field-preparation.ts')],
                format: 'cjs', platform: 'node', target: 'node14', outfile: bundle, legalComments: 'none',
                alias: Object.fromEntries(Object.entries(modules).map(([name, path]) => [name, join(repositoryRoot, path, 'dist/index.js')])),
                external: ['electron', 'canvas', '@editor/package'], plugins: [{ name: 'creator-38-node-builtin-compatibility',
                    setup(api) { api.onResolve({ filter: /^node:/ }, args => ({ path: args.path.slice(5), external: true })); } }] });
            const packed = createRequire(import.meta.url)(bundle) as { HostResourceFieldPreparation: typeof HostResourceFieldPreparation };
            const source = join(project, 'assets/one.pmtl'); const meta = `${source}.meta`;
            const sourceBytes = Buffer.from('{"__type__":"cc.PhysicsMaterial","_name":"original","_friction":0.5}');
            const metaBytes = Buffer.from('{"uuid":"11111111-1111-4111-8111-111111111111","importer":"physics-material","ver":"1.0.0","userData":{},"subMetas":{}}');
            writeFileSync(source, sourceBytes); writeFileSync(meta, metaBytes);
            const producer = new packed.HostResourceFieldPreparation(project, '3.8.3');
            await assert.rejects(producer.prepare(project, { assetRelativePath: 'assets/one.pmtl', props: { friction: 'invalid' }, cocosVersion: '3.8.3' }),
                (error: unknown) => error instanceof Error && error.message === (withPackedSchema
                    ? 'lumen_property_type:friction:number>=0' : `lumen_curated_schema_root_missing:${join(host, 'bundled/schema')}`));
            assert.deepEqual(readFileSync(source), sourceBytes); assert.deepEqual(readFileSync(meta), metaBytes);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}
