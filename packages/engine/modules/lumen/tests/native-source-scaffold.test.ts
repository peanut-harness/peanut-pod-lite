import assert from 'assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import test from 'node:test';
import { LumenSession } from '../source/session';
for (const [extension, type, template] of [['mtl', 'cc.Material', 'standard'], ['anim', 'cc.AnimationClip', 'empty'],
    ['pmtl', 'cc.PhysicsMaterial', 'empty'], ['rt', 'cc.RenderTexture', 'empty']]) {
    test(`native source ${extension} serializes without publishing source or meta`, () => {
        const root = mkdtempSync(join(tmpdir(), 'lumen-native-source-'));
        try {
            const path = `assets/new.${extension}`; const s = new LumenSession({ projectRoot: root });
            const serialized = s.serializeStandaloneScaffold({ prefabRelativePath: path, rootName: 'Real', template });
            assert.equal(JSON.parse(serialized.content).__type__, type); assert.equal(serialized.relativePath, path);
            assert.equal(existsSync(join(root, 'assets')), false);
            s.save(); assert.equal(readFileSync(join(root, path), 'utf8'), serialized.content);
            assert.throws(() => s.serializeStandaloneScaffold({ prefabRelativePath: path, rootName: 'Again', template }), /target_exists/);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}
