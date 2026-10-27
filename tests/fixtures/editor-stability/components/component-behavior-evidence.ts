/**
 * @description 实际截图解码后的游戏画布像素；必须由外层保存原图、裁剪区域和来源摘要。
 */
export type ComponentBehaviorPixels = { width: number; height: number; rgba: Uint8Array };

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
     * @returns 有界的组件行为观测，不是5.1整体通过。
     */
    public static compare(type: string, baseline: unknown, effect: unknown, before: ComponentBehaviorPixels, after: ComponentBehaviorPixels) {
        if (!['cc.Bloom', 'cc.SkeletalAnimation', 'cc.SkinnedMeshRenderer', 'cc.SkinnedMeshBatchRenderer'].includes(type))
            throw new Error('component_behavior_case_not_registered');
        const first = this.observation(type, 'baseline', baseline); const second = this.observation(type, 'effect', effect);
        if (second.observedFrame <= first.observedFrame) throw new Error('component_behavior_frame_order_invalid');
        if (type === 'cc.SkeletalAnimation') this.animation(first, second);
        else {
            if (first.enabled !== false || second.enabled !== true) throw new Error('component_behavior_enable_transition_missing');
            if (type === 'cc.Bloom') {
                if ([first, second].some(row => row.threshold !== 0 || row.intensity !== 5))
                    throw new Error('component_behavior_bloom_stimulus_missing');
            } else if ([first, second].some(row => row.meshBound !== true || row.skeletonBound !== true))
                throw new Error('component_behavior_renderer_dependency_missing');
        }
        const pixels = this.pixels(before, after);
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
        if (row.schemaVersion !== 1 || row.componentType !== type || row.sceneName !== type || row.phase !== phase
            || row.ready !== true || row.accepted !== false) throw new Error('component_behavior_observation_identity_invalid');
        const { requestedFrame, observedFrame, engineFramesElapsed } = row;
        if (typeof requestedFrame !== 'number' || !Number.isSafeInteger(requestedFrame) || requestedFrame < 0
            || typeof observedFrame !== 'number' || !Number.isSafeInteger(observedFrame)
            || observedFrame - requestedFrame < 2 || engineFramesElapsed !== observedFrame - requestedFrame)
            throw new Error('component_behavior_not_ready');
        return { ...row, observedFrame };
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
