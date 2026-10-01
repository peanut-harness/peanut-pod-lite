import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { CoverageInventoryReader } from '../editor-stability/coverage-inventory-reader.mjs';
import { CoverageManifestGenerator } from '../editor-stability/coverage-manifest-generator.mjs';
import { CreatorAsarLayoutReader } from '../editor-stability/creator-asar-layout-reader.mjs';
import { CreatorComponentSourceReader } from '../editor-stability/creator-component-source-reader.mjs';

/**
 * @description 为测试写入公开 ASAR 头部格式；正文只作无关尾部，不执行任何模块。
 * @param path 测试临时文件。
 * @param header 合成目录数据。
 * @param body 无关正文。
 * @returns 无返回值。
 */
const archive = (path: string, header: unknown, body = ''): void => {
    const json = Buffer.from(JSON.stringify(header));
    const prefix = Buffer.alloc(16);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(json.length + 8, 4);
    prefix.writeUInt32LE(json.length + 4, 8);
    prefix.writeUInt32LE(json.length, 12);
    writeFileSync(path, Buffer.concat([prefix, json, Buffer.from(body)]));
};

const header = { files: { modules: { files: { 'engine-extensions': { files: { assets: { files: {
    importer: { files: { importers: { files: { 'text.ccc': { size: 0, offset: '0' }, 'helper.ccc': { size: 0, offset: '0' } } } } },
} } } } } } } };

/**
 * @description 建立语法有效的合成引擎声明，覆盖真正继承、私有中间类、名称空间和非组件。
 * @param root 测试目录。
 * @returns 无返回值。
 */
const sourceTree = (root: string): void => {
    const files = {
        'decorators.ts': 'export function ccclass(name: string): ClassDecorator { return () => {}; }',
        'scene-graph/component.ts': "import {ccclass} from '../decorators'; @ccclass('cc.Component') export class Component {}",
        'physics/colliders.ts': "import {ccclass} from '../decorators'; import {Component as Base} from '../scene-graph/component';\n"
            + "@ccclass('cc.Collider') export abstract class Collider extends Base {}\n"
            + "class PrivateCollider extends Collider {}\n@ccclass('cc.BoxCollider') export class Box extends PrivateCollider {}\n",
        'animation/controller.ts': "import {ccclass} from '../decorators'; import {Component} from '../scene-graph/component';\n"
            + "@ccclass('cc.animation.AnimationController') export class Animation extends Component {}\n"
            + "@ccclass('cc.Asset') export class Asset {}",
        'alternative.ts': "import {ccclass} from './decorators'; @ccclass('cc.Asset') export class OtherAsset {}",
    };
    for (const [relative, content] of Object.entries(files)) {
        const path = join(root, relative);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
    }
};

test('ASAR reader retains helper modules without treating file layout as registrations', (context) => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-asar-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, 'app.asar');
    archive(path, header, 'unexecuted-body-1');
    const first = CreatorAsarLayoutReader.read(path);
    assert.deepEqual(first.importerModules, ['modules/engine-extensions/assets/importer/importers/helper.ccc',
        'modules/engine-extensions/assets/importer/importers/text.ccc']);
    archive(path, header, 'unexecuted-body-2');
    assert.equal(CreatorAsarLayoutReader.read(path).headerSha256, first.headerSha256);
});

test('ASAR reader rejects truncated headers and malformed or traversing directory entries', (context) => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-bad-asar-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, 'app.asar');
    writeFileSync(path, Buffer.alloc(10));
    assert.throws(() => CreatorAsarLayoutReader.read(path), /truncated/u);
    for (const invalid of [{ files: { '..': {} } }, { files: { 'a/b': {} } }, { files: { 'a\\b': {} } },
        { files: { directory: { files: [] } } }, { files: [] }]) {
        archive(path, invalid);
        assert.throws(() => CreatorAsarLayoutReader.read(path), /directory_invalid/u);
    }
    archive(path, header);
    const corrupted = readFileSync(path);
    corrupted.writeUInt32LE(33 * 1024 * 1024, 4);
    writeFileSync(path, corrupted);
    assert.throws(() => CreatorAsarLayoutReader.read(path), /header_invalid/u);
});

