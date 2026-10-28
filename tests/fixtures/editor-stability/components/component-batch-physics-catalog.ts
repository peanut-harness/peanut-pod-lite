/**
 * @description 本轮未通过的Bullet组件固定清单；不包含已经通过的54项。
 */
export const BULLET_BATCH_TYPES = ['cc.RigidBody', 'cc.ConstantForce', 'cc.BoxCollider', 'cc.CapsuleCollider',
    'cc.ConeCollider', 'cc.CylinderCollider', 'cc.MeshCollider', 'cc.PlaneCollider', 'cc.SimplexCollider', 'cc.SphereCollider',
    'cc.FixedConstraint', 'cc.HingeConstraint', 'cc.PointToPointConstraint', 'cc.ConfigurableConstraint',
    'cc.BoxCharacterController', 'cc.CapsuleCharacterController'] as const;
/**
 * @description 共用Box2D夹具的七项关节；MouseJoint需要真实拖动，另行保留。
 */
export const JOINT_BATCH_TYPES = ['cc.DistanceJoint2D', 'cc.FixedJoint2D', 'cc.HingeJoint2D', 'cc.RelativeJoint2D',
    'cc.SliderJoint2D', 'cc.SpringJoint2D', 'cc.WheelJoint2D'] as const;
/**
 * @description 统一物理批次接口，不在控制面板中模拟物体运动。
 */
export interface Task51BatchCase {
    reset(phase: string): void;
    step(): void;
    state(): Record<string, unknown>;
    dispose(): void;
}
