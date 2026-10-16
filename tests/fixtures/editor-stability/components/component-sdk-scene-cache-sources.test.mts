import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentSdkSceneCacheSources } from './component-sdk-scene-cache-sources.ts';

test('fixed cache-source diagnostics never call SDK methods/getters or inspect unrelated modules', () => {
    let calls = 0;
    class Cache {
        clearSceneCache(): void { calls++; }
        saveSceneCache(): void { calls++; }
        get privateState(): never { throw Error('getter invoked'); }
    }
    const exported = { default: new Cache() };
    Object.defineProperty(exported, 'secret', { get: () => { throw Error('export getter invoked'); } });
    const unrelated = {};
    Object.defineProperty(unrelated, 'exports', { get: () => { throw Error('unrelated module invoked'); } });
    const result = JSON.parse(JSON.stringify(ComponentSdkSceneCacheSources.read({
        '/sdk/app.asar/builtin/scene/dist/browser/scene-cache.ccc': { exports: exported }, '/other': unrelated,
    })));
    assert.equal(result.length, 1);
    assert.equal(result[0].module, 'builtin/scene/dist/browser/scene-cache.ccc');
    assert.deepEqual(result[0].methods.map((method: { name: string }) => method.name).sort(), ['clearSceneCache', 'saveSceneCache']);
    assert.equal(calls, 0);
    assert.deepEqual(ComponentSdkSceneCacheSources.read({ '/unloaded': unrelated }), []);
});
