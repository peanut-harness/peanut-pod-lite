import assert from 'node:assert/strict';
import test from 'node:test';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';

for (const version of ['3.8.3', '3.8.7']) {
    for (const type of ['cc.SkinnedMeshRenderer', 'cc.SkinnedMeshBatchRenderer']) {
        test(version + ' ' + type + ' inherits actual MeshRenderer shadow enum without changing its five public fields', () => {
            const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
            const fields = schema.describeComponent(type); assert.equal(fields.length, 5);
            assert.equal(fields.find(field => field.apiName === 'receiveShadow')?.serializedName, '_shadowReceivingMode');
            for (const flag of [false, true]) {
                const patch = schema.encodeComponentPatch(type, { receiveShadow: flag }, {});
                assert.deepEqual(patch, { _shadowReceivingMode: flag ? 1 : 0 });
                assert.equal(schema.decodeComponentSnapshot(type, patch, () => null).receiveShadow, flag);
            }
            const existing = { _shadowReceivingMode: 1 }; const before = JSON.stringify(existing);
            assert.throws(() => schema.encodeComponentPatch(type, { receiveShadow: 1 }, existing), /property_type/u);
            assert.equal(JSON.stringify(existing), before);
        });
    }
}
