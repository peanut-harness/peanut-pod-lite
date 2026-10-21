import { _decorator, Component, Node, TiledMap, UITransform } from 'cc';

/**
 * @description 固定地图输入的用户节点依赖；只使用SDK登记接口，不覆写被验字段或重建被移除的单格组件。
 */
@_decorator.ccclass('Task51TiledUserDependency')
@_decorator.executeInEditMode
@_decorator.executionOrder(100)
export class TiledUserDependency extends Component {
    /**
     * @description 在实际地图初始化后登记专用用户节点，不触碰图层颜色、裁剪、对象混合或单格坐标。
     */
    protected onLoad(): void {
        const map = this.node.getComponent(TiledMap);
        const layer = map?.getLayer('Ground');
        if (!layer) throw new Error('task51_tiled_real_layer_missing');
        let user = layer.node.getChildByName('OwnedUser');
        if (!user) {
            user = new Node('OwnedUser');
            user.addComponent(UITransform).setContentSize(8, 8);
        }
        if (!user.getComponent('cc.TiledUserNodeData') && !layer.addUserNode(user)) {
            throw new Error('task51_tiled_user_registration_failed');
        }
    }
}
