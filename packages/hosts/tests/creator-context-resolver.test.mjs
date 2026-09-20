import assert from 'node:assert/strict';
import test from 'node:test';

import { CreatorContextResolver, CreatorProcessDiscovery } from '../dist/index.js';

test('resolves the four Creator compatibility profiles', () => {
    assert.equal(CreatorContextResolver.resolve('2.4.11').profileId, 'creator-24');
    assert.equal(CreatorContextResolver.resolve('3.5.2').profileId, 'creator-30-35');
    assert.equal(CreatorContextResolver.resolve('3.7.4').profileId, 'creator-36-37');
    assert.equal(CreatorContextResolver.resolve('3.8.7').profileId, 'creator-38');
});

test('only exact host and project evidence enables writes', () => {
    assert.equal(CreatorContextResolver.resolve('3.8.3', '3.8.3').writesAllowed, true);
    assert.equal(CreatorContextResolver.resolve('3.8.7', '3.8.7').writesAllowed, true);
    assert.equal(CreatorContextResolver.resolve('3.8.7').writesAllowed, false);
    assert.equal(CreatorContextResolver.resolve('3.8.6', '3.8.6').writesAllowed, false);
    assert.equal(CreatorContextResolver.resolve('3.8.7', '3.8.6').writesAllowed, false);
    assert.equal(CreatorContextResolver.resolve('3.7.4').writesAllowed, false);
});

test('missing, malformed, and unsupported versions fail closed', () => {
    assert.throws(() => CreatorContextResolver.resolve(''), /creator_version_unavailable/);
    assert.throws(() => CreatorContextResolver.resolve('3.8'), /creator_version_invalid/);
    assert.throws(() => CreatorContextResolver.resolve('3.8.7-beta.1'), /creator_version_invalid/);
    assert.throws(() => CreatorContextResolver.resolve('Creator 3.8.7'), /creator_version_invalid/);
    assert.throws(() => CreatorContextResolver.resolve('3.9.0'), /unsupported_cocos_creator_version/);
});

test('discovers exact Windows project processes without matching path prefixes', () => {
    const projectPath = 'D:\\workspaces\\demo project';
    const processList = [
        `111 C:\\ProgramData\\cocos\\editors\\Creator\\3.8.7\\CocosCreator.exe --nologin --project "${projectPath}"`,
        `222 C:\\ProgramData\\cocos\\editors\\Creator\\3.8.7\\CocosCreator.exe --project "${projectPath}-copy"`,
        `333 C:\\ProgramData\\cocos\\editors\\Creator\\3.8.7\\CocosCreator.exe --type=renderer --project "${projectPath}"`,
    ].join('\n');

    assert.deepEqual(CreatorProcessDiscovery.parseProjectProcessIds(processList, projectPath, 'win32'), [111]);
});

test('uses exact macOS paths and every supported binary override', () => {
    const projectPath = '/Users/peanut/Game Project';
    const processList = [
        `41 /Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/MacOS/CocosCreator --project="${projectPath}"`,
        '42 /Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/MacOS/CocosCreator --project="/Users/peanut/game project"',
    ].join('\n');

    assert.deepEqual(CreatorProcessDiscovery.parseProjectProcessIds(processList, projectPath, 'darwin'), [41]);
    assert.equal(CreatorProcessDiscovery.resolveDefaultBinary('win32', { COCOS_CREATOR_APP: ' explicit.exe ' }), 'explicit.exe');
    assert.equal(CreatorProcessDiscovery.resolveDefaultBinary('win32', { PEANUT_COCOS_CREATOR_BIN: 'peanut.exe' }), 'peanut.exe');
    assert.equal(CreatorProcessDiscovery.resolveDefaultBinary('darwin', { COCOS_CREATOR_PATH: '/custom/Creator' }), '/custom/Creator');
    assert.match(CreatorProcessDiscovery.resolveDefaultBinary('win32', {}), /CocosCreator\.exe$/u);
    assert.match(CreatorProcessDiscovery.resolveDefaultBinary('darwin', {}), /MacOS\/CocosCreator$/u);
    assert.throws(() => CreatorProcessDiscovery.resolveDefaultBinary('win32', {}, '../3.8.7'), /creator_binary_version_invalid/);
});