test('AST inheritance retains private component chains, abstract classes and namespace names', (context) => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-cocos-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    sourceTree(root);
    const first = CreatorComponentSourceReader.read(root);
    assert.deepEqual(first.componentDeclarations, ['cc.BoxCollider', 'cc.Collider', 'cc.Component', 'cc.animation.AnimationController']);
    assert.deepEqual(first.abstractComponentDeclarations, ['cc.Collider']);
    assert.ok(first.registeredClasses.includes('cc.Asset'));
    assert.deepEqual(first.registrationAlternatives, [{ name: 'cc.Asset', paths: ['alternative.ts', 'animation/controller.ts'] }]);
    writeFileSync(join(root, 'alternative.ts'), "import {ccclass} from './decorators'; @ccclass('cc.Asset') export class OtherAsset { value = 1; }");
    assert.notEqual(CreatorComponentSourceReader.read(root).sourceSha256, first.sourceSha256);
});

test('product inventory expands nested fields and preserves all unverified native differences', (context) => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-inventory-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const engine = join(root, 'resources/3d/engine');
    sourceTree(join(engine, 'cocos'));
    writeFileSync(join(engine, 'package.json'), JSON.stringify({ version: '3.8.7' }));
    archive(join(root, 'app.asar'), header);
    const repositoryRoot = resolve(import.meta.dirname, '../..');
    const inventory = CoverageInventoryReader.read({ repositoryRoot, creatorResourcesRoot: root, creatorVersion: '3.8.7' });
    assert.equal(inventory.targets.filter((target) => target.domain === 'asset').length, 40);
    assert.equal(inventory.targets.filter((target) => target.id.startsWith('operation:')).length, 84);
    assert.equal(inventory.targets.filter((target) => target.domain === 'importer').length, 2);
    assert.ok(inventory.targets.some((target) => target.id === 'field:component:cc.ParticleSystem:shapeModule:radius'));
    assert.ok(inventory.targets.some((target) => target.id === 'field:node:cc.Node:position'));
    assert.ok(inventory.curatedComponentsWithoutDeclaration.includes('cc.Sorting2D'));
    assert.ok(inventory.targets.every((target) => target.availability === 'unverified'));
    assert.equal(CoverageManifestGenerator.createDraft(inventory).cases.every((row) => row.status === 'pending'), true);
    assert.equal(JSON.stringify(inventory).includes(root), false);
    writeFileSync(join(engine, 'package.json'), JSON.stringify({ version: '3.8.3' }));
    assert.throws(() => CoverageInventoryReader.read({ repositoryRoot, creatorResourcesRoot: root, creatorVersion: '3.8.7' }), /version_mismatch/u);
});

test('constant templates, concatenation, decorator aliases and namespaces resolve without execution', (context) => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-names-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    sourceTree(root);
    writeFileSync(join(root, 'prefix.ts'), "export const PREFIX = 'cc.extra.';");
    writeFileSync(join(root, 'names.ts'), [
        "import {ccclass as defineClass} from './decorators'; import * as decorators from './decorators';",
        "import {Component} from './scene-graph/component'; import {PREFIX as prefix} from './prefix';",
        '@defineClass(`${prefix}Template`) export class Template extends Component {}',
        "@decorators.ccclass(prefix + 'Concatenated') export class Concatenated extends Component {}",
        '@defineClass(`cc.extra.LiteralTemplate`) export class Literal extends Component {}',
    ].join('\n'));
    const declarations = CreatorComponentSourceReader.read(root);
    for (const name of ['cc.extra.Template', 'cc.extra.Concatenated', 'cc.extra.LiteralTemplate']) {
        assert.ok(declarations.componentDeclarations.includes(name));
    }
    assert.deepEqual(declarations.unresolvedRegistrations, []);
});

test('dynamic, mutable and cyclic names remain explicit gaps and expressions are never executed', (context) => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-dynamic-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    sourceTree(root);
    writeFileSync(join(root, 'dynamic.ts'), [
        "import {ccclass} from './decorators'; import {Component} from './scene-graph/component';",
        'export function factory(name: string) { @ccclass(name) class Dynamic extends Component {} return Dynamic; }',
        "let mutable = 'cc.Mutable'; @ccclass(mutable) class Mutable extends Component {}",
        'const recursive = recursive; @ccclass(recursive) class Cycle extends Component {}',
        "const dangerous = () => { throw new Error('expression_executed'); }; @ccclass(dangerous()) class Invocation extends Component {}",
    ].join('\n'));
    const declarations = CreatorComponentSourceReader.read(root);
    assert.deepEqual(declarations.unresolvedRegistrations.map((entry) => entry.className), ['Dynamic', 'Mutable', 'Cycle', 'Invocation']);
    assert.ok(declarations.unresolvedRegistrations.every((entry) => entry.sourcePath === 'dynamic.ts' && entry.componentDeclaration));
    assert.equal(declarations.registeredClasses.includes('cc.Mutable'), false);
});
