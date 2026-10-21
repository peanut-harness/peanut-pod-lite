import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { ComponentSdkSceneCacheCompat } from './component-sdk-scene-cache-compat.ts';

const proof = JSON.parse(readFileSync(new URL('./3.8.3/sdk-scene-cache-compat-source.json', import.meta.url), 'utf8'));
const project = '/project'; const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/**
 * @description 运行冻结的真实SDK原方法，仅替换其消息与删除IO；不会访问或修改实际缓存。
 */
function sdk() {
    const removed: string[] = []; let removalFailure: Error | null = null;
    const context = { path_1: { join }, SCENE_CACHE_DIR: join(project, 'temp/scene/cache'), UnSaveSceneId: 'unSave',
        safeRemove: async (path: string) => { if (removalFailure) throw removalFailure; removed.push(path); },
        getCacheDirWithId: (id: string) => join(project, 'temp/scene/cache', id),
        Editor: { Message: { request: async (channel: string) => channel === 'scene' ? uuid : { visible: true } } } };
    const methods = runInNewContext('({' + ['clearSceneCache', 'getCurrentSceneUUID', 'getCurrentCacheID', 'onSceneReady']
        .map(name => proof.methods[name].source).join(',') + '})', context);
    const manager = Object.assign(Object.create(methods), { disabled: false, _currentSceneUUID: uuid, _unSaveSceneUUID: '',
        cacheTimerList: { [uuid]: [1] }, cacheJsonList: { [uuid]: { real: true } } });
    const namespace = { sceneCacheManager: manager, getCachePath: runInNewContext('(' + proof.methods.getCachePath.source + ')', context) };
    return { namespace, manager, removed, fail: (error: Error) => { removalFailure = error; } };
}

test('absent cache cleanup preserves exact SDK memory cleanup without invoking deletion; restored original still owns existing-cache deletion and errors', async () => {
    const instance = sdk(); const original = instance.manager.clearSceneCache;
    const patch = ComponentSdkSceneCacheCompat.install(instance.namespace, project, '3.8.3', () => {}, () => false);
    await instance.manager.clearSceneCache(uuid);
    assert.equal(patch.state.absentCleared, 1); assert.equal(patch.state.originalDelegated, 0); assert.deepEqual(instance.removed, []);
    assert.equal(instance.manager.cacheTimerList[uuid], undefined); assert.equal(instance.manager.cacheJsonList[uuid], undefined);
    assert.equal(instance.manager._currentSceneUUID, ''); assert.equal(patch.isInstalled(), true);
    patch.restore(); assert.equal(instance.manager.clearSceneCache, original);
    const existing = ComponentSdkSceneCacheCompat.install(instance.namespace, project, '3.8.3', () => {}, () => true);
    await instance.manager.clearSceneCache(uuid);
    assert.deepEqual(instance.removed, [join(project, 'temp/scene/cache', uuid)]); assert.equal(existing.state.originalDelegated, 1);
    const error = new Error('EACCES real SDK removal failure'); instance.fail(error);
    await assert.rejects(instance.manager.clearSceneCache(uuid), value => value === error);
    existing.restore();
});

test('unknown source/version/project and non-ENOENT IO failures remain visible; disabled caching keeps SDK no-op behavior', async () => {
    const instance = sdk(); const original = instance.manager.clearSceneCache;
    assert.throws(() => ComponentSdkSceneCacheCompat.install(instance.namespace, project, '3.8.7'), /version_unverified/u);
    assert.throws(() => ComponentSdkSceneCacheCompat.install(instance.namespace, '/other', '3.8.3'), /project_scope_mismatch/u);
    assert.equal(instance.manager.clearSceneCache, original);
    const changed = sdk(); changed.manager.getCurrentCacheID = () => uuid;
    assert.throws(() => ComponentSdkSceneCacheCompat.install(changed.namespace, project, '3.8.3'), /source_mismatch:getCurrentCacheID/u);
    const error = new Error('EACCES lstat failure');
    const patch = ComponentSdkSceneCacheCompat.install(instance.namespace, project, '3.8.3', () => {}, () => { throw error; });
    await assert.rejects(instance.manager.clearSceneCache(uuid), value => value === error);
    assert.equal(patch.state.absentCleared, 0); assert.equal(instance.manager._currentSceneUUID, uuid);
    instance.manager.disabled = true; await instance.manager.clearSceneCache(uuid);
    assert.equal(patch.state.absentCleared, 0); patch.restore();
});
