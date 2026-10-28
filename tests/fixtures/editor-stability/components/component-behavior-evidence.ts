import { ComponentUiBehaviorContract } from './component-ui-behavior-contract.ts';
import { ComponentInputBehaviorContract } from './component-input-behavior-contract.ts';
import { ComponentContextUiBehaviorContract } from './component-context-ui-behavior-contract.ts';
import { ComponentVisualBehaviorContract } from './component-visual-behavior-contract.ts';
import { ComponentPhysics2DBehaviorContract } from './component-physics2d-behavior-contract.ts';
import { ComponentBatchPhysicsContract } from './component-batch-physics-contract.ts';

/**
 * @description 实际截图解码后的游戏画布像素；必须由外层保存原图、裁剪区域和来源摘要。
 */
export type ComponentBehaviorPixels = { width: number; height: number; rgba: Uint8Array };

/**
 * @description 冻结场景与实际原生会话在取证前后的独立身份绑定。
 */
export type ComponentBehaviorSceneBinding = {
    expectedSceneUuid: string; beforeSceneUuid: string; afterSceneUuid: string; sourceMetaUuid: string;
    expectedPid: number; beforePid: number; afterPid: number;
    expectedSourceSha256: string; beforeSourceSha256: string; afterSourceSha256: string;
    expectedPreviewUrl: string; beforePreviewUrl: string; afterPreviewUrl: string;
};

/**
 * @description 将真实预览的公开运行观测与画布像素对照联合判定，禁止用字段读回或不同HUD代替行为证据。
 */
