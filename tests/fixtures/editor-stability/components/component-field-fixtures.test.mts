import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ComponentFieldFixtures } from './component-field-fixtures.mts';
import { ComponentResourceBindings } from './component-resource-bindings.mts';
import type { IComponentValueRecipe } from './component-value-recipe.mts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

for (const version of ['3.8.3', '3.8.7'] as const) {
    const audit = JSON.parse(readFileSync(new URL(`./${version}/component-assembly-audit.json`, import.meta.url), 'utf8'));
    const saved: ReturnType<typeof ComponentFieldFixtures.create> = JSON.parse(
        readFileSync(new URL(`./${version}/component-field-fixtures.json`, import.meta.url), 'utf8'));
    test(`${version} field fixtures preserve every effective field and rejection input with no native passed flag`, () => {
        const expected = ComponentFieldFixtures.create(root, version, audit.nativeDeclarations);
        assert.deepEqual(saved, expected);
        assert.equal(saved.componentCount, 99);
        assert.equal(saved.fieldCount, 795);
        assert.equal(saved.nativePassedRows, 0);
        const particle = saved.components.find(row => row.componentType === 'cc.ParticleSystem2D');
        assert.deepEqual(particle?.cases.find(row => row.selector.join('.') === 'custom')?.validValue, { form: 'literal', value: true });
        const sorting = saved.components.find(row => row.componentType === 'cc.Sorting');
        assert.deepEqual(sorting?.cases.find(row => row.selector.join('.') === 'sortingLayer')?.validValue, { form: 'literal', value: 0 });
        assert.equal(sorting?.assemblyRequirements.modelRendererCarrier?.componentType, 'cc.MeshRenderer');
        assert.equal(sorting?.assemblyRequirements.modelRendererCarrier?.enabled, false);
        const uiModel = saved.components.find(row => row.componentType === 'cc.UIMeshRenderer');
        assert.equal(uiModel?.assemblyRequirements.uiScene, true);
        assert.equal(uiModel?.assemblyRequirements.modelRendererCarrier?.componentType, 'cc.MeshRenderer');
        assert.equal(uiModel?.assemblyRequirements.modelRendererCarrier?.enabled, true);
        assert.equal(uiModel?.assemblyRequirements.modelRendererCarrier?.materialRequired, true);
        for (const [type, name] of [['cc.PointLight', 'intensity'], ['cc.PointLight', 'size'], ['cc.RangedDirectionalLight', 'intensity'],
            ['cc.SpriteRenderer', 'sortLayer'], ['cc.SpriteRenderer', 'sortOrder']]) {
            const row = saved.components.find(row => row.componentType === type)?.cases.find(row => row.selector.join('.') === name);
            assert.equal(row?.expectedWrite, 'reject-native-persistence');
        }
        const sprite = audit.nativeDeclarations.find((row: { type: string }) => row.type === 'cc.SpriteRenderer');
        assert(sprite);
        assert.equal(sprite.properties.some((row: { name: string }) => ['sortLayer', '_sortLayer', 'sortOrder', '_sortOrder'].includes(row.name)), false);
        const terrain = saved.components.find(row => row.componentType === 'cc.Terrain')?.cases.find(row => row.selector.join('.') === 'effectAsset');
        assert.equal(terrain?.validValue.form, 'resource');
        assert(terrain?.validValue.resource?.sources.some(source => source.path.endsWith('/terrain-effect/task51-terrain.effect')));
        assert.equal(saved.components.find(row => row.componentType === 'cc.SafeArea')?.cases[0]?.expectedWrite,
            version === '3.8.3' ? 'reject-native-persistence' : 'set-and-readback');
        for (const component of saved.components) {
            const fields = audit.rows.find((row: { componentType: string }) => row.componentType === component.componentType).fields;
            assert.deepEqual(component.cases.map((row) => row.id), fields.map((row: { id: string }) => row.id));
            assert.ok(component.nativeReadbackRequired);
            for (const row of component.cases) {
                assert.equal(row.nativeAcceptance, false);
                assert.equal(row.sourceOrigin, 'static-recipe');
                assert.notEqual(row.validValue, undefined);
                assert.notEqual(row.invalidValue, undefined);
            }
        }
    });
    test(`${version} resource bindings have actual matching bytes and contain no invented output UUID`, () => {
        const bindings = ComponentResourceBindings.create(root, version);
        assert.equal(Object.keys(bindings).length, 20);
        for (const binding of Object.values(bindings)) {
            assert.ok(binding.sources.length > 0);
            assert.ok(binding.fixtureReference.startsWith('tests/fixtures/editor-stability/'));
            for (const source of binding.sources) assert.equal(hash(readFileSync(`${root}/${source.path}`)), source.sha256);
            assert.equal(Object.hasOwn(binding, 'uuid'), false);
            assert.equal(Object.hasOwn(binding, 'assetDbUuid'), false);
        }
    });
    test(`${version} nonempty references, source names and local URLs retain concrete assembly requirements`, () => {
        const recipes: IComponentValueRecipe[] = [];
        const visit = (recipe: IComponentValueRecipe): void => {
            recipes.push(recipe);
            if (recipe.form === 'list') { assert.ok(recipe.items?.length); recipe.items?.forEach(visit); }
            if (recipe.form === 'object') Object.values(recipe.properties ?? {}).forEach(visit);
        };
        for (const component of saved.components) for (const row of component.cases) visit(row.validValue);
        assert.ok(recipes.some((recipe) => recipe.form === 'resource'));
        assert.ok(recipes.some((recipe) => recipe.form === 'node-reference'));
        assert.ok(recipes.some((recipe) => recipe.form === 'component-reference'));
        for (const recipe of recipes.filter((recipe) => recipe.form === 'project-file-url')) {
            assert.ok(recipe.projectFile);
            assert.equal(hash(readFileSync(`${root}/${recipe.projectFile.path}`)), recipe.projectFile.sha256);
            assert.equal(recipe.value, undefined);
        }
        for (const name of ['cc.TiledLayer', 'cc.TiledObjectGroup', 'cc.TiledTile', 'cc.TiledUserNodeData']) {
            assert.equal(saved.components.find((row) => row.componentType === name)?.assemblyRequirements.sourceOwnedTiledComponent, true);
        }
        for (const name of ['cc.SkeletalAnimation', 'cc.SkinnedMeshRenderer', 'cc.SkinnedMeshBatchRenderer']) {
            assert.equal(saved.components.find((row) => row.componentType === name)?.assemblyRequirements.importedSkinnedHierarchy, true);
        }
    });
}
