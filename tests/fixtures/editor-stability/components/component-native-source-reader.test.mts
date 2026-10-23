import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ComponentNativeSourceReader } from './component-native-source-reader.mts';

test('native dependency proof resolves aliases, namespace imports and inherited decorator requirements', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-component-source-'));
    try {
        writeFileSync(join(root, 'decorator.ts'), 'export function ccclass(name: string) { return (target: unknown) => {}; }\n'
            + 'export function requireComponent(value: unknown) { return (target: unknown) => {}; }\n');
        writeFileSync(join(root, 'base.ts'), `import {ccclass,requireComponent} from './decorator';
            @ccclass('cc.Transform') export class Transform {}
            @ccclass('cc.Body') export class Body {}
            @ccclass('cc.Base') @requireComponent(Transform) export class Base {}
        `);
        writeFileSync(join(root, 'test.ts'), `import {ccclass as register,requireComponent as requires} from './decorator';
            import * as core from './base';
            @register('cc.Derived') @requires([core.Body,core.Transform]) export class Derived extends core.Base {}
        `);
        const rows = ComponentNativeSourceReader.read(root);
        const derived = rows.find((row) => row.type === 'cc.Derived');
        assert.ok(derived);
        assert.deepEqual(derived.requiredComponents, ['cc.Body', 'cc.Transform']);
        assert.deepEqual(derived.unresolvedDependencies, []);
        assert.ok(derived.dependencyProofs.some((proof) => proof.componentType === 'cc.Transform' && proof.reference === 'base.ts'));
        assert.equal(derived.sources[0]?.reference, 'test.ts');
        assert.match(derived.sources[0]?.sha256 ?? '', /^[a-f0-9]{64}$/u);
        assert.equal(derived.classification, 'source-declared-runtime-unverified');
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Creator virtual decorator imports and editor type annotations retain a real resource class proof', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-component-source-'));
    try {
        writeFileSync(join(root, 'test.ts'), `import {ccclass,requireComponent,type as fieldType} from 'cc.decorator';
            @ccclass('cc.Component') class Component {}
            @ccclass('cc.Texture2D') class Texture2D {}
            @ccclass('cc.Transform') class Transform extends Component {}
            @ccclass('cc.Host') @requireComponent(Transform) class Host extends Component {
                @fieldType(Texture2D) get texture(): null { return null; }
            }
        `);
        const host = ComponentNativeSourceReader.read(root).find((row) => row.type === 'cc.Host');
        assert.ok(host);
        assert.deepEqual(host.requiredComponents, ['cc.Transform']);
        assert.ok(host.baseTypes.includes('cc.Component'));
        assert.deepEqual(host.properties.find((property) => property.name === 'texture')?.registeredTypes, ['cc.Texture2D']);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('same-name native branches remain separate source proofs and dynamic dependencies stay unresolved', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-component-source-'));
    try {
        writeFileSync(join(root, 'decorator.ts'), 'export function ccclass(name: string) { return (target: unknown) => {}; }\n'
            + 'export function requireComponent(value: unknown) { return (target: unknown) => {}; }\n');
        for (const file of ['one.ts', 'two.ts']) writeFileSync(join(root, file), `import {ccclass,requireComponent} from './decorator';
            function choose() { return null; }
            @ccclass('cc.Branch') @requireComponent(choose()) export class Branch {}
        `);
        const branch = ComponentNativeSourceReader.read(root).find((row) => row.type === 'cc.Branch');
        assert.ok(branch);
        assert.deepEqual(branch.sources.map((source) => source.reference), ['one.ts', 'two.ts']);
        assert.deepEqual(branch.requiredComponents, []);
        assert.equal(branch.unresolvedDependencies.length, 2);
        assert.equal(branch.unresolvedDependencies[0]?.expression, 'choose()');
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an undecorated class is not silently substituted for a native registered dependency', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-component-source-'));
    try {
        writeFileSync(join(root, 'test.ts'), `function ccclass(name: string) { return (target: unknown) => {}; }
            function requireComponent(value: unknown) { return (target: unknown) => {}; }
            class Unknown {}
            @ccclass('cc.Host') @requireComponent(Unknown) class Host {}
        `);
        const host = ComponentNativeSourceReader.read(root).find((row) => row.type === 'cc.Host');
        assert.ok(host);
        assert.deepEqual(host.requiredComponents, []);
        assert.equal(host.unresolvedDependencies[0]?.expression, 'Unknown');
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('numeric getters retain editor enum values through a static Enum alias without evaluating code', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-component-source-'));
    try {
        writeFileSync(join(root, 'test.ts'), `import {ccclass,type} from 'cc.decorator';
            enum Resolution { LOW=128, HIGH=512 }
            function Enum(value: unknown) { throw new Error('must never execute'); }
            const OPTIONS=Enum(Resolution);
            @ccclass('cc.Probe') class Probe { @type(OPTIONS) get resolution(): number { return 128; } }
        `);
        const probe = ComponentNativeSourceReader.read(root).find((row) => row.type === 'cc.Probe');
        assert.ok(probe);
        assert.deepEqual(probe.properties.find((property) => property.name === 'resolution')?.numericEnumValues, [128, 512]);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
