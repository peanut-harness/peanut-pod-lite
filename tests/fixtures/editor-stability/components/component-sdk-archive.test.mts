import assert from 'node:assert/strict';
import test from 'node:test';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ComponentSdkArchive } from './component-sdk-archive.mts';
test('raw ASAR uses only supplied read-only FS port including header, payload, stat and close', () => {
    const resources = '/Applications/Cocos/Creator/3.8.3/CocosCreator.app/Contents/Resources';
    const calls = { open: 0, read: 0, stat: 0, close: 0 };
    const bytes = ComponentSdkArchive.read(resources, 'app-lifecycle', {
        openSync: (...args: Parameters<typeof openSync>) => { calls.open++; return openSync(...args); },
        readSync: new Proxy(readSync, { apply(target, receiver, args) { calls.read++; return Reflect.apply(target, receiver, args); } }),
        fstatSync: new Proxy(fstatSync, { apply(target, receiver, args) { calls.stat++; return Reflect.apply(target, receiver, args); } }),
        closeSync: fd => { calls.close++; closeSync(fd); },
    });
    assert.equal(createHash('sha256').update(bytes).digest('hex'), 'cf93cef51b13e8d5a6dd1929656379aed76144a9bc86467d85a0df3b994f23ea');
    assert.equal(calls.open, 1); assert(calls.read >= 3); assert.equal(calls.stat, 1); assert.equal(calls.close, 1);
});
