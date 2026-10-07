import { LumenCocosVersion } from './cocos-version';

/**
 * @description 已实机验证的组件持久化能力边界；原生光度单位不作隐式属性别名。
 */
export class LumenNativeComponentPersistence {
    /**
     * @description 判断已证实版本中运行时丢失的目录字段，未知版本保持原行为。
     * @param version 实际会话版本；MCP 会话由受信 Host 绑定。
     * @param componentType 完整组件类型。
     * @param apiName 公开目录属性名。
     * @returns 是否必须在整补丁变化与保存前拒绝。
     */
    public static isNonPersistent(version: LumenCocosVersion, componentType: string, apiName: string): boolean {
        const field = `${componentType}.${apiName}`;
        if (version.toString() === '3.8.7' && field === 'cc.PolygonCollider2D.threshold') {
            return true;
        }
        if (!['3.8.3', '3.8.7'].includes(version.toString())) { return false; }
        return [
            'cc.UITransform.priority',
            'cc.Camera.targetDisplay',
            'cc.DirectionalLight.intensity',
            'cc.SphereLight.intensity',
            'cc.SpotLight.intensity',
        ].includes(field);
    }
}
