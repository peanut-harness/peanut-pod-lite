import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { load, unload } from './component-native-main.ts';
import { ComponentProjectUrlFiles } from './component-project-url-files.ts';

test('authenticated health reads actual project engine modules through getProject without modifying configuration', async () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/u, '');
    const output = mkdtempSync('/private/tmp/pod-native-main-health-'); const project = join(output, 'project');
    mkdirSync(join(project, 'extensions/peanut-component-probe'), { recursive: true });
    const identity = { task: '5.1', projectPath: project, owner: 'offline-test', runId: 'health-test', candidateSourceCommit: 'offline-test' };
    writeFileSync(join(output, 'project-ownership.json'), JSON.stringify(identity)); ComponentProjectUrlFiles.stage(root, project, identity);
    const expected = { configs: { defaultConfig: { includeModules: ['sorting-2d'], flags: {} } }, globalConfigKey: 'defaultConfig' };
    const calls: string[] = []; const prior = Reflect.get(globalThis, 'Editor');
    Reflect.set(globalThis, 'Editor', { Project: { path: project }, App: { version: '3.8.7' },
        Message: { request: async (target: string, message: string) => {
            assert.equal(target, 'peanut-pod-lite-host'); assert.equal(message, 'query-status'); return { ready: true };
        } }, Profile: {
            getProject: async (name: string, key: string) => { calls.push('project:' + name + ':' + key);
                if (name === 'cocos-service') return key === 'cscv' ? '2.0.0' : null;
                return key === 'macroConfig' ? { CUSTOM_PIPELINE_NAME: 'Forward' } : expected; },
            getConfig: async (name: string, key?: string) => { calls.push('editor:' + name + ':' + key); return {}; },
        } });
    try {
        load(); const path = join(project, '.peanut-ai/component-probe.json'); const until = Date.now() + 2000;
        while (!existsSync(path)) { if (Date.now() >= until) throw Error('test_probe_listen_timeout'); await new Promise(done => setTimeout(done, 10)); }
        const descriptor = JSON.parse(readFileSync(path, 'utf8'));
        const response = await fetch(`http://127.0.0.1:${descriptor.port}/probe`, { method: 'POST',
            headers: { 'content-type': 'application/json', 'x-component-token': descriptor.token }, body: JSON.stringify({ action: 'health' }) });
        const payload = await response.json(); assert.equal(payload.ok, true);
        assert.deepEqual(payload.result.engineModulesProfile, expected);
        assert.deepEqual(payload.result.serviceConfigProfile, { game: null, configs: null, appConfigMaps: null, cscv: '2.0.0' });
        assert.equal(calls.filter(call => call.startsWith('project:cocos-service:')).length, 4);
        assert.deepEqual(payload.result.engineMacroProfile, { CUSTOM_PIPELINE_NAME: 'Forward' });
        assert.equal(calls.filter(call => call === 'project:engine:macroConfig').length, 1);
        assert.equal(calls.filter(call => call === 'project:engine:modules').length, 1);
        assert.equal(calls.includes('editor:engine:modules'), false); assert(calls.every(call => !call.includes('set')));
    } finally { unload(); if (prior === undefined) Reflect.deleteProperty(globalThis, 'Editor'); else Reflect.set(globalThis, 'Editor', prior); rmSync(output, { recursive: true, force: true }); }
});
