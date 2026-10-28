import { BULLET_BATCH_TYPES, JOINT_BATCH_TYPES } from './component-batch-physics-catalog';

/**
 * @description 批次只复用装配流程；各组件仍须真实后端、底层对象、事件、运动和实际像素联合成立。
 */
export class ComponentBatchPhysicsContract {
    /**
     * @description 仅接纳本轮23项，不包含已通过54项或SDK单列故障。
     */
    public static readonly types = new Set<string>([...BULLET_BATCH_TYPES, ...JOINT_BATCH_TYPES]);
    /**
     * @description 验证独立实际用例，不允许HUD、enable字段或错误后端替代运动。
     * @param type 固定组件。
     * @param baseline 实际基线。
     * @param effect 实际效果。
     */
    public static validate(type: string, baseline: unknown, effect: unknown): void {
        const a = this.record(baseline); const b = this.record(effect);
        if (!this.types.has(type)) throw new Error('batch_case_unregistered');
        const joint = (JOINT_BATCH_TYPES as readonly string[]).includes(type);
        for (const row of [a, b]) {
            if (row.backend !== (joint ? 'box2d' : 'bullet') || row.backendBound !== true || row.targetBound !== true
                || row.targetNode !== type || row.bodyBound !== true || row.visualBound !== true || row.materialBound !== true
                || row.steps !== 90 || row.connectedBodyBound !== true || !['x', 'y', 'vx', 'vy'].every(key => typeof row[key] === 'number' && Number.isFinite(row[key])))
                throw new Error('batch_actual_dependency_missing');
        }
        if (a.phase !== 'baseline' || b.phase !== 'effect') throw new Error('batch_phase_missing');
        if (joint) {
            if (a.targetEnabled !== false || b.targetEnabled !== true || a.nativeJointBound !== false || b.nativeJointBound !== true
                || Number(a.y) >= -150 || Number(b.y) <= 100 || Number(b.y) >= 180 || Math.abs(Number(b.vy)) >= 1)
                throw new Error('batch_joint_motion_missing');
            return;
        }
        this.bullet(type, a, b);
    }
    /**
     * @description 对各Bullet刺激验证实际事件和数值结果。
     * @param type 固定组件。
     * @param a 实际基线。
     * @param b 实际效果。
     */
    private static bullet(type: string, a: Record<string, unknown>, b: Record<string, unknown>): void {
        if (type === 'cc.RigidBody') {
            if (a.targetEnabled !== true || b.targetEnabled !== true || a.gravity !== false || b.gravity !== true
                || Math.abs(Number(a.y) - 3) > 1e-4 || Math.abs(Number(a.vy)) > 1e-4 || Number(b.y) >= -6 || Number(b.vy) >= -5)
                throw new Error('batch_gravity_motion_missing');
            return;
        }
        if (type === 'cc.ConstantForce') {
            if (a.targetEnabled !== false || b.targetEnabled !== true || a.gravity !== false || b.gravity !== false
                || Math.abs(Number(a.x)) > 1e-4 || Math.abs(Number(a.vx)) > 1e-4 || Number(b.x) <= 2 || Number(b.vx) <= 1)
                throw new Error('batch_force_motion_missing');
            return;
        }
        if (type.endsWith('Constraint')) {
            if (a.targetEnabled !== false || b.targetEnabled !== true || Number(a.y) >= -6
                || Number(b.y) <= 0.5 || Number(b.y) >= 1.5 || Math.abs(Number(b.vy)) >= 0.3)
                throw new Error('batch_constraint_motion_missing');
            return;
        }
        if (a.floorEnabled !== false || b.floorEnabled !== true || a.contacts !== 0
            || !Number.isSafeInteger(b.contacts) || Number(b.contacts) < 1 || Number(a.y) >= -6 || Number(b.y) <= -3 || Number(b.y) >= 3)
            throw new Error('batch_contact_motion_missing');
        if (type.endsWith('CharacterController')) {
            if (a.targetEnabled !== true || b.targetEnabled !== true || a.grounded !== false || b.grounded !== true)
                throw new Error('batch_controller_ground_missing');
        } else if (a.targetEnabled !== false || b.targetEnabled !== true || Math.abs(Number(b.vy)) >= 0.3)
            throw new Error('batch_collider_stop_missing');
    }
    /**
     * @description 除全画布差异外，实际蓝色运动体必须可见且改变画面位置，不能只靠地面或HUD变化。
     * @param before 原始画布像素。
     * @param after 原始效果像素。
     */
    public static motionPixels(before: { width: number; height: number; rgba: Uint8Array }, after: { width: number; height: number; rgba: Uint8Array }): void {
        const a = this.centroid(before); const b = this.centroid(after);
        if (Math.hypot(a.x - b.x, a.y - b.y) < 8) throw new Error('batch_actual_body_image_unchanged');
    }
    /**
     * @description 只测量原始像素中的实际运动体，不改写、遮罩或替换截图。
     * @param image 原始画布像素。
     * @returns 实际可见蓝色运动体中心。
     */
    private static centroid(image: { width: number; height: number; rgba: Uint8Array }): { x: number; y: number } {
        let x = 0; let y = 0; let count = 0;
        for (let i = 0; i < image.rgba.length; i += 4) {
            const red = image.rgba[i]!; const green = image.rgba[i + 1]!; const blue = image.rgba[i + 2]!;
            if (green > red + 30 && blue > red + 50) { const index = i / 4; x += index % image.width; y += Math.floor(index / image.width); count++; }
        }
        if (count < 40) throw new Error('batch_actual_body_image_missing');
        return { x: x / count, y: y / count };
    }
    /**
     * @description 拒绝缺失或数组观测。
     * @param value 外部状态。
     * @returns 实际记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('batch_state_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
