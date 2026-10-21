import assert from 'assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import test from 'node:test';
import { LumenSession } from '../source/session';
for (const [extension, type, template] of [['mtl', 'cc.Material', 'standard'], ['anim', 'cc.AnimationClip', 'empty'],
    ['pmtl', 'cc.PhysicsMaterial', 'empty'], ['rt', 'cc.RenderTexture', 'empty'],
    ['animgraph', 'cc.animation.AnimationGraph', 'empty'], ['animgraphvari', 'cc.animation.AnimationGraphVariant', 'empty'],
    ['animask', 'cc.animation.AnimationMask', 'empty'], ['rpp', 'cc.RenderPipeline', 'empty']]) {
    test(`native source ${extension} serializes without publishing source or meta`, () => {
        const root = mkdtempSync(join(tmpdir(), 'lumen-native-source-'));
        try {
            const path = `assets/new.${extension}`; const s = new LumenSession({ projectRoot: root });
            const serialized = s.serializeStandaloneScaffold({ prefabRelativePath: path, rootName: 'Real', template });
            assert.equal(typeof serialized.content, 'string');
            const data = JSON.parse(serialized.content as string); const header = Array.isArray(data) ? data[0] : data;
            assert.equal(header.__type__, type); assert.equal(serialized.relativePath, path);
            if (['animgraph', 'animgraphvari', 'animask', 'rpp'].includes(extension!)) assert.equal(header._name, 'Real');
            assert.equal(existsSync(join(root, 'assets')), false);
            s.save(); assert.equal(readFileSync(join(root, path), 'utf8'), serialized.content);
            assert.throws(() => s.serializeStandaloneScaffold({ prefabRelativePath: path, rootName: 'Again', template }), /target_exists/);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}

test('native Terrain scaffold preserves raw VERSION8 Buffer without publishing source or meta', () => {
    const root = mkdtempSync(join(tmpdir(), 'lumen-native-terrain-'));
    try {
        const session = new LumenSession({ projectRoot: root }); const path = 'assets/Real.terrain';
        const serialized = session.serializeStandaloneScaffold({ prefabRelativePath: path, rootName: 'Real', template: 'empty' });
        assert.ok(Buffer.isBuffer(serialized.content)); assert.equal(serialized.kind, 'terrain');
        assert.equal(serialized.content.readInt32LE(0), 0x01010008);
        assert.equal(existsSync(join(root, 'assets')), false);
        session.save(); assert.deepEqual(readFileSync(join(root, path)), serialized.content);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
