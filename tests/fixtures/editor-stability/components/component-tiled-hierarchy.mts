import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';
import { LumenComponentPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/component-property.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';

/**
 * @description 只暂存独立的真实TMX输入和待初始化场景，原生拥有组件不凭离线骨架计为通过。
 */
export class ComponentTiledHierarchy {
    /**
     * @description 精确核验同版SDK后为新工程装配地图输入；用户脚本须经实际导入和公开组件添加。
     */
    public static stage(root: string, project: string, engine: string, version: string, target: string,
        sdkSourceHash: (path: string) => string = path => createHash('sha256').update(readFileSync(path)).digest('hex')): void {
        if (version !== '3.8.7') throw new Error('component_tiled_version_unverified');
        if (['library', 'temp', '.peanut-ai/component-probe.json'].some(path => existsSync(join(project, path))))
            throw new Error('component_tiled_project_already_started');
        if (target !== '/Root/Canvas/Target') throw new Error('component_tiled_source_target_unverified');
        const directory = join(root, 'tests/fixtures/editor-stability/components');
        const proof = this.record(JSON.parse(readFileSync(join(directory, '3.8.7/tiled-source-provenance.json'), 'utf8')));
        const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
        if (proof.creatorVersion !== version || !Array.isArray(proof.sdkSources) || proof.sdkSources.length !== 5)
            throw new Error('component_tiled_source_proof_invalid');
        for (const item of proof.sdkSources) {
            const source = this.record(item);
            if (typeof source.path !== 'string' || !/^(?:package\.json|cocos\/tiledmap\/tiled-[a-z-]+\.ts)$/u.test(source.path)
                || sdkSourceHash(join(engine, source.path)) !== source.sha256) throw new Error('component_tiled_sdk_source_mismatch');
        }
        const input = readFileSync(join(directory, 'fixtures/tiled/source-owned.tmx'));
        const metaBytes = readFileSync(join(directory, '3.8.7/tiled-source.meta.json'));
        if (digest(input) !== proof.inputSha256 || digest(metaBytes) !== proof.metaSha256) throw new Error('component_tiled_input_changed');
        const meta = this.record(JSON.parse(metaBytes.toString('utf8')));
        if (meta.importer !== 'tiled-map' || typeof meta.uuid !== 'string') throw new Error('component_tiled_meta_invalid');
        const sourceUuid = randomUUID(); meta.uuid = sourceUuid;
        const tmx = 'assets/fixtures/media/assets/map/source-owned.tmx';
        const relativePath = 'assets/components/_lifecycle/cc.TiledMap.scene';
        const document = LumenPrefabDocument.cloneFromTemplate('assets/components/task51-tiled-source.scene', join(project, relativePath));
        document.setPropertySchema(new LumenComponentPropertySchema(LumenCocosVersion.parse(version)));
        document.setComponentProperty(target, 'cc.TiledMap', { tmxFile: sourceUuid });
        for (const [name, type] of [['Ground', 'cc.TiledLayer'], ['Objects', 'cc.TiledObjectGroup']] as const) {
            document.addChildFromSpec(target, { name });
            document.attachBuiltinComponent(`${target}/${name}`, 'cc.UITransform');
            document.attachBuiltinComponent(`${target}/${name}`, type);
        }
        document.addChildFromSpec(`${target}/Ground`, { name: 'OwnedTile' });
        document.attachBuiltinComponent(`${target}/Ground/OwnedTile`, 'cc.UITransform');
        document.attachBuiltinComponent(`${target}/Ground/OwnedTile`, 'cc.TiledTile');
        writeFileSync(join(project, tmx), input, { flag: 'wx' });
        writeFileSync(join(project, tmx + '.meta'), JSON.stringify(meta, null, 2) + '\n', { flag: 'wx' });
        const script = 'assets/components/TiledUserDependency.ts';
        writeFileSync(join(project, script), readFileSync(join(directory, 'fixtures/tiled/TiledUserDependency.ts')), { flag: 'wx' });
        document.save(project, false, LumenCocosVersion.parse(version));
        writeFileSync(join(dirname(project), 'tiled-source-staging.json'), JSON.stringify({ sourceUuid, tmx, script,
            scene: document.relativePath, target, sdkSourceProof: proof, nativePassed: false,
            scriptAttachment: 'pending real AssetDB import and public lumen-comp-add',
            scope: '真实TMX拥有Ground/Objects；离线节点只作SDK初始化载体，禁止据此计为原生通过' }, null, 2) + '\n', { flag: 'wx' });
    }

    /**
     * @description 外部JSON只按记录读取，拒绝空值及数组冒充来源证明。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_tiled_record_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
