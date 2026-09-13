import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CocosUuidCodec } from '@peanut/pod-engine/assets';

import { LumenAtomicFileWriter } from '../source/io/atomic-file-writer';
import { LumenDefaultTemplateRoot } from '../source/templates/default-root';
import { LumenEngineSerializableProbe } from '../source/schema/engine-serializable-probe';
import { LumenPrefabDocument } from '../source/hierarchy/prefab-document';
import { LumenSessionFactory } from '../source/lumen-session-factory';
import { LumenSession } from '../source/session';
import { LumenCocosVersion } from '../source/schema/cocos-version';
import { LumenMetaImporterVersions } from '../source/schema/meta-importer-versions';

/**
 * @description 创建最小 Creator 项目目录。
 * @param prefix 临时目录前缀
 * @returns 项目根
 * @oopException 测试辅助无领域对象归属。
 */
function createProject(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"name":"tmp","creator":{"version":"3.8.7"}}\n');
    return root;
}

/**
 * @description 写入可被 catalog 解析的 uuid stub（含 `@子资源`）。
 * @param root 项目根
 * @param uuids uuid 列表
 * @oopException 测试辅助无领域对象归属。
 */
function plantUuidStubs(root: string, uuids: readonly string[]): void {
    const dir = join(root, 'assets/_uuid-stub');
    mkdirSync(dir, { recursive: true });
    for (const raw of uuids) {
        const uuid = raw.trim();
        const at = uuid.indexOf('@');
        const base = at >= 0 ? uuid.slice(0, at) : uuid;
        const sub = at >= 0 ? uuid.slice(at + 1) : '';
        const absolute = join(dir, `${base}.txt`);
        if (!existsSync(absolute)) {
            writeFileSync(absolute, 'uuid-stub\n');
        }
        const metaPath = `${absolute}.meta`;
        const meta: Record<string, unknown> = existsSync(metaPath)
            ? (JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>)
            : {
                  ver: '1.0.1',
                  importer: 'text',
                  imported: true,
                  uuid: base,
                  files: ['.json'],
                  subMetas: {},
                  userData: {},
              };
        if (meta.subMetas == null || typeof meta.subMetas !== 'object' || Array.isArray(meta.subMetas)) {
            meta.subMetas = {};
        }
        if (sub.length > 0) {
            const subMetas = meta.subMetas as Record<string, unknown>;
            subMetas[sub] = {
                importer: 'sprite-frame',
                uuid: `${base}@${sub}`,
                displayName: sub,
                id: sub,
                name: 'spriteFrame',
                userData: {},
                ver: '1.0.12',
                imported: true,
                files: ['.json'],
                subMetas: {},
            };
        }
        writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    }
}

