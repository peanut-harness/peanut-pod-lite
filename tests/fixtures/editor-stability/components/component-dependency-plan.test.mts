import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentDependencyPlanner } from './component-dependency-plan.mts';
import type { IComponentNativeDeclaration } from './component-native-source-reader.mts';

function row(type: string, dependencies: readonly string[] = []): IComponentNativeDeclaration {
    return { type, sources: [{ reference: `${type}.ts`, sha256: 'a'.repeat(64), line: 1 }],
        requiredComponents: dependencies, dependencyProofs: dependencies.map((componentType) => ({ componentType,
            reference: `${type}.ts`, line: 1, sha256: 'a'.repeat(64) })), baseTypes: [], unresolvedDependencies: [], properties: [],
        classification: 'source-declared-runtime-unverified' };
}

test('dependency graph adds transitive dependencies once before the tested component', () => {
    const plan = ComponentDependencyPlanner.create('cc.Test', [row('cc.Test', ['cc.Body', 'cc.Transform']),
        row('cc.Body', ['cc.Transform']), row('cc.Transform')]);
    assert.deepEqual(plan.attachOrder, ['cc.Transform', 'cc.Body', 'cc.Test']);
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.edges.length, 3);
    assert.equal(plan.nativeAcceptance, false);
});

test('missing native dependency prevents every attach instead of emitting a partial assembly', () => {
    const plan = ComponentDependencyPlanner.create('cc.Test', [row('cc.Test', ['cc.Missing'])]);
    assert.deepEqual(plan.attachOrder, []);
    assert.deepEqual(plan.blockers, ['component_source_declaration_absent:cc.Missing']);
});

test('a dependency cycle blocks the plan rather than omitting the cycle edge', () => {
    const plan = ComponentDependencyPlanner.create('cc.Test', [row('cc.Test', ['cc.Body']), row('cc.Body', ['cc.Test'])]);
    assert.deepEqual(plan.attachOrder, []);
    assert.deepEqual(plan.blockers, ['component_dependency_cycle:cc.Test']);
    assert.equal(plan.edges.length, 2);
});

test('dynamic dependencies and same-name native branches require runtime proof before assembly', () => {
    const testRow = row('cc.Test');
    const plan = ComponentDependencyPlanner.create('cc.Test', [{ ...testRow,
        sources: [...testRow.sources, { reference: 'other/test.ts', sha256: 'b'.repeat(64), line: 2 }],
        unresolvedDependencies: [{ reference: 'test.ts', line: 3, expression: 'choose()' }] }]);
    assert.deepEqual(plan.attachOrder, []);
    assert.equal(plan.blockers.length, 2);
});

test('duplicate declaration records fail instead of letting the last record replace the first', () => {
    assert.throws(() => ComponentDependencyPlanner.create('cc.Test', [row('cc.Test'), row('cc.Test')]), /declaration_duplicate/u);
});

test('abstract renderer requirements use a source-proven concrete renderer and reject a wrong provider', () => {
    const declarations = [row('cc.Sorting2D', ['cc.UIRenderer']), row('cc.UIRenderer'),
        { ...row('cc.Sprite', ['cc.Transform']), baseTypes: ['cc.UIRenderer'] }, row('cc.Transform'), row('cc.Body')];
    assert.deepEqual(ComponentDependencyPlanner.create('cc.Sorting2D', declarations, { 'cc.UIRenderer': 'cc.Sprite' }).attachOrder,
        ['cc.Transform', 'cc.Sprite', 'cc.Sorting2D']);
    const invalid = ComponentDependencyPlanner.create('cc.Sorting2D', declarations, { 'cc.UIRenderer': 'cc.Body' });
    assert.deepEqual(invalid.attachOrder, []);
    assert.ok(invalid.blockers.some((blocker) => blocker.includes('provider_type_mismatch')));
});
