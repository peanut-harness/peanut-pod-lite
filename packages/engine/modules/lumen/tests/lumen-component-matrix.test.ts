import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LumenHierarchyRefValidator } from '../source/hierarchy/lumen-hierarchy-ref-validator.ts';
import { LumenSession } from '../source/session.ts';

test('all Creator 3.8.7 schema components roundtrip or explicitly refuse SDK-owned attachment', (): void => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-component-matrix-'));
    try {
        const imageUuid = '1ae1bf24-3cd6-4663-a07c-dcc2ec8f94c5';
        const spriteFrameUuid = `${imageUuid}@f9941`;
        mkdirSync(join(root, 'assets/component-matrix'), { recursive: true });
        mkdirSync(join(root, 'assets/textures'), { recursive: true });
        writeFileSync(join(root, 'assets/textures/MatrixSprite.png'), 'fixture');
        writeFileSync(
            join(root, 'assets/textures/MatrixSprite.png.meta'),
            `${JSON.stringify(
                {
                    uuid: imageUuid,
                    importer: 'image',
                    files: ['.png'],
                    subMetas: {
                        f9941: {
                            importer: 'sprite-frame',
                            uuid: spriteFrameUuid,
                            displayName: 'MatrixSprite',
                        },
                    },
                    userData: {},
                },
                null,
                2,
            )}\n`,
        );

        const seed = new LumenSession({ projectRoot: root, cocosVersion: '3.8.7' });
        const componentTypes = seed.describeSchema().components;
        assert.equal(componentTypes.length, 99);
        assert.equal(new Set(componentTypes).size, componentTypes.length);

        const failures: Array<{ readonly componentType: string; readonly reason: string }> = [];
        const sourceOwned: string[] = [];
        let roundtripped = 0;
        for (let index = 0; index < componentTypes.length; index += 1) {
            const componentType = componentTypes[index]!;
            const rootName = componentType.replace(/[^A-Za-z0-9]+/gu, '-');
            const relativePath = `assets/component-matrix/${String(index + 1).padStart(3, '0')}-${rootName}.prefab`;
            try {
                const session = new LumenSession({ projectRoot: root, cocosVersion: '3.8.7' });
                session.scaffoldPrefab({ prefabRelativePath: relativePath, rootName, template: 'empty' });
                if (componentType === 'cc.TiledUserNodeData') {
                    const before = session.inspectNode(`/${rootName}`);
                    assert.throws(() => session.attachComponent({ nodePath: `/${rootName}`, builtinType: componentType }),
                        /lumen_component_source_owned:cc.TiledUserNodeData:TiledLayer.addUserNode/u);
                    assert.deepEqual(session.inspectNode(`/${rootName}`), before);
                    sourceOwned.push(componentType);
                    continue;
                }
                session.attachComponent({ nodePath: `/${rootName}`, builtinType: componentType });
                if (componentType === 'cc.Sprite') {
                    session.refreshCatalog();
                    session.bindSprite({ nodePath: `/${rootName}`, spriteFrameUuid });
                }
                session.save();

                const reopened = new LumenSession({ projectRoot: root, cocosVersion: '3.8.7' });
                reopened.openPrefab(relativePath);
                const inspected = reopened.inspectNode(`/${rootName}`);
                if (!inspected.components.some((component) => component.type === componentType)) {
                    failures.push({ componentType, reason: 'component_missing_after_reopen' });
                    continue;
                }
                const validation = new LumenHierarchyRefValidator().validate(root, { prefabRelativePath: relativePath });
                if (!validation.ok) {
                    failures.push({
                        componentType,
                        reason: validation.issues.map((issue) => `${issue.kind}:${issue.fieldHint}`).join(','),
                    });
                } else roundtripped += 1;
            } catch (error) {
                failures.push({ componentType, reason: error instanceof Error ? error.message : String(error) });
            }
        }
        assert.deepEqual(failures, []);
        assert.deepEqual(sourceOwned, ['cc.TiledUserNodeData']);
        assert.equal(roundtripped, 98);
        assert.equal(roundtripped + sourceOwned.length, componentTypes.length);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