test('scaffold empty prefab writes file and meta', (): void => {
    const root = createProject('lumen-scaffold-');
    try {
        const session = new LumenSession({ projectRoot: root });
        const relativePath = session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Demo.prefab',
            rootName: 'Demo',
            template: 'empty',
        });
        assert.equal(relativePath, 'assets/ui/Demo.prefab');
        assert.equal(session.phase, 'scaffolded');
        const prefab = JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as Array<{
            __type__?: string;
            _name?: string;
        }>;
        assert.equal(prefab[0]?.__type__, 'cc.Prefab');
        assert.equal(prefab[1]?._name, 'Demo');
        const meta = JSON.parse(readFileSync(join(root, `${relativePath}.meta`), 'utf8')) as {
            importer?: string;
            uuid?: string;
        };
        assert.equal(meta.importer, 'prefab');
        assert.ok(typeof meta.uuid === 'string' && meta.uuid.length > 0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('scaffold reset recreates prefab instead of appending on reopen', (): void => {
    const root = createProject('lumen-scaffold-reset-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Demo.prefab',
            rootName: 'Demo',
            template: 'empty',
        });
        session.buildFromRecipe({
            parentPath: '/Demo',
            recipe: { name: 'Title', template: 'ui/Label', props: { string: 'A' } },
        });
        session.save();
        let prefab = JSON.parse(readFileSync(join(root, 'assets/ui/Demo.prefab'), 'utf8')) as Array<{
            __type__?: string;
            _name?: string;
        }>;
        assert.equal(prefab.filter((entry) => entry.__type__ === 'cc.Node' && entry._name === 'Title').length, 1);

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Demo.prefab',
            rootName: 'Demo',
            template: 'empty',
            reset: true,
        });
        session.buildFromRecipe({
            parentPath: '/Demo',
            recipe: { name: 'Title', template: 'ui/Label', props: { string: 'B' } },
        });
        session.save();
        prefab = JSON.parse(readFileSync(join(root, 'assets/ui/Demo.prefab'), 'utf8')) as Array<{
            __type__?: string;
            _name?: string;
        }>;
        assert.equal(prefab.filter((entry) => entry.__type__ === 'cc.Node' && entry._name === 'Title').length, 1);
        const inspected = session.inspectNode('/Demo/Title');
        const label = inspected.components.find((component) => component.type === 'cc.Label');
        assert.equal(label?.props?.string, 'B');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('prefab document bindClick appends ClickEvent with componentId', (): void => {
    const document = LumenPrefabDocument.createEmpty('assets/ui/Btn.prefab', 'Root');
    const entries = document.entries as Array<Record<string, unknown>>;
    const buttonIndex = entries.length;
    entries.push({
        __type__: 'cc.Button',
        node: { __id__: 1 },
        _enabled: true,
        clickEvents: [],
    });
    const root = entries[1] as { _components: Array<{ __id__: number }> };
    root._components.push({ __id__: buttonIndex });

    const mutable = new LumenPrefabDocument('assets/ui/Btn.prefab', entries);
    mutable.bindClickEvent('/Root', '/Root', 'DemoPanel', 'onClick', 'x', 'e56c2BdWQZKnrEob356B/ap');
    const button = mutable.entries[buttonIndex] as { clickEvents: Array<{ __id__: number }> };
    assert.equal(button.clickEvents.length, 1);
    const eventId = button.clickEvents[0]?.__id__;
    assert.ok(typeof eventId === 'number');
    const event = mutable.entries[eventId] as {
        __type__?: string;
        handler?: string;
        component?: string;
        _componentId?: string;
    };
    assert.equal(event.__type__, 'cc.ClickEvent');
    assert.equal(event.handler, 'onClick');
    assert.equal(event.component, 'DemoPanel');
    assert.equal(event._componentId, 'e56c2BdWQZKnrEob356B/ap');

    const otherPath = mutable.addChildFromSpec('/Root', {
        name: 'Other',
        components: ['cc.UITransform', 'cc.Button'],
    });
    mutable.bindClickEvent(otherPath, '/Root', 'DemoPanel', 'onOtherClick');
    mutable.setComponentProperty('/Root', 'cc.Button', { clickEvents: [] });
    const clearedButton = mutable.entries[buttonIndex] as { clickEvents: Array<{ __id__: number }> };
    assert.deepEqual(clearedButton.clickEvents, []);
    assert.equal(mutable.entries.filter((entry) => entry.__type__ === 'cc.ClickEvent').length, 1);

    mutable.setComponentProperty(otherPath, 'cc.Button', { clickEvents: [] });
    assert.equal(mutable.entries.some((entry) => entry.__type__ === 'cc.ClickEvent'), false);
});

test('scaffold clones default_prefab ui/Label without explicit templateRoot', (): void => {
    const templateRoot = LumenDefaultTemplateRoot.resolve();
    assert.ok(templateRoot != null, 'products/cocos/default_prefab must exist');
    const root = createProject('lumen-label-');
    try {
        const session = new LumenSession({ projectRoot: root });
        const relativePath = session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Title.prefab',
            rootName: 'Title',
            template: 'ui/Label',
        });
        assert.equal(relativePath, 'assets/ui/Title.prefab');
        const prefab = JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as Array<{
            __type__?: string;
            _name?: string;
        }>;
        assert.equal(prefab[0]?.__type__, 'cc.Prefab');
        assert.equal(prefab[1]?._name, 'Title');
        assert.equal(
            prefab.some((entry) => entry.__type__ === 'cc.Label'),
            true,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('node CRUD: add from template, rename, reorder, remove', (): void => {
    const root = createProject('lumen-node-crud-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Panel.prefab',
            rootName: 'Panel',
            template: 'empty',
        });
        const first = session.addChildFromTemplate({
            parentPath: '/Panel',
            template: 'ui/Label',
            name: 'Title',
        });
        assert.equal(first, '/Panel/Title');
        session.addChildFromSpec({
            parentPath: '/Panel',
            spec: { name: 'Body', components: ['cc.UITransform', 'cc.Button'] },
        });
        session.renameNode('/Panel/Title', 'Header');
        session.reorderChild('/Panel', 'Body', 0);
        session.removeNode('/Panel/Header');
        session.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/Panel.prefab'), 'utf8')) as Array<{
            __type__?: string;
            _name?: string;
            _children?: Array<{ __id__: number }>;
        }>;
        const panel = prefab[1];
        assert.equal(panel?._name, 'Panel');
        assert.equal(panel?._children?.length, 1);
        const childId = panel?._children?.[0]?.__id__;
        assert.ok(typeof childId === 'number');
        assert.equal(prefab[childId]?._name, 'Body');
        assert.equal(
            prefab.some((entry) => entry.__type__ === 'cc.Button'),
            true,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('session bindClick writes compressedUuid from catalog', (): void => {
    const root = createProject('lumen-bind-');
    try {
        const scriptUuid = 'e56c205d-5906-4a9e-b128-6f7e7a07f6a9';
        const compressed = new CocosUuidCodec().compress(scriptUuid);
        mkdirSync(join(root, 'assets', 'scripts'), { recursive: true });
        writeFileSync(join(root, 'assets/scripts/DemoPanel.ts'), 'export class DemoPanel {}\n');
        writeFileSync(
            join(root, 'assets/scripts/DemoPanel.ts.meta'),
            `${JSON.stringify(
                {
                    ver: '4.0.24',
                    importer: 'typescript',
                    imported: true,
                    uuid: scriptUuid,
                    files: ['.js'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Click.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.Button' });
        session.refreshCatalog();
        session.bindClick({
            buttonNodePath: '/Root',
            targetNodePath: '/Root',
            component: 'DemoPanel',
            handler: 'onClick',
        });
        session.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/Click.prefab'), 'utf8')) as Array<{
            __type__?: string;
            _componentId?: string;
            handler?: string;
        }>;
        const click = prefab.find((entry) => entry.__type__ === 'cc.ClickEvent');
        assert.ok(click != null);
        assert.equal(click._componentId, compressed);
        assert.equal(click.handler, 'onClick');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('session bindClick resolves unique @ccclass when filename miss', (): void => {
    const root = createProject('lumen-bind-ccclass-');
    try {
        const scriptUuid = 'a56c205d-5906-4a9e-b128-6f7e7a07f6a9';
        const compressed = new CocosUuidCodec().compress(scriptUuid);
        mkdirSync(join(root, 'assets', 'scripts'), { recursive: true });
        writeFileSync(
            join(root, 'assets/scripts/demo-panel.ts'),
            "import { _decorator, Component } from 'cc';\nconst { ccclass } = _decorator;\n@ccclass('DemoPanelHost')\nexport class DemoPanel extends Component {}\n",
        );
        writeFileSync(
            join(root, 'assets/scripts/demo-panel.ts.meta'),
            `${JSON.stringify(
                {
                    ver: '4.0.24',
                    importer: 'typescript',
                    imported: true,
                    uuid: scriptUuid,
                    files: ['.js'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/ClickCcclass.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.Button' });
        session.refreshCatalog();
        session.bindClick({
            buttonNodePath: '/Root',
            targetNodePath: '/Root',
            component: 'DemoPanelHost',
            handler: 'onClick',
        });
        session.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/ClickCcclass.prefab'), 'utf8')) as Array<{
            __type__?: string;
            _componentId?: string;
        }>;
        const click = prefab.find((entry) => entry.__type__ === 'cc.ClickEvent');
        assert.ok(click != null);
        assert.equal(click._componentId, compressed);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('session bindRef accepts componentRef object and writes Label __id__', (): void => {
    const root = createProject('lumen-bind-ref-');
    try {
        const scriptUuid = 'b56c205d-5906-4a9e-b128-6f7e7a07f6a9';
        mkdirSync(join(root, 'assets', 'scripts'), { recursive: true });
        writeFileSync(
            join(root, 'assets/scripts/BindRefHost.ts'),
            "import { _decorator, Component, Label } from 'cc';\nconst { ccclass, property } = _decorator;\n@ccclass('BindRefHost')\nexport class BindRefHost extends Component {\n  @property(Label) title: Label = null;\n}\n",
        );
        writeFileSync(
            join(root, 'assets/scripts/BindRefHost.ts.meta'),
            `${JSON.stringify(
                {
                    ver: '4.0.24',
                    importer: 'typescript',
                    imported: true,
                    uuid: scriptUuid,
                    files: ['.js'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/BindRef.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.addChildFromTemplate({ parentPath: '/Root', template: 'ui/Label', name: 'Title' });
        session.refreshCatalog();
        session.attachComponent({ nodePath: '/Root', scriptName: 'BindRefHost.ts' });
        session.bindRef({
            nodePath: '/Root',
            componentType: 'BindRefHost.ts',
            field: 'title',
            componentRef: { nodePath: '/Root/Title', type: 'cc.Label' },
        });
        session.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/BindRef.prefab'), 'utf8')) as Array<{
            __type__?: string;
            title?: { __id__: number };
        }>;
        const host = prefab.find((entry) => entry.__type__ !== 'cc.Prefab' && entry.title != null);
        assert.ok(host != null);
        assert.equal(typeof host.title?.__id__, 'number');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('session bindClick rejects engine cc.* as handler component', (): void => {
    const root = createProject('lumen-bind-cc-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/ClickCc.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.Button' });
        session.refreshCatalog();
        assert.throws(
            () =>
                session.bindClick({
                    buttonNodePath: '/Root',
                    targetNodePath: '/Root',
                    component: 'cc.Button',
                    handler: 'onClick',
                }),
            /lumen_bind_click_handler_must_be_user_script:cc\.Button/,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('attachScriptComponent uses compressedUuid as __type__', (): void => {
    const root = createProject('lumen-script-');
    try {
        const scriptUuid = '79507851-2d3a-4b4e-9b7c-0c1d2e3f4a5b';
        const compressed = new CocosUuidCodec().compress(scriptUuid);
        mkdirSync(join(root, 'assets', 'scripts'), { recursive: true });
        writeFileSync(join(root, 'assets/scripts/SeatItem.ts'), 'export class SeatItem {}\n');
        writeFileSync(
            join(root, 'assets/scripts/SeatItem.ts.meta'),
            `${JSON.stringify(
                {
                    ver: '4.0.24',
                    importer: 'typescript',
                    imported: true,
                    uuid: scriptUuid,
                    files: ['.js'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Seat.prefab',
            rootName: 'Seat',
            template: 'empty',
        });
        session.refreshCatalog();
        session.attachComponent({ nodePath: '/Seat', scriptName: 'SeatItem' });
        session.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/Seat.prefab'), 'utf8')) as Array<{
            __type__?: string;
        }>;
        assert.equal(
            prefab.some((entry) => entry.__type__ === compressed),
            true,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('attachScriptComponent disambiguates TableView-like script families by exact name', (): void => {
    const root = createProject('lumen-script-family-');
    try {
        const tableViewUuid = '11111111-1111-4111-8111-111111111111';
        const tableViewCellUuid = '22222222-2222-4222-8222-222222222222';
        mkdirSync(join(root, 'assets', 'tests', 'tableview'), { recursive: true });
        for (const [name, uuid] of [
            ['TableView.ts', tableViewUuid],
            ['TableViewCell.ts', tableViewCellUuid],
        ] as const) {
            writeFileSync(join(root, 'assets/tests/tableview', name), `export class ${name.replace(/\.ts$/, '')} {}\n`);
            writeFileSync(
                join(root, 'assets/tests/tableview', `${name}.meta`),
                `${JSON.stringify(
                    {
                        ver: '4.0.24',
                        importer: 'typescript',
                        imported: true,
                        uuid,
                        files: ['.js'],
                        subMetas: {},
                        userData: {},
                    },
                    null,
                    2,
                )}\n`,
            );
        }
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Host.prefab',
            rootName: 'Host',
            template: 'empty',
        });
        session.refreshCatalog();
        session.attachComponent({ nodePath: '/Host', scriptName: 'TableView' });
        session.attachComponent({ nodePath: '/Host', scriptName: 'TableViewCell.ts' });
        session.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/Host.prefab'), 'utf8')) as Array<{
            __type__?: string;
        }>;
        const tableViewCompressed = new CocosUuidCodec().compress(tableViewUuid);
        const tableViewCellCompressed = new CocosUuidCodec().compress(tableViewCellUuid);
        assert.equal(
            prefab.some((entry) => entry.__type__ === tableViewCompressed),
            true,
        );
        assert.equal(
            prefab.some((entry) => entry.__type__ === tableViewCellCompressed),
            true,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('buildFromRecipe nests default_prefab ui templates', (): void => {
    const root = createProject('lumen-recipe-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Panel.prefab',
            rootName: 'Panel',
            template: 'empty',
        });
        const created = session.buildFromRecipe({
            parentPath: '/Panel',
            recipe: [
                { name: 'Header', template: 'ui/Label' },
                {
                    name: 'Body',
                    template: 'ui/Layout',
                    children: [{ name: 'Icon', template: 'ui/Sprite' }],
                },
                {
                    name: 'Footer',
                    components: ['cc.UITransform'],
                    children: [{ name: 'Ok', template: 'ui/Button' }],
                },
            ],
        });
        assert.deepEqual(created, ['/Panel/Header', '/Panel/Body', '/Panel/Footer']);
        session.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/Panel.prefab'), 'utf8')) as Array<{
            __type__?: string;
            _name?: string;
        }>;
        const names = prefab.filter((entry) => entry.__type__ === 'cc.Node').map((entry) => entry._name);
        assert.deepEqual(names.includes('Header'), true);
        assert.deepEqual(names.includes('Body'), true);
        assert.deepEqual(names.includes('Icon'), true);
        assert.deepEqual(names.includes('Footer'), true);
        assert.deepEqual(names.includes('Ok'), true);
        assert.equal(
            prefab.some((entry) => entry.__type__ === 'cc.Layout'),
            true,
        );
        assert.equal(
            prefab.some((entry) => entry.__type__ === 'cc.Sprite'),
            true,
        );
        assert.equal(
            prefab.some((entry) => entry.__type__ === 'cc.Button'),
            true,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('buildFromRecipe writes componentProps onto multiple components', (): void => {
    const root = createProject('lumen-component-props-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/MultiProps.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.buildFromRecipe({
            parentPath: '/Root',
            recipe: {
                name: 'Title',
                components: ['cc.UITransform', 'cc.Label'],
                nodeProps: { position: { x: 8, y: 16, z: 0 } },
                componentProps: {
                    'cc.UITransform': { contentSize: { width: 120, height: 32 } },
                    'cc.Label': { string: 'Hello', fontSize: 22 },
                },
            },
        });
        session.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/MultiProps.prefab'), 'utf8')) as Array<
            Record<string, unknown>
        >;
        const label = prefab.find((entry) => entry.__type__ === 'cc.Label');
        const transform = prefab.find(
            (entry) =>
                entry.__type__ === 'cc.UITransform' &&
                (entry._contentSize as { width?: number } | undefined)?.width === 120,
        );
        const node = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === 'Title');
        assert.equal(label?._string, 'Hello');
        assert.equal(label?._fontSize, 22);
        assert.deepEqual(transform?._contentSize, { __type__: 'cc.Size', width: 120, height: 32 });
        assert.deepEqual(node?._lpos, { __type__: 'cc.Vec3', x: 8, y: 16, z: 0 });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('buildFromRecipe infers props target from cloned template components', (): void => {
    const root = createProject('lumen-template-props-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Inferred.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.buildFromRecipe({
            parentPath: '/Root',
            recipe: [
                { name: 'Title', template: 'ui/Label', props: { string: 'Hello', fontSize: 24 } },
                { name: 'Box', template: '3d/Cube', props: { shadowCastingMode: 0 } },
            ],
        });
        session.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/Inferred.prefab'), 'utf8')) as Array<
            Record<string, unknown>
        >;
        const label = prefab.find((entry) => entry.__type__ === 'cc.Label');
        assert.equal(label?._string, 'Hello');
        assert.equal(label?._fontSize, 24);
        const mesh = prefab.find((entry) => entry.__type__ === 'cc.MeshRenderer');
        assert.equal(mesh?._shadowCastingMode, 0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('buildRootFromRecipe rebuilds root from recipe without wrapper layer', (): void => {
    const document = LumenPrefabDocument.createEmpty('assets/ui/Panel.prefab', 'DesignUi');
    document.buildRootFromRecipe({
        name: 'Panel',
        components: ['cc.UITransform', 'cc.Sprite'],
        nodeProps: { active: false, position: { x: 0, y: 0, z: 0 } },
        componentProps: {
            'cc.UITransform': { contentSize: { width: 750, height: 96 } },
            'cc.Sprite': { sizeMode: 0 },
        },
        children: [
            { name: 'grid', components: ['cc.UITransform'] },
            { name: 'content', components: ['cc.UITransform'] },
        ],
    });
    const entries = document.entries;
    const header = entries[0];
    const rootNode = entries[1];
    assert.equal(header?.__type__, 'cc.Prefab');
    assert.equal(header?._name, 'Panel');
    assert.equal(rootNode?.__type__, 'cc.Node');
    assert.equal(rootNode?._name, 'Panel');
    assert.equal(rootNode?._parent, null);
    const nodeNames = entries
        .filter((entry) => entry?.__type__ === 'cc.Node')
        .map((entry) => entry?._name);
    assert.deepEqual(nodeNames, ['Panel', 'grid', 'content']);
    assert.equal(
        entries.some((entry) => entry?.__type__ === 'cc.Sprite'),
        true,
    );
    const transform = entries.find(
        (entry) => entry?.__type__ === 'cc.UITransform' && (entry?._contentSize as { width?: number } | undefined)?.width === 750,
    );
    assert.deepEqual(transform?._contentSize, { __type__: 'cc.Size', width: 750, height: 96 });
    assert.equal(rootNode?._active, false);
});

test('buildRootFromRecipe rejects template root', (): void => {
    const document = LumenPrefabDocument.createEmpty('assets/ui/Panel.prefab', 'DesignUi');
    assert.throws(
        (): void => {
            document.buildRootFromRecipe({ name: 'Panel', template: 'ui/Label' });
        },
        /lumen_root_template_unsupported/,
    );
});

test('removeNodeByIndex and setScriptProperties encode refs', (): void => {
    const document = LumenPrefabDocument.createEmpty('assets/ui/ScriptProps.prefab', 'Root');
    const childPath = document.addChildFromSpec('/Root', {
        name: 'Child',
        components: ['cc.UITransform'],
    });
    const siblingPath = document.addChildFromSpec('/Root', {
        name: 'Sibling',
        components: ['cc.UITransform'],
    });
    const compressedUuid = 'a'.repeat(22);
    document.attachScriptComponent('/Root/Child', compressedUuid);
    document.setScriptProperties('/Root/Child', compressedUuid, {
        target: { $node: siblingPath },
        sprite: { $asset: { uuid: '11111111-1111-1111-1111-111111111111', expectedType: 'cc.SpriteFrame' } },
        size: { $type: 'cc.Size', width: 10, height: 20 },
    });
    const childIndex = document.findNodeIndex('/Root/Child');
    const componentIndex = document.findComponentIndex(childIndex, compressedUuid);
    const component = document.entries[componentIndex] as Record<string, unknown> | undefined;
    assert.equal((component?.target as { __id__?: number } | undefined)?.__id__, document.findNodeIndex(siblingPath));
    assert.deepEqual(component?.sprite, {
        __uuid__: '11111111-1111-1111-1111-111111111111',
        __expectedType__: 'cc.SpriteFrame',
    });
    assert.equal((component?.size as { __type__?: string } | undefined)?.__type__, 'cc.Size');
    document.removeNodeByIndex(document.findNodeIndex(siblingPath));
    assert.throws(() => document.findNodeIndex(siblingPath));
    assert.ok(document.findNodeIndex(childPath) >= 0);
});

test('findNodeIndex remaps mismatched root path segment to real root name', (): void => {
    const document = LumenPrefabDocument.createEmpty('assets/ui/Alias.prefab', 'BindRoot');
    document.addChildFromSpec('/BindRoot', {
        name: 'Label',
        components: ['cc.UITransform', 'cc.Label'],
    });
    assert.equal(document.findNodeIndex('/McpStabilityBind/Label'), document.findNodeIndex('/BindRoot/Label'));
});

test('findNodeIndex keeps first segment when it is a real child under scene-like root', (): void => {
    // 复现：Scene 根名被 scaffold 成 Canvas，配方引用仍写 /CompositeProbe/pager。
    const document = LumenPrefabDocument.createEmpty('assets/ui/Probe.scene', 'Canvas');
    document.addChildFromSpec('/Canvas', {
        name: 'CompositeProbe',
        components: ['cc.UITransform'],
    });
    document.addChildFromSpec('/Canvas/CompositeProbe', {
        name: 'pager',
        components: ['cc.UITransform', 'cc.PageView'],
    });
    assert.equal(
        document.findNodeIndex('/CompositeProbe/pager'),
        document.findNodeIndex('/Canvas/CompositeProbe/pager'),
    );
    assert.throws(() => document.findNodeIndex('/Canvas/pager'), /lumen_child_missing:Canvas\/pager/);
});

test('setComponentProperty rewrites absolute recipe refs under nested Canvas host', (): void => {
    const document = LumenPrefabDocument.createEmpty('assets/ui/Nested.scene', 'Game');
    document.addChildFromSpec('/Game', { name: 'Canvas', components: ['cc.UITransform'] });
    document.addChildFromSpec('/Game/Canvas', { name: 'CompositeProbe', components: ['cc.UITransform'] });
    document.addChildFromSpec('/Game/Canvas/CompositeProbe', {
        name: 'pager',
        components: ['cc.UITransform', 'cc.PageView'],
    });
    document.addChildFromSpec('/Game/Canvas/CompositeProbe/pager', {
        name: 'view',
        components: ['cc.UITransform'],
    });
    document.addChildFromSpec('/Game/Canvas/CompositeProbe/pager/view', {
        name: 'content',
        components: ['cc.UITransform'],
    });
    // 配方仍写 /CompositeProbe/pager/view/content（未带 Game/Canvas 前缀）
    document.setComponentProperty('/Game/Canvas/CompositeProbe/pager', 'cc.PageView', {
        content: '/CompositeProbe/pager/view/content',
    });
    const pageViewIndex = document.findComponentIndex(
        document.findNodeIndex('/Game/Canvas/CompositeProbe/pager'),
        'cc.PageView',
    );
    const pageView = document.entries[pageViewIndex] as Record<string, unknown> | undefined;
    const contentRef = pageView?._content as { __id__?: number } | undefined;
    assert.equal(contentRef?.__id__, document.findNodeIndex('/Game/Canvas/CompositeProbe/pager/view/content'));
});

test('setComponentProperty writes Label string via schema', (): void => {
    const root = createProject('lumen-props-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Props.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.addChildFromTemplate({ parentPath: '/Root', template: 'ui/Label', name: 'Title' });
        session.setComponentProperty({
            nodePath: '/Root/Title',
            componentType: 'cc.Label',
            patch: { string: 'Hello CRUD', fontSize: 28, isBold: true },
        });
        session.setNodeProperty({
            nodePath: '/Root/Title',
            patch: { position: { x: 10, y: 20, z: 0 } },
        });
        session.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/Props.prefab'), 'utf8')) as Array<
            Record<string, unknown>
        >;
        const label = prefab.find((entry) => entry.__type__ === 'cc.Label');
        assert.ok(label != null);
        assert.equal(label._string, 'Hello CRUD');
        assert.equal(label._fontSize, 28);
        assert.equal(label._isBold, true);
        const title = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === 'Title');
        assert.ok(title != null);
        const pos = title._lpos as { x: number; y: number; z: number };
        assert.equal(pos.x, 10);
        assert.equal(pos.y, 20);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('embedded templates unpack prefab instance meta and keep components', (): void => {
    const root = createProject('lumen-fileid-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Dup.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.addChildFromTemplate({ parentPath: '/Root', template: 'ui/Button', name: 'Submit' });
        session.addChildFromTemplate({ parentPath: '/Root', template: 'ui/Button', name: 'Cancel' });
        session.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/Dup.prefab'), 'utf8')) as Array<{
            __type__?: string;
            _name?: string;
            _prefab?: unknown;
            fileId?: string;
        }>;
        assert.equal(prefab.filter((entry) => entry.__type__ === 'cc.Button').length, 2);
        assert.equal(
            prefab
                .filter((entry) => entry.__type__ === 'cc.Node' && (entry._name === 'Submit' || entry._name === 'Cancel'))
                .every((node) => node._prefab == null),
            true,
        );
        // 宿主 Prefab 根仍保留 PrefabInfo；内嵌解包后不再带 CompPrefabInfo fileId
        const rootPrefabInfos = prefab.filter((entry) => entry.__type__ === 'cc.PrefabInfo');
        assert.equal(rootPrefabInfos.length, 1);
        const fileIds = prefab
            .map((entry) => entry.fileId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0);
        assert.equal(new Set(fileIds).size, fileIds.length);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('setComponentProperty writes 3D camera light and mesh fields', (): void => {
    const root = createProject('lumen-3d-props-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/world/SceneKit.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.addChildFromTemplate({ parentPath: '/Root', template: 'Camera', name: 'MainCam' });
        session.addChildFromTemplate({
            parentPath: '/Root',
            template: 'light/Directional Light',
            name: 'Sun',
        });
        session.addChildFromTemplate({ parentPath: '/Root', template: '3d/Cube', name: 'Box' });
        session.setComponentProperty({
            nodePath: '/Root/MainCam',
            componentType: 'cc.Camera',
            patch: {
                fov: 50,
                near: 0.5,
                far: 2000,
                rect: { x: 0, y: 0, width: 1, height: 1 },
            },
        });
        session.setComponentProperty({
            nodePath: '/Root/Sun',
            componentType: 'cc.DirectionalLight',
            patch: {
                intensity: 3.5,
                color: { r: 255, g: 240, b: 200, a: 255 },
            },
        });
        session.setComponentProperty({
            nodePath: '/Root/Box',
            componentType: 'cc.MeshRenderer',
            patch: {
                materials: ['620b6bf3-0369-4560-837f-2a2c00b73c26'],
            },
        });
        session.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/world/SceneKit.prefab'), 'utf8')) as Array<
            Record<string, unknown>
        >;
        const camera = prefab.find((entry) => entry.__type__ === 'cc.Camera');
        assert.ok(camera != null);
        assert.equal(camera._fov, 50);
        assert.equal(camera._near, 0.5);
        assert.equal(camera._far, 2000);
        const light = prefab.find((entry) => entry.__type__ === 'cc.DirectionalLight');
        assert.ok(light != null);
        assert.equal(light._intensity, 3.5);
        const mesh = prefab.find((entry) => entry.__type__ === 'cc.MeshRenderer');
        assert.ok(mesh != null);
        const materials = mesh._materials as Array<{ __uuid__: string }>;
        assert.equal(materials[0]?.__uuid__, '620b6bf3-0369-4560-837f-2a2c00b73c26');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('editor refresh noop reports not triggered', async (): Promise<void> => {
    const root = createProject('lumen-refresh-');
    try {
        const session = new LumenSession({ projectRoot: root });
        const result = await session.requestEditorRefresh(['assets/ui']);
        assert.equal(result.triggered, false);
        assert.match(result.message, /lumen_editor_refresh_noop/);
        assert.equal(session.phase, 'idle');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('session factory wires AssetDB refresh adapter', async (): Promise<void> => {
    const root = createProject('lumen-assetdb-refresh-');
    try {
        mkdirSync(join(root, 'assets/ui'), { recursive: true });
        writeFileSync(join(root, 'assets/ui/Panel.prefab'), '[]\n');
        const calls: Array<{ target: string; message: string; args: unknown[] }> = [];
        const session = LumenSessionFactory.createWithAssetDbRefresh(
            { projectRoot: root },
            {
                async request<TData = unknown>(
                    target: string,
                    message: string,
                    ...args: unknown[]
                ): Promise<TData> {
                    calls.push({ target, message, args });
                    if (message === 'query-asset-info') {
                        return { uuid: 'panel-uuid' } as TData;
                    }
                    if (message === 'query-ready') {
                        return true as TData;
                    }
                    return undefined as TData;
                },
            },
        );
        const result = await session.requestEditorRefresh(['assets/ui/Panel.prefab']);
        assert.equal(result.triggered, true);
        assert.match(result.message, /lumen_asset_db_refresh/);
        assert.equal(session.phase, 'editor_refreshed');
        const refreshCalls = calls.filter((entry) => entry.message === 'refresh-asset');
        assert.equal(refreshCalls.length, 0, 'must leave registered serialized assets to the file watcher');
        // 3.8.x：已登记祖先目录禁止连带 force refresh-asset（Assets 面板 Window 竞态）。
        assert.equal(
            refreshCalls.some(
                (entry) =>
                    entry.target === 'asset-db' &&
                    entry.message === 'refresh-asset' &&
                    entry.args[0] === 'db://assets/ui/',
            ),
            false,
            'must not force-refresh already-registered ancestor directory',
        );
        assert.equal(
            calls.some((entry) => entry.message === 'save-asset' || entry.message === 'create-asset'),
            false,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('session reads creator.version from project package.json', (): void => {
    const root = createProject('lumen-cocos-detect-');
    try {
        const session = new LumenSession({ projectRoot: root });
        assert.equal(session.cocosVersion.toString(), '3.8.7');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('session falls back to baseline 3.8.3 when creator.version missing', (): void => {
    const root = createProject('lumen-cocos-fallback-');
    try {
        writeFileSync(join(root, 'package.json'), '{"name":"tmp"}\n');
        const session = new LumenSession({ projectRoot: root });
        assert.equal(session.cocosVersion.toString(), '3.8.3');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('Label outline fields require cocos >= 3.8.2', (): void => {
    const root = createProject('lumen-outline-gate-');
    try {
        const oldSession = new LumenSession({ projectRoot: root, cocosVersion: '3.8.0' });
        assert.equal(oldSession.propertySchema.listApiNames('cc.Label').includes('enableOutline'), false);
        oldSession.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Outline.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        oldSession.addChildFromTemplate({ parentPath: '/Root', template: 'ui/Label', name: 'Title' });
        assert.throws(
            (): void => {
                oldSession.setComponentProperty({
                    nodePath: '/Root/Title',
                    componentType: 'cc.Label',
                    patch: { enableOutline: true },
                });
            },
            /lumen_property_not_editable:cc\.Label\.enableOutline/,
        );
        oldSession.save();

        const baselineSession = new LumenSession({ projectRoot: root, cocosVersion: '3.8.3' });
        baselineSession.openPrefab('assets/ui/Outline.prefab');
        assert.equal(baselineSession.propertySchema.listApiNames('cc.Label').includes('enableOutline'), true);
        baselineSession.setComponentProperty({
            nodePath: '/Root/Title',
            componentType: 'cc.Label',
            patch: { enableOutline: true, outlineWidth: 2 },
        });
        baselineSession.save();
        const prefab = JSON.parse(readFileSync(join(root, 'assets/ui/Outline.prefab'), 'utf8')) as Array<
            Record<string, unknown>
        >;
        const label = prefab.find((entry) => entry.__type__ === 'cc.Label');
        assert.ok(label != null);
        assert.equal(label._enableOutline, true);
        assert.equal(label._outlineWidth, 2);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('cocos 3.8.3 baseline rejects deprecated LabelOutline', (): void => {
    const root = createProject('lumen-deprecated-383-');
    try {
        writeFileSync(join(root, 'package.json'), '{"name":"tmp","creator":{"version":"3.8.3"}}\n');
        const session = new LumenSession({ projectRoot: root });
        assert.equal(session.cocosVersion.toString(), '3.8.3');
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Deprecated383.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        assert.throws(
            (): void => {
                session.attachComponent({ nodePath: '/Root', builtinType: 'cc.LabelOutline' });
            },
            /lumen_component_deprecated:cc\.LabelOutline/,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('deprecated LabelOutline is never attachable', (): void => {
    const root = createProject('lumen-deprecated-');
    try {
        const session = new LumenSession({ projectRoot: root, cocosVersion: '3.8.7' });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Deprecated.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        assert.throws(
            (): void => {
                session.attachComponent({ nodePath: '/Root', builtinType: 'cc.LabelOutline' });
            },
            /lumen_component_deprecated:cc\.LabelOutline/,
        );
        const oldSession = new LumenSession({ projectRoot: root, cocosVersion: '3.8.0' });
        oldSession.openPrefab('assets/ui/Deprecated.prefab');
        assert.throws(
            (): void => {
                oldSession.attachComponent({ nodePath: '/Root', builtinType: 'cc.LabelOutline' });
            },
            /lumen_component_not_supported:cc\.LabelOutline/,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('schema lists version-gated Label outline props', (): void => {
    const root = createProject('lumen-schema-list-');
    try {
        const v383 = new LumenSession({ projectRoot: root, cocosVersion: '3.8.3' });
        assert.ok(v383.propertySchema.listSupportedComponents().includes('cc.Label'));
        assert.ok(v383.propertySchema.listApiNames('cc.Label').includes('enableOutline'));
        const described = v383.describeSchema('cc.Label');
        const align = described.props?.find((prop) => prop.apiName === 'horizontalAlign');
        assert.equal(align?.kind, 'enum');
        assert.ok((align?.enumHints?.length ?? 0) >= 3);
        const v380 = new LumenSession({ projectRoot: root, cocosVersion: '3.8.0' });
        assert.equal(v380.propertySchema.listApiNames('cc.Label').includes('enableOutline'), false);
        assert.ok(v380.propertySchema.listApiNames('cc.Label').includes('string'));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('template cache syncs bundled default_prefab when stale', (): void => {
    const root = createProject('lumen-template-cache-');
    const cacheDir = join(root, '.lumen-cache');
    try {
        const first = LumenDefaultTemplateRoot.ensurePluginCache(cacheDir);
        assert.equal(first.copied, true);
        assert.equal(first.manifest.cocosVersion, '3.8.3');
        assert.ok(existsSync(join(first.templateRoot, 'ui', 'Label.prefab')));
        assert.ok(first.manifest.templateCount >= 40);
        const second = LumenDefaultTemplateRoot.ensurePluginCache(cacheDir);
        assert.equal(second.copied, false);
        assert.equal(second.manifest.contentHash, first.manifest.contentHash);

        const session = new LumenSession({ projectRoot: root, templateCacheDir: cacheDir });
        const templates = session.listTemplates();
        assert.ok(templates.some((entry) => entry.id === 'ui/Label'));
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/FromCache.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.addChildFromTemplate({ parentPath: '/Root', template: 'ui/Label', name: 'Title' });
        session.save();
        assert.ok(existsSync(join(root, 'assets/ui/FromCache.prefab')));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('template cache reset and import pack succeed', (): void => {
    const root = createProject('lumen-cache-import-');
    const cacheA = join(root, 'cache-a');
    const cacheB = join(root, 'cache-b');
    try {
        const synced = LumenDefaultTemplateRoot.ensurePluginCache(cacheA);
        assert.equal(synced.manifest.cocosVersion, '3.8.3');
        const imported = LumenDefaultTemplateRoot.importPluginCache(cacheA, cacheB);
        assert.equal(imported.copied, true);
        assert.equal(imported.manifest.cocosVersion, '3.8.3');
        assert.ok(existsSync(join(cacheB, 'default_prefab', 'ui', 'Label.prefab')));

        const statusBefore = LumenDefaultTemplateRoot.readPluginCacheStatus(cacheB);
        assert.equal(statusBefore.inSyncWithBundled, true);

        const reset = LumenDefaultTemplateRoot.resetPluginCache(cacheB);
        assert.equal(reset.copied, true);
        assert.equal(reset.manifest.cocosVersion, '3.8.3');
        const statusAfter = LumenDefaultTemplateRoot.readPluginCacheStatus(cacheB);
        assert.equal(statusAfter.inSyncWithBundled, true);
        assert.equal(statusAfter.bundled.cocosVersion, '3.8.3');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('tree and inspect read prefab structure', (): void => {
    const root = createProject('lumen-tree-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Tree.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.addChildFromTemplate({ parentPath: '/Root', template: 'ui/Label', name: 'Title' });
        session.save();
        const tree = session.inspectTree();
        assert.equal(tree.name, 'Root');
        assert.ok(tree.children.some((child) => child.name === 'Title'));
        const inspected = session.inspectNode('/Root/Title');
        const label = inspected.components.find((component) => component.type === 'cc.Label');
        assert.ok(label != null);
        assert.ok(label.props != null);
        assert.equal(typeof label.props.string, 'string');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('comp-set writes nodeRef and componentRef as __id__', (): void => {
    const root = createProject('lumen-refs-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Refs.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.addChildFromTemplate({ parentPath: '/Root', template: 'ui/ScrollView', name: 'Scroll' });
        const tree = session.inspectTree();
        const scroll = tree.children.find((child) => child.name === 'Scroll');
        assert.ok(scroll != null);
        const contentChild = scroll.children
            .flatMap((child) => [child, ...child.children])
            .find((child) => child.name === 'content' || child.name === 'Content');
        assert.ok(contentChild != null, 'ScrollView template should include a content node');

        session.setComponentProperty({
            nodePath: '/Root/Scroll',
            componentType: 'cc.ScrollView',
            patch: { content: contentChild.path },
        });
        session.save();

        const inspected = session.inspectNode('/Root/Scroll');
        const scrollView = inspected.components.find((component) => component.type === 'cc.ScrollView');
        assert.ok(scrollView != null);
        assert.equal(scrollView.props.content, contentChild.path);

        const schema = session.describeSchema('cc.ScrollView');
        assert.ok('props' in schema);
        const contentProp = schema.props.find((prop) => prop.apiName === 'content');
        assert.equal(contentProp?.kind, 'nodeRef');
        const barProp = schema.props.find((prop) => prop.apiName === 'verticalScrollBar');
        assert.equal(barProp?.kind, 'componentRef');
        assert.equal(barProp?.refComponentType, 'cc.ScrollBar');

        assert.ok(session.describeSchema().components.includes('cc.SafeArea'));
        assert.ok(session.describeSchema().components.includes('cc.BlockInputEvents'));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('comp-set Toggle checkMark componentRef and Button target nodeRef', (): void => {
    const root = createProject('lumen-toggle-ref-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/ToggleRef.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.addChildFromTemplate({ parentPath: '/Root', template: 'ui/Toggle', name: 'Toggle' });
        const toggleInspect = session.inspectNode('/Root/Toggle');
        const checkMarkPath = toggleInspect.components
            .map((component) => {
                const mark = component.props.checkMark;
                if (mark != null && typeof mark === 'object' && 'nodePath' in mark) {
                    return (mark as { nodePath?: string }).nodePath;
                }
                return null;
            })
            .find((path) => typeof path === 'string');

        // Template already wires checkMark; re-set via API to prove round-trip.
        if (typeof checkMarkPath === 'string') {
            session.setComponentProperty({
                nodePath: '/Root/Toggle',
                componentType: 'cc.Toggle',
                patch: { checkMark: checkMarkPath, isChecked: false },
            });
            session.setComponentProperty({
                nodePath: '/Root/Toggle',
                componentType: 'cc.Toggle',
                patch: { target: '/Root/Toggle' },
            });
            session.save();
            const again = session.inspectNode('/Root/Toggle');
            const toggle = again.components.find((component) => component.type === 'cc.Toggle');
            assert.ok(toggle != null);
            assert.equal(toggle.props.isChecked, false);
            assert.equal(toggle.props.target, '/Root/Toggle');
            const mark = toggle.props.checkMark as { nodePath?: string; componentType?: string };
            assert.equal(mark.nodePath, checkMarkPath);
            assert.equal(mark.componentType, 'cc.Sprite');
        }

        session.addChildFromTemplate({ parentPath: '/Root', template: 'ui/Button', name: 'Btn' });
        session.setComponentProperty({
            nodePath: '/Root/Btn',
            componentType: 'cc.Button',
            patch: { target: '/Root' },
        });
        session.save();
        const btn = session.inspectNode('/Root/Btn').components.find((c) => c.type === 'cc.Button');
        assert.equal(btn?.props.target, '/Root');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('cocos-info reports project version and optional engine scan', (): void => {
    const root = createProject('lumen-cocos-info-');
    try {
        const session = new LumenSession({ projectRoot: root });
        const basic = session.probeCocosInfo();
        assert.equal(basic.projectVersion, '3.8.7');
        assert.equal(basic.effectiveVersion, '3.8.7');
        assert.equal(basic.trust.projectVersion, 'high');
        assert.equal(basic.engine, null);
        assert.equal(basic.trust.fieldAutoMap, 'none');

        const engineRoot = '/Users/alex/workspaces/VVGame-engine/engine-3.8.3';
        if (existsSync(engineRoot)) {
            const withEngine = session.probeCocosInfo(engineRoot);
            assert.ok(withEngine.engine != null);
            assert.equal(withEngine.trust.engineDts, 'medium');
            assert.ok((withEngine.engine?.matchedWhitelist.length ?? 0) > 20);
            assert.equal(withEngine.engine?.inEngineNotInWhitelist.autoMap, 'none');
            assert.equal(withEngine.engine?.inEngineNotInWhitelist.filter, 'componentExtendsHeuristic');
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('cocos-info paginates inEngineNotInWhitelist and never auto-maps', (): void => {
    const root = createProject('lumen-cocos-info-gaps-');
    const gapDts = join(process.cwd(), 'tests', 'fixtures', 'cc-gap.d.ts');
    try {
        const session = new LumenSession({ projectRoot: root });
        const first = session.probeCocosInfo(gapDts, { offset: 0, limit: 3 });
        const page = first.engine?.inEngineNotInWhitelist;
        assert.ok(page != null);
        assert.equal(page.autoMap, 'none');
        assert.equal(page.filter, 'componentExtendsHeuristic');
        assert.equal(page.offset, 0);
        assert.equal(page.limit, 3);
        assert.equal(page.items.length, 3);
        assert.equal(page.truncated, true);
        assert.equal(page.nextOffset, 3);
        assert.equal(page.total >= 8, true);
        assert.deepEqual(first.engine?.dtsNotInWhitelistSample, page.items);
        assert.equal(page.items.includes('cc.Vec3'), false);
        assert.equal(page.items.includes('cc.Label'), false);
        assert.equal(page.items.includes('cc.AnimationClip'), false);
        assert.equal(page.items.includes('cc.LabelAtlas'), false);

        const second = session.probeCocosInfo(gapDts, { offset: 3, limit: 3 });
        const secondPage = second.engine?.inEngineNotInWhitelist;
        assert.ok(secondPage != null);
        assert.equal(secondPage.offset, 3);
        assert.equal(secondPage.items.length, 3);
        assert.equal(secondPage.items[0] === page.items[0], false);

        assert.throws(
            () => session.probeCocosInfo(gapDts, { offset: -1, limit: 3 }),
            /lumen_cocos_info_gap_offset_invalid/,
        );
        assert.throws(
            () => session.probeCocosInfo(gapDts, { offset: 0, limit: 0 }),
            /lumen_cocos_info_gap_limit_invalid/,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('cocos-info accepts engine TypeScript source without cc.d.ts', (): void => {
    const root = createProject('lumen-cocos-info-ts-only-');
    const engineSource = join(process.cwd(), 'tests', 'fixtures', 'engine-serializable.ts');
    try {
        const session = new LumenSession({ projectRoot: root });
        const report = session.probeCocosInfo(engineSource, { offset: 0, limit: 20 });
        assert.equal(report.engine?.dtsPath, '');
        assert.ok(report.engine?.fieldGaps != null);
        assert.equal(report.engine?.fieldGaps?.inEngineNotInWhitelistFields.autoMap, 'none');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('cocos-info reports field-level inEngineNotInWhitelistFields from engine TypeScript source', (): void => {
    const root = createProject('lumen-cocos-info-field-gaps-');
    const engineSource = join(process.cwd(), 'tests', 'fixtures', 'engine-serializable.ts');
    try {
        const session = new LumenSession({ projectRoot: root });
        const dtsOnly = session.probeCocosInfo(join(process.cwd(), 'tests', 'fixtures', 'cc-gap.d.ts'));
        assert.equal(dtsOnly.engine?.fieldGaps, null);

        const withFields = session.probeCocosInfo(engineSource, { offset: 0, limit: 20 });
        const fieldPage = withFields.engine?.fieldGaps?.inEngineNotInWhitelistFields;
        assert.ok(fieldPage != null);
        assert.equal(fieldPage.autoMap, 'none');
        assert.equal(fieldPage.filter, 'engine-serializable-vs-curated');
        const trailProbeGap = fieldPage.items.find(
            (item) => item.componentType === 'cc.TrailModule' && item.apiName === 'probeGapOnlyField',
        );
        assert.ok(trailProbeGap != null);
        assert.equal(trailProbeGap.kind, 'boolean');
        assert.equal(
            fieldPage.items.some(
                (item) => item.componentType === 'cc.TrailModule' && item.apiName === 'widthFromParticle',
            ),
            false,
            'curated TrailModule fields must not appear in field gap report',
        );
        assert.equal(
            fieldPage.items.some(
                (item) => item.componentType === 'cc.TrailModule' && item.apiName === 'widthRatio',
            ),
            false,
            'curated TrailModule curve fields must not appear in field gap report',
        );
        assert.equal(
            fieldPage.items.some((item) => item.componentType === 'cc.LabelExtra'),
            false,
            'non-curated components must not appear in field gap report',
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('schema covers spine / motion streak / polygon and encodes vec2List', (): void => {
    const root = createProject('lumen-broad-');
    try {
        const session = new LumenSession({ projectRoot: root });
        const components = session.describeSchema().components;
        for (const type of [
            'sp.Skeleton',
            'dragonBones.ArmatureDisplay',
            'cc.MotionStreak',
            'cc.UICoordinateTracker',
            'cc.PolygonCollider2D',
            'cc.TerrainCollider',
            'cc.BoxCharacterController',
            'cc.SafeArea',
            'cc.HingeJoint2D',
            'cc.FixedConstraint',
            'cc.ParticleSystem',
            'cc.Line',
            'cc.LODGroup',
            'cc.Sorting2D',
            'cc.UISkew',
            'cc.TiledLayer',
            'cc.TiledObjectGroup',
            'cc.TiledTile',
            'cc.TiledUserNodeData',
            'cc.animation.AnimationController',
            'cc.SkinnedMeshBatchRenderer',
            'cc.SimplexCollider',
            'cc.PostProcess',
            'cc.Bloom',
            'cc.DOF',
            'cc.TAA',
            'cc.FSR',
            'cc.HBAO',
            'cc.ColorGrading',
            'cc.BlitScreen',
        ]) {
            assert.ok(components.includes(type), `missing ${type}`);
        }
        assert.equal(components.includes('cc.IKConstraint'), false);

        const spine = session.describeSchema('sp.Skeleton');
        assert.ok('props' in spine);
        const cacheMode = spine.props.find((prop) => prop.apiName === 'defaultCacheMode');
        assert.equal(cacheMode?.kind, 'enum');
        assert.ok((cacheMode?.enumHints?.length ?? 0) >= 3);

        const layout = session.describeSchema('cc.Layout');
        assert.ok('props' in layout);
        assert.ok(layout.props.some((prop) => prop.apiName === 'cellSize'));
        assert.ok(layout.props.some((prop) => prop.apiName === 'startAxis'));

        const particle = session.describeSchema('cc.ParticleSystem');
        assert.ok('props' in particle);
        const shape = particle.props.find((prop) => prop.apiName === 'shapeModule');
        assert.equal(shape?.kind, 'objectPatch');
        assert.ok((shape?.nestedProps?.length ?? 0) > 0);
        const rate = particle.props.find((prop) => prop.apiName === 'rateOverTime');
        assert.equal(rate?.kind, 'curveRange');

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Broad.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.PolygonCollider2D' });
        session.setComponentProperty({
            nodePath: '/Root',
            componentType: 'cc.PolygonCollider2D',
            patch: {
                points: [
                    { x: -2, y: -2 },
                    { x: 2, y: -2 },
                    { x: 0, y: 3 },
                ],
                threshold: 0.5,
            },
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.BlockInputEvents' });
        session.addChildFromSpec({
            parentPath: '/Root',
            spec: { name: 'FX', components: ['cc.UITransform'] },
        });
        session.attachComponent({ nodePath: '/Root/FX', builtinType: 'cc.ParticleSystem' });
        session.setComponentProperty({
            nodePath: '/Root/FX',
            componentType: 'cc.ParticleSystem',
            patch: {
                capacity: 64,
                rateOverTime: 30,
                startColor: { r: 255, g: 128, b: 0, a: 255 },
                bursts: [{ time: 0.2, repeatCount: 2, repeatInterval: 0.5 }],
                shapeModule: { enable: true, shapeType: 3, radius: 2 },
                colorOverLifetimeModule: { enable: true },
            },
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.Button' });
        session.setComponentProperty({
            nodePath: '/Root',
            componentType: 'cc.Button',
            patch: {
                clickEvents: [
                    {
                        target: '/Root',
                        component: 'DemoPanel',
                        handler: 'onClick',
                        customEventData: 'go',
                        componentId: 'e56c2BdWQZKnrEob356B/ap',
                    },
                ],
            },
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.BlitScreen' });
        session.setComponentProperty({
            nodePath: '/Root',
            componentType: 'cc.BlitScreen',
            patch: {
                materials: [
                    {
                        material: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                        enable: true,
                    },
                ],
            },
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.HingeJoint2D' });
        session.setComponentProperty({
            nodePath: '/Root',
            componentType: 'cc.HingeJoint2D',
            patch: { enableMotor: true, motorSpeed: 12, maxMotorTorque: 50 },
        });
        session.addChildFromSpec({
            parentPath: '/Root',
            spec: { name: 'Trail', components: ['cc.UITransform'] },
        });
        session.attachComponent({ nodePath: '/Root/Trail', builtinType: 'cc.Line' });
        session.setComponentProperty({
            nodePath: '/Root/Trail',
            componentType: 'cc.Line',
            patch: {
                worldSpace: true,
                width: 2,
                positions: [
                    { x: 0, y: 0, z: 0 },
                    { x: 5, y: 0, z: 0 },
                ],
            },
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.UISkew' });
        session.setComponentProperty({
            nodePath: '/Root',
            componentType: 'cc.UISkew',
            patch: { skew: { x: 8, y: 2 }, rotational: true },
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.Bloom' });
        session.setComponentProperty({
            nodePath: '/Root',
            componentType: 'cc.Bloom',
            patch: { intensity: 1.5, threshold: 0.6 },
        });
        session.save();

        const inspected = session.inspectNode('/Root');
        const fx = session.inspectNode('/Root/FX');
        const trail = session.inspectNode('/Root/Trail');
        const poly = inspected.components.find((component) => component.type === 'cc.PolygonCollider2D');
        assert.ok(poly != null);
        assert.deepEqual(poly.props.points, [
            { x: -2, y: -2 },
            { x: 2, y: -2 },
            { x: 0, y: 3 },
        ]);
        assert.equal(poly.props.threshold, 0.5);
        assert.ok(inspected.components.some((component) => component.type === 'cc.BlockInputEvents'));

        const ps = fx.components.find((component) => component.type === 'cc.ParticleSystem');
        assert.ok(ps != null);
        assert.equal(ps.props.capacity, 64);
        assert.equal((ps.props.rateOverTime as { constant?: number }).constant, 30);
        assert.equal((ps.props.startColor as { mode?: number; color?: { r?: number } }).mode, 0);
        assert.equal((ps.props.startColor as { color?: { r?: number; g?: number } }).color?.r, 255);
        assert.equal((ps.props.startColor as { color?: { g?: number } }).color?.g, 128);
        const bursts = ps.props.bursts as Array<{ time?: number; repeatCount?: number }>;
        assert.equal(bursts.length, 1);
        assert.equal(bursts[0]?.time, 0.2);
        assert.equal(bursts[0]?.repeatCount, 2);
        assert.equal((ps.props.shapeModule as { enable?: boolean; shapeType?: number; radius?: number }).enable, true);
        assert.equal((ps.props.shapeModule as { shapeType?: number }).shapeType, 3);
        assert.equal((ps.props.shapeModule as { radius?: number }).radius, 2);
        assert.equal((ps.props.colorOverLifetimeModule as { enable?: boolean }).enable, true);

        const button = inspected.components.find((component) => component.type === 'cc.Button');
        assert.ok(button != null);
        const clickEvents = button.props.clickEvents as Array<{
            target?: string | null;
            handler?: string;
            componentId?: string;
        }>;
        assert.equal(clickEvents.length, 1);
        assert.equal(clickEvents[0]?.target, '/Root');
        assert.equal(clickEvents[0]?.handler, 'onClick');
        assert.equal(clickEvents[0]?.componentId, 'e56c2BdWQZKnrEob356B/ap');

        const blit = inspected.components.find((component) => component.type === 'cc.BlitScreen');
        assert.ok(blit != null);
        const materials = blit.props.materials as Array<{ material?: string; enable?: boolean }>;
        assert.equal(materials.length, 1);
        assert.equal(materials[0]?.material, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        assert.equal(materials[0]?.enable, true);

        const hinge = inspected.components.find((component) => component.type === 'cc.HingeJoint2D');
        assert.ok(hinge != null);
        assert.equal(hinge.props.enableMotor, true);
        assert.equal(hinge.props.motorSpeed, 12);

        const line = trail.components.find((component) => component.type === 'cc.Line');
        assert.ok(line != null);
        assert.equal(line.props.worldSpace, true);
        assert.equal((line.props.width as { constant?: number }).constant, 2);
        assert.deepEqual(line.props.positions, [
            { x: 0, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 },
        ]);

        const skew = inspected.components.find((component) => component.type === 'cc.UISkew');
        assert.ok(skew != null);
        assert.equal(skew.props.rotational, true);
        const skewValue = skew.props.skew as { x?: number; y?: number };
        assert.equal(skewValue.x, 8);
        assert.equal(skewValue.y, 2);

        const bloom = inspected.components.find((component) => component.type === 'cc.Bloom');
        assert.ok(bloom != null);
        assert.equal(bloom.props.intensity, 1.5);
        assert.equal(bloom.props.threshold, 0.6);

        assert.throws(
            (): void => {
                session.attachComponent({ nodePath: '/Root', builtinType: 'cc.Component' });
            },
            /lumen_component_not_supported:cc\.Component:reason=abstract_or_internal/,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('renderer exclusive components cannot share one node', (): void => {
    const root = createProject('lumen-renderer-x-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Exclusive.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.Label' });
        assert.throws(
            (): void => {
                session.attachComponent({ nodePath: '/Root', builtinType: 'cc.ParticleSystem' });
            },
            /lumen_renderer_exclusive:cc\.ParticleSystem:conflicts=cc\.Label/,
        );
        session.addChildFromSpec({
            parentPath: '/Root',
            spec: { name: 'FX', components: ['cc.ParticleSystem'] },
        });
        const fx = session.inspectNode('/Root/FX');
        assert.equal(fx.node.layer, 1 << 30);
        assert.ok(fx.components.some((component) => component.type === 'cc.ParticleSystem'));
        assert.throws(
            (): void => {
                session.addChildFromSpec({
                    parentPath: '/Root',
                    spec: { name: 'Bad', components: ['cc.Label', 'cc.Sprite'] },
                });
            },
            /lumen_renderer_exclusive_batch:cc\.Label\+cc\.Sprite/,
        );
        const catalog = session.describeSchema();
        assert.ok(catalog.conventions != null);
        assert.ok(catalog.conventions!.rendererExclusive.includes('cc.Label'));
        const labelSchema = session.describeSchema('cc.Label');
        assert.equal(labelSchema.layerRole, 'ui2d');
        assert.equal(labelSchema.rendererExclusive, true);
        const particleSchema = session.describeSchema('cc.ParticleSystem');
        assert.equal(particleSchema.layerRole, 'world3d');
        assert.equal(particleSchema.rendererExclusive, true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('curveRange two-constants and keys round-trip; gradientRange colorKeys round-trip', (): void => {
    const root = createProject('lumen-curve-gradient-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/fx/Curve.prefab',
            rootName: 'FX',
            template: 'empty',
        });
        session.attachComponent({ nodePath: '/FX', builtinType: 'cc.ParticleSystem' });
        session.setComponentProperty({
            nodePath: '/FX',
            componentType: 'cc.ParticleSystem',
            patch: {
                rateOverTime: { mode: 3, constantMin: 4, constantMax: 12 },
                startLifetime: {
                    keys: [
                        { time: 0, value: 1 },
                        { time: 1, value: 3 },
                    ],
                },
                startColor: {
                    colorKeys: [
                        { time: 0, color: { r: 255, g: 255, b: 255, a: 255 } },
                        { time: 1, color: { r: 255, g: 0, b: 0, a: 128 } },
                    ],
                    alphaKeys: [
                        { time: 0, alpha: 255 },
                        { time: 1, alpha: 128 },
                    ],
                },
                colorOverLifetimeModule: {
                    enable: true,
                    color: {
                        colorKeys: [
                            { time: 0, color: { r: 255, g: 255, b: 255, a: 255 } },
                            { time: 1, color: { r: 0, g: 0, b: 0, a: 0 } },
                        ],
                    },
                },
                sizeOvertimeModule: {
                    enable: true,
                    size: {
                        keys: [
                            { time: 0, value: 1 },
                            { time: 1, value: 0.2 },
                        ],
                    },
                },
                velocityOvertimeModule: { enable: true, y: 12 },
            },
        });
        const inspected = session.inspectNode('/FX');
        const ps = inspected.components.find((component) => component.type === 'cc.ParticleSystem');
        assert.ok(ps != null);
        const rate = ps.props.rateOverTime;
        assert.ok(rate != null && typeof rate === 'object');
        const rateRecord = rate as { mode?: number; constantMin?: number; constantMax?: number };
        assert.equal(rateRecord.mode, 3);
        assert.equal(rateRecord.constantMin, 4);
        assert.equal(rateRecord.constantMax, 12);
        const lifetime = ps.props.startLifetime;
        assert.ok(lifetime != null && typeof lifetime === 'object');
        const lifetimeRecord = lifetime as { mode?: number; keys?: Array<{ time?: number; value?: number }> };
        assert.equal(lifetimeRecord.mode, 1);
        assert.equal(lifetimeRecord.keys?.[0]?.time, 0);
        assert.equal(lifetimeRecord.keys?.[0]?.value, 1);
        assert.equal(lifetimeRecord.keys?.[1]?.time, 1);
        assert.equal(lifetimeRecord.keys?.[1]?.value, 3);
        const startColor = ps.props.startColor;
        assert.ok(startColor != null && typeof startColor === 'object');
        const colorRecord = startColor as { mode?: number; colorKeys?: Array<{ time?: number }> };
        assert.equal(colorRecord.mode, 1);
        assert.equal(colorRecord.colorKeys?.length, 2);
        assert.equal(colorRecord.colorKeys?.[0]?.time, 0);
        const colorOver = ps.props.colorOverLifetimeModule as {
            enable?: boolean;
            color?: { mode?: number; colorKeys?: Array<{ time?: number }> };
        };
        assert.equal(colorOver.enable, true);
        assert.equal(colorOver.color?.mode, 1);
        assert.equal(colorOver.color?.colorKeys?.length, 2);
        const sizeOver = ps.props.sizeOvertimeModule as {
            enable?: boolean;
            size?: { mode?: number; keys?: Array<{ value?: number }> };
        };
        assert.equal(sizeOver.enable, true);
        assert.equal(sizeOver.size?.mode, 1);
        assert.equal(sizeOver.size?.keys?.[1]?.value, 0.2);
        const velocityOver = ps.props.velocityOvertimeModule as { enable?: boolean; y?: { constant?: number } };
        assert.equal(velocityOver.enable, true);
        assert.equal(velocityOver.y?.constant, 12);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('script property schema supports lists via setComponentProperty', (): void => {
    const root = createProject('lumen-script-props-');
    try {
        const scriptKey = 'e56c2BdWQZKnrEob356B/ap';
        const fields = [
            { apiName: 'title', serializedName: '_title', kind: 'string' as const },
            { apiName: 'scores', serializedName: '_scores', kind: 'numberList' as const },
            { apiName: 'targets', serializedName: '_targets', kind: 'nodeRefList' as const },
            {
                apiName: 'labels',
                serializedName: '_labels',
                kind: 'componentRefList' as const,
                refComponentType: 'cc.Label',
            },
        ];
        const session = new LumenSession({ projectRoot: root });
        session.registerScriptProperties(scriptKey, fields);
        const described = session.describeSchema(scriptKey);
        assert.ok('props' in described);
        assert.equal(described.props?.some((prop) => prop.apiName === 'targets'), true);

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/ScriptProps.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.Label' });
        session.save();

        const document = LumenPrefabDocument.open(root, 'assets/ui/ScriptProps.prefab');
        document.setPropertySchema(session.propertySchema);
        document.attachScriptComponent('/Root', scriptKey);
        document.setComponentProperty('/Root', scriptKey, {
            title: 'Hello',
            scores: [1, 2, 3],
            targets: ['/Root'],
            labels: ['/Root'],
        });
        document.save(root, false);

        const verifySession = new LumenSession({ projectRoot: root });
        verifySession.registerScriptProperties(scriptKey, fields);
        verifySession.openPrefab('assets/ui/ScriptProps.prefab');
        const node = verifySession.inspectNode('/Root');
        const script = node.components.find((component) => component.type === scriptKey);
        assert.ok(script != null);
        assert.equal(script.props.title, 'Hello');
        assert.deepEqual(script.props.scores, [1, 2, 3]);
        assert.deepEqual(script.props.targets, ['/Root']);
        const labels = script.props.labels as Array<{ nodePath?: string }>;
        assert.equal(labels[0]?.nodePath, '/Root');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('ensureScriptProperties discovers @property from project source', (): void => {
    const root = createProject('lumen-script-discover-');
    try {
        const scriptUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const compressed = new CocosUuidCodec().compress(scriptUuid);
        mkdirSync(join(root, 'assets', 'scripts'), { recursive: true });
        writeFileSync(
            join(root, 'assets/scripts/ProbeLike.ts'),
            `import { _decorator, Component, Node, Label, CCInteger } from 'cc';
const { ccclass, property } = _decorator;
@ccclass('ProbeLike')
export class ProbeLike extends Component {
  @property
  public labelText: string = 'x';
  @property({ type: [CCInteger] })
  public scores: number[] = [];
  @property({ type: [Node] })
  public targets: Node[] = [];
  @property({ type: [Label] })
  public labels: Label[] = [];
}
`,
        );
        writeFileSync(
            join(root, 'assets/scripts/ProbeLike.ts.meta'),
            `${JSON.stringify(
                {
                    ver: '4.0.24',
                    importer: 'typescript',
                    imported: true,
                    uuid: scriptUuid,
                    files: ['.js'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );

        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Discover.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.addChildFromSpec({
            parentPath: '/Root',
            spec: { name: 'Title', components: ['cc.UITransform', 'cc.Label'] },
        });
        session.refreshCatalog();
        session.attachComponent({ nodePath: '/Root', scriptName: 'ProbeLike' });
        assert.equal(session.listRegisteredScripts().includes(compressed), true);

        const byName = session.describeSchema('ProbeLike');
        assert.equal(byName.component, compressed);
        assert.equal(byName.props?.some((prop) => prop.apiName === 'scores'), true);

        session.setComponentProperty({
            nodePath: '/Root',
            componentType: compressed,
            patch: {
                labelText: 'discovered',
                scores: [9, 8],
                targets: ['/Root'],
                labels: ['/Root/Title'],
            },
        });
        session.save();

        const verify = new LumenSession({ projectRoot: root });
        verify.refreshCatalog();
        verify.openPrefab('assets/ui/Discover.prefab');
        const inspected = verify.inspectNode('/Root');
        const script = inspected.components.find((component) => component.type === compressed);
        assert.ok(script != null);
        assert.equal(script.props.labelText, 'discovered');
        assert.deepEqual(script.props.scores, [9, 8]);
        assert.equal(
            Array.isArray(script.props.targets) && script.props.targets.includes('/Root'),
            true,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('repeated save and reopen keeps prefab JSON and meta uuid intact', (): void => {
    const root = createProject('lumen-durable-');
    try {
        const relativePath = 'assets/ui/Durable.prefab';
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: relativePath,
            rootName: 'Root',
            template: 'empty',
        });
        session.addChildFromSpec({
            parentPath: '/Root',
            spec: { name: 'Title', components: ['cc.UITransform', 'cc.Label'] },
        });
        session.save();
        const prefabPath = join(root, relativePath);
        const metaPath = `${prefabPath}.meta`;
        const metaUuid = readMetaUuid(metaPath);
        assert.ok(metaUuid.length > 0);

        for (let cycle = 0; cycle < 80; cycle += 1) {
            const writer = new LumenSession({ projectRoot: root });
            writer.openPrefab(relativePath);
            if (cycle === 0) {
                writer.buildFromRecipe({
                    parentPath: '/Root',
                    recipe: Array.from({ length: 40 }, (_, index) => ({
                        name: `Cell_${index}`,
                        components: ['cc.UITransform', 'cc.Label'],
                        componentProps: { 'cc.Label': { string: `c${index}` } },
                    })),
                });
            }
            writer.setComponentProperty({
                nodePath: '/Root/Title',
                componentType: 'cc.Label',
                patch: { string: `tick-${cycle}` },
            });
            if (cycle === 40) {
                for (let index = 0; index < 40; index += 1) {
                    writer.removeNode(`/Root/Cell_${index}`);
                }
            }
            writer.save();
            assertNoTmpFiles(join(root, 'assets/ui'));

            const reader = new LumenSession({ projectRoot: root });
            reader.openPrefab(relativePath);
            assert.equal(reader.inspectTree().name, 'Root');
            const title = reader.inspectNode('/Root/Title');
            const label = title.components.find((component) => component.type === 'cc.Label');
            assert.equal(label?.props.string, `tick-${cycle}`);
            const disk = JSON.parse(readFileSync(prefabPath, 'utf8')) as Array<Record<string, unknown>>;
            assert.equal(disk[0]?.__type__, 'cc.Prefab');
            assertUniqueFileIds(disk);
            assert.equal(readMetaUuid(metaPath), metaUuid);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('atomic writer leaves original prefab readable if a sibling tmp is leftover', (): void => {
    const root = createProject('lumen-atomic-tmp-');
    try {
        const relativePath = 'assets/ui/Safe.prefab';
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({ prefabRelativePath: relativePath, rootName: 'Safe', template: 'empty' });
        const prefabPath = join(root, relativePath);
        const original = readFileSync(prefabPath, 'utf8');
        writeFileSync(join(root, 'assets/ui/.Safe.prefab.crash.tmp'), '[{"truncated":true', 'utf8');
        const reopened = new LumenSession({ projectRoot: root });
        reopened.openPrefab(relativePath);
        assert.equal(reopened.inspectTree().name, 'Safe');
        assert.equal(readFileSync(prefabPath, 'utf8'), original);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('open rejects truncated prefab JSON instead of returning a half document', (): void => {
    const root = createProject('lumen-corrupt-');
    try {
        mkdirSync(join(root, 'assets/ui'), { recursive: true });
        writeFileSync(join(root, 'assets/ui/Broken.prefab'), '[{"__type__":"cc.Prefab"', 'utf8');
        const session = new LumenSession({ projectRoot: root });
        assert.throws(() => session.openPrefab('assets/ui/Broken.prefab'), /lumen_prefab_json_corrupt/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('atomic overwrite of a shorter document does not keep the previous file tail', (): void => {
    const root = createProject('lumen-shorten-');
    try {
        const target = join(root, 'assets/ui/Shorten.prefab');
        mkdirSync(join(root, 'assets/ui'), { recursive: true });
        const longBody = `${JSON.stringify([{ __type__: 'cc.Prefab', _name: 'LongPadding'.repeat(200) }, { __type__: 'cc.Node', _name: 'Root' }], null, 2)}\n`;
        writeFileSync(target, longBody, 'utf8');
        const shortBody = `${JSON.stringify([{ __type__: 'cc.Prefab', _name: 'S' }, { __type__: 'cc.Node', _name: 'Root' }], null, 2)}\n`;
        LumenAtomicFileWriter.writeUtf8(target, shortBody);
        const onDisk = readFileSync(target, 'utf8');
        assert.equal(onDisk, shortBody);
        assert.equal(onDisk.includes('LongPadding'), false);
        assert.equal(JSON.parse(onDisk)[0].__type__, 'cc.Prefab');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('inspector parity discovers instance fields and allows engine attach outside curated table', (): void => {
    const root = createProject('lumen-inspector-parity-');
    try {
        const session = new LumenSession({ projectRoot: root });
        const catalog = session.describeSchema();
        assert.equal(catalog.inspectorParity?.attach, 'engine-deny-list');
        assert.equal(catalog.inspectorParity?.fields, 'curated+serialized-instance+engine-serializable');
        assert.equal(catalog.inspectorParity?.engineCatalogSize, 0);

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/fx/Parity.prefab',
            rootName: 'FX',
            template: 'empty',
        });
        session.attachComponent({ nodePath: '/FX', builtinType: 'cc.LabelExtra' });
        session.setComponentProperty({
            nodePath: '/FX',
            componentType: 'cc.LabelExtra',
            patch: { extraScale: 2.5 },
        });
        const extraInspect = session.inspectNode('/FX');
        const extra = extraInspect.components.find((component) => component.type === 'cc.LabelExtra');
        assert.ok(extra != null);
        assert.equal(extra.props.extraScale, 2.5);

        session.addChildFromTemplate({
            parentPath: '/FX',
            template: 'effects/Particle System',
            name: 'Burst',
        });
        session.setComponentProperty({
            nodePath: '/FX/Burst',
            componentType: 'cc.ParticleSystem',
            patch: {
                trailModule: { enable: true, widthFromParticle: false, colorFromParticle: true },
            },
        });
        const burst = session.inspectNode('/FX/Burst');
        const ps = burst.components.find((component) => component.type === 'cc.ParticleSystem');
        assert.ok(ps != null);
        const trail = ps.props.trailModule as {
            enable?: boolean;
            widthFromParticle?: boolean;
            colorFromParticle?: boolean;
        };
        assert.equal(trail.enable, true);
        assert.equal(trail.widthFromParticle, false);
        assert.equal(trail.colorFromParticle, true);

        assert.throws(
            (): void => {
                session.attachComponent({ nodePath: '/FX', builtinType: 'cc.Renderer' });
            },
            /lumen_component_not_supported:cc\.Renderer/,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('engine serializable overlay fills schema and stub particle trail fields', (): void => {
    const root = createProject('lumen-engine-serializable-');
    const engineSource = join(process.cwd(), 'tests', 'fixtures', 'engine-serializable.ts');
    try {
        const parsed = LumenEngineSerializableProbe.parseSource(readFileSync(engineSource, 'utf8'));
        assert.ok(parsed.get('cc.LabelExtra') != null);
        const extraField = parsed.get('cc.LabelExtra')?.find((field) => field.apiName === 'extraScale');
        assert.equal(extraField?.kind, 'number');
        assert.equal(extraField?.origin, 'engine');

        const session = new LumenSession({ projectRoot: root, engineRoot: engineSource });
        assert.equal(session.describeSchema().inspectorParity?.engineCatalogSize != null, true);
        assert.equal((session.describeSchema().inspectorParity?.engineCatalogSize ?? 0) > 0, true);
        const extraSchema = session.describeSchema('cc.LabelExtra');
        const extraScale = extraSchema.props?.find((prop) => prop.apiName === 'extraScale');
        assert.equal(extraScale?.origin, 'engine');
        assert.equal(extraScale?.kind, 'number');

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/fx/Engine.prefab',
            rootName: 'FX',
            template: 'empty',
        });
        session.attachComponent({ nodePath: '/FX', builtinType: 'cc.ParticleSystem' });
        session.setComponentProperty({
            nodePath: '/FX',
            componentType: 'cc.ParticleSystem',
            patch: { trailModule: { widthFromParticle: false } },
        });
        const inspected = session.inspectNode('/FX');
        const ps = inspected.components.find((component) => component.type === 'cc.ParticleSystem');
        assert.ok(ps != null);
        const trail = ps.props.trailModule as { widthFromParticle?: boolean };
        assert.equal(trail.widthFromParticle, false);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('scene scaffold seeds Main Camera clearFlags=14 before optional Canvas', (): void => {
    const root = createProject('lumen-scene-baseline-');
    try {
        const emptySession = new LumenSession({ projectRoot: root });
        emptySession.scaffoldPrefab({
            prefabRelativePath: 'assets/Empty.scene',
            rootName: 'Empty',
            template: 'empty',
        });
        const emptyTree = emptySession.inspectTree();
        assert.deepEqual(
            emptyTree.children.map((child) => child.name).sort(),
            ['Main Camera', 'Main Light'],
        );

        const canvasSession = new LumenSession({ projectRoot: root });
        canvasSession.scaffoldPrefab({
            prefabRelativePath: 'assets/Ui.scene',
            rootName: 'Ui',
            template: 'ui/Canvas',
        });
        // 重复 reset 不得叠加第二套 Main Camera / Canvas
        canvasSession.scaffoldPrefab({
            prefabRelativePath: 'assets/Ui.scene',
            rootName: 'Ui',
            template: 'ui/Canvas',
            reset: true,
        });
        const uiTree = canvasSession.inspectTree();
        assert.equal(uiTree.children.filter((child) => child.name === 'Main Camera').length, 1);
        assert.equal(uiTree.children.filter((child) => child.name === 'Main Light').length, 1);
        assert.equal(uiTree.children.filter((child) => child.name === 'Canvas').length, 1);
        assert.equal(
            uiTree.children.find((child) => child.name === 'Canvas')?.children.some((child) => child.name === 'Camera'),
            true,
        );

        const sceneJson = JSON.parse(readFileSync(join(root, 'assets/Ui.scene'), 'utf8')) as Array<
            Record<string, unknown>
        >;
        assert.equal(
            sceneJson.some(
                (entry) => entry.__type__ === 'cc.CompPrefabInfo' || entry.__type__ === 'cc.PrefabInfo',
            ),
            false,
            'embedded templates must unpack PrefabInfo (else asset.__id__=0 binds SceneAsset)',
        );
        assert.equal(
            sceneJson
                .filter((entry) => entry.__type__ === 'cc.Node')
                .every((node) => node._prefab == null),
            true,
        );
        assert.equal(
            sceneJson.every((entry) => entry.__prefab == null),
            true,
        );
        const cameras = sceneJson.filter((entry) => entry.__type__ === 'cc.Camera');
        assert.equal(cameras.length, 2);
        const byNodeName = (name: string): Record<string, unknown> | undefined => {
            const node = sceneJson.find((entry) => entry.__type__ === 'cc.Node' && entry._name === name);
            if (node == null) {
                return undefined;
            }
            const nodeIndex = sceneJson.indexOf(node);
            return cameras.find((camera) => {
                const ref = camera.node as { __id__?: number } | undefined;
                return ref?.__id__ === nodeIndex;
            });
        };
        assert.equal(byNodeName('Main Camera')?._clearFlags, 14);
        assert.equal(byNodeName('Camera')?._clearFlags, 6);
        const skybox = sceneJson.find((entry) => entry.__type__ === 'cc.SkyboxInfo') as
            | { _enabled?: unknown; _envmapHDR?: { __uuid__?: string } | null }
            | undefined;
        assert.equal(skybox?._enabled, true);
        assert.equal(
            typeof skybox?._envmapHDR?.__uuid__ === 'string' && skybox._envmapHDR.__uuid__.length > 0,
            true,
            'skybox envmap must be bound (null envmap + enabled == editor white fog)',
        );
        const mainNode = sceneJson.find(
            (entry) => entry.__type__ === 'cc.Node' && entry._name === 'Main Camera',
        ) as { _lpos?: { x?: number; y?: number; z?: number } } | undefined;
        assert.equal(mainNode?._lpos?.x, -10);
        assert.equal(mainNode?._lpos?.y, 10);
        assert.equal(mainNode?._lpos?.z, 10);
        const mainCamColor = byNodeName('Main Camera')?._color as
            | { r?: number; g?: number; b?: number }
            | undefined;
        assert.equal(mainCamColor?.r, 51);
        assert.equal(mainCamColor?.g, 51);
        assert.equal(mainCamColor?.b, 51);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('scene scaffold rejects rootName Canvas with ui/Canvas template', (): void => {
    const root = createProject('lumen-scene-canvas-collide-');
    try {
        const session = new LumenSession({ projectRoot: root });
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/Bad.scene',
                    rootName: 'Canvas',
                    template: 'ui/Canvas',
                }),
            /lumen_scene_root_name_collides_with_canvas_template/,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('scene scaffold shares node CRUD with prefab and rejects attach on scene root', (): void => {
    const root = createProject('lumen-scene-');
    try {
        const session = new LumenSession({ projectRoot: root });
        const relativePath = session.scaffoldPrefab({
            prefabRelativePath: 'assets/Game.scene',
            rootName: 'Game',
            template: 'ui/Canvas',
        });
        assert.equal(relativePath, 'assets/Game.scene');
        assert.equal(session.openedAssetKind, 'scene');
        const sceneJson = JSON.parse(readFileSync(join(root, 'assets/Game.scene'), 'utf8')) as Array<{
            __type__?: string;
            _enabled?: boolean;
        }>;
        const skybox = sceneJson.find((entry) => entry.__type__ === 'cc.SkyboxInfo');
        assert.equal(skybox?._enabled, true);
        const tree = session.inspectTree();
        assert.equal(tree.path, '/Game');
        assert.equal(tree.children.some((child) => child.name === 'Main Camera'), true);
        assert.equal(tree.children.some((child) => child.name === 'Main Light'), true);
        assert.equal(tree.children.some((child) => child.name === 'Canvas'), true);
        assert.throws(
            () => session.attachComponent({ nodePath: '/Game', builtinType: 'cc.Label' }),
            /lumen_cannot_attach_on_scene/,
        );
        session.addChildFromTemplate({ parentPath: '/Game/Canvas', template: 'ui/Label', name: 'Title' });
        session.setComponentProperty({
            nodePath: '/Game/Canvas/Title',
            componentType: 'cc.Label',
            patch: { string: 'Scene Hello' },
        });
        session.save();
        const meta = JSON.parse(readFileSync(join(root, 'assets/Game.scene.meta'), 'utf8')) as {
            importer?: unknown;
        };
        assert.equal(meta.importer, 'scene');

        const verify = new LumenSession({ projectRoot: root });
        verify.openPrefab('assets/Game.scene');
        assert.equal(verify.openedAssetKind, 'scene');
        const title = verify.inspectNode('/Game/Canvas/Title');
        const label = title.components.find((component) => component.type === 'cc.Label');
        assert.ok(label != null);
        assert.equal(label.props.string, 'Scene Hello');
        assert.throws(() => verify.removeNode('/Game'), /lumen_cannot_remove_root/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('meta importer versions resolve material ver by Creator range', (): void => {
    const versions = LumenMetaImporterVersions.shared();
    assert.equal(versions.resolve(LumenCocosVersion.parse('3.6.4'), 'prefab'), '1.1.42');
    assert.equal(versions.resolve(LumenCocosVersion.parse('3.6.4'), 'material'), '1.0.12');
    assert.equal(versions.resolve(LumenCocosVersion.parse('3.7.4'), 'prefab'), '1.1.46');
    assert.equal(versions.resolve(LumenCocosVersion.parse('3.7.4'), 'material'), '1.0.18');
    assert.equal(versions.resolve(LumenCocosVersion.parse('3.8.3'), 'material'), '1.0.21');
    assert.equal(versions.resolve(LumenCocosVersion.parse('3.8.7'), 'material'), '1.0.21');
    assert.equal(versions.resolve(LumenCocosVersion.parse('3.8.7'), 'prefab'), '1.1.50');
    assert.equal(versions.resolve(LumenCocosVersion.parse('3.8.7'), 'unknown-importer'), '1.0.0');
});

test('material scaffold inspects and patches Inspector fields without a node tree', (): void => {
    const root = createProject('lumen-mtl-');
    try {
        const session = new LumenSession({ projectRoot: root });
        const relativePath = session.scaffoldPrefab({
            prefabRelativePath: 'assets/fx/Lit.mtl',
            rootName: 'Lit',
            template: 'standard',
        });
        assert.equal(relativePath, 'assets/fx/Lit.mtl');
        assert.equal(session.openedAssetKind, 'material');
        const snapshot = session.inspectMaterial();
        assert.equal(snapshot.kind, 'material');
        assert.equal(snapshot.name, 'Lit');
        assert.equal(snapshot.effectAsset, '1baf0fc9-befa-459c-8bdd-af1a450a0319');
        assert.equal(snapshot.props[0]?.roughness, 0.8);
        assert.throws(() => session.inspectTree(), /lumen_not_hierarchy_asset/);
        assert.throws(
            () => session.attachComponent({ nodePath: '/Lit', builtinType: 'cc.Label' }),
            /lumen_not_hierarchy_asset/,
        );

        plantUuidStubs(root, ['c8f66d17-351a-48da-a12c-0212d28575c4']);
        session.setAssetProperty({
            patch: {
                effectAsset: 'c8f66d17-351a-48da-a12c-0212d28575c4',
                props: { roughness: 0.2 },
            },
        });
        session.save();
        const meta = JSON.parse(readFileSync(join(root, 'assets/fx/Lit.mtl.meta'), 'utf8')) as {
            importer?: unknown;
            ver?: unknown;
        };
        assert.equal(meta.importer, 'material');
        assert.equal(
            meta.ver,
            LumenMetaImporterVersions.shared().resolve(session.cocosVersion, 'material'),
        );

        const verify = new LumenSession({ projectRoot: root });
        verify.openPrefab('assets/fx/Lit.mtl');
        assert.equal(verify.openedAssetKind, 'material');
        const again = verify.inspectMaterial();
        assert.equal(again.effectAsset, 'c8f66d17-351a-48da-a12c-0212d28575c4');
        assert.equal(again.props[0]?.roughness, 0.2);
        assert.equal(again.props[0]?.metallic, 0.6);
        assert.throws(
            () => session.scaffoldPrefab({
                prefabRelativePath: 'assets/fx/Unknown.mtl',
                rootName: 'Unknown',
                template: 'ui/Label',
            }),
            /lumen_material_template_unknown/,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('animation clip blocks raw tracks without allowRawTracks', (): void => {
    const root = createProject('lumen-anim-raw-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/anim/Idle.anim',
            rootName: 'Idle',
            template: 'empty',
        });
        assert.throws(
            () => session.setAssetProperty({ patch: { tracks: [{ id: 't0' }] } }),
            /lumen_animation_clip_raw_tracks_blocked/,
        );
        session.setAssetProperty({
            patch: {
                allowRawTracks: true,
                tracks: [{ id: 't0' }],
                curveDatas: { Root: {} },
            },
        });
        session.save();
        const verify = new LumenSession({ projectRoot: root });
        verify.openPrefab('assets/anim/Idle.anim');
        const inspect = verify.inspectAsset();
        assert.equal(inspect.kind, 'animationClip');
        if (inspect.kind === 'animationClip') {
            assert.equal(inspect.tracks.length, 1);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('animation clip physics material and terrain share inspect and asset-set', (): void => {
    const root = createProject('lumen-standalone-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/anim/Idle.anim',
            rootName: 'Idle',
            template: 'empty',
        });
        assert.equal(session.openedAssetKind, 'animationClip');
        session.setAssetProperty({
            patch: {
                wrapMode: 'Loop',
                sample: 30,
                speed: 1.5,
                duration: 2,
                events: [{ frame: 0.5, func: 'onStep', params: ['a'] }],
                curves: [
                    {
                        path: 'Root',
                        property: 'eulerAngles',
                        keys: [0, 2],
                        values: [
                            [0, 0, 0],
                            [0, 90, 0],
                        ],
                    },
                ],
            },
        });
        session.save();
        const clipMeta = JSON.parse(readFileSync(join(root, 'assets/anim/Idle.anim.meta'), 'utf8')) as {
            importer?: unknown;
        };
        assert.equal(clipMeta.importer, 'animation-clip');
        const clip = new LumenSession({ projectRoot: root });
        clip.openPrefab('assets/anim/Idle.anim');
        const clipInspect = clip.inspectAsset();
        assert.equal(clipInspect.kind, 'animationClip');
        if (clipInspect.kind === 'animationClip') {
            assert.equal(clipInspect.wrapMode, 2);
            assert.equal(clipInspect.wrapModeName, 'Loop');
            assert.equal(clipInspect.sample, 30);
            assert.equal(clipInspect.speed, 1.5);
            assert.equal(clipInspect.events[0]?.func, 'onStep');
            assert.equal(clipInspect.curves.length, 1);
        }

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/phys/Ground.pmtl',
            rootName: 'Ground',
            template: 'empty',
        });
        session.setAssetProperty({ patch: { friction: 0.9, restitution: 0.2 } });
        session.save();
        const phys = new LumenSession({ projectRoot: root });
        phys.openPrefab('assets/phys/Ground.pmtl');
        const physInspect = phys.inspectAsset();
        assert.equal(physInspect.kind, 'physicsMaterial');
        if (physInspect.kind === 'physicsMaterial') {
            assert.equal(physInspect.friction, 0.9);
            assert.equal(physInspect.restitution, 0.2);
            assert.equal(physInspect.rollingFriction, 0.1);
        }
        const physMeta = JSON.parse(readFileSync(join(root, 'assets/phys/Ground.pmtl.meta'), 'utf8')) as {
            importer?: unknown;
        };
        assert.equal(physMeta.importer, 'physics-material');

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/land/Field.terrain',
            rootName: 'Field',
            template: 'empty',
        });
        plantUuidStubs(root, ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
        session.setAssetProperty({
            patch: {
                layerInfos: [
                    {
                        slot: 0,
                        tileSize: 2,
                        detailMap: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                    },
                ],
            },
        });
        session.save();
        const terrain = new LumenSession({ projectRoot: root });
        terrain.openPrefab('assets/land/Field.terrain');
        const terrainInspect = terrain.inspectAsset();
        assert.equal(terrainInspect.kind, 'terrain');
        if (terrainInspect.kind === 'terrain') {
            assert.equal(terrainInspect.layerInfos[0]?.tileSize, 2);
            assert.equal(terrainInspect.layerInfos[0]?.detailMap, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
            assert.equal(terrainInspect.layerInfos[0]?.normalMap, null);
        }
        assert.throws(() => terrain.inspectTree(), /lumen_not_hierarchy_asset/);
        const terrainMeta = JSON.parse(readFileSync(join(root, 'assets/land/Field.terrain.meta'), 'utf8')) as {
            importer?: unknown;
        };
        assert.equal(terrainMeta.importer, 'terrain');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('image meta inspects and patches texture and sprite-frame settings without touching source', (): void => {
    const root = createProject('lumen-image-meta-');
    try {
        const imagePath = join(root, 'assets/Icon.png');
        writeFileSync(imagePath, 'png-source');
        writeFileSync(
            `${imagePath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.27',
                    importer: 'image',
                    imported: true,
                    uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                    files: ['.json', '.png'],
                    subMetas: {
                        textureId: {
                            importer: 'texture',
                            uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@texture',
                            userData: {
                                wrapModeS: 'clamp-to-edge',
                                wrapModeT: 'clamp-to-edge',
                                minfilter: 'linear',
                                magfilter: 'linear',
                                mipfilter: 'none',
                                anisotropy: 0,
                                internalTextureField: 'preserved',
                            },
                        },
                        spriteId: {
                            importer: 'sprite-frame',
                            uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@sprite',
                            userData: {
                                trimThreshold: 1,
                                rotated: false,
                                borderTop: 0,
                                borderBottom: 0,
                                borderLeft: 0,
                                borderRight: 0,
                                packable: true,
                                pixelsToUnit: 100,
                                pivotX: 0.5,
                                pivotY: 0.5,
                                meshType: 0,
                                trimType: 'auto',
                                vertices: { internal: true },
                            },
                        },
                    },
                    userData: {
                        type: 'sprite-frame',
                        hasAlpha: true,
                        fixAlphaTransparencyArtifacts: false,
                    },
                },
                null,
                2,
            )}\n`,
        );

        const session = new LumenSession({ projectRoot: root });
        session.openPrefab('assets/Icon.png');
        assert.equal(session.openedAssetKind, 'image');
        const before = session.inspectAsset();
        assert.equal(before.kind, 'image');
        if (before.kind === 'image') {
            assert.equal(before.texture.wrapModeS, 'clamp-to-edge');
            assert.equal(before.spriteFrame?.pivotX, 0.5);
            assert.equal(before.image.hasAlpha, true);
        }

        session.setAssetProperty({
            patch: {
                image: { fixAlphaTransparencyArtifacts: true },
                texture: {
                    wrapModeS: 'repeat',
                    minfilter: 'nearest',
                    mipfilter: 'linear',
                    anisotropy: 4,
                },
                spriteFrame: {
                    borderTop: 8,
                    borderBottom: 9,
                    borderLeft: 10,
                    borderRight: 11,
                    packable: false,
                    pixelsToUnit: 64,
                    pivotX: 0.25,
                    pivotY: 0.75,
                },
            },
        });
        session.save();

        assert.equal(readFileSync(imagePath, 'utf8'), 'png-source');
        const verify = new LumenSession({ projectRoot: root });
        verify.openPrefab('assets/Icon.png');
        const after = verify.inspectAsset();
        assert.equal(after.kind, 'image');
        if (after.kind === 'image') {
            assert.equal(after.image.fixAlphaTransparencyArtifacts, true);
            assert.equal(after.texture.wrapModeS, 'repeat');
            assert.equal(after.texture.anisotropy, 4);
            assert.equal(after.spriteFrame?.borderTop, 8);
            assert.equal(after.spriteFrame?.packable, false);
            assert.equal(after.spriteFrame?.pivotY, 0.75);
        }
        const saved = JSON.parse(readFileSync(`${imagePath}.meta`, 'utf8')) as {
            subMetas: {
                textureId: { userData: Record<string, unknown> };
                spriteId: { userData: Record<string, unknown> };
            };
        };
        assert.equal(saved.subMetas.textureId.userData.internalTextureField, 'preserved');
        assert.deepEqual(saved.subMetas.spriteId.userData.vertices, { internal: true });
        assert.throws(
            () => verify.setAssetProperty({ patch: { spriteFrame: { bogusField: 99 } } }),
            /lumen_image_property_not_editable:spriteFrame.bogusField/,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('effect scaffold inspects yaml properties and patches program source', (): void => {
    const root = createProject('lumen-effect-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/fx/Unlit.effect',
            rootName: 'Unlit',
            template: 'empty',
        });
        assert.equal(session.openedAssetKind, 'effect');
        const snapshot = session.inspectAsset();
        assert.equal(snapshot.kind, 'effect');
        if (snapshot.kind === 'effect') {
            assert.equal(snapshot.techniques.includes('opaque'), true);
            assert.equal(snapshot.properties.mainTexture, 'white');
            assert.deepEqual(snapshot.properties.mainColor, [1, 1, 1, 1]);
            assert.equal(snapshot.programs.some((program) => program.name === 'unlit-fs'), true);
        }
        session.setAssetProperty({
            patch: {
                properties: { mainColor: [1, 0, 0, 1], mainTexture: 'black' },
                programs: { 'unlit-fs': '\n  vec4 frag () { return vec4(1.0); }\n' },
            },
        });
        session.save();
        const meta = JSON.parse(readFileSync(join(root, 'assets/fx/Unlit.effect.meta'), 'utf8')) as {
            importer?: unknown;
        };
        assert.equal(meta.importer, 'effect');
        const verify = new LumenSession({ projectRoot: root });
        verify.openPrefab('assets/fx/Unlit.effect');
        const again = verify.inspectAsset();
        assert.equal(again.kind, 'effect');
        if (again.kind === 'effect') {
            assert.deepEqual(again.properties.mainColor, [1, 0, 0, 1]);
            assert.equal(again.properties.mainTexture, 'black');
            assert.equal(again.programs[0]?.source.includes('return vec4(1.0)'), true);
        }
        assert.throws(
            () => verify.setAssetProperty({ patch: { properties: { missingProp: 1 } } }),
            /lumen_effect_property_missing:missingProp/,
        );

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/fx/common.chunk',
            rootName: 'common',
            template: 'empty',
        });
        assert.equal(session.openedAssetKind, 'effectChunk');
        session.setAssetProperty({ patch: { source: '// patched chunk\n' } });
        session.save();
        const chunk = new LumenSession({ projectRoot: root });
        chunk.openPrefab('assets/fx/common.chunk');
        const chunkInspect = chunk.inspectAsset();
        assert.equal(chunkInspect.kind, 'effectChunk');
        if (chunkInspect.kind === 'effectChunk') {
            assert.equal(chunkInspect.source, '// patched chunk\n');
        }
        const chunkMeta = JSON.parse(readFileSync(join(root, 'assets/fx/common.chunk.meta'), 'utf8')) as {
            importer?: unknown;
        };
        assert.equal(chunkMeta.importer, 'chunk');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('model meta inspects and patches import settings without touching source', (): void => {
    const root = createProject('lumen-model-meta-');
    try {
        const modelPath = join(root, 'assets/Hero.fbx');
        writeFileSync(modelPath, 'fbx-source');
        writeFileSync(
            `${modelPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '2.3.10',
                    importer: 'fbx',
                    imported: true,
                    uuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
                    files: ['.json'],
                    subMetas: {
                        mesh0: {
                            importer: 'mesh',
                            uuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff@mesh',
                            name: 'Cube',
                            displayName: 'Cube',
                        },
                    },
                    userData: {
                        normals: 2,
                        tangents: 2,
                        morphNormals: 1,
                        skipValidation: true,
                        disableMeshSplit: true,
                        allowMeshDataAccess: true,
                        addVertexColor: false,
                        promoteSingleRootNode: false,
                        generateLightmapUVNode: false,
                        dumpMaterials: false,
                        useVertexColors: false,
                        depthWriteInAlphaModeBlend: false,
                        legacyFbxImporter: false,
                        keepUnknown: true,
                        fbx: {
                            animationBakeRate: 0,
                            preferLocalTimeSpan: true,
                            smartMaterialEnabled: false,
                        },
                        imageMetas: [{ name: 'albedo', uri: 'tex.png', remap: '' }],
                    },
                },
                null,
                2,
            )}\n`,
        );
        const session = new LumenSession({ projectRoot: root });
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/Missing.fbx',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_model_scaffold_unsupported/,
        );
        session.openPrefab('assets/Hero.fbx');
        assert.equal(session.openedAssetKind, 'model');
        const before = session.inspectAsset();
        assert.equal(before.kind, 'model');
        if (before.kind === 'model') {
            assert.equal(before.importer, 'fbx');
            assert.equal(before.model.normals, 2);
            assert.equal(before.fbx.animationBakeRate, 0);
            assert.equal(before.fbx.preferLocalTimeSpan, true);
            assert.equal(before.material.dumpMaterials, false);
            assert.equal(before.subAssets.length, 1);
            assert.equal(before.subAssets[0]?.importer, 'mesh');
            assert.equal(before.imageMetas[0]?.name, 'albedo');
            assert.equal(before.imageMetas[0]?.remap, '');
        }
        plantUuidStubs(root, ['dddddddd-eeee-ffff-aaaa-bbbbbbbbbbbb']);
        session.setAssetProperty({
            patch: {
                model: { normals: 1, addVertexColor: true, generateLightmapUVNode: true },
                fbx: { animationBakeRate: 30, smartMaterialEnabled: true, legacyFbxImporter: true },
                material: { dumpMaterials: true, useVertexColors: true },
                imageMetas: [{ name: 'albedo', remap: 'dddddddd-eeee-ffff-aaaa-bbbbbbbbbbbb' }],
            },
        });
        session.save();
        assert.equal(readFileSync(modelPath, 'utf8'), 'fbx-source');
        const verify = new LumenSession({ projectRoot: root });
        verify.openPrefab('assets/Hero.fbx');
        const after = verify.inspectAsset();
        assert.equal(after.kind, 'model');
        if (after.kind === 'model') {
            assert.equal(after.model.normals, 1);
            assert.equal(after.model.addVertexColor, true);
            assert.equal(after.model.generateLightmapUVNode, true);
            assert.equal(after.fbx.animationBakeRate, 30);
            assert.equal(after.fbx.smartMaterialEnabled, true);
            assert.equal(after.fbx.legacyFbxImporter, true);
            assert.equal(after.material.dumpMaterials, true);
            assert.equal(after.material.useVertexColors, true);
            assert.equal(after.imageMetas[0]?.remap, 'dddddddd-eeee-ffff-aaaa-bbbbbbbbbbbb');
        }
        const saved = JSON.parse(readFileSync(`${modelPath}.meta`, 'utf8')) as {
            userData: { keepUnknown?: unknown; fbx?: { animationBakeRate?: unknown } };
        };
        assert.equal(saved.userData.keepUnknown, true);
        assert.equal(saved.userData.fbx?.animationBakeRate, 30);
        assert.throws(
            () => verify.setAssetProperty({ patch: { fbx: { animationBakeRate: 12 } } }),
            /lumen_model_property_range:fbx.animationBakeRate:0\|24\|25\|30\|60/,
        );
        assert.throws(
            () => verify.setAssetProperty({ patch: { model: { unknownMeshFlag: true } } }),
            /lumen_model_property_not_editable:model.unknownMeshFlag/,
        );
        const gltfPath = join(root, 'assets/Hero.gltf');
        writeFileSync(gltfPath, '{}');
        writeFileSync(
            `${gltfPath}.meta`,
            `${JSON.stringify({
                importer: 'gltf',
                uuid: 'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa',
                subMetas: {},
                userData: {},
            })}\n`,
        );
        const gltf = new LumenSession({ projectRoot: root });
        gltf.openPrefab('assets/Hero.gltf');
        assert.equal(gltf.openedAssetKind, 'model');
        const gltfInspect = gltf.inspectAsset();
        assert.equal(gltfInspect.kind, 'model');
        if (gltfInspect.kind === 'model') {
            assert.equal(gltfInspect.importer, 'gltf');
            assert.equal(gltfInspect.model.skipValidation, true);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('auto atlas and label atlas scaffold inspect and patch meta without preview ui', (): void => {
    const root = createProject('lumen-atlas-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Icons.pac',
            rootName: 'Icons',
            template: 'empty',
        });
        assert.equal(session.openedAssetKind, 'autoAtlas');
        const atlas = session.inspectAsset();
        assert.equal(atlas.kind, 'autoAtlas');
        if (atlas.kind === 'autoAtlas') {
            assert.equal(atlas.pack.maxWidth, 1024);
            assert.equal(atlas.pack.algorithm, 'MaxRects');
            assert.equal(atlas.texture.wrapModeS, 'repeat');
        }
        session.setAssetProperty({
            patch: {
                pack: { maxWidth: 2048, padding: 4, filterUnused: false, format: 'png' },
                texture: { wrapModeS: 'clamp-to-edge', anisotropy: 4 },
            },
        });
        session.save();
        const pacSource = readFileSync(join(root, 'assets/ui/Icons.pac'), 'utf8');
        assert.equal(pacSource.includes('cc.SpriteAtlas'), true);
        const verifyAtlas = new LumenSession({ projectRoot: root });
        verifyAtlas.openPrefab('assets/ui/Icons.pac');
        const atlasAgain = verifyAtlas.inspectAsset();
        assert.equal(atlasAgain.kind, 'autoAtlas');
        if (atlasAgain.kind === 'autoAtlas') {
            assert.equal(atlasAgain.pack.maxWidth, 2048);
            assert.equal(atlasAgain.pack.padding, 4);
            assert.equal(atlasAgain.pack.filterUnused, false);
            assert.equal(atlasAgain.texture.wrapModeS, 'clamp-to-edge');
            assert.equal(atlasAgain.texture.anisotropy, 4);
        }
        assert.throws(
            () => verifyAtlas.setAssetProperty({ patch: { pack: { algorithm: 'BestAreaFit' } } }),
            /lumen_auto_atlas_property_range:pack.algorithm:MaxRects/,
        );

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Digits.labelatlas',
            rootName: 'Digits',
            template: 'empty',
        });
        assert.equal(session.openedAssetKind, 'labelAtlas');
        plantUuidStubs(root, ['dddddddd-eeee-ffff-aaaa-bbbbbbbbbbbb']);
        session.setAssetProperty({
            patch: {
                spriteFrameUuid: 'dddddddd-eeee-ffff-aaaa-bbbbbbbbbbbb',
                itemWidth: 16,
                itemHeight: 24,
                startChar: '0',
            },
        });
        session.save();
        const verifyLabel = new LumenSession({ projectRoot: root });
        verifyLabel.openPrefab('assets/ui/Digits.labelatlas');
        const label = verifyLabel.inspectAsset();
        assert.equal(label.kind, 'labelAtlas');
        if (label.kind === 'labelAtlas') {
            assert.equal(label.spriteFrameUuid, 'dddddddd-eeee-ffff-aaaa-bbbbbbbbbbbb');
            assert.equal(label.itemWidth, 16);
            assert.equal(label.itemHeight, 24);
            assert.equal(label.startChar, '0');
            assert.equal(label.fontSize, 0);
        }
        assert.throws(
            () => verifyLabel.setAssetProperty({ patch: { fontSize: 32 } }),
            /lumen_label_atlas_property_not_editable:labelAtlas.fontSize/,
        );
        const saved = JSON.parse(readFileSync(join(root, 'assets/ui/Digits.labelatlas.meta'), 'utf8')) as {
            importer?: unknown;
            userData: { _fntConfig?: unknown };
        };
        assert.equal(saved.importer, 'label-atlas');
        assert.deepEqual(saved.userData._fntConfig, {});
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('animation graph family and render texture pipeline scaffold inspect and patch', (): void => {
    const root = createProject('lumen-anim-rt-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/anim/Hero.animgraph',
            rootName: 'HeroGraph',
            template: 'empty',
        });
        assert.equal(session.openedAssetKind, 'animationGraph');
        plantUuidStubs(root, ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
        session.setAssetProperty({
            patch: {
                name: 'HeroGraph',
                layers: [{ index: 0, name: 'Base', weight: 0.8, mask: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
                variables: [
                    { name: 'speed', type: 'FLOAT', value: 1.5 },
                    { name: 'alive', type: 'BOOLEAN', value: true },
                    { name: 'jump', type: 'TRIGGER', value: false },
                    { name: 'count', type: 'INTEGER', value: 3 },
                ],
            },
        });
        session.save();
        const verifyGraph = new LumenSession({ projectRoot: root });
        verifyGraph.openPrefab('assets/anim/Hero.animgraph');
        const graph = verifyGraph.inspectAsset();
        assert.equal(graph.kind, 'animationGraph');
        if (graph.kind === 'animationGraph') {
            assert.equal(graph.name, 'HeroGraph');
            assert.equal(graph.layers.length, 1);
            assert.equal(graph.layers[0]?.name, 'Base');
            assert.equal(graph.layers[0]?.weight, 0.8);
            assert.equal(graph.layers[0]?.mask, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
            assert.equal(graph.variables.length, 4);
            assert.equal(graph.variables.find((item) => item.name === 'speed')?.value, 1.5);
            assert.equal(graph.variables.find((item) => item.name === 'alive')?.value, true);
            assert.equal(graph.variables.find((item) => item.name === 'jump')?.type, 'TRIGGER');
            assert.equal(graph.variables.find((item) => item.name === 'count')?.value, 3);
        }
        verifyGraph.setAssetProperty({
            patch: { variables: [{ name: 'alive', remove: true }, { name: 'speed', value: 2 }] },
        });
        const graphAgain = verifyGraph.inspectAsset();
        if (graphAgain.kind === 'animationGraph') {
            assert.equal(graphAgain.variables.find((item) => item.name === 'alive'), undefined);
            assert.equal(graphAgain.variables.find((item) => item.name === 'speed')?.value, 2);
        }
        assert.throws(
            () => verifyGraph.setAssetProperty({ patch: { states: [] } }),
            /lumen_animation_graph_property_not_editable:animationGraph.states/,
        );

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/anim/Hero.animgraphvari',
            rootName: 'HeroVariant',
            template: 'empty',
        });
        plantUuidStubs(root, [
            '99999999-9999-4999-8999-999999999999',
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
        ]);
        session.setAssetProperty({
            patch: {
                graph: '99999999-9999-4999-8999-999999999999',
                clips: [
                    {
                        original: '11111111-1111-4111-8111-111111111111',
                        substitution: '22222222-2222-4222-8222-222222222222',
                    },
                ],
            },
        });
        session.save();
        const verifyVariant = new LumenSession({ projectRoot: root });
        verifyVariant.openPrefab('assets/anim/Hero.animgraphvari');
        const variant = verifyVariant.inspectAsset();
        assert.equal(variant.kind, 'animationGraphVariant');
        if (variant.kind === 'animationGraphVariant') {
            assert.equal(variant.graph, '99999999-9999-4999-8999-999999999999');
            assert.equal(variant.clips[0]?.original, '11111111-1111-4111-8111-111111111111');
            assert.equal(variant.clips[0]?.substitution, '22222222-2222-4222-8222-222222222222');
        }

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/anim/Body.animask',
            rootName: 'BodyMask',
            template: 'empty',
        });
        session.setAssetProperty({
            patch: {
                joints: [
                    { path: 'Root/Hips', enabled: false },
                    { path: 'Root/Hips/Spine', enabled: true },
                ],
            },
        });
        session.save();
        const verifyMask = new LumenSession({ projectRoot: root });
        verifyMask.openPrefab('assets/anim/Body.animask');
        const mask = verifyMask.inspectAsset();
        assert.equal(mask.kind, 'animationMask');
        if (mask.kind === 'animationMask') {
            assert.equal(mask.joints.length, 2);
            assert.equal(mask.joints[0]?.path, 'Root/Hips');
            assert.equal(mask.joints[0]?.enabled, false);
            assert.equal(mask.joints[1]?.enabled, true);
        }

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/fx/Screen.rt',
            rootName: 'Screen',
            template: 'empty',
        });
        session.setAssetProperty({
            patch: {
                width: 512,
                height: 256,
                texture: { wrapModeS: 'clamp-to-edge', anisotropy: 8 },
            },
        });
        session.save();
        const rtSource = JSON.parse(readFileSync(join(root, 'assets/fx/Screen.rt'), 'utf8')) as {
            content: { w?: number; h?: number; base?: string };
        };
        assert.equal(rtSource.content.w, 512);
        assert.equal(rtSource.content.h, 256);
        assert.equal(rtSource.content.base, '2,2,0,0,0,0');
        const rtMeta = JSON.parse(readFileSync(join(root, 'assets/fx/Screen.rt.meta'), 'utf8')) as {
            userData: { width?: number; wrapModeS?: string };
            subMetas: { f9941?: { userData?: { width?: number; height?: number } } };
        };
        assert.equal(rtMeta.userData.width, 512);
        assert.equal(rtMeta.userData.wrapModeS, 'clamp-to-edge');
        assert.equal(rtMeta.subMetas.f9941?.userData?.width, 512);
        assert.equal(rtMeta.subMetas.f9941?.userData?.height, 256);
        const verifyRt = new LumenSession({ projectRoot: root });
        verifyRt.openPrefab('assets/fx/Screen.rt');
        const rt = verifyRt.inspectAsset();
        assert.equal(rt.kind, 'renderTexture');
        if (rt.kind === 'renderTexture') {
            assert.equal(rt.width, 512);
            assert.equal(rt.height, 256);
            assert.equal(rt.texture.wrapModeS, 'clamp-to-edge');
            assert.equal(rt.texture.anisotropy, 8);
        }

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/fx/Empty.rpp',
            rootName: 'EmptyPipe',
            template: 'empty',
        });
        plantUuidStubs(root, ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee']);
        session.setAssetProperty({
            patch: {
                name: 'EmptyPipe',
                tag: 2,
                flowUuids: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],
            },
        });
        session.save();
        const verifyEmptyPipe = new LumenSession({ projectRoot: root });
        verifyEmptyPipe.openPrefab('assets/fx/Empty.rpp');
        const emptyPipe = verifyEmptyPipe.inspectAsset();
        assert.equal(emptyPipe.kind, 'renderPipeline');
        if (emptyPipe.kind === 'renderPipeline') {
            assert.equal(emptyPipe.type, 'cc.RenderPipeline');
            assert.equal(emptyPipe.tag, 2);
            assert.equal(emptyPipe.flows[0]?.uuid, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
        }

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/fx/Forward.rpp',
            rootName: 'ForwardPipe',
            template: 'forward',
        });
        session.setAssetProperty({
            patch: {
                name: 'ForwardPipe',
                flows: [{ index: 0, name: 'MainFlow', priority: 10 }],
            },
        });
        session.save();
        const verifyForward = new LumenSession({ projectRoot: root });
        verifyForward.openPrefab('assets/fx/Forward.rpp');
        const forward = verifyForward.inspectAsset();
        assert.equal(forward.kind, 'renderPipeline');
        if (forward.kind === 'renderPipeline') {
            assert.equal(forward.type, 'ForwardPipeline');
            assert.equal(forward.name, 'ForwardPipe');
            assert.equal(forward.flows[0]?.name, 'MainFlow');
            assert.equal(forward.flows[0]?.priority, 10);
            assert.equal(forward.flows[0]?.type, 'ForwardFlow');
            assert.equal(forward.flows[0]?.stageCount, 1);
        }
        assert.throws(
            () => verifyForward.setAssetProperty({ patch: { flowUuids: [] } }),
            /lumen_render_pipeline_property_not_editable:flowUuids:array_pipeline/,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('render flow and stage json assets patch name priority tag and stage uuids', (): void => {
    const root = createProject('lumen-render-flow-stage-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/fx/Main.flow',
            rootName: 'MainFlow',
            template: 'empty',
        });
        plantUuidStubs(root, ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee']);
        session.setAssetProperty({
            patch: {
                name: 'MainFlow',
                priority: 3,
                tag: 1,
                stageUuids: ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'],
            },
        });
        session.save();
        const verifyFlow = new LumenSession({ projectRoot: root });
        verifyFlow.openPrefab('assets/fx/Main.flow');
        const flow = verifyFlow.inspectAsset();
        assert.equal(flow.kind, 'renderFlow');
        if (flow.kind === 'renderFlow') {
            assert.equal(flow.type, 'RenderFlow');
            assert.equal(flow.name, 'MainFlow');
            assert.equal(flow.priority, 3);
            assert.equal(flow.tag, 1);
            assert.deepEqual(flow.stageUuids, ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee']);
        }
        const flowSource = JSON.parse(readFileSync(join(root, 'assets/fx/Main.flow'), 'utf8')) as {
            __type__?: unknown;
            _stages?: unknown;
        };
        assert.equal(flowSource.__type__, 'RenderFlow');
        assert.deepEqual(flowSource._stages, [{ __uuid__: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }]);
        const flowMeta = JSON.parse(readFileSync(join(root, 'assets/fx/Main.flow.meta'), 'utf8')) as {
            importer?: unknown;
        };
        assert.equal(flowMeta.importer, 'render-flow');
        assert.throws(
            () => verifyFlow.setAssetProperty({ patch: { type: 'ForwardFlow' } }),
            /lumen_render_flow_property_not_editable:type/,
        );
        assert.throws(
            () => verifyFlow.setAssetProperty({ patch: { priority: 1.5 } }),
            /lumen_render_flow_property_type:priority:integer/,
        );

        session.scaffoldPrefab({
            prefabRelativePath: 'assets/fx/Opaque.stg',
            rootName: 'OpaqueStage',
            template: 'empty',
        });
        session.setAssetProperty({
            patch: { name: 'OpaqueStage', priority: 5, tag: 2 },
        });
        session.save();
        const verifyStage = new LumenSession({ projectRoot: root });
        verifyStage.openPrefab('assets/fx/Opaque.stg');
        const stage = verifyStage.inspectAsset();
        assert.equal(stage.kind, 'renderStage');
        if (stage.kind === 'renderStage') {
            assert.equal(stage.type, 'RenderStage');
            assert.equal(stage.name, 'OpaqueStage');
            assert.equal(stage.priority, 5);
            assert.equal(stage.tag, 2);
        }
        const stageMeta = JSON.parse(readFileSync(join(root, 'assets/fx/Opaque.stg.meta'), 'utf8')) as {
            importer?: unknown;
        };
        assert.equal(stageMeta.importer, 'render-stage');
        assert.throws(
            () => verifyStage.setAssetProperty({ patch: { stageUuids: [] } }),
            /lumen_render_stage_property_not_editable:stageUuids/,
        );

        writeFileSync(
            join(root, 'assets/fx/Legacy.flow'),
            `${JSON.stringify(
                {
                    __type__: 'cc.RenderFlow',
                    _name: 'Legacy',
                    _priority: 0,
                    _tag: 0,
                    _stages: [{ __uuid__: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }],
                },
                null,
                2,
            )}\n`,
        );
        writeFileSync(
            join(root, 'assets/fx/Legacy.flow.meta'),
            `${JSON.stringify(
                {
                    ver: '1.1.50',
                    importer: 'render-flow',
                    imported: true,
                    uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                    files: ['.json'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const legacy = new LumenSession({ projectRoot: root });
        legacy.openPrefab('assets/fx/Legacy.flow');
        const legacyInspect = legacy.inspectAsset();
        assert.equal(legacyInspect.kind, 'renderFlow');
        if (legacyInspect.kind === 'renderFlow') {
            assert.equal(legacyInspect.type, 'cc.RenderFlow');
            assert.deepEqual(legacyInspect.stageUuids, ['ffffffff-ffff-4fff-8fff-ffffffffffff']);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('audio video ttf and bitmap font meta inspect and patch without touching source', (): void => {
    const root = createProject('lumen-media-font-');
    try {
        const audioPath = join(root, 'assets/sfx/Click.wav');
        mkdirSync(join(root, 'assets/sfx'), { recursive: true });
        mkdirSync(join(root, 'assets/fx'), { recursive: true });
        mkdirSync(join(root, 'assets/fonts'), { recursive: true });
        writeFileSync(audioPath, 'wav-bytes');
        writeFileSync(
            `${audioPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.0',
                    importer: 'audio-clip',
                    imported: true,
                    uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                    files: ['.json', '.wav'],
                    subMetas: {},
                    userData: { downloadMode: 0 },
                },
                null,
                2,
            )}\n`,
        );
        const videoPath = join(root, 'assets/fx/Intro.mp4');
        writeFileSync(videoPath, 'mp4-bytes');
        writeFileSync(
            `${videoPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.0',
                    importer: 'video-clip',
                    imported: true,
                    uuid: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
                    files: ['.json', '.mp4'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const ttfPath = join(root, 'assets/fonts/Title.ttf');
        writeFileSync(ttfPath, 'ttf-bytes');
        writeFileSync(
            `${ttfPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.0',
                    importer: 'ttf-font',
                    imported: true,
                    uuid: 'cccccccc-dddd-4eee-8fff-000000000000',
                    files: ['.json'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const fntPath = join(root, 'assets/fonts/Score.fnt');
        writeFileSync(fntPath, 'info face="Score"\n');
        writeFileSync(
            `${fntPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.0',
                    importer: 'bitmap-font',
                    imported: true,
                    uuid: 'dddddddd-eeee-4fff-8000-111111111111',
                    files: ['.json'],
                    subMetas: {},
                    userData: { fontSize: 32, textureUuid: '' },
                },
                null,
                2,
            )}\n`,
        );

        const session = new LumenSession({ projectRoot: root });
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/sfx/Missing.wav',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_audio_scaffold_unsupported/,
        );
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/fx/Missing.mp4',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_video_scaffold_unsupported/,
        );
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/fonts/Missing.ttf',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_font_scaffold_unsupported/,
        );
        session.openPrefab('assets/sfx/Click.wav');
        assert.equal(session.openedAssetKind, 'audio');
        const audio = session.inspectAsset();
        assert.equal(audio.kind, 'audio');
        if (audio.kind === 'audio') {
            assert.equal(audio.downloadMode, 0);
            assert.equal(audio.downloadModeName, 'WEB_AUDIO');
        }
        session.setAssetProperty({ patch: { downloadMode: 'DOM_AUDIO' } });
        session.save();
        assert.equal(readFileSync(audioPath, 'utf8'), 'wav-bytes');
        const verifyAudio = new LumenSession({ projectRoot: root });
        verifyAudio.openPrefab('assets/sfx/Click.wav');
        const audioAgain = verifyAudio.inspectAsset();
        if (audioAgain.kind === 'audio') {
            assert.equal(audioAgain.downloadMode, 1);
            assert.equal(audioAgain.downloadModeName, 'DOM_AUDIO');
        }

        session.openPrefab('assets/fx/Intro.mp4');
        assert.equal(session.openedAssetKind, 'video');
        const video = session.inspectAsset();
        assert.equal(video.kind, 'video');
        assert.throws(
            () => session.setAssetProperty({ patch: { downloadMode: 1 } }),
            /lumen_video_property_not_editable:video.downloadMode/,
        );
        assert.equal(readFileSync(videoPath, 'utf8'), 'mp4-bytes');

        session.openPrefab('assets/fonts/Title.ttf');
        assert.equal(session.openedAssetKind, 'ttfFont');
        const ttf = session.inspectAsset();
        assert.equal(ttf.kind, 'ttfFont');
        assert.throws(
            () => session.setAssetProperty({ patch: { fontSize: 16 } }),
            /lumen_font_property_not_editable:ttfFont.fontSize/,
        );
        assert.equal(readFileSync(ttfPath, 'utf8'), 'ttf-bytes');

        session.openPrefab('assets/fonts/Score.fnt');
        assert.equal(session.openedAssetKind, 'bitmapFont');
        plantUuidStubs(root, ['eeeeeeee-ffff-4000-8111-222222222222']);
        session.setAssetProperty({
            patch: { textureUuid: 'eeeeeeee-ffff-4000-8111-222222222222', fontSize: 48 },
        });
        session.save();
        assert.equal(readFileSync(fntPath, 'utf8'), 'info face="Score"\n');
        const verifyFont = new LumenSession({ projectRoot: root });
        verifyFont.openPrefab('assets/fonts/Score.fnt');
        const font = verifyFont.inspectAsset();
        assert.equal(font.kind, 'bitmapFont');
        if (font.kind === 'bitmapFont') {
            assert.equal(font.textureUuid, 'eeeeeeee-ffff-4000-8111-222222222222');
            assert.equal(font.fontSize, 48);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('spine and dragonbones meta inspect and patch without touching source', (): void => {
    const root = createProject('lumen-spine-db-');
    try {
        mkdirSync(join(root, 'assets/spine'), { recursive: true });
        mkdirSync(join(root, 'assets/dragon'), { recursive: true });
        const skelPath = join(root, 'assets/spine/Hero.skel');
        writeFileSync(skelPath, 'skel-bytes');
        writeFileSync(
            `${skelPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.1.50',
                    importer: 'spine-data',
                    imported: true,
                    uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111',
                    files: ['.json'],
                    subMetas: {},
                    userData: { atlasUuid: '' },
                },
                null,
                2,
            )}\n`,
        );
        const jsonPath = join(root, 'assets/spine/Hero.json');
        writeFileSync(jsonPath, '{"skeleton":{"hash":"x"}}\n');
        writeFileSync(
            `${jsonPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.1.50',
                    importer: 'spine-data',
                    imported: true,
                    uuid: 'bbbbbbbb-cccc-4ddd-8eee-222222222222',
                    files: ['.json'],
                    subMetas: {},
                    userData: { atlasUuid: 'cccccccc-dddd-4eee-8fff-333333333333' },
                },
                null,
                2,
            )}\n`,
        );
        const dbbinPath = join(root, 'assets/dragon/Hero.dbbin');
        writeFileSync(dbbinPath, 'dbbin-bytes');
        writeFileSync(
            `${dbbinPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.1.50',
                    importer: 'dragonbones',
                    imported: true,
                    uuid: 'dddddddd-eeee-4fff-8000-444444444444',
                    files: ['.bin'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const atlasPath = join(root, 'assets/dragon/Hero_tex.json');
        writeFileSync(atlasPath, '{"imagePath":"Hero_tex.png"}\n');
        writeFileSync(
            `${atlasPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.1.50',
                    importer: 'dragonbones-atlas',
                    imported: true,
                    uuid: 'eeeeeeee-ffff-4000-8111-555555555555',
                    files: ['.json'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );

        const session = new LumenSession({ projectRoot: root });
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/spine/Missing.skel',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_spine_scaffold_unsupported/,
        );
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/dragon/Missing.dbbin',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_dragonbones_scaffold_unsupported/,
        );

        session.openPrefab('assets/spine/Hero.skel');
        assert.equal(session.openedAssetKind, 'spine');
        plantUuidStubs(root, ['ffffffff-0000-4111-8222-666666666666']);
        session.setAssetProperty({ patch: { atlasUuid: 'ffffffff-0000-4111-8222-666666666666' } });
        session.save();
        assert.equal(readFileSync(skelPath, 'utf8'), 'skel-bytes');
        const verifySkel = new LumenSession({ projectRoot: root });
        verifySkel.openPrefab('assets/spine/Hero.skel');
        const skel = verifySkel.inspectAsset();
        assert.equal(skel.kind, 'spine');
        if (skel.kind === 'spine') {
            assert.equal(skel.atlasUuid, 'ffffffff-0000-4111-8222-666666666666');
        }

        session.openPrefab('assets/spine/Hero.json');
        assert.equal(session.openedAssetKind, 'spine');
        const jsonSpine = session.inspectAsset();
        if (jsonSpine.kind === 'spine') {
            assert.equal(jsonSpine.atlasUuid, 'cccccccc-dddd-4eee-8fff-333333333333');
        }
        assert.equal(readFileSync(jsonPath, 'utf8'), '{"skeleton":{"hash":"x"}}\n');

        session.openPrefab('assets/dragon/Hero.dbbin');
        assert.equal(session.openedAssetKind, 'dragonBones');
        assert.throws(
            () => session.setAssetProperty({ patch: { atlasUuid: 'x' } }),
            /lumen_dragonbones_property_not_editable:dragonBones.atlasUuid/,
        );
        assert.equal(readFileSync(dbbinPath, 'utf8'), 'dbbin-bytes');

        session.openPrefab('assets/dragon/Hero_tex.json');
        assert.equal(session.openedAssetKind, 'dragonBonesAtlas');
        const atlas = session.inspectAsset();
        assert.equal(atlas.kind, 'dragonBonesAtlas');
        assert.throws(
            () => session.setAssetProperty({ patch: { textureUuid: 'x' } }),
            /lumen_dragonbones_property_not_editable:dragonBonesAtlas.textureUuid/,
        );
        assert.equal(readFileSync(atlasPath, 'utf8'), '{"imagePath":"Hero_tex.png"}\n');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('cubemap tiledmap and directory meta inspect and patch without touching source', (): void => {
    const root = createProject('lumen-cube-tmx-dir-');
    try {
        mkdirSync(join(root, 'assets/sky'), { recursive: true });
        mkdirSync(join(root, 'assets/maps'), { recursive: true });
        mkdirSync(join(root, 'assets/pack'), { recursive: true });
        const cubePath = join(root, 'assets/sky/Sky.cubemap');
        writeFileSync(cubePath, '{}\n');
        writeFileSync(
            `${cubePath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.12',
                    importer: 'texture-cube',
                    imported: true,
                    uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111',
                    files: ['.json'],
                    subMetas: {},
                    userData: {
                        left: '',
                        wrapModeS: 'repeat',
                        wrapModeT: 'repeat',
                        minfilter: 'nearest',
                        magfilter: 'nearest',
                        mipfilter: 'none',
                        anisotropy: 1,
                        mipBakeMode: 1,
                    },
                },
                null,
                2,
            )}\n`,
        );
        const tmxPath = join(root, 'assets/maps/Level.tmx');
        writeFileSync(tmxPath, '<map version="1.4"/>\n');
        writeFileSync(
            `${tmxPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.7',
                    importer: 'tiled-map',
                    imported: true,
                    uuid: 'bbbbbbbb-cccc-4ddd-8eee-222222222222',
                    files: ['.json'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        writeFileSync(
            join(root, 'assets/pack.meta'),
            `${JSON.stringify(
                {
                    ver: '1.2.0',
                    importer: 'directory',
                    imported: true,
                    uuid: 'cccccccc-dddd-4eee-8fff-333333333333',
                    files: [],
                    subMetas: {},
                    userData: {
                        isBundle: false,
                        compressionType: {},
                        isRemoteBundle: {},
                    },
                },
                null,
                2,
            )}\n`,
        );

        const session = new LumenSession({ projectRoot: root });
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/sky/Missing.cubemap',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_cubemap_scaffold_unsupported/,
        );
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/maps/Missing.tmx',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_tiledmap_scaffold_unsupported/,
        );

        session.openPrefab('assets/sky/Sky.cubemap');
        assert.equal(session.openedAssetKind, 'cubeMap');
        plantUuidStubs(root, ['dddddddd-eeee-4fff-8000-444444444444']);
        session.setAssetProperty({
            patch: {
                faces: { left: 'dddddddd-eeee-4fff-8000-444444444444', right: '' },
                texture: { wrapModeS: 'clamp-to-edge', mipBakeMode: true, anisotropy: 8 },
            },
        });
        session.save();
        assert.equal(readFileSync(cubePath, 'utf8'), '{}\n');
        const verifyCube = new LumenSession({ projectRoot: root });
        verifyCube.openPrefab('assets/sky/Sky.cubemap');
        const cube = verifyCube.inspectAsset();
        assert.equal(cube.kind, 'cubeMap');
        if (cube.kind === 'cubeMap') {
            assert.equal(cube.faces.left, 'dddddddd-eeee-4fff-8000-444444444444');
            assert.equal(cube.faces.right, '');
            assert.equal(cube.texture.wrapModeS, 'clamp-to-edge');
            assert.equal(cube.texture.mipBakeMode, 2);
            assert.equal(cube.texture.anisotropy, 8);
        }

        session.openPrefab('assets/maps/Level.tmx');
        assert.equal(session.openedAssetKind, 'tiledMap');
        assert.throws(
            () => session.setAssetProperty({ patch: { atlasUuid: 'x' } }),
            /lumen_tiledmap_property_not_editable:tiledMap.atlasUuid/,
        );
        assert.equal(readFileSync(tmxPath, 'utf8'), '<map version="1.4"/>\n');

        session.openPrefab('assets/pack');
        assert.equal(session.openedAssetKind, 'directory');
        session.setAssetProperty({
            patch: {
                isBundle: true,
                bundleName: 'game-pack',
                priority: 8,
                compressionType: { wechatgame: 1 },
                isRemoteBundle: { wechatgame: true },
            },
        });
        session.save();
        const verifyDir = new LumenSession({ projectRoot: root });
        verifyDir.openPrefab('assets/pack');
        const folder = verifyDir.inspectAsset();
        assert.equal(folder.kind, 'directory');
        if (folder.kind === 'directory') {
            assert.equal(folder.isBundle, true);
            assert.equal(folder.bundleName, 'game-pack');
            assert.equal(folder.priority, 8);
            assert.equal(folder.compressionType.wechatgame, 1);
            assert.equal(folder.isRemoteBundle.wechatgame, true);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('particle sprite-atlas json text and buffer meta inspect without rewriting source', (): void => {
    const root = createProject('lumen-plist-config-');
    try {
        mkdirSync(join(root, 'assets/fx'), { recursive: true });
        mkdirSync(join(root, 'assets/ui'), { recursive: true });
        mkdirSync(join(root, 'assets/cfg'), { recursive: true });
        const particlePath = join(root, 'assets/fx/Smoke.plist');
        writeFileSync(particlePath, '<?xml version="1.0"?><plist/>\n');
        writeFileSync(
            `${particlePath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.7',
                    importer: 'particle',
                    imported: true,
                    uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111',
                    files: ['.json'],
                    subMetas: {},
                    userData: { spriteFrameUuid: 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb' },
                },
                null,
                2,
            )}\n`,
        );
        const atlasPath = join(root, 'assets/ui/Hero.plist');
        writeFileSync(atlasPath, '<?xml version="1.0"?><plist/>\n');
        writeFileSync(
            `${atlasPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.7',
                    importer: 'sprite-atlas',
                    imported: true,
                    uuid: 'bbbbbbbb-cccc-4ddd-8eee-222222222222',
                    files: ['.json'],
                    subMetas: {
                        icon: {
                            importer: 'sprite-frame',
                            uuid: 'bbbbbbbb-cccc-4ddd-8eee-222222222222@icon',
                            name: 'icon',
                            displayName: 'icon',
                        },
                    },
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const jsonPath = join(root, 'assets/cfg/note.json');
        writeFileSync(jsonPath, '{"ok":true}\n');
        writeFileSync(
            `${jsonPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.7',
                    importer: 'json',
                    imported: true,
                    uuid: 'cccccccc-dddd-4eee-8fff-333333333333',
                    files: ['.json'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const textPath = join(root, 'assets/cfg/note.txt');
        writeFileSync(textPath, 'hello\n');
        writeFileSync(
            `${textPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.7',
                    importer: 'text',
                    imported: true,
                    uuid: 'dddddddd-eeee-4fff-8000-444444444444',
                    files: ['.json'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const binPath = join(root, 'assets/data/Table.bin');
        mkdirSync(join(root, 'assets/data'), { recursive: true });
        writeFileSync(binPath, Buffer.from([0x00, 0x01, 0x02, 0xff]));
        writeFileSync(
            `${binPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.0',
                    importer: 'buffer',
                    imported: true,
                    uuid: 'eeeeeeee-ffff-4000-8111-555555555555',
                    files: ['.bin'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );

        const session = new LumenSession({ projectRoot: root });
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/fx/Missing.plist',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_plist_scaffold_unsupported/,
        );
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/cfg/Missing.json',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_json_scaffold_unsupported/,
        );
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/cfg/Missing.txt',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_text_scaffold_unsupported/,
        );
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/data/Missing.bin',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_buffer_scaffold_unsupported/,
        );

        session.openPrefab('assets/fx/Smoke.plist');
        assert.equal(session.openedAssetKind, 'particle');
        const particle = session.inspectAsset();
        assert.equal(particle.kind, 'particle');
        if (particle.kind === 'particle') {
            assert.equal(particle.spriteFrameUuid, 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb');
        }
        assert.throws(
            () => session.setAssetProperty({ patch: { spriteFrameUuid: 'x' } }),
            /lumen_particle_property_not_editable:particle.spriteFrameUuid/,
        );
        assert.equal(readFileSync(particlePath, 'utf8'), '<?xml version="1.0"?><plist/>\n');

        session.openPrefab('assets/ui/Hero.plist');
        assert.equal(session.openedAssetKind, 'spriteAtlas');
        const atlas = session.inspectAsset();
        assert.equal(atlas.kind, 'spriteAtlas');
        if (atlas.kind === 'spriteAtlas') {
            assert.equal(atlas.spriteFrames.length, 1);
            assert.equal(atlas.spriteFrames[0]?.name, 'icon');
        }
        assert.throws(
            () => session.setAssetProperty({ patch: { textureUuid: 'x' } }),
            /lumen_spriteatlas_property_not_editable:spriteAtlas.textureUuid/,
        );
        assert.equal(readFileSync(atlasPath, 'utf8'), '<?xml version="1.0"?><plist/>\n');

        session.openPrefab('assets/cfg/note.json');
        assert.equal(session.openedAssetKind, 'json');
        assert.throws(
            () => session.setAssetProperty({ patch: { source: '{}' } }),
            /lumen_json_property_not_editable:json.source/,
        );
        assert.equal(readFileSync(jsonPath, 'utf8'), '{"ok":true}\n');

        session.openPrefab('assets/cfg/note.txt');
        assert.equal(session.openedAssetKind, 'text');
        assert.throws(
            () => session.setAssetProperty({ patch: { source: 'x' } }),
            /lumen_text_property_not_editable:text.source/,
        );
        assert.equal(readFileSync(textPath, 'utf8'), 'hello\n');

        session.openPrefab('assets/data/Table.bin');
        assert.equal(session.openedAssetKind, 'buffer');
        const buffer = session.inspectAsset();
        assert.equal(buffer.kind, 'buffer');
        if (buffer.kind === 'buffer') {
            assert.equal(buffer.importer, 'buffer');
            assert.equal(buffer.uuid, 'eeeeeeee-ffff-4000-8111-555555555555');
        }
        assert.throws(
            () => session.setAssetProperty({ patch: { source: 'x' } }),
            /lumen_buffer_property_not_editable:buffer.source/,
        );
        assert.deepEqual(readFileSync(binPath), Buffer.from([0x00, 0x01, 0x02, 0xff]));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('script javascript and mesh meta inspect without rewriting source', (): void => {
    const root = createProject('lumen-script-mesh-');
    try {
        mkdirSync(join(root, 'assets/scripts'), { recursive: true });
        mkdirSync(join(root, 'assets/mesh'), { recursive: true });
        const tsPath = join(root, 'assets/scripts/Probe.ts');
        const tsSource = 'import { _decorator, Component } from \'cc\';\nexport class Probe extends Component {}\n';
        writeFileSync(tsPath, tsSource);
        writeFileSync(
            `${tsPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '4.0.24',
                    importer: 'typescript',
                    imported: true,
                    uuid: '11111111-2222-4333-8444-555555555555',
                    files: [],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const jsPath = join(root, 'assets/scripts/plugin.js');
        const jsSource = 'module.exports = {};\n';
        writeFileSync(jsPath, jsSource);
        writeFileSync(
            `${jsPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '4.0.24',
                    importer: 'javascript',
                    imported: true,
                    uuid: '66666666-7777-4888-8999-aaaaaaaaaaaa',
                    files: [],
                    subMetas: {},
                    userData: {
                        isPlugin: false,
                        loadPluginInEditor: false,
                        loadPluginInWeb: true,
                        loadPluginInNative: true,
                        loadPluginInMiniGame: true,
                    },
                },
                null,
                2,
            )}\n`,
        );
        const meshPath = join(root, 'assets/mesh/Cube.mesh');
        const meshSource = '[{"__type__":"cc.Mesh"}]\n';
        writeFileSync(meshPath, meshSource);
        writeFileSync(
            `${meshPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.0',
                    importer: 'instantiation-mesh',
                    imported: true,
                    uuid: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
                    files: ['.json'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );

        const session = new LumenSession({ projectRoot: root });
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/scripts/Missing.ts',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_script_scaffold_unsupported/,
        );
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/scripts/Missing.js',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_javascript_scaffold_unsupported/,
        );
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/mesh/Missing.mesh',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_mesh_scaffold_unsupported/,
        );

        session.openPrefab('assets/scripts/Probe.ts');
        assert.equal(session.openedAssetKind, 'script');
        const script = session.inspectAsset();
        assert.equal(script.kind, 'script');
        if (script.kind === 'script') {
            assert.equal(script.importer, 'typescript');
            assert.equal(script.uuid, '11111111-2222-4333-8444-555555555555');
            assert.equal(script.source, tsSource);
        }
        const patchedSource =
            'import { _decorator, Component, Label } from \'cc\';\nconst { ccclass } = _decorator;\n@ccclass(\'Probe\')\nexport class Probe extends Component {}\n';
        session.setAssetProperty({ patch: { source: patchedSource } });
        session.save();
        assert.equal(readFileSync(tsPath, 'utf8'), patchedSource);
        const verifyTs = new LumenSession({ projectRoot: root });
        verifyTs.openPrefab('assets/scripts/Probe.ts');
        const scriptAgain = verifyTs.inspectAsset();
        assert.equal(scriptAgain.kind, 'script');
        if (scriptAgain.kind === 'script') {
            assert.equal(scriptAgain.source, patchedSource);
        }
        assert.throws(
            () => session.setAssetProperty({ patch: { isPlugin: true } }),
            /lumen_script_property_not_editable:script/,
        );

        session.openPrefab('assets/scripts/plugin.js');
        assert.equal(session.openedAssetKind, 'javascript');
        session.setAssetProperty({
            patch: {
                isPlugin: true,
                loadPluginInEditor: true,
                loadPluginInWeb: false,
                loadPluginInNative: false,
                loadPluginInMiniGame: false,
            },
        });
        session.save();
        assert.equal(readFileSync(jsPath, 'utf8'), jsSource);
        const verifyJs = new LumenSession({ projectRoot: root });
        verifyJs.openPrefab('assets/scripts/plugin.js');
        const javascript = verifyJs.inspectAsset();
        assert.equal(javascript.kind, 'javascript');
        if (javascript.kind === 'javascript') {
            assert.equal(javascript.isPlugin, true);
            assert.equal(javascript.loadPluginInEditor, true);
            assert.equal(javascript.loadPluginInWeb, false);
            assert.equal(javascript.loadPluginInNative, false);
            assert.equal(javascript.loadPluginInMiniGame, false);
        }

        session.openPrefab('assets/mesh/Cube.mesh');
        assert.equal(session.openedAssetKind, 'mesh');
        const mesh = session.inspectAsset();
        assert.equal(mesh.kind, 'mesh');
        if (mesh.kind === 'mesh') {
            assert.equal(mesh.importer, 'instantiation-mesh');
            assert.equal(mesh.uuid, 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff');
        }
        assert.throws(
            () => session.setAssetProperty({ patch: { source: '[]' } }),
            /lumen_mesh_property_not_editable:mesh.source/,
        );
        assert.equal(readFileSync(meshPath, 'utf8'), meshSource);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('skeleton animation and material dump meta inspect without rewriting source', (): void => {
    const root = createProject('lumen-dump-meta-');
    try {
        mkdirSync(join(root, 'assets/mesh'), { recursive: true });
        mkdirSync(join(root, 'assets/anim'), { recursive: true });
        mkdirSync(join(root, 'assets/fx'), { recursive: true });
        const skeletonPath = join(root, 'assets/mesh/Skin.skeleton');
        const skeletonSource = '[{"__type__":"cc.Skeleton"}]\n';
        writeFileSync(skeletonPath, skeletonSource);
        writeFileSync(
            `${skeletonPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.0',
                    importer: 'instantiation-skeleton',
                    imported: true,
                    uuid: 'cccccccc-dddd-4eee-8fff-000000000001',
                    files: ['.json'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const animationPath = join(root, 'assets/anim/Walk.animation');
        const animationSource = '[{"__type__":"cc.AnimationClip"}]\n';
        writeFileSync(animationPath, animationSource);
        writeFileSync(
            `${animationPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.0',
                    importer: 'instantiation-animation',
                    imported: true,
                    uuid: 'dddddddd-eeee-4fff-8000-000000000002',
                    files: ['.json'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );
        const materialPath = join(root, 'assets/fx/Body.material');
        const materialSource = '[{"__type__":"cc.Material"}]\n';
        writeFileSync(materialPath, materialSource);
        writeFileSync(
            `${materialPath}.meta`,
            `${JSON.stringify(
                {
                    ver: '1.0.0',
                    importer: 'instantiation-material',
                    imported: true,
                    uuid: 'eeeeeeee-ffff-4000-8111-000000000003',
                    files: ['.json'],
                    subMetas: {},
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );

        const session = new LumenSession({ projectRoot: root });
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/mesh/Missing.skeleton',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_skeleton_scaffold_unsupported/,
        );
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/anim/Missing.animation',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_instantiation_animation_scaffold_unsupported/,
        );
        assert.throws(
            () =>
                session.scaffoldPrefab({
                    prefabRelativePath: 'assets/fx/Missing.material',
                    rootName: 'Missing',
                    template: 'empty',
                }),
            /lumen_instantiation_material_scaffold_unsupported/,
        );

        session.openPrefab('assets/mesh/Skin.skeleton');
        assert.equal(session.openedAssetKind, 'skeleton');
        const skeleton = session.inspectAsset();
        assert.equal(skeleton.kind, 'skeleton');
        if (skeleton.kind === 'skeleton') {
            assert.equal(skeleton.importer, 'instantiation-skeleton');
            assert.equal(skeleton.uuid, 'cccccccc-dddd-4eee-8fff-000000000001');
        }
        assert.throws(
            () => session.setAssetProperty({ patch: { source: '[]' } }),
            /lumen_skeleton_property_not_editable:skeleton.source/,
        );
        assert.equal(readFileSync(skeletonPath, 'utf8'), skeletonSource);

        session.openPrefab('assets/anim/Walk.animation');
        assert.equal(session.openedAssetKind, 'instantiationAnimation');
        const animation = session.inspectAsset();
        assert.equal(animation.kind, 'instantiationAnimation');
        if (animation.kind === 'instantiationAnimation') {
            assert.equal(animation.importer, 'instantiation-animation');
            assert.equal(animation.uuid, 'dddddddd-eeee-4fff-8000-000000000002');
        }
        assert.throws(
            () => session.setAssetProperty({ patch: { source: '[]' } }),
            /lumen_instantiation_animation_property_not_editable:instantiationAnimation.source/,
        );
        assert.equal(readFileSync(animationPath, 'utf8'), animationSource);

        session.openPrefab('assets/fx/Body.material');
        assert.equal(session.openedAssetKind, 'instantiationMaterial');
        const material = session.inspectAsset();
        assert.equal(material.kind, 'instantiationMaterial');
        if (material.kind === 'instantiationMaterial') {
            assert.equal(material.importer, 'instantiation-material');
            assert.equal(material.uuid, 'eeeeeeee-ffff-4000-8111-000000000003');
        }
        assert.throws(
            () => session.setAssetProperty({ patch: { source: '[]' } }),
            /lumen_instantiation_material_property_not_editable:instantiationMaterial.source/,
        );
        assert.equal(readFileSync(materialPath, 'utf8'), materialSource);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('instance discovery maps __id__ refs and unknown nested objects', (): void => {
    const root = createProject('lumen-id-discover-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/Refs.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        session.attachComponent({ nodePath: '/Root', builtinType: 'cc.Label' });
        session.save();
        const prefabPath = join(root, 'assets/ui/Refs.prefab');
        const entries = JSON.parse(readFileSync(prefabPath, 'utf8')) as Array<Record<string, unknown>>;
        const label = entries.find((entry) => entry.__type__ === 'cc.Label');
        assert.ok(label != null);
        label.bindTarget = { __id__: 1 };
        label._extraBox = { __type__: 'cc.BoxExtra', width: 3, height: 4 };
        writeFileSync(prefabPath, `${JSON.stringify(entries, null, 2)}\n`);

        const verify = new LumenSession({ projectRoot: root });
        verify.openPrefab('assets/ui/Refs.prefab');
        const inspected = verify.inspectNode('/Root');
        const component = inspected.components.find((item) => item.type === 'cc.Label');
        assert.ok(component != null);
        assert.equal(component.props.bindTarget, '/Root');
        const extraBox = component.props.extraBox as { width?: number; height?: number };
        assert.equal(extraBox.width, 3);
        assert.equal(extraBox.height, 4);
        verify.setComponentProperty({
            nodePath: '/Root',
            componentType: 'cc.Label',
            patch: { extraBox: { width: 9 } },
        });
        const updated = verify.inspectNode('/Root').components.find((item) => item.type === 'cc.Label');
        assert.ok(updated != null);
        assert.equal((updated.props.extraBox as { width?: number }).width, 9);
        assert.equal((updated.props.extraBox as { height?: number }).height, 4);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('curveRange twoCurves and gradientRange twoGradients round-trip', (): void => {
    const root = createProject('lumen-two-splines-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/fx/Dual.prefab',
            rootName: 'FX',
            template: 'empty',
        });
        session.attachComponent({ nodePath: '/FX', builtinType: 'cc.ParticleSystem' });
        session.setComponentProperty({
            nodePath: '/FX',
            componentType: 'cc.ParticleSystem',
            patch: {
                startLifetime: {
                    keysMin: [
                        { time: 0, value: 1 },
                        { time: 1, value: 2 },
                    ],
                    keysMax: [
                        { time: 0, value: 3 },
                        { time: 1, value: 4 },
                    ],
                },
                startColor: {
                    colorKeysMin: [
                        { time: 0, color: { r: 255, g: 255, b: 255, a: 255 } },
                        { time: 1, color: { r: 0, g: 0, b: 0, a: 255 } },
                    ],
                    colorKeysMax: [
                        { time: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
                        { time: 1, color: { r: 0, g: 255, b: 0, a: 128 } },
                    ],
                },
            },
        });
        const inspected = session.inspectNode('/FX');
        const ps = inspected.components.find((component) => component.type === 'cc.ParticleSystem');
        assert.ok(ps != null);
        const lifetime = ps.props.startLifetime as {
            mode?: number;
            keysMin?: Array<{ value?: number }>;
            keysMax?: Array<{ value?: number }>;
        };
        assert.equal(lifetime.mode, 2);
        assert.equal(lifetime.keysMin?.[1]?.value, 2);
        assert.equal(lifetime.keysMax?.[1]?.value, 4);
        const startColor = ps.props.startColor as {
            mode?: number;
            colorKeysMin?: unknown[];
            colorKeysMax?: unknown[];
        };
        assert.equal(startColor.mode, 3);
        assert.equal(startColor.colorKeysMin?.length, 2);
        assert.equal(startColor.colorKeysMax?.length, 2);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

/**
 * @description 读取 prefab meta uuid。
 * @param metaPath meta 绝对路径
 * @returns uuid
 * @oopException 测试辅助。
 */
function readMetaUuid(metaPath: string): string {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { uuid?: unknown };
    if (typeof meta.uuid !== 'string' || meta.uuid.length === 0) {
        throw new Error('lumen_test_meta_uuid_missing');
    }
    return meta.uuid;
}

/**
 * @description 断言目录中没有原子写残留的 tmp。
 * @param directory 目录
 * @oopException 测试辅助。
 */
function assertNoTmpFiles(directory: string): void {
    const names = readdirSync(directory);
    assert.equal(
        names.some((name) => name.endsWith('.tmp')),
        false,
        `tmp leftover:${names.filter((name) => name.endsWith('.tmp')).join(',')}`,
    );
}

/**
 * @description 断言 Prefab 本地 fileId 不重复。
 * @param entries prefab 数组
 * @oopException 测试辅助。
 */
function assertUniqueFileIds(entries: ReadonlyArray<Record<string, unknown>>): void {
    const fileIds = entries.flatMap((entry) => (typeof entry.fileId === 'string' ? [entry.fileId] : []));
    assert.equal(new Set(fileIds).size, fileIds.length);
}

test('addChildFromTemplate empty is logical (no empty.prefab required)', (): void => {
    const root = createProject('lumen-empty-node-add-');
    try {
        const session = new LumenSession({ projectRoot: root });
        session.scaffoldPrefab({
            prefabRelativePath: 'assets/ui/EmptyChild.prefab',
            rootName: 'Root',
            template: 'empty',
        });
        const path = session.addChildFromTemplate({
            parentPath: '/Root',
            template: 'empty',
            name: 'ChildEmpty',
        });
        assert.equal(path, '/Root/ChildEmpty');
        session.save();
        const inspected = session.inspectNode('/Root/ChildEmpty');
        assert.equal(inspected.name, 'ChildEmpty');
        assert.ok(inspected.components.some((component) => component.type === 'cc.UITransform'));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('addChildFromTemplate accepts an absolute prefab path with its extension', (): void => {
    const root = createProject('lumen-absolute-template-');
    try {
        const source = new LumenSession({ projectRoot: root });
        const templatePath = source.scaffoldPrefab({
            prefabRelativePath: 'assets/PlayerPanel.prefab',
            rootName: 'PlayerPanel',
            template: 'empty',
        });
        source.save();

        const scene = new LumenSession({ projectRoot: root });
        scene.scaffoldPrefab({
            prefabRelativePath: 'assets/BindingVerification.scene',
            rootName: 'BindingVerification',
            template: 'ui/Canvas',
        });
        const childPath = scene.addChildFromTemplate({
            parentPath: '/BindingVerification/Canvas',
            template: join(root, templatePath),
        });

        assert.equal(childPath, '/BindingVerification/Canvas/PlayerPanel');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
