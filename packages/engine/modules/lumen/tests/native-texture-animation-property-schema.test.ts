import assert from 'node:assert/strict';
import test from 'node:test';
import { LumenPrefabDocument } from '../source/hierarchy/prefab-document';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';

for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' texture animation tile counts persist under native JSON aliases after reopening', () => {
        const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
        let document = LumenPrefabDocument.createEmptyScene('assets/Particle.scene', 'Root');
        document.setPropertySchema(schema);
        document.addChildFromSpec('/Root', { name: 'Target', components: ['cc.ParticleSystem'] });
        for (const [numTilesX, numTilesY] of [[4, 8], [2, 16]]) {
            document.setComponentProperty('/Root/Target', 'cc.ParticleSystem', { textureAnimationModule: { numTilesX, numTilesY } });
            document = new LumenPrefabDocument('assets/Particle.scene', JSON.parse(JSON.stringify(document.entries)), schema);
            const module = document.entries.find(entry => entry.__type__ === 'cc.TextureAnimationModule');
            assert(module); assert.equal(module.numTilesX, numTilesX); assert.equal(module.numTilesY, numTilesY);
            assert.equal(Object.hasOwn(module, '_numTilesX'), false); assert.equal(Object.hasOwn(module, '_numTilesY'), false);
            const particle = document.entries.find(entry => entry.__type__ === 'cc.ParticleSystem'); assert(particle);
            const snapshot = schema.decodeComponentSnapshot('cc.ParticleSystem', particle, () => null, index => document.entries[index] ?? null);
            assert.equal((snapshot.textureAnimationModule as Record<string, unknown>).numTilesX, numTilesX);
            assert.equal((snapshot.textureAnimationModule as Record<string, unknown>).numTilesY, numTilesY);
        }
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.setComponentProperty('/Root/Target', 'cc.ParticleSystem', {
            textureAnimationModule: { numTilesX: 7, numTilesY: 'invalid' },
        }), /lumen_property_type/);
        assert.equal(JSON.stringify(document.entries), before);
    });
}

test('unknown Creator versions retain the previous texture animation JSON slots', () => {
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.4'));
    const document = LumenPrefabDocument.createEmptyScene('assets/Particle.scene', 'Root'); document.setPropertySchema(schema);
    document.addChildFromSpec('/Root', { name: 'Target', components: ['cc.ParticleSystem'] });
    document.setComponentProperty('/Root/Target', 'cc.ParticleSystem', { textureAnimationModule: { numTilesX: 4, numTilesY: 8 } });
    const module = document.entries.find(entry => entry.__type__ === 'cc.TextureAnimationModule'); assert(module);
    assert.equal(module._numTilesX, 4); assert.equal(module._numTilesY, 8); assert.equal(Object.hasOwn(module, 'numTilesX'), false);
});
