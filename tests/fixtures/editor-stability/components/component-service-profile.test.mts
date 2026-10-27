import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ComponentServiceProfile } from './component-service-profile.mts';

const create = () => {
    const root = mkdtempSync('/private/tmp/pod-service-profile-'); const project = join(root, 'project');
    mkdirSync(join(project, 'settings'), { recursive: true }); return { root, project, path: join(project, 'settings/service.json') };
};

test('new isolated 3.8.7 project supplies only the SDK legacy empty-service migration input', () => {
    const f = create();
    try {
        ComponentServiceProfile.stage(f.project, '3.8.7'); ComponentServiceProfile.assertProject(f.project, '3.8.7');
        const legacy = JSON.parse(readFileSync(f.path, 'utf8'));
        assert.deepEqual(legacy.game, { app_id: 'UNKNOW', name: '', cid: '0' }); assert.deepEqual(legacy.configs[0].services, []);
        assert.equal(existsSync(join(f.project, 'settings/v2/packages/cocos-service.json')), false);
        const actual = { game: { app_id: 'UNKNOW', name: '', c_id: '0' }, configs: legacy.configs,
            appConfigMaps: [{ app_id: 'UNKNOW', config_id: legacy.configs[0].config_id }], cscv: '2.0.0' };
        ComponentServiceProfile.assertActive(actual, '3.8.7');
        for (const change of [
            (v: typeof actual) => { v.configs[0].services.push({ service_id: 'unexpected', enable: true }); },
            (v: typeof actual) => { v.game.app_id = 'real-account'; },
            (v: typeof actual) => { v.appConfigMaps[0]!.config_id = 'unmatched'; },
            (v: typeof actual) => { v.cscv = '1.0.0'; },
        ]) { const value = structuredClone(actual); change(value); assert.throws(() => ComponentServiceProfile.assertActive(value, '3.8.7'), /active_profile_mismatch/); }
        assert.throws(() => ComponentServiceProfile.assertActive(undefined, '3.8.7'), /active_profile_mismatch/);
        legacy.configs[0].services.push({ enable: true }); writeFileSync(f.path, JSON.stringify(legacy));
        assert.throws(() => ComponentServiceProfile.assertProject(f.project, '3.8.7'), /legacy_profile_mismatch/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('new isolated 3.8.3 project uses its separately verified SDK legacy empty-service migration input', () => {
    const f = create();
    try {
        ComponentServiceProfile.stage(f.project, '3.8.3'); ComponentServiceProfile.assertProject(f.project, '3.8.3');
        const legacy = JSON.parse(readFileSync(f.path, 'utf8'));
        assert.deepEqual(legacy.game, { app_id: 'UNKNOW', name: '', cid: '0' }); assert.deepEqual(legacy.configs[0].services, []);
        assert.equal(existsSync(join(f.project, 'settings/v2/packages/cocos-service.json')), false);
        const actual = { game: { app_id: 'UNKNOW', name: '', c_id: '0' }, configs: legacy.configs,
            appConfigMaps: [{ app_id: 'UNKNOW', config_id: legacy.configs[0].config_id }], cscv: '2.0.0' };
        ComponentServiceProfile.assertActive(actual, '3.8.3');
        for (const change of [
            (v: typeof actual) => { v.configs[0].services.push({ service_id: 'unexpected', enable: true }); },
            (v: typeof actual) => { v.game.app_id = 'real-account'; },
            (v: typeof actual) => { v.appConfigMaps[0]!.config_id = 'unmatched'; },
            (v: typeof actual) => { v.cscv = '1.0.0'; },
        ]) { const value = structuredClone(actual); change(value); assert.throws(() => ComponentServiceProfile.assertActive(value, '3.8.3'), /active_profile_mismatch/); }
        assert.throws(() => ComponentServiceProfile.assertActive(undefined, '3.8.3'), /active_profile_mismatch/);
        legacy.configs[0].services.push({ enable: true }); writeFileSync(f.path, JSON.stringify(legacy));
        assert.throws(() => ComponentServiceProfile.assertProject(f.project, '3.8.3'), /legacy_profile_mismatch/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('service staging refuses other versions, existing and dangling configurations, and started projects without overwrite', () => {
    for (const mode of ['version', 'existing', 'dangling', 'started', 'profile']) {
        const f = create();
        try {
            if (mode === 'existing') writeFileSync(f.path, 'preserve');
            if (mode === 'dangling') symlinkSync(join(f.root, 'absent'), f.path);
            if (mode === 'started') mkdirSync(join(f.project, 'library'));
            if (mode === 'profile') { mkdirSync(join(f.project, 'settings/v2/extensions'), { recursive: true }); writeFileSync(join(f.project, 'settings/v2/extensions/cocos-service.json'), '{}'); }
            assert.throws(() => ComponentServiceProfile.stage(f.project, mode === 'version' ? '3.9.0' : '3.8.7'), /component_service_/);
            if (mode === 'existing') assert.equal(readFileSync(f.path, 'utf8'), 'preserve');
            if (mode === 'dangling') assert.equal(existsSync(join(f.root, 'absent')), false);
            if (['version', 'started', 'profile'].includes(mode)) assert.equal(existsSync(f.path), false);
        } finally { rmSync(f.root, { recursive: true, force: true }); }
    }
});

test('service staging refuses linked settings rather than writing outside the new project', () => {
    const f = create();
    try {
        rmSync(join(f.project, 'settings'), { recursive: true }); const target = join(f.root, 'outside'); mkdirSync(target);
        symlinkSync(target, join(f.project, 'settings'));
        assert.throws(() => ComponentServiceProfile.stage(f.project, '3.8.7'), /settings_link_refused/);
        assert.equal(existsSync(join(target, 'service.json')), false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('existing project planning is read-only while the original new-project stage still refuses started projects', (t) => {
    const sdk = t.mock.method(ComponentServiceProfile, 'assertSdk', () => {});
    const f = create();
    try {
        mkdirSync(join(f.project, 'library')); mkdirSync(join(f.project, 'temp'));
        const plan = ComponentServiceProfile.planExisting('/repository', f.project, '/sdk/resources', '3.8.7');
        assert.equal(plan.relativePath, 'settings/service.json'); assert.equal(plan.expectedAbsent, true);
        assert.equal(plan.executable, false); assert.equal(plan.absentPaths.length, 6);
        const value = JSON.parse(plan.bytes.toString()); assert.deepEqual(value.configs[0].services, []);
        assert.equal(existsSync(f.path), false); assert.equal(sdk.mock.calls.length, 1);
        assert.throws(() => ComponentServiceProfile.stage(f.project, '3.8.7'), /already_started/u);
        assert.equal(existsSync(f.path), false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('existing planning refuses every old or new service location, dangling links and SDK drift without overwriting', (t) => {
    t.mock.method(ComponentServiceProfile, 'assertSdk', () => {});
    for (const relative of ['settings/service.json', 'settings/v2/extensions/cocos-service.json',
        'settings/v2/packages/cocos-service.json', 'profiles/service.json',
        'profiles/v2/extensions/cocos-service.json', 'profiles/v2/packages/cocos-service.json']) {
        const f = create();
        try {
            const path = join(f.project, relative); mkdirSync(join(path, '..'), { recursive: true });
            writeFileSync(path, 'preserve existing account or service data');
            assert.throws(() => ComponentServiceProfile.planExisting('/repository', f.project, '/sdk/resources', '3.8.7'), /existing_config_refused/u);
            assert.equal(readFileSync(path, 'utf8'), 'preserve existing account or service data');
        } finally { rmSync(f.root, { recursive: true, force: true }); }
    }
    const f = create();
    try {
        symlinkSync(join(f.root, 'missing'), f.path);
        assert.throws(() => ComponentServiceProfile.planExisting('/repository', f.project, '/sdk/resources', '3.8.7'), /existing_config_refused/u);
        assert.equal(existsSync(join(f.root, 'missing')), false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
    t.mock.method(ComponentServiceProfile, 'assertSdk', () => { throw new Error('component_service_sdk_source_mismatch'); });
    const drift = create();
    try {
        assert.throws(() => ComponentServiceProfile.planExisting('/repository', drift.project, '/sdk/resources', '3.8.7'), /sdk_source_mismatch/u);
        assert.equal(existsSync(drift.path), false);
    } finally { rmSync(drift.root, { recursive: true, force: true }); }
});
