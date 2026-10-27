import { createHash } from 'node:crypto';
import { CocosUuidCodec } from '../../../../packages/engine/modules/assets/src/cocos-uuid-codec.ts';

/**
 * @description 从已冻结展示源返回独立行为场景字节；不写现有工程、不改原资源身份或生命周期副本。
 */
export class ComponentBehaviorFixture {
    /**
     * @description 为四个已有真实载体创建独立场景并绑定唯一新脚本UUID，原始资源引用保持不变。
     * @param type 明确的测试组件。
     * @param sourceScene 已冻结、未破坏的展示场景字节。
     * @param sourceMeta 对应原场景meta字节。
     * @param identity 新命名空间、场景和脚本身份。
     * @returns 仅供外层精确登记的内存字节与来源证明，无实机通过结论。
     */
    public static prepare(type: string, sourceScene: Uint8Array, sourceMeta: Uint8Array,
        identity: { relativePath: string; sceneUuid: string; scriptUuid: string }) {
        if (!['cc.Bloom', 'cc.SkeletalAnimation', 'cc.SkinnedMeshRenderer', 'cc.SkinnedMeshBatchRenderer'].includes(type)
            || identity.relativePath !== `assets/components/_lifecycle/task51-attempt-28/presentations/${type}.scene`)
            throw new Error('component_behavior_fixture_scope_invalid');
        const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
        if (!uuid.test(identity.sceneUuid) || !uuid.test(identity.scriptUuid) || identity.sceneUuid === identity.scriptUuid)
            throw new Error('component_behavior_fixture_uuid_invalid');
        const decoded: unknown = JSON.parse(Buffer.from(sourceScene).toString('utf8'));
        if (!Array.isArray(decoded)) throw new Error('component_behavior_fixture_scene_invalid');
        const entries = decoded.map(value => this.record(value)); const meta = this.record(JSON.parse(Buffer.from(sourceMeta).toString('utf8')));
        const scenes = entries.filter(row => row.__type__ === 'cc.Scene'); const scene = scenes[0];
        if (meta.importer !== 'scene' || meta.uuid === identity.sceneUuid || meta.uuid === identity.scriptUuid
            || entries[0]?.__type__ !== 'cc.SceneAsset' || scenes.length !== 1 || scene?._id !== meta.uuid)
            throw new Error('component_behavior_fixture_source_identity_invalid');
        const targets = entries.filter(row => row.__type__ === type);
        if (targets.length !== 1) throw new Error('component_behavior_fixture_target_ambiguous');
        const nodeRef = this.record(targets[0]?.node); const nodeIndex = nodeRef.__id__;
        if (typeof nodeIndex !== 'number' || !Number.isSafeInteger(nodeIndex) || entries[nodeIndex]?.__type__ !== 'cc.Node')
            throw new Error('component_behavior_fixture_target_missing');
        const node = entries[nodeIndex]!;
        if (!Array.isArray(node._components)) throw new Error('component_behavior_fixture_component_links_missing');
        this.dependencies(type, entries, targets[0]!);
        const scriptType = new CocosUuidCodec().compress(identity.scriptUuid);
        if (entries.some(entry => entry.__type__ === scriptType)) throw new Error('component_behavior_fixture_script_collision');
        const observerIndex = entries.length;
        entries.push({ __type__: scriptType, _name: '', _objFlags: 0, node: { __id__: nodeIndex },
            _enabled: true, __prefab: null, componentType: type, _id: '' });
        node._components = [...node._components, { __id__: observerIndex }];
        entries[0]!._name = type; scene!._id = identity.sceneUuid;
        return { relativePath: identity.relativePath, sceneUuid: identity.sceneUuid, scriptUuid: identity.scriptUuid,
            sceneBytes: Buffer.from(JSON.stringify(entries, null, 2) + '\n'),
            metaBytes: Buffer.from(JSON.stringify({ ...meta, uuid: identity.sceneUuid }, null, 2) + '\n'),
            sourceSceneSha256: createHash('sha256').update(sourceScene).digest('hex'),
            sourceMetaSha256: createHash('sha256').update(sourceMeta).digest('hex'),
            originalSceneUuid: meta.uuid, nativeVerified: false, behaviorVerified: false, task51Complete: false };
    }
    /**
     * @description 保留真正可见且有区分力的依赖，批处理不能由仍启用的子渲染器代替。
     * @param type 明确的被测类型。
     * @param entries 原展示场景条目。
     * @param target 对应实际组件。
     * @returns 无；依赖缺失时拒绝生成。
     */
    private static dependencies(type: string, entries: readonly Record<string, unknown>[], target: Record<string, unknown>): void {
        if (type === 'cc.Bloom') {
            if (!entries.some(row => row.__type__ === 'cc.PostProcess' && row.global === true)
                || !entries.some(row => row.__type__ === 'cc.Camera' && row._usePostProcess === true))
                throw new Error('component_behavior_fixture_post_context_missing');
            return;
        }
        const animation = entries.find(row => row.__type__ === 'cc.SkeletalAnimation');
        if (!animation?._defaultClip) throw new Error('component_behavior_fixture_animation_missing');
        if (type === 'cc.SkeletalAnimation') return;
        if (type === 'cc.SkinnedMeshBatchRenderer') {
            // 同版SDK onLoad会以真实units生成mesh/skeleton，不能把尚未烘制的序列化空值判为缺失。
            if (!target._skinningRoot || !Array.isArray(target.units) || target.units.length === 0
                || target.units.map(value => this.record(value)).some(unit => !unit.mesh || !unit.skeleton || !unit.material))
                throw new Error('component_behavior_fixture_batch_units_missing');
            if (entries.some(row => row.__type__ === 'cc.SkinnedMeshRenderer' && row._enabled !== false))
                throw new Error('component_behavior_fixture_batch_source_still_visible');
            return;
        }
        if (!target._mesh || !target._skeleton || !target._skinningRoot)
            throw new Error('component_behavior_fixture_renderer_missing');
    }
    /**
     * @description 收窄外部JSON条目，不接受空值和数组。
     * @param value 外部JSON值。
     * @returns 已收窄记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_behavior_fixture_record_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
