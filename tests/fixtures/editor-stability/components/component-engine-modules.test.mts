import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ComponentEngineModules } from './component-engine-modules.mts';

const create = () => {
    const root = mkdtempSync('/private/tmp/pod-engine-modules-'); const project = join(root, 'project'); const engine = join(root, 'sdk');
    mkdirSync(join(project, 'settings/v2/packages'), { recursive: true }); mkdirSync(engine);
    const path = join(project, 'settings/v2/packages/engine.json');
    writeFileSync(path, JSON.stringify({ __version__: '1.0.12', fixtureControl: true }));
    // 合成SDK仅测试版本与功能契约拒绝，实际SDK和画面证据另存，不冒充原生验证。
    writeFileSync(join(engine, 'package.json'), JSON.stringify({ version: '3.8.7' }));
    const config = { features: { 'sorting-2d': { modules: ['sorting-2d'], dependentModules: ['2d'],
        overrideConstants: { USE_SORTING_2D: true } } }, constants: { USE_SORTING_2D: { value: false } } };
    writeFileSync(join(engine, 'cc.config.json'), JSON.stringify(config));
    return { root, project, engine, path, config };
};

test('3.8.7 matrix stages the official single-feature profile without changing engine choice or enabling unrelated backends', () => {
    const f = create();
    try {
        ComponentEngineModules.stage(f.project, f.engine, '3.8.7'); ComponentEngineModules.assertProject(f.project, '3.8.7');
        const settings = JSON.parse(readFileSync(f.path, 'utf8')); const modules = settings.modules;
        assert.equal(settings.__version__, '1.0.12'); assert.equal(settings.fixtureControl, true); assert.equal(settings.engine, undefined);
        assert.equal(modules.globalConfigKey, 'defaultConfig');
        const config = modules.configs.defaultConfig; assert(config.includeModules.includes('sorting-2d'));
        assert.equal(config.cache['sorting-2d']._value, true);
        for (const key of ['physics-physx', 'xr', 'procedural-animation', 'custom-pipeline-post-process']) assert.equal(config.cache[key]._value, false);
        assert.deepEqual(config.flags, { LOAD_SPINE_MANUALLY: false, LOAD_BULLET_MANUALLY: false });
        const effective = { ...modules, graphics: { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': false } };
        ComponentEngineModules.assertActive(effective, '3.8.7');
        const reordered = Object.fromEntries(Object.entries(effective).reverse()); ComponentEngineModules.assertActive(reordered, '3.8.7');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('module preflight refuses missing sorting, wrong active config and broader feature or load-flag changes', () => {
    const f = create();
    try {
        ComponentEngineModules.stage(f.project, f.engine, '3.8.7'); const before = readFileSync(f.path);
        const original = { ...JSON.parse(before.toString()).modules,
            graphics: { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': false } };
        for (const change of [
            (m: ReturnType<typeof JSON.parse>) => { m.configs.defaultConfig.includeModules = m.configs.defaultConfig.includeModules.filter((key: string) => key !== 'sorting-2d'); },
            (m: ReturnType<typeof JSON.parse>) => { m.configs.defaultConfig.cache['sorting-2d']._value = false; },
            (m: ReturnType<typeof JSON.parse>) => { m.configs.defaultConfig.includeModules.push('physics-physx'); },
            (m: ReturnType<typeof JSON.parse>) => { m.configs.defaultConfig.flags.LOAD_BULLET_MANUALLY = true; },
            (m: ReturnType<typeof JSON.parse>) => { m.globalConfigKey = 'other'; },
            (m: ReturnType<typeof JSON.parse>) => { delete m.graphics; },
            (m: ReturnType<typeof JSON.parse>) => { m.graphics.pipeline = 'legacy-pipeline'; },
            (m: ReturnType<typeof JSON.parse>) => { m.graphics['custom-pipeline-post-process'] = true; },
            (m: ReturnType<typeof JSON.parse>) => { m.graphics.unexpected = true; },
            (m: ReturnType<typeof JSON.parse>) => { m.unexpected = true; },
        ]) {
            const value = structuredClone(original); change(value);
            assert.throws(() => ComponentEngineModules.assertActive(value, '3.8.7'), /active_profile_mismatch/);
        }
        assert.throws(() => ComponentEngineModules.assertActive(undefined, '3.8.7'), /active_profile_mismatch/);
        writeFileSync(f.path, JSON.stringify({ ...JSON.parse(before.toString()), modules: original }));
        assert.throws(() => ComponentEngineModules.assertProject(f.project, '3.8.7'), /project_profile_mismatch/);
        writeFileSync(f.path, before);
        assert.deepEqual(readFileSync(f.path), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('official empty-template settings without engine.json acquire an exclusive project module file', () => {
    const f = create();
    try {
        rmSync(f.path); assert.throws(() => ComponentEngineModules.assertProject(f.project, '3.8.7'), /settings_missing/);
        ComponentEngineModules.stage(f.project, f.engine, '3.8.7'); ComponentEngineModules.assertProject(f.project, '3.8.7');
        const settings = JSON.parse(readFileSync(f.path, 'utf8'));
        assert.equal(settings.__version__, '1.0.12'); assert.equal(settings.modules.configs.defaultConfig.cache['sorting-2d']._value, true);
        const before = readFileSync(f.path);
        assert.throws(() => ComponentEngineModules.stage(f.project, f.engine, '3.8.7'), /existing_config_refused/);
        assert.deepEqual(readFileSync(f.path), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('missing-file creation refuses linked parent directories and dangling file links without writing targets', () => {
    const f = create();
    try {
        rmSync(f.path); const target = join(f.root, 'absent.json'); symlinkSync(target, f.path);
        assert.throws(() => ComponentEngineModules.stage(f.project, f.engine, '3.8.7'), /settings_link/);
        assert.equal(existsSync(target), false); rmSync(f.path);
        const parent = join(f.project, 'settings/v2/packages'); rmSync(parent, { recursive: true });
        const linked = join(f.root, 'linked-packages'); mkdirSync(linked); symlinkSync(linked, parent);
        assert.throws(() => ComponentEngineModules.stage(f.project, f.engine, '3.8.7'), /settings_link/);
        assert.equal(existsSync(join(linked, 'engine.json')), false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('module staging refuses incompatible SDK, existing settings, linked settings and already-started projects before writing', () => {
    const f = create();
    try {
        const before = readFileSync(f.path);
        f.config.features['sorting-2d'].overrideConstants.USE_SORTING_2D = false;
        writeFileSync(join(f.engine, 'cc.config.json'), JSON.stringify(f.config));
        assert.throws(() => ComponentEngineModules.stage(f.project, f.engine, '3.8.7'), /sdk_contract_invalid/);
        assert.deepEqual(readFileSync(f.path), before);
        f.config.features['sorting-2d'].overrideConstants.USE_SORTING_2D = true; writeFileSync(join(f.engine, 'cc.config.json'), JSON.stringify(f.config));
        ComponentEngineModules.stage(f.project, f.engine, '3.8.7'); const staged = readFileSync(f.path);
        assert.throws(() => ComponentEngineModules.stage(f.project, f.engine, '3.8.7'), /existing_config_refused/); assert.deepEqual(readFileSync(f.path), staged);
        rmSync(f.path); const linked = join(f.root, 'linked.json'); writeFileSync(linked, before); symlinkSync(linked, f.path);
        assert.throws(() => ComponentEngineModules.stage(f.project, f.engine, '3.8.7'), /settings_link/); assert.deepEqual(readFileSync(linked), before);
        rmSync(f.path); writeFileSync(f.path, before); writeFileSync(join(f.root, 'creator-owned-start.json'), '{}');
        assert.throws(() => ComponentEngineModules.stage(f.project, f.engine, '3.8.7'), /already_started/); assert.deepEqual(readFileSync(f.path), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('3.8.3 retains its original settings and unknown versions do not acquire guessed sorting support', () => {
    const f = create();
    try {
        const before = readFileSync(f.path); ComponentEngineModules.stage(f.project, f.engine, '3.8.3');
        ComponentEngineModules.assertProject(f.project, '3.8.3'); ComponentEngineModules.assertActive(undefined, '3.8.3');
        assert.deepEqual(readFileSync(f.path), before);
        assert.throws(() => ComponentEngineModules.stage(f.project, f.engine, '3.8.4'), /version_unsupported/);
        assert.throws(() => ComponentEngineModules.assertActive(undefined, '3.8.4'), /version_unsupported/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});
