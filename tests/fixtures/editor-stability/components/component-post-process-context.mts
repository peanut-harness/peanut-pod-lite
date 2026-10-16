import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * @description 后处理缓存字段的真实持久化前置条件；所有写仍交给六项受管能力。
 */
export class ComponentPostProcessContext {
    /**
     * @description BlitScreen在onLoad按启用的materials重建activeMaterials，必须保存相同真实材质上下文。
     * @param engine 已登记精确SDK目录。
     * @param version 实际SDK版本。
     * @param type 当前组件。
     * @param root 正在验证的公开根字段。
     * @param value 已解析真实UUID的公开输入。
     * @returns 本次原子字段patch，不更改预期读回值。
     */
    public static patch(engine: string, version: string, type: string, root: string, value: unknown): Record<string, unknown> {
        if (type !== 'cc.BlitScreen' || root !== 'activeMaterials') return { [root]: value };
        if (version !== '3.8.7') throw new Error('component_post_material_context_version_unverified');
        const proof = JSON.parse(readFileSync(new URL('./3.8.7/blit-screen-material-context.json', import.meta.url), 'utf8'));
        const sdk = realpathSync(engine); const path = join(sdk, proof.reference);
        if (proof.creatorVersion !== version || JSON.parse(readFileSync(join(sdk, 'package.json'), 'utf8')).version !== version
            || realpathSync(path) !== path || createHash('sha256').update(readFileSync(path)).digest('hex') !== proof.sha256)
            throw new Error('component_post_material_context_source_mismatch');
        if (!Array.isArray(value) || !value.length || value.length > 16 || value.some(item => typeof item !== 'string' || !item.length))
            throw new Error('component_post_material_context_assets_missing');
        return { materials: value.map(material => ({ material, enable: true })), activeMaterials: value };
    }
}
