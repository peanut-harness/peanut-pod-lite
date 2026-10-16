import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { ComponentSdkWindowDiagnostics } from './component-sdk-window-diagnostics.ts';

test('fixed main-window inspection reads SDK callback text without executing callbacks or getters', () => {
    let calls = 0;
    const ready = () => { calls++; const label = 'main-window:ready'; void label; };
    const handlers = { _events: { 'scene:ready': [ready] } };
    Object.defineProperty(handlers, 'secret', { get: () => { throw Error('getter called'); } });
    const result: any = runInNewContext(ComponentSdkWindowDiagnostics.rendererSource(), {
        require: { cache: {} }, Editor: { Message: { __protected__: { __eb__: handlers } } },
    });
    assert.equal(result.complete, true); assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].source, ready.toString()); assert.equal(calls, 0);
});

test('window inspection selects exactly the current SDK main window and refuses other versions or ambiguous ownership', async () => {
    const app = '/Applications/Cocos/Creator/3.8.7/CocosCreator.app'; let calls = 0;
    const contents = { id: 3, getURL: () => 'file://' + app + '/Contents/Resources/app.asar/node_modules/@editor/creator/static/windows/main.html',
        isDestroyed: () => false, executeJavaScript: async (source: string, userGesture: boolean) => {
            calls++; assert.equal(source, ComponentSdkWindowDiagnostics.rendererSource()); assert.equal(userGesture, false); return { complete: true };
        } };
    const electron = { BrowserWindow: { getAllWindows: () => [{ webContents: contents }] } };
    assert.deepEqual(await ComponentSdkWindowDiagnostics.read(electron, app, '3.8.7'), { webContentsId: 3, guestViewHandlers: [
        { channel: 'GUEST_VIEW_MANAGER_CALL', present: false, source: null },
        { channel: 'GUEST_VIEW_MANAGER_SYNC_CALL', present: false, source: null }], observation: { complete: true } });
    await ComponentSdkWindowDiagnostics.read(electron, app, '3.8.3');
    await assert.rejects(ComponentSdkWindowDiagnostics.read(electron, app, '3.9.0'), /version_unverified/u);
    await assert.rejects(ComponentSdkWindowDiagnostics.read(electron, app + '-other', '3.8.7'), /identity_invalid/u);
    electron.BrowserWindow.getAllWindows = () => [{ webContents: contents }, { webContents: contents }];
    await assert.rejects(ComponentSdkWindowDiagnostics.read(electron, app, '3.8.7'), /identity_invalid/u); assert.equal(calls, 2);
});
