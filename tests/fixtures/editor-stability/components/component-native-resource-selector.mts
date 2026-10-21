/**
 * @description 按冻结源路径和原生类型选择真实AssetDB身份，不因同工程其它资源而猜测UUID。
 */
export class ComponentNativeResourceSelector {
    /**
     * @description 独立材质与模型内嵌材质必须按来源区分；同源子资源仍须唯一且已导入。
     * @param resource 冻结资源绑定。
     * @param assets 当前工程实际AssetDB观测。
     * @returns 公开写入身份、原生期望与精确令牌资源。
     */
    public static resolve(resource: Record<string, unknown>, assets: readonly Record<string, unknown>[]) {
        if (typeof resource.nativeType !== 'string' || !Array.isArray(resource.sources)) throw new Error('component_matrix_resource_binding_invalid');
        const urls = resource.sources.flatMap((source: unknown) => {
            if (!source || typeof source !== 'object' || !('path' in source) || typeof source.path !== 'string'
                || !source.path.startsWith('tests/fixtures/editor-stability/') || source.path.split('/').some(part => ['', '.', '..'].includes(part))
                || source.path.includes('\\')) throw new Error('component_matrix_resource_source_invalid');
            return source.path.endsWith('.meta') ? [] : [`db://assets/fixtures/${source.path.slice('tests/fixtures/editor-stability/'.length)}`];
        });
        const matches = assets.filter(asset => asset.type === resource.nativeType && asset.imported === true && asset.invalid !== true
            && typeof asset.url === 'string' && urls.some(url => asset.url === url || String(asset.url).startsWith(url + '/')));
        const asset = matches[0];
        if (matches.length !== 1 || !asset || typeof asset.uuid !== 'string' || !asset.uuid || typeof asset.url !== 'string')
            throw new Error('component_matrix_resource_not_unique:' + resource.nativeType);
        return { input: asset.uuid, expected: { reference: 'asset', uuid: asset.uuid, type: asset.type, valid: true }, resources: [asset.url] };
    }
}
