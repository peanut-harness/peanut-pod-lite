import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ComponentStartupScene } from './component-startup-scene.mts';
import { ComponentFieldFixtures } from './component-field-fixtures.mts';
import { ComponentSceneFixture } from './component-scene-fixture.mts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const proof = JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/components/3.8.3/startup-scene-profile-provenance.json'), 'utf8'));
const sdkContract = { sha256: proof.sha256, projectCurrentScene: proof.projectCurrentScene };

test('startup input is an actual saved same-version control scene; SDK drift and existing settings reject before overwrite', () => {
    const output = mkdtempSync('/private/tmp/pod-startup-scene-'); const project = join(output, 'project');
    const audit = JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/components/3.8.3/component-assembly-audit.json'), 'utf8'));
    const fields = ComponentFieldFixtures.create(root, '3.8.3', audit.nativeDeclarations);
    const row = fields.components.find(row => row.componentType === 'cc.Label'); assert(row);
    const scene = ComponentSceneFixture.create(root, '3.8.3', row, audit.nativeDeclarations, true);
    assert.notEqual(scene.status, 'blocked'); if (scene.status === 'blocked') throw Error('control scene missing');
    scene.document.save(project, true, LumenCocosVersion.parse('3.8.3'));
    try {
        assert.throws(() => ComponentStartupScene.stage(root, project, '/sdk', '3.8.7', () => sdkContract), /version_unverified/u);
        assert.throws(() => ComponentStartupScene.stage(root, project, '/sdk', '3.8.3', () => ({ ...sdkContract, sha256: 'drift' })), /sdk_contract_mismatch/u);
        ComponentStartupScene.stage(root, project, '/sdk', '3.8.3', () => sdkContract);
        const meta = JSON.parse(readFileSync(join(project, 'assets/components/cc.Label.scene.meta'), 'utf8'));
        const path = join(project, 'settings/v2/packages/scene.json'); const bytes = readFileSync(path);
        assert.equal(JSON.parse(bytes.toString('utf8'))['current-scene'], meta.uuid);
        const staged = JSON.parse(readFileSync(join(output, 'startup-scene-staging.json'), 'utf8'));
        assert.equal(staged.uuid, meta.uuid); assert.equal(staged.nativeAcceptance, false);
        assert.throws(() => ComponentStartupScene.stage(root, project, '/sdk', '3.8.3', () => sdkContract), /existing_value_refused/u);
        assert.deepEqual(readFileSync(path), bytes);
        mkdirSync(join(project, 'library'));
        assert.throws(() => ComponentStartupScene.stage(root, project, '/sdk', '3.8.3', () => sdkContract), /project_started/u);
    } finally { rmSync(output, { recursive: true, force: true }); }
});

test('truncated SDK public manifest archives fail closed without invoking SDK code', () => {
    const output = mkdtempSync('/private/tmp/pod-startup-archive-');
    try {
        const resources = join(output, 'resources'); mkdirSync(resources);
        const header = Buffer.alloc(8); header.writeUInt32LE(4, 0); header.writeUInt32LE(32, 4);
        writeFileSync(join(resources, 'app.asar'), header);
        assert.throws(() => ComponentStartupScene.stage(root, join(output, 'project'), resources, '3.8.3'), /asar_truncated/u);
    } finally { rmSync(output, { recursive: true, force: true }); }
});
