import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ComponentBlitScreenMaterial } from './component-blit-screen-material.mts';
import { ComponentFieldFixtures } from './component-field-fixtures.mts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const engine = '/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/Resources/resources/3d/engine';

test('Blit field recipes use the exact SDK post-process effect without replacing mesh materials or changing coverage', () => {
    ComponentBlitScreenMaterial.assertSdk(root, engine, '3.8.7');
    assert.equal(ComponentBlitScreenMaterial.binding(root, '3.8.3'), null);
    assert.throws(() => ComponentBlitScreenMaterial.binding(root, '3.9.0'), /version_unverified/u);
    const audit = JSON.parse(readFileSync(new URL('./3.8.7/component-assembly-audit.json', import.meta.url), 'utf8'));
    const fields = ComponentFieldFixtures.create(root, '3.8.7', audit.nativeDeclarations);
    assert.equal(fields.componentCount, 99); assert.equal(fields.fieldCount, 795);
    const blit = fields.components.find(row => row.componentType === 'cc.BlitScreen'); assert(blit);
    assert.equal(blit.cases.length, 4);
    const material = blit.cases.find(row => row.selector.join('.') === 'materials.material')?.validValue.resource;
    assert(material); assert(material.sources.every(source => source.path.includes('/blit-screen-material/')));
    assert.notDeepEqual(material, fields.resources['cc.Material']);
    assert.deepEqual(blit.cases.find(row => row.selector.join('.') === 'materials.enable')?.validValue, { form: 'literal', value: true });
});

test('Blit source gates reject modified authored material and changed SDK shader bytes before launch', () => {
    const temp = mkdtempSync('/private/tmp/pod-blit-material-');
    try {
        const fixture = 'tests/fixtures/editor-stability/components/3.8.7';
        mkdirSync(join(temp, fixture), { recursive: true });
        cpSync(join(root, fixture, 'blit-screen-material'), join(temp, fixture, 'blit-screen-material'), { recursive: true });
        cpSync(join(root, fixture, 'blit-screen-material.json'), join(temp, fixture, 'blit-screen-material.json'));
        const proof = JSON.parse(readFileSync(join(root, fixture, 'blit-screen-material.json'), 'utf8'));
        const sdk = join(temp, 'sdk'); mkdirSync(sdk); writeFileSync(join(sdk, 'package.json'), JSON.stringify({ version: '3.8.7' }));
        for (const source of proof.sources) { mkdirSync(dirname(join(sdk, source.path)), { recursive: true }); cpSync(join(engine, source.path), join(sdk, source.path)); }
        ComponentBlitScreenMaterial.assertSdk(temp, sdk, '3.8.7');
        writeFileSync(join(sdk, proof.sources[0].path), 'changed shader');
        assert.throws(() => ComponentBlitScreenMaterial.assertSdk(temp, sdk, '3.8.7'), /sdk_source_mismatch/u);
        writeFileSync(join(temp, fixture, 'blit-screen-material/task51-blit-screen.mtl'), '{}');
        assert.throws(() => ComponentBlitScreenMaterial.binding(temp, '3.8.7'), /source_mismatch/u);
    } finally { rmSync(temp, { recursive: true, force: true }); }
});
