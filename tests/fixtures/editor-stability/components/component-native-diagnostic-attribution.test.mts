import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ComponentNativeDiagnosticAttribution } from './component-native-diagnostic-attribution.ts';

const project = '/registered/project';
const manifest = Buffer.from(JSON.stringify({ name: 'Peanut Lite Lifecycle Acceptance 3.8.7' }));
const sdk = readFileSync('/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/Resources/resources/3d/engine/package.json');
const warning = project + '/temp/logs/project.log: 10-27-2026 16:56:30 - warn: '
    + 'The provided project name "Peanut Lite Lifecycle Acceptance 3.8.7" is not suitable for use as an executable name. \'CocosGame\' is applied instead.';

test('one precise unchanged-project naming warning retains raw count and source inference separately from Pod preflight', () => {
    const raw = Object.freeze({ newErrors: Object.freeze([]), newWarnings: Object.freeze([warning]) });
    const result = ComponentNativeDiagnosticAttribution.classify(raw, project, '3.8.7', manifest, manifest, sdk);
    assert.equal(result.podPreflightMayContinue, true);
    assert.equal(result.attribution, 'creator-project-name-rule-inferred');
    assert.equal(result.raw, raw); assert.equal(result.raw.newWarnings.length, 1);
    assert.equal(result.zeroDiagnosticsClaimed, false); assert(result.proof?.limitation);
});

test('Pod, unknown, duplicate and delayed diagnostics cannot inherit the naming decision', () => {
    for (const raw of [
        { newErrors: ['[plugin:peanut.editor-mcp] task failed'], newWarnings: [warning] },
        { newErrors: [], newWarnings: [warning, 'late unknown warning'] },
        { newErrors: [], newWarnings: [warning, warning] },
        { newErrors: [], newWarnings: [warning + ' additional Pod warning'] },
        { newErrors: [], newWarnings: [warning.replace('/temp/logs/project.log', '/stdout.log')] },
        { newErrors: [], newWarnings: [warning.replace('Peanut Lite', 'Different Project')] },
    ]) {
        const result = ComponentNativeDiagnosticAttribution.classify(raw, project, '3.8.7', manifest, manifest, sdk);
        assert.equal(result.podPreflightMayContinue, false); assert.equal(result.raw, raw);
    }
});

test('changed project manifest, SDK drift and unsupported Creator cannot acquire an attribution', () => {
    const raw = { newErrors: [], newWarnings: [warning] };
    for (const [version, before, currentSdk] of [
        ['3.8.3', manifest, sdk], ['3.8.7', Buffer.from('{}'), sdk], ['3.8.7', manifest, Buffer.from('{}')],
    ] as const) {
        assert.equal(ComponentNativeDiagnosticAttribution.classify(raw, project, version, before, manifest, currentSdk).podPreflightMayContinue, false);
    }
});

test('empty raw input remains successful without inventing a classified diagnostic or zero-diagnostic claim', () => {
    const result = ComponentNativeDiagnosticAttribution.classify({ newErrors: [], newWarnings: [] }, project, '3.8.7', manifest, manifest, sdk);
    assert.equal(result.podPreflightMayContinue, true); assert.equal(result.proof, null);
    assert.equal(result.attribution, 'not-classified'); assert.equal(result.zeroDiagnosticsClaimed, false);
});
