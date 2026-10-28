/**
 * @description 真实Box2D运动、实际接触事件及画面必须共同成立，参数读回不能代替行为。
 */
export class ComponentPhysics2DBehaviorContract {
    /**
     * @description 本阶段未通过组件固定名单。
     */
    public static readonly types = new Set(['cc.RigidBody2D', 'cc.BoxCollider2D', 'cc.CircleCollider2D', 'cc.PolygonCollider2D']);
    /**
     * @description Box2D浮点世界坐标往返的静止位置容差，单位为UI像素；不影响运动和画面恢复门禁。
     */
    private static readonly restingPositionTolerance = 1e-4;
    /**
     * @description 联合核对后端、依赖、步数及有区分力的运动。
     * @param type 固定组件。
     * @param baseline 实际基线。
     * @param effect 实际效果。
     */
    public static validate(type: string, baseline: unknown, effect: unknown): void {
        const a = this.record(baseline); const b = this.record(effect);
        if (!this.types.has(type)) throw new Error('component_physics2d_type_unknown');
        for (const row of [a, b]) {
            if (row.backendBox2D !== true || row.testedComponentBound !== true || row.dynamicBodyBound !== true
                || row.bodyImplBound !== true || row.debugShapesEnabled !== true || row.steps !== 90
                || typeof row.ballY !== 'number' || !Number.isFinite(row.ballY)
                || typeof row.velocityY !== 'number' || !Number.isFinite(row.velocityY)
                || !Number.isSafeInteger(row.contacts) || Number(row.contacts) < 0) throw new Error('component_physics2d_dependency_missing');
        }
        if (type === 'cc.RigidBody2D') {
            if (a.targetEnabled !== true || b.targetEnabled !== true || a.gravityScale !== 0 || b.gravityScale !== 1
                || Math.abs(Number(a.ballY) - 140) > this.restingPositionTolerance || a.velocityY !== 0 || Number(b.ballY) >= -150 || Number(b.velocityY) >= -10
                || a.contacts !== 0 || b.contacts !== 0) throw new Error('component_physics2d_gravity_not_observed');
            return;
        }
        if (a.targetEnabled !== false || b.targetEnabled !== true || a.gravityScale !== 1 || b.gravityScale !== 1
            || a.contacts !== 0 || Number(b.contacts) < 1 || Number(a.ballY) >= -150
            || Number(b.ballY) <= -80 || Number(b.ballY) >= 0 || Math.abs(Number(b.velocityY)) >= 1)
            throw new Error('component_physics2d_contact_not_observed');
    }
    /**
     * @description 不接受缺失或数组观测。
     * @param value 未受信数据。
     * @returns 实际状态记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_physics2d_state_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
