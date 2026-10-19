import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
