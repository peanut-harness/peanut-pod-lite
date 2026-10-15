import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ComponentTerrainEffect } from './component-terrain-effect.mts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' Terrain uses the complete frozen SDK effect with required material properties', () => {
        const binding = ComponentTerrainEffect.binding(root, version);
        assert.equal(binding.nativeType, 'cc.EffectAsset'); assert.equal(binding.sources.length, 2);
        assert.equal(Object.hasOwn(binding, 'uuid'), false);
        const source = binding.sources.find(row => row.path.endsWith('.effect')); assert(source);
        const bytes = readFileSync(join(root, source.path), 'utf8');
        for (const key of ['detailMap0', 'UVScale', 'normalMap3', 'weightMap']) assert.match(bytes, new RegExp('\\b' + key + '\\s*:'));
        const provenance = JSON.parse(readFileSync(join(root, binding.fixtureReference), 'utf8'));
        assert.equal(provenance.sdkChunks.length, 75);
        assert.equal(provenance.files.find((row: { sdkPath: string }) => row.sdkPath.endsWith('.effect'))?.sha256, source.sha256);
    });
}

test('Terrain source gate rejects changed chunks, omitted transitive dependencies, links and incompatible effects before launch', () => {
    const scratch = mkdtempSync('/private/tmp/pod-terrain-effect-');
    try {
        const engine = join(scratch, 'sdk'); const fixture = 'tests/fixtures/editor-stability/components/3.8.3/terrain-effect/';
        const effectPath = 'editor/assets/effects/builtin-terrain.effect';
        const chunkA = 'editor/assets/chunks/test/a.chunk'; const chunkB = 'editor/assets/chunks/test/b.chunk';
        const props = ['UVScale', 'metallic', 'roughness', 'weightMap', 'detailMap0', 'detailMap1', 'detailMap2', 'detailMap3',
            'normalMap0', 'normalMap1', 'normalMap2', 'normalMap3'];
        const effect = 'CCEffect %{\nproperties:\n' + props.map(name => name + ': {}').join('\n')
            + '\n}%\nCCProgram local-shared %{\n}%\nCCProgram main %{\n#include <local-shared>\n#include <test/a>\n}%\n';
        const bytes = new Map([[effectPath, effect], [effectPath + '.meta', '{}\n'],
            [chunkA, '/* #include <commented/XXX> */\n#include <test/b>\n'], [chunkB, '// #include <not/real>\nvoid main() {}\n']]);
        mkdirSync(engine, { recursive: true }); writeFileSync(join(engine, 'package.json'), '{"version":"3.8.3"}\n');
        for (const [path, value] of bytes) { mkdirSync(dirname(join(engine, path)), { recursive: true }); writeFileSync(join(engine, path), value); }
        mkdirSync(join(scratch, fixture), { recursive: true });
        writeFileSync(join(scratch, fixture + 'task51-terrain.effect'), effect);
        writeFileSync(join(scratch, fixture + 'task51-terrain.effect.meta'), '{}\n');
        const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
        const provenance = { schemaVersion: 1, creatorVersion: '3.8.3', files: [effectPath, effectPath + '.meta'].map(sdkPath => {
            const value = bytes.get(sdkPath); assert(value);
            return { path: fixture + sdkPath.split('/').at(-1)?.replace('builtin-terrain', 'task51-terrain'), sdkPath, sha256: hash(value) };
        }), sdkChunks: [chunkA, chunkB].map(path => { const value = bytes.get(path); assert(value); return { path, sha256: hash(value) }; }) };
        const path = join(scratch, fixture + 'source-provenance.json');
        writeFileSync(path, JSON.stringify(provenance));
        ComponentTerrainEffect.assertSdk(scratch, engine, '3.8.3');
        writeFileSync(join(engine, chunkB), 'changed');
        assert.throws(() => ComponentTerrainEffect.assertSdk(scratch, engine, '3.8.3'), /hash_mismatch/);
        writeFileSync(join(engine, chunkB), bytes.get(chunkB) ?? '');
        writeFileSync(path, JSON.stringify({ ...provenance, sdkChunks: provenance.sdkChunks.slice(0, 1) }));
        assert.throws(() => ComponentTerrainEffect.assertSdk(scratch, engine, '3.8.3'), /chunk_closure_missing/);
        writeFileSync(path, JSON.stringify(provenance));
        const external = join(scratch, 'external.chunk'); writeFileSync(external, bytes.get(chunkB) ?? '');
        unlinkSync(join(engine, chunkB)); symlinkSync(external, join(engine, chunkB));
        assert.throws(() => ComponentTerrainEffect.assertSdk(scratch, engine, '3.8.3'), /link_escape/);
        unlinkSync(join(engine, chunkB)); writeFileSync(join(engine, chunkB), bytes.get(chunkB) ?? '');
        const incompatible = 'CCEffect %{ properties: { mainTexture: {} } }%';
        writeFileSync(join(scratch, fixture + 'task51-terrain.effect'), incompatible);
        assert.throws(() => ComponentTerrainEffect.binding(scratch, '3.8.3'), /hash_mismatch/);
        const effectSource = provenance.files.find(row => row.sdkPath.endsWith('.effect')); assert(effectSource);
        effectSource.sha256 = hash(incompatible); writeFileSync(path, JSON.stringify(provenance));
        assert.throws(() => ComponentTerrainEffect.binding(scratch, '3.8.3'), /properties_missing/);
        assert.throws(() => ComponentTerrainEffect.binding(scratch, '3.8.4'), /version_unsupported/);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
});
