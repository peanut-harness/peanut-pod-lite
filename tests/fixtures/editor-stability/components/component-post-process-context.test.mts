import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentPostProcessContext } from './component-post-process-context.mts';
for (const version of ['3.8.3', '3.8.7']) {
    test(`${version} onLoad material reconstruction uses real matching enabled material without changing requested active values`, () => {
        const sdk = `/Applications/Cocos/Creator/${version}/CocosCreator.app/Contents/Resources/resources/3d/engine`;
        const assets = ['actual-asset-uuid'];
        assert.deepEqual(ComponentPostProcessContext.patch(sdk, version, 'cc.BlitScreen', 'activeMaterials', assets),
            { materials: [{ material: 'actual-asset-uuid', enable: true }], activeMaterials: assets });
        assert.throws(() => ComponentPostProcessContext.patch(sdk, version, 'cc.BlitScreen', 'activeMaterials', []), /assets_missing/u);
        assert.throws(() => ComponentPostProcessContext.patch(sdk.replace('/' + version + '/', version === '3.8.3' ? '/3.8.7/' : '/3.8.3/'), version,
            'cc.BlitScreen', 'activeMaterials', assets), /source_mismatch/u);
    });
}
