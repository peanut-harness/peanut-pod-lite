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
        overrideConstants: { USE_SORTING_2D: true } }, 'custom-pipeline-post-process': {
        modules: ['custom-pipeline-post-process'], dependentModules: ['custom-pipeline'] } }, constants: { USE_SORTING_2D: { value: false } } };
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

test('post-process context adds only its declared SDK feature and requires the matching effective graphics profile', () => {
    const f = create();
    try {
        ComponentEngineModules.stage(f.project, f.engine, '3.8.7', 'post-process');
        ComponentEngineModules.assertProject(f.project, '3.8.7', 'post-process');
        const modules = JSON.parse(readFileSync(f.path, 'utf8')).modules;
        const macros = JSON.parse(readFileSync(f.path, 'utf8')).macroConfig;
        assert.deepEqual(macros, { CUSTOM_PIPELINE_NAME: 'Forward' });
        ComponentEngineModules.assertMacros(macros, '3.8.7', 'post-process');
        assert.throws(() => ComponentEngineModules.assertMacros({}, '3.8.7', 'post-process'), /macro_profile_mismatch/);
        assert.throws(() => ComponentEngineModules.assertMacros({ ...macros, other: true }, '3.8.7', 'post-process'), /macro_profile_mismatch/);
        assert.throws(() => ComponentEngineModules.assertMacros(macros, '3.8.7'), /macro_profile_mismatch/);
        const baseline = JSON.parse(readFileSync(new URL('./3.8.7/engine-modules-sorting2d.json', import.meta.url), 'utf8')).modules;
        assert.deepEqual(modules.configs.defaultConfig.includeModules.filter((key: string) => key !== 'custom-pipeline-post-process'),
            baseline.configs.defaultConfig.includeModules);
        const cache = modules.configs.defaultConfig.cache;
        assert.deepEqual(modules.graphics, { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': true });
        assert.equal(cache['custom-pipeline-post-process']._value, true);
        assert.equal(cache['physics-physx']._value, false); assert.equal(cache.xr._value, false);
        const effective = { ...modules, graphics: { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': true } };
        ComponentEngineModules.assertActive(effective, '3.8.7', 'post-process');
        assert.throws(() => ComponentEngineModules.assertActive(effective, '3.8.7'), /active_profile_mismatch/);
        assert.throws(() => ComponentEngineModules.assertProject(f.project, '3.8.7'), /project_profile_mismatch/);
        effective.graphics['custom-pipeline-post-process'] = false;
        assert.throws(() => ComponentEngineModules.assertActive(effective, '3.8.7', 'post-process'), /active_profile_mismatch/);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('unproven post-process versions, missing SDK dependencies and undeclared contexts fail before writing', () => {
    const f = create();
    try {
        const before = readFileSync(f.path);
        assert.throws(() => ComponentEngineModules.stage(f.project, f.engine, '3.8.3', 'post-process'), /post_version_unverified/);
        f.config.features['custom-pipeline-post-process'].dependentModules = [];
        writeFileSync(join(f.engine, 'cc.config.json'), JSON.stringify(f.config));
        assert.throws(() => ComponentEngineModules.stage(f.project, f.engine, '3.8.7', 'post-process'), /post_sdk_contract_invalid/);
        assert.throws(() => ComponentEngineModules.context('all'), /context_invalid/);
        assert.throws(() => ComponentEngineModules.context({}), /context_invalid/);
        assert.deepEqual(readFileSync(f.path), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('effective macro profile requires all exact SDK defaults while disk profile permits only explicit overrides', () => {
    const defaults = JSON.parse(readFileSync(new URL('./3.8.7/engine-macro-defaults.json', import.meta.url), 'utf8')).macroConfig;
    ComponentEngineModules.assertActiveMacros(defaults, '3.8.7');
    const active = { ...defaults, CUSTOM_PIPELINE_NAME: 'Forward' };
    ComponentEngineModules.assertActiveMacros(active, '3.8.7', 'post-process');
    ComponentEngineModules.assertMacros({ CUSTOM_PIPELINE_NAME: 'Forward' }, '3.8.7', 'post-process');
    assert.throws(() => ComponentEngineModules.assertMacros(active, '3.8.7', 'post-process'), /macro_profile_mismatch/);
    for (const value of [{}, { ...active, unexpected: true }, { ...active, ENABLE_FLOAT_OUTPUT: true },
        { ...active, TOUCH_TIMEOUT: 0 }, { ...active, CUSTOM_PIPELINE_NAME: 'Builtin' }])
        assert.throws(() => ComponentEngineModules.assertActiveMacros(value, '3.8.7', 'post-process'), /active_macro_profile_mismatch/);
    const missing = { ...active }; delete missing.ENABLE_TILEDMAP_CULLING;
    assert.throws(() => ComponentEngineModules.assertActiveMacros(missing, '3.8.7', 'post-process'), /active_macro_profile_mismatch/);
});

test('character context selects only PhysX instead of Bullet and keeps unrelated modules and automatic loading intact', () => {
    const f = create();
    try {
        Object.assign(f.config.features, { 'physics-physx': { modules: ['physics-physx', 'physics-framework'] } });
        Object.assign(f.config.constants, { LOAD_PHYSX_MANUALLY: { value: false } });
        writeFileSync(join(f.engine, 'cc.config.json'), JSON.stringify(f.config));
        ComponentEngineModules.stage(f.project, f.engine, '3.8.7', 'character-physx');
        ComponentEngineModules.assertProject(f.project, '3.8.7', 'character-physx');
        const modules = JSON.parse(readFileSync(f.path, 'utf8')).modules; const config = modules.configs.defaultConfig;
        const baseline = JSON.parse(readFileSync(new URL('./3.8.7/engine-modules-sorting2d.json', import.meta.url), 'utf8')).modules.configs.defaultConfig;
        assert.deepEqual(config.includeModules.filter((name: string) => name !== 'physics-physx'),
            baseline.includeModules.filter((name: string) => name !== 'physics-ammo'));
        const expected = structuredClone(baseline); expected.cache.physics._option = 'physics-physx';
        expected.cache['physics-ammo']._value = false; expected.cache['physics-physx']._value = true;
        expected.flags.LOAD_PHYSX_MANUALLY = false; expected.includeModules = config.includeModules;
        assert.deepEqual(config, expected);
        const active = { ...modules, graphics: { pipeline: 'custom-pipeline', 'custom-pipeline-post-process': false } };
        ComponentEngineModules.assertActive(active, '3.8.7', 'character-physx');
        ComponentEngineModules.assertMacros({ CUSTOM_PIPELINE_NAME: 'Builtin' }, '3.8.7', 'character-physx');
        assert.throws(() => ComponentEngineModules.assertMacros(undefined, '3.8.7', 'character-physx'), /macro_profile_mismatch/u);
        assert.throws(() => ComponentEngineModules.assertActive(active, '3.8.7'), /active_profile_mismatch/u);
        active.configs.defaultConfig.flags.LOAD_PHYSX_MANUALLY = true;
        assert.throws(() => ComponentEngineModules.assertActive(active, '3.8.7', 'character-physx'), /active_profile_mismatch/u);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('PhysX context rejects unverified versions and missing SDK prerequisites without touching project settings', () => {
    const f = create();
    try {
        const before = readFileSync(f.path);
        assert.throws(() => ComponentEngineModules.stage(f.project, f.engine, '3.8.3', 'character-physx'), /physx_version_unverified/u);
        assert.throws(() => ComponentEngineModules.stage(f.project, f.engine, '3.8.7', 'character-physx'), /physx_sdk_contract_invalid/u);
        assert.deepEqual(readFileSync(f.path), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
});