export class ComponentBehaviorEvidence {
    /**
     * @description 验证固定组件的两个实际状态及游戏区域差异；不提升完整矩阵或环境诊断状态。
     * @param type 已登记的组件类型。
     * @param baseline 实际预览可见DOM中的基线记录。
     * @param effect 实际预览可见DOM中的效果记录。
     * @param before 基线截图相同游戏区域的真实像素。
     * @param after 效果截图相同游戏区域的真实像素。
     * @param binding 独立原生查询、冻结来源和实际预览地址的前后绑定。
     * @returns 有界的组件行为观测，不是5.1整体通过。
     */
    public static compare(type: string, baseline: unknown, effect: unknown, before: ComponentBehaviorPixels, after: ComponentBehaviorPixels,
        binding: ComponentBehaviorSceneBinding) {
        if (!['cc.Bloom', 'cc.SkeletalAnimation', 'cc.SkinnedMeshRenderer', 'cc.SkinnedMeshBatchRenderer',
            'cc.TiledMap', 'cc.TiledLayer', 'cc.TiledObjectGroup', 'cc.TiledTile', 'cc.TiledUserNodeData',
            'cc.BlitScreen', 'cc.ColorGrading', 'cc.DOF', 'cc.FSR', 'cc.HBAO', 'cc.PostProcess', 'cc.TAA'].includes(type)
            && !ComponentUiBehaviorContract.types.has(type) && !ComponentInputBehaviorContract.types.has(type)
            && !ComponentContextUiBehaviorContract.types.has(type) && !ComponentVisualBehaviorContract.types.has(type)
            && !ComponentPhysics2DBehaviorContract.types.has(type) && !ComponentBatchPhysicsContract.types.has(type))
            throw new Error('component_behavior_case_not_registered');
        this.binding(binding);
        const first = this.observation(type, 'baseline', baseline); const second = this.observation(type, 'effect', effect);
        if (second.observedFrame <= first.observedFrame) throw new Error('component_behavior_frame_order_invalid');
        if (ComponentBatchPhysicsContract.types.has(type)) {
            if ([first, second].some(row => typeof row.engineFramesElapsed !== 'number' || row.engineFramesElapsed < 94))
                throw new Error('batch_frames_insufficient');
            ComponentBatchPhysicsContract.validate(type, first.state, second.state);
        } else if (ComponentPhysics2DBehaviorContract.types.has(type)) {
            if ([first, second].some(row => typeof row.engineFramesElapsed !== 'number' || row.engineFramesElapsed < 91))
                throw new Error('component_physics2d_frames_insufficient');
            ComponentPhysics2DBehaviorContract.validate(type, first.state, second.state);
        } else if (ComponentVisualBehaviorContract.types.has(type)) {
            if ([first, second].some(row => typeof row.engineFramesElapsed !== 'number' || row.engineFramesElapsed < 16))
                throw new Error('component_visual_frames_insufficient');
            ComponentVisualBehaviorContract.validate(type, first.state, second.state);
        } else if (ComponentContextUiBehaviorContract.types.has(type)) {
            if ([first, second].some(row => typeof row.engineFramesElapsed !== 'number' || row.engineFramesElapsed < 16))
                throw new Error('component_context_frames_insufficient');
            ComponentContextUiBehaviorContract.validate(type, first.state, second.state);
        } else if (ComponentInputBehaviorContract.types.has(type)) {
            if ([first, second].some(row => typeof row.engineFramesElapsed !== 'number' || row.engineFramesElapsed < 16))
                throw new Error('component_input_frames_insufficient');
            ComponentInputBehaviorContract.validate(type, first.state, second.state);
        } else if (ComponentUiBehaviorContract.types.has(type)) {
            if ([first, second].some(row => typeof row.engineFramesElapsed !== 'number' || row.engineFramesElapsed < 16))
                throw new Error('component_ui_frames_insufficient');
            ComponentUiBehaviorContract.validate(type, first.state, second.state);
        } else if (type.startsWith('cc.Tiled') || ['cc.BlitScreen', 'cc.ColorGrading', 'cc.DOF', 'cc.FSR', 'cc.HBAO', 'cc.PostProcess', 'cc.TAA'].includes(type))
            this.remaining(type, first, second);
        else if (type === 'cc.SkeletalAnimation') this.animation(first, second);
        else {
            if (first.enabled !== false || second.enabled !== true) throw new Error('component_behavior_enable_transition_missing');
            if (type === 'cc.Bloom') {
                if ([first, second].some(row => row.threshold !== 0 || row.intensity !== 5))
                    throw new Error('component_behavior_bloom_stimulus_missing');
            } else if ([first, second].some(row => row.meshBound !== true || row.skeletonBound !== true))
                throw new Error('component_behavior_renderer_dependency_missing');
        }
        const pixels = this.pixels(before, after);
        if (ComponentBatchPhysicsContract.types.has(type)) ComponentBatchPhysicsContract.motionPixels(before, after);
        return { componentType: type, behaviorObserved: true, pixels, task51Complete: false,
            verificationScope: 'registered public runtime transition and actual game-canvas pixel difference; whole-session diagnostics remain separate' };
    }
    /**
     * @description 拒绝未就绪、跨场景、伪造自动通过及没有真实帧推进的观测。
     * @param type 固定被测组件。
     * @param phase 固定对照状态。
     * @param value 未受信DOM记录。
     * @returns 已检查身份和就绪条件的记录。
     */
    private static observation(type: string, phase: string, value: unknown): Record<string, unknown> & { observedFrame: number } {
        const row = this.record(value);
        if (row.schemaVersion !== 1 || row.protocolVersion !== 2 || row.componentType !== type
            || (row.sceneName !== '' && row.sceneName !== type
                && !(ComponentBatchPhysicsContract.types.has(type) && row.sceneName === 'Task51BatchPhysics')) || row.phase !== phase
            || row.ready !== true || row.accepted !== false) throw new Error('component_behavior_observation_identity_invalid');
        const { requestedFrame, observedFrame, engineFramesElapsed } = row;
        if (typeof requestedFrame !== 'number' || !Number.isSafeInteger(requestedFrame) || requestedFrame < 0
            || typeof observedFrame !== 'number' || !Number.isSafeInteger(observedFrame)
            || observedFrame - requestedFrame < 2 || engineFramesElapsed !== observedFrame - requestedFrame)
            throw new Error('component_behavior_not_ready');
        return { ...row, observedFrame };
    }
    /**
     * @description 剩余组件的真实公开行为必须与固定刺激吻合，依赖缺失或只改HUD均拒绝。
     * @param type 已登记组件。
     * @param first 实际基线。
     * @param second 实际变化。
     * @returns 无；语义不匹配即拒绝。
     */
    private static remaining(type: string, first: Record<string, unknown>, second: Record<string, unknown>): void {
        const before = this.record(first.state); const after = this.record(second.state);
        const minimum = type === 'cc.TAA' ? 32 : 8;
        if ([first, second].some(row => typeof row.engineFramesElapsed !== 'number' || row.engineFramesElapsed < minimum))
            throw new Error('component_behavior_remaining_frames_insufficient');
        const common: Record<string, unknown> = {};
        const third = before.visualRevision === 3 || after.visualRevision === 3;
        const refined = third || before.visualRevision === 2 || after.visualRevision === 2;
        if (refined && (before.visualRevision !== (third ? 3 : 2) || after.visualRevision !== (third ? 3 : 2)
            || !['cc.TiledLayer', 'cc.TiledTile', 'cc.TiledUserNodeData', 'cc.TAA'].includes(type)))
            throw new Error('component_behavior_visual_revision_invalid');
        if (refined) common.visualRevision = third ? 3 : 2;
        if (third) {
            if (type === 'cc.TiledLayer') common.publicRenderInvalidation = true;
            else if (type === 'cc.TiledUserNodeData') Object.assign(common, { userSpriteBound: true, userWidth: 16, userHeight: 16 });
            else if (type === 'cc.TAA') common.postProcessCameraCount = 1;
            else throw new Error('component_behavior_visual_revision_invalid');
        }
        let initial: Record<string, unknown>; let changed: Record<string, unknown>;
        switch (type) {
            case 'cc.TiledMap': initial = { mapBound: true, layers: 1, objects: 1 }; changed = { mapBound: false, layers: 0, objects: 0 }; break;
            case 'cc.TiledLayer': initial = refined ? { layerColor: '255,255,255,255' } : { gid: 1 }; changed = refined ? { layerColor: '255,0,0,255' } : { gid: 0 }; Object.assign(common, { mapBound: true, layers: 1 }); break;
            case 'cc.TiledObjectGroup': initial = { groupActive: true }; changed = { groupActive: false }; Object.assign(common, { mapBound: true, objects: 1 }); break;
            case 'cc.TiledTile': initial = refined ? { tileScaleX: 1, tileGrid: 1 } : { tileGrid: 1 }; changed = refined ? { tileScaleX: 1.8, tileGrid: 1 } : { tileGrid: 0 }; Object.assign(common, { mapBound: true, tileRegistered: true }); break;
            case 'cc.TiledUserNodeData': initial = { userRegistered: true, userParentIsLayer: true, ...(third ? { userGridOwned: true } : {}) }; changed = { userRegistered: false, userParentIsLayer: false, ...(third ? { userGridOwned: false } : {}) }; Object.assign(common, { mapBound: true, layers: 1 }); break;
            case 'cc.PostProcess': initial = { shadingScale: 1 }; changed = { shadingScale: 0.2 }; Object.assign(common, { enabled: true }); break;
            case 'cc.BlitScreen': initial = { enabled: false }; changed = { enabled: true }; Object.assign(common, { activeMaterials: 1 }); break;
            case 'cc.ColorGrading': initial = { enabled: false }; changed = { enabled: true }; Object.assign(common, { lutBound: true, lutWidth: 256, lutHeight: 16, contribute: 1 }); break;
            case 'cc.DOF': initial = { enabled: false }; changed = { enabled: true }; Object.assign(common, { focusDistance: 100, focusRange: 0.1, bokehRadius: 10 }); break;
            case 'cc.FSR': initial = { enabled: false }; changed = { enabled: true }; Object.assign(common, { sharpness: 1, shadingScale: 0.2 }); break;
            case 'cc.HBAO': initial = { enabled: false }; changed = { enabled: true }; Object.assign(common, { radiusScale: 5, aoSaturation: 5 }); break;
            case 'cc.TAA': initial = { enabled: false }; changed = { enabled: true }; Object.assign(common, { sampleScale: refined ? 5 : 1, feedback: 0.95 }); if (refined) common.shadingScale = 0.5; break;
            default: throw new Error('component_behavior_remaining_case_invalid');
        }
        if (Object.entries({ ...common, ...initial }).some(([key, value]) => before[key] !== value)
            || Object.entries({ ...common, ...changed }).some(([key, value]) => after[key] !== value))
            throw new Error('component_behavior_remaining_transition_invalid');
    }
    /**
     * @description 浏览器运行场景可能没有名称；必须用原生场景UUID、进程、源码摘要与地址共同证明身份。
     * @param value 独立采集的前后身份。
     * @returns 无；缺失或不一致即拒绝。
     */
    private static binding(value: ComponentBehaviorSceneBinding): void {
        const row = this.record(value);
        const uuid = row.expectedSceneUuid;
        const sha = row.expectedSourceSha256;
        const pid = row.expectedPid;
        const url = row.expectedPreviewUrl;
        if (typeof uuid !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(uuid)
            || [row.beforeSceneUuid, row.afterSceneUuid, row.sourceMetaUuid].some(item => item !== uuid)
            || typeof sha !== 'string' || !/^[a-f0-9]{64}$/u.test(sha)
            || [row.beforeSourceSha256, row.afterSourceSha256].some(item => item !== sha)
            || typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0
            || row.beforePid !== pid || row.afterPid !== pid
            || typeof url !== 'string' || !/^http:\/\/(?:localhost|127\.0\.0\.1):[1-9][0-9]{0,4}\/$/u.test(url)
            || Number(new URL(url).port) > 65535
            || row.beforePreviewUrl !== url || row.afterPreviewUrl !== url)
            throw new Error('component_behavior_native_binding_invalid');
    }
    /**
     * @description 时间和真实骨骼位姿必须同时改变，只有采样时间字段变化仍拒绝。
     * @param first 原始起始状态。
     * @param second 实际四分之三时刻状态。
     * @returns 无；不可判别动画抛错。
     */
    private static animation(first: Record<string, unknown>, second: Record<string, unknown>): void {
        const duration = first.animationDuration;
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0
            || second.animationDuration !== duration || first.animationTime !== 0
            || typeof second.animationTime !== 'number' || Math.abs(second.animationTime - duration * 0.75) > 1e-6
            || first.enabled !== true || second.enabled !== true) throw new Error('component_behavior_animation_sample_invalid');
        const before = this.poses(first.poses); const after = this.poses(second.poses);
        if (before.size !== after.size || [...before.keys()].some(path => !after.has(path)))
            throw new Error('component_behavior_pose_identity_changed');
        if (![...before].some(([path, values]) => values.some((value, index) => Math.abs(value - after.get(path)![index]!) > 1e-5)))
            throw new Error('component_behavior_animation_pose_unchanged');
    }
    /**
     * @description 位姿路径唯一且全部数值有限，拒绝空层级及NaN冒充变化。
     * @param value 未受信实际层级观测。
     * @returns 各真实节点的平移与旋转数值。
     */
    private static poses(value: unknown): Map<string, number[]> {
        if (!Array.isArray(value) || value.length === 0) throw new Error('component_behavior_pose_missing');
        const result = new Map<string, number[]>();
        for (const item of value) {
            const row = this.record(item);
            if (typeof row.path !== 'string' || !row.path.startsWith('/') || result.has(row.path)
                || !Array.isArray(row.position) || row.position.length !== 3 || !Array.isArray(row.rotation) || row.rotation.length !== 4)
                throw new Error('component_behavior_pose_invalid');
            const values: unknown[] = [...row.position, ...row.rotation];
            if (!values.every((number): number is number => typeof number === 'number' && Number.isFinite(number)))
                throw new Error('component_behavior_pose_invalid');
            result.set(row.path, values);
        }
        return result;
    }
    /**
     * @description 仅比较相同游戏区域的RGB；至少千分之一像素有16级差异，HUD不应包含在输入中。
     * @param before 基线游戏画布。
     * @param after 效果游戏画布。
     * @returns 实际变化像素与固定判别门槛。
     */
    private static pixels(before: ComponentBehaviorPixels, after: ComponentBehaviorPixels) {
        if (!Number.isSafeInteger(before.width) || !Number.isSafeInteger(before.height) || before.width <= 0 || before.height <= 0
            || before.width !== after.width || before.height !== after.height || before.width * before.height > 8 * 1024 * 1024
            || before.rgba.length !== before.width * before.height * 4 || after.rgba.length !== before.rgba.length)
            throw new Error('component_behavior_pixel_region_invalid');
        let changedPixels = 0;
        for (let index = 0; index < before.rgba.length; index += 4) {
            if ([0, 1, 2].some(channel => Math.abs(before.rgba[index + channel]! - after.rgba[index + channel]!) >= 16)) changedPixels++;
        }
        const totalPixels = before.width * before.height; const minimumChangedPixels = Math.max(32, Math.ceil(totalPixels * 0.001));
        if (changedPixels < minimumChangedPixels) throw new Error('component_behavior_game_pixels_unchanged');
        return { width: before.width, height: before.height, totalPixels, changedPixels, minimumChangedPixels, channelThreshold: 16 };
    }
    /**
     * @description 收窄不可信JSON对象，拒绝空值和数组。
     * @param value 外部DOM值。
     * @returns 有效键值记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_behavior_record_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
