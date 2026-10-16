import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ComponentEngineContext383 as Context } from './component-engine-context-383.mts';
import { ComponentEngineModules } from './component-engine-modules.mts';
const sdk = '/Applications/Cocos/Creator/3.8.3/CocosCreator.app/Contents/Resources/resources/3d/engine';
for (const context of ['post-process', 'character-physx'] as const) {
    test(`3.8.3 ${context} stages independently pinned SDK profile and refuses drift, existing settings or late mutation`, () => {
        const root = mkdtempSync('/private/tmp/pod-context383-'); const project = join(root, 'project'); mkdirSync(join(project, 'settings/v2/packages'), { recursive: true });
        const path = join(project, 'settings/v2/packages/engine.json');
        try {
            ComponentEngineModules.stage(project, sdk, '3.8.3', context);
            const bytes = readFileSync(path); const settings = JSON.parse(bytes.toString('utf8'));
            assert.equal(settings.__version__, '1.0.9'); assert.equal('configs' in settings.modules, false);
            ComponentEngineModules.assertProject(project, '3.8.3', context);
            ComponentEngineModules.assertActive(settings.modules, '3.8.3', context);
            ComponentEngineModules.assertActiveMacros(Context.macros(context, true), '3.8.3', context);
            assert.equal(settings.modules.includeModules.includes('sorting-2d'), false);
            const changed = structuredClone(settings.modules); changed.includeModules.push('all');
            assert.throws(() => ComponentEngineModules.assertActive(changed, '3.8.3', context), /modules_mismatch/u);
            assert.throws(() => ComponentEngineModules.assertActiveMacros({ ...Context.macros(context, true), CUSTOM_PIPELINE_NAME: 'Forward' }, '3.8.3', context), /active-macros_mismatch/u);
            assert.throws(() => ComponentEngineModules.stage(project, sdk, '3.8.3', context), /existing_config_refused/u);
            assert.deepEqual(readFileSync(path), bytes); mkdirSync(join(project, 'library'));
            assert.throws(() => ComponentEngineModules.stage(project, sdk, '3.8.3', context), /already_started/u);
            assert.deepEqual(readFileSync(path), bytes);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}
test('3.8.7 SDK cannot stage a 3.8.3 context or create guessed configuration', () => {
    const root = mkdtempSync('/private/tmp/pod-context383-wrong-sdk-'); const project = join(root, 'project'); mkdirSync(join(project, 'settings/v2/packages'), { recursive: true });
    try {
        assert.throws(() => ComponentEngineModules.stage(project, sdk.replace('/3.8.3/', '/3.8.7/'), '3.8.3', 'post-process'), /sdk_source_mismatch/u);
        assert.equal(existsSync(join(project, 'settings/v2/packages/engine.json')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
