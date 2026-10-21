import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LumenCuratedSchemaCatalog } from '../../../../packages/engine/modules/lumen/source/schema/catalog.ts';
import { LumenComponentPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/component-property.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import type { ILumenPropertyFieldSpec } from '../../../../packages/engine/modules/lumen/source/schema/component-property-contracts.ts';
import { ComponentCatalogAudit } from './component-catalog-audit.mts';
import { ComponentDependencyPlanner } from './component-dependency-plan.mts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const catalog = new LumenCuratedSchemaCatalog(`${root}/packages/engine/modules/lumen/bundled/schema`);
const flatten = (owner: string, fields: readonly ILumenPropertyFieldSpec[]): string[] => fields.flatMap((field) => {
    const id = `${owner}:${field.apiName}`;
    return [id, ...flatten(id, field.nestedFields ?? [])];
});

for (const version of ['3.8.3', '3.8.7']) {
    const saved: ReturnType<typeof ComponentCatalogAudit.create> = JSON.parse(
        readFileSync(new URL(`./${version}/component-assembly-audit.json`, import.meta.url), 'utf8'));
    test(`${version} component audit retains all current catalog and recursively expanded fields`, () => {
        const names = catalog.listComponentTypes().slice().sort();
        assert.equal(names.length, 99);
        assert.deepEqual(saved.rows.map((row) => row.componentType), names);
        let fields = 0;
        for (const row of saved.rows) {
            const specs = catalog.componentFields(row.componentType);
            assert.ok(specs);
            const publicSchema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version), catalog);
            const effective = publicSchema.describeComponent(row.componentType);
            const descriptors = (owner: string, fields: typeof effective): string[] => fields.flatMap((field) => {
                const id = `${owner}:${field.apiName}`; return [id, ...descriptors(id, field.nestedProps ?? [])];
            });
            const ids = [...new Set([...flatten(`field:component:${row.componentType}`, specs),
                ...descriptors(`field:component:${row.componentType}`, effective)])].sort();
            assert.deepEqual(row.fields.map((field) => field.id).sort(), ids);
            fields += ids.length;
            assert.deepEqual(row.dependencyPlan, ComponentDependencyPlanner.create(row.componentType, saved.nativeDeclarations));
            assert.equal(row.fixturePreparation, 'pending');
            assert.equal(row.nativeAcceptance, false);
        }
        assert.equal(saved.fieldCount, fields);
        assert.equal(saved.nativePassedRows, 0);
        assert.equal(saved.task51Complete, false);
    });
    test(`${version} missing final field, dependency or forged completion cannot pass a catalog audit`, () => {
        const originalBytes = JSON.stringify(saved);
        const missing = structuredClone(saved);
        const row = missing.rows.slice().reverse().find((entry) => entry.fields.length > 0);
        assert.ok(row); row.fields.pop();
        assert.throws(() => ComponentCatalogAudit.validate(missing, saved), /drift_or_missing_rows/u);
        const dependency = structuredClone(saved);
        const dependent = dependency.rows.find((entry) => entry.dependencyPlan.edges.length > 0);
        assert.ok(dependent); Object.assign(dependent.dependencyPlan, { edges: [] });
        assert.throws(() => ComponentCatalogAudit.validate(dependency, saved), /drift_or_missing_rows/u);
        assert.throws(() => ComponentCatalogAudit.validate({ ...saved, task51Complete: true, nativePassedRows: 99 }, saved), /drift_or_missing_rows/u);
        assert.equal(JSON.stringify(saved), originalBytes);
    });
    test(`${version} native source difference remains visible and cannot become runtime not-applicable`, () => {
        assert.deepEqual(saved.curatedWithoutSource, version === '3.8.3' ? ['cc.Sorting2D', 'cc.UISkew'] : []);
        for (const name of saved.curatedWithoutSource) {
            const row = saved.rows.find((entry) => entry.componentType === name);
            assert.ok(row);
            assert.equal(row.declarationStatus, 'source-absent-runtime-unverified');
            assert.deepEqual(row.dependencyPlan.attachOrder, []);
            assert.ok(row.dependencyPlan.blockers.length > 0);
            assert.ok(row.fields.length > 0);
        }
    });
}
