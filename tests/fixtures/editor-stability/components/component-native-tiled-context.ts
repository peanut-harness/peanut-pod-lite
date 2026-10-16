/**
 * @description 只读核对SDK真实TMX初始化的拥有关系，不创建单格、用户登记或任何引擎对象。
 */
export class ComponentNativeTiledContext {
    /**
     * @description 读取固定Ground/Objects输入及序列化字段；getTiledTileAt明确禁止自动创建。
     */
    public static read(component: object): unknown {
        const cc = require('cc');
        const type = cc.js.getClassName(component);
        if (!['cc.TiledMap', 'cc.TiledLayer', 'cc.TiledObjectGroup', 'cc.TiledTile', 'cc.TiledUserNodeData'].includes(type)) return null;
        const values: unknown = Reflect.get(component.constructor, '__values__');
        const serializedFields = Array.isArray(values) ? values.filter(value => typeof value === 'string') : null;
        if (type !== 'cc.TiledMap') return { type, serializedFields };
        const node = Reflect.get(component, 'node');
        const layer = this.call(component, 'getLayer', ['Ground']);
        const group = this.call(component, 'getObjectGroup', ['Objects']);
        const source = Reflect.get(component, 'tmxAsset');
        const valid = (value: unknown): boolean => Boolean(value && cc.isValid(value));
        const mapSize = this.call(component, 'getMapSize');
        const size = this.call(layer, 'getLayerSize');
        const tileNode = this.call(this.get(layer, 'node'), 'getChildByName', ['OwnedTile']);
        const tile = this.call(tileNode, 'getComponent', ['cc.TiledTile']);
        const x = this.get(tile, 'x'); const y = this.get(tile, 'y');
        const userNode = this.call(this.get(layer, 'node'), 'getChildByName', ['OwnedUser']);
        const user = this.call(userNode, 'getComponent', ['cc.TiledUserNodeData']);
        const textures = this.call(layer, 'getTextures');
        const objects = this.call(group, 'getObjects');
        return { type, serializedFields, source: source ? { uuid: this.get(source, '_uuid'), type: cc.js.getClassName(source), valid: valid(source) } : null,
            mapSize: { width: this.get(mapSize, 'width'), height: this.get(mapSize, 'height') },
            layer: { valid: valid(layer), parentMatches: this.get(this.get(layer, 'node'), 'parent') === node,
                size: { width: this.get(size, 'width'), height: this.get(size, 'height') },
                firstGid: this.call(layer, 'getTileGIDAt', [0, 0]),
                textures: Array.isArray(textures) ? textures.map(texture => ({ valid: valid(texture), type: cc.js.getClassName(texture), uuid: this.get(texture, '_uuid') })) : null },
            group: { valid: valid(group), parentMatches: this.get(this.get(group, 'node'), 'parent') === node,
                objectCount: Array.isArray(objects) ? objects.length : null,
                objects: Array.isArray(objects) ? objects.map(object => ({ name: this.get(object, 'name'), gid: this.get(object, 'gid') })) : null },
            tile: { present: valid(tile), x, y, parentMatches: this.get(tileNode, 'parent') === this.get(layer, 'node'),
                cacheMatches: Boolean(tile && this.call(layer, 'getTiledTileAt', [x, y, false]) === tile) },
            user: { present: valid(user), layerMatches: Boolean(user && this.get(user, '_tiledLayer') === layer),
                row: this.get(user, '_row'), col: this.get(user, '_col') } };
    }

    /**
     * @description 要求地图来源、实际贴图和拥有关系成立；单格或用户尚未初始化时不能冒充已验。
     */
    public static assert(value: unknown, sourceUuid: string, requireTile: boolean, requireUser: boolean): void {
        const observed = this.record(value); const source = this.record(observed.source);
        const layer = this.record(observed.layer); const group = this.record(observed.group);
        const mapSize = this.record(observed.mapSize); const size = this.record(layer.size);
        if (observed.type !== 'cc.TiledMap' || source.uuid !== sourceUuid || source.type !== 'cc.TiledMapAsset' || source.valid !== true)
            throw new Error('component_tiled_native_source_invalid');
        if (mapSize.width !== 2 || mapSize.height !== 2 || size.width !== 2 || size.height !== 2
            || layer.valid !== true || layer.parentMatches !== true || layer.firstGid !== 1
            || !Array.isArray(layer.textures) || !layer.textures.length
            || layer.textures.some(texture => this.record(texture).valid !== true || this.record(texture).type !== 'cc.SpriteFrame'))
            throw new Error('component_tiled_native_layer_invalid');
        if (group.valid !== true || group.parentMatches !== true || group.objectCount !== 1
            || !Array.isArray(group.objects) || this.record(group.objects[0]).name !== 'Marker' || this.record(group.objects[0]).gid !== 1)
            throw new Error('component_tiled_native_group_invalid');
        const tile = this.record(observed.tile); const user = this.record(observed.user);
        if (requireTile && (tile.present !== true || tile.parentMatches !== true || tile.cacheMatches !== true
            || typeof tile.x !== 'number' || typeof tile.y !== 'number' || ![0, 1].includes(tile.x) || ![0, 1].includes(tile.y)))
            throw new Error('component_tiled_native_tile_invalid');
        if (requireUser && (user.present !== true || user.layerMatches !== true || typeof user.row !== 'number'
            || typeof user.col !== 'number' || user.row < 0 || user.col < 0)) throw new Error('component_tiled_native_user_invalid');
    }

    /**
     * @description 原生纯JSON证明必须为非空记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_tiled_native_record_invalid');
        return Object.fromEntries(Object.entries(value));
    }

    /**
     * @description 空依赖只返回null，读取属性不调用setter。
     */
    private static get(value: unknown, key: string): unknown {
        return value && typeof value === 'object' ? Reflect.get(value, key) : null;
    }

    /**
     * @description 仅由固定代码传入已审计的SDK只读方法及有界参数。
     */
    private static call(value: unknown, name: string, args: unknown[] = []): unknown {
        const method = this.get(value, name);
        return typeof method === 'function' ? Reflect.apply(method, value, args) : null;
    }
}
