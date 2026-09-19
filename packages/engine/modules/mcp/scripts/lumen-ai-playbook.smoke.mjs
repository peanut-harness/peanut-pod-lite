#!/usr/bin/env node
/**
 * @description Lumen AI playbook 冒烟：templates → scaffold → structure(autoCommit) → tree。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EditorMcpLumenGateway, EditorMcpPluginModule } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'peanut-lumen-playbook-'));
mkdirSync(join(root, 'assets'), { recursive: true });
writeFileSync(join(root, 'package.json'), '{"name":"playbook","creator":{"version":"3.8.7"}}\n');

const pluginModule = new EditorMcpPluginModule(undefined, new EditorMcpLumenGateway(async () => root));
await pluginModule.activate({
    plugin: { id: 'peanut.editor-mcp' },
    runtime: {
        version: {
            getCurrentVersion: () => ({
                raw: '3.8.7',
                major: 3,
                minor: 8,
                patch: 7,
                stage: 'editor_api_38',
                phase: 'editor_api_stable',
            }),
        },
        projectRead: {
            getProjectName: async () => 'playbook',
            getProjectPath: async () => root,
        },
    },
    services: { request: async () => ({}) },
    logger: { info() {}, warn() {}, error() {} },
});

try {
    const call = (operation, input) => pluginModule.dispatchMcpAction('cocos.call', { operation, input });

    const templates = await call('lumen.templates', {});
    assert.ok(templates.data.count > 0);

    const info = await call('lumen.cocosInfo', {});
    assert.equal(info.data.projectVersion, '3.8.7');

    await call('lumen.scaffold', {
        prefabRelativePath: 'assets/ui/Playbook.prefab',
        rootName: 'Playbook',
        template: 'empty',
    });

    const structure = await call('lumen.structure', {
        prefabRelativePath: 'assets/ui/Playbook.prefab',
        parentPath: '/Playbook',
        recipe: { name: 'Title', template: 'ui/Label', props: { string: 'OK' } },
        autoCommit: true,
    });
    assert.equal(structure.data.recommendedNext.operation, 'lumen.commit');
    assert.equal(structure.data.autoCommit, true);
    assert.ok(Array.isArray(structure.data.commit.pipeline));
    assert.ok(structure.data.commit.pipeline.includes('assetdb_refresh'));
    assert.ok(structure.data.commit.pipeline.includes('catalog_refresh'));
    assert.ok(structure.data.commit.pipeline.includes('validate_refs'));
    assert.ok(Array.isArray(structure.data.commit.validation));
    assert.equal(structure.data.commit.validation[0].ok, true);

    const schema = await call('lumen.schema', { type: 'cc.ScrollView' });
    const contentProp = schema.data.schema.props.find((prop) => prop.apiName === 'content');
    assert.equal(contentProp?.kind, 'nodeRef');

    await call('lumen.nodeAdd', {
        prefabRelativePath: 'assets/ui/Playbook.prefab',
        parentPath: '/Playbook',
        template: 'ui/ScrollView',
        name: 'Scroll',
    });
    const treeBefore = await call('lumen.tree', { prefabRelativePath: 'assets/ui/Playbook.prefab' });
    const scrollNode = treeBefore.data.tree.children.find((child) => child.name === 'Scroll');
    assert.ok(scrollNode != null);
    const contentNode = findNamed(scrollNode, 'content') ?? findNamed(scrollNode, 'Content');
    assert.ok(contentNode != null);

    await call('lumen.compSet', {
        prefabRelativePath: 'assets/ui/Playbook.prefab',
        nodePath: '/Playbook/Scroll',
        componentType: 'cc.ScrollView',
        props: { content: contentNode.path },
        autoCommit: true,
    });

    const inspected = await call('lumen.inspect', {
        prefabRelativePath: 'assets/ui/Playbook.prefab',
        nodePath: '/Playbook/Scroll',
    });
    const scrollView = inspected.data.node.components.find(
        (component) => component.type === 'cc.ScrollView',
    );
    assert.ok(scrollView != null);
    assert.equal(scrollView.props.content, contentNode.path);

    const tree = await call('lumen.tree', { prefabRelativePath: 'assets/ui/Playbook.prefab' });
    assert.equal(tree.data.tree.name, 'Playbook');

    await call('lumen.scaffold', {
        assetRelativePath: 'assets/fx/Playbook.mtl',
        rootName: 'Playbook',
        template: 'standard',
    });
    const material = await call('lumen.inspect', { assetRelativePath: 'assets/fx/Playbook.mtl' });
    assert.equal(material.data.kind, 'material');
    await call('lumen.assetSet', {
        assetRelativePath: 'assets/fx/Playbook.mtl',
        props: { props: { roughness: 0.25 } },
    });
    const patched = await call('lumen.inspect', { prefabRelativePath: 'assets/fx/Playbook.mtl' });
    assert.equal(patched.data.asset.props[0].roughness, 0.25);

    await call('lumen.scaffold', {
        assetRelativePath: 'assets/anim/Playbook.anim',
        rootName: 'Playbook',
        template: 'empty',
    });
    await call('lumen.assetSet', {
        assetRelativePath: 'assets/anim/Playbook.anim',
        props: {
            wrapMode: 'Loop',
            sample: 30,
            events: [{ frame: 0.25, func: 'onBeat', params: [] }],
            curves: [
                {
                    path: 'Root',
                    property: 'eulerAngles',
                    keys: [0, 1],
                    values: [
                        [0, 0, 0],
                        [0, 45, 0],
                    ],
                },
                {
                    path: 'Root/Hips',
                    property: 'position',
                    keys: [0, 0.5, 1],
                    values: [
                        [0, 0, 0],
                        [0, 0.1, 0],
                        [0, 0, 0],
                    ],
                },
            ],
        },
    });
    const clip = await call('lumen.inspect', { assetRelativePath: 'assets/anim/Playbook.anim' });
    assert.equal(clip.data.kind, 'animationClip');
    assert.equal(clip.data.asset.wrapModeName, 'Loop');
    assert.equal(clip.data.asset.curves.length, 2);

    let rawBlocked = false;
    try {
        await call('lumen.assetSet', {
            assetRelativePath: 'assets/anim/Playbook.anim',
            props: { tracks: [{ __type__: 'cc.AnimationClip' }] },
        });
    } catch (error) {
        rawBlocked = String(error).includes('lumen_animation_clip_raw_tracks_blocked');
    }
    assert.equal(rawBlocked, true);

    await call('lumen.assetSet', {
        assetRelativePath: 'assets/anim/Playbook.anim',
        props: {
            allowRawTracks: true,
            tracks: [{ id: 'track-0' }],
        },
    });

    await call('lumen.scaffold', {
        assetRelativePath: 'assets/anim/Playbook.animgraph',
        rootName: 'PlaybookGraph',
        template: 'empty',
    });
    await call('lumen.assetSet', {
        assetRelativePath: 'assets/anim/Playbook.animgraph',
        props: {
            layers: [{ index: 0, name: 'Base', weight: 1 }],
            variables: [{ name: 'speed', type: 'FLOAT', value: 1 }],
        },
    });
    const graph = await call('lumen.inspect', { assetRelativePath: 'assets/anim/Playbook.animgraph' });
    assert.equal(graph.data.kind, 'animationGraph');

    await call('lumen.scaffold', {
        assetRelativePath: 'assets/anim/Playbook.animask',
        rootName: 'PlaybookMask',
        template: 'empty',
    });
    await call('lumen.assetSet', {
        assetRelativePath: 'assets/anim/Playbook.animask',
        props: {
            joints: [
                { path: 'Root/Hips', enabled: false },
                { path: 'Root/Hips/Spine', enabled: true },
            ],
        },
    });
    const mask = await call('lumen.inspect', { assetRelativePath: 'assets/anim/Playbook.animask' });
    assert.equal(mask.data.kind, 'animationMask');
    assert.equal(mask.data.asset.joints.length, 2);
    assert.equal(mask.data.asset.joints[0].path, 'Root/Hips');
    assert.equal(mask.data.asset.joints[0].enabled, false);
    assert.equal(mask.data.asset.joints[1].enabled, true);
    await call('lumen.assetSet', {
        assetRelativePath: 'assets/anim/Playbook.animask',
        props: {
            joints: [
                { path: 'Root/Hips', enabled: true },
                { path: 'Root/Hips/Spine', enabled: false },
            ],
        },
    });
    const maskToggled = await call('lumen.inspect', { assetRelativePath: 'assets/anim/Playbook.animask' });
    assert.equal(maskToggled.data.asset.joints[0].enabled, true);
    assert.equal(maskToggled.data.asset.joints[1].enabled, false);

    const graphMeta = JSON.parse(readFileSync(join(root, 'assets/anim/Playbook.animgraph.meta'), 'utf8'));
    await call('lumen.scaffold', {
        assetRelativePath: 'assets/anim/Playbook.animgraphvari',
        rootName: 'PlaybookVariant',
        template: 'empty',
    });
    await call('lumen.assetSet', {
        assetRelativePath: 'assets/anim/Playbook.animgraphvari',
        props: { graph: graphMeta.uuid },
    });
    const variant = await call('lumen.inspect', { assetRelativePath: 'assets/anim/Playbook.animgraphvari' });
    assert.equal(variant.data.kind, 'animationGraphVariant');

    const validated = await call('lumen.validateRefs', {
        prefabRelativePath: 'assets/ui/Playbook.prefab',
    });
    // ScrollView 模板引用引擎/default_prefab 内置图：应计入 ignoredEngineDefaultUuid，不抬 missing。
    assert.equal(typeof validated.data.ok, 'boolean');
    assert.equal(validated.data.summary.missingUuid, 0);
    assert.ok((validated.data.summary.ignoredEngineDefaultUuid ?? 0) >= 1);

    const commit = await call('lumen.commit', {
        paths: ['assets/ui/Playbook.prefab'],
    });
    assert.ok(Array.isArray(commit.data.validation));
    assert.equal(commit.data.validation[0].prefabRelativePath, 'assets/ui/Playbook.prefab');
    assert.equal(commit.data.validation[0].summary.missingUuid, 0);
    assert.ok((commit.data.validation[0].summary.ignoredEngineDefaultUuid ?? 0) >= 1);
    assert.deepEqual(commit.data.pipeline, [
        'assetdb_refresh',
        'hierarchy_settle',
        'assetdb_registration',
        'catalog_refresh',
        'validate_refs',
    ]);
    assert.equal(commit.data.recommendedNext.operation, 'preview.refresh');

    process.stdout.write('lumen-ai-playbook.smoke: ok\n');
} finally {
    await pluginModule.deactivate('manual_disable');
    rmSync(root, { recursive: true, force: true });
}

/**
 * @description 在树中按名称查找节点。
 * @param node 树节点
 * @param name 名称
 * @returns 匹配节点或 `null`
 */
function findNamed(node, name) {
    if (node.name === name) {
        return node;
    }
    for (const child of node.children ?? []) {
        const hit = findNamed(child, name);
        if (hit != null) {
            return hit;
        }
    }
    return null;
}
