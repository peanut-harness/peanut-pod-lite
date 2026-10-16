import { readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { IComponentResourceBinding, IComponentValueRecipe } from './component-value-recipe.mts';

/**
 * @description 全屏Blit使用同版后处理effect，不能以网格standard材质替代。
 */
export class ComponentBlitScreenMaterial {
    /**
     * @description 冻结自有材质源，真实UUID仍由原生AssetDB解析。
     */
    public static binding(root: string, version: string): IComponentResourceBinding | null {
        if (version === '3.8.3') return null;
        if (version !== '3.8.7') throw new Error('component_blit_material_version_unverified');
        const proof = this.proof(root); const base = 'tests/fixtures/editor-stability/components/3.8.7/blit-screen-material/';
        const paths = [base + 'task51-blit-screen.mtl', base + 'task51-blit-screen.mtl.meta'];
        const sources = paths.map(path => {
            const absolute = join(realpathSync(root), path);
            if (realpathSync(absolute) !== absolute) throw new Error('component_blit_material_source_link');
            const bytes = readFileSync(absolute); const sha256 = this.hash(bytes);
            if (!proof.authoredFiles.some(source => source.path === path && source.sha256 === sha256)) throw new Error('component_blit_material_source_mismatch');
            return { path, sha256 };
        });
        const material = JSON.parse(readFileSync(join(root, paths[0]!), 'utf8'));
        if (material.__type__ !== 'cc.Material' || material._effectAsset?.__uuid__ !== proof.effectUuid || material._techIdx !== 0)
            throw new Error('component_blit_material_effect_mismatch');
        return { nativeType: 'cc.Material', fixtureReference: 'tests/fixtures/editor-stability/components/3.8.7/blit-screen-material.json',
            sources, selector: '只选择专用全屏Blit材质根；原生effect必须是同版pipeline/post-process/blit-screen' };
    }

    /**
     * @description 两个公开根及内嵌字段共用专用全屏材质，保持每个字段的完整覆盖。
     */
    public static context(root: string, version: string): Readonly<Record<string, IComponentValueRecipe>> {
        const binding = this.binding(root, version); if (!binding) return {};
        const material: IComponentValueRecipe = { form: 'resource', resource: binding };
        return { 'cc.BlitScreen.activeMaterials': { form: 'list', items: [material] },
            'cc.BlitScreen.materials': { form: 'list', items: [{ form: 'object', properties: { material, enable: { form: 'literal', value: true } } }] },
            'cc.BlitScreenMaterial.material': material, 'cc.BlitScreenMaterial.enable': { form: 'literal', value: true } };
    }

    /**
     * @description 首次暂存前核对SDK effect及全屏pass源，拒绝版本、链接和摘要漂移。
     */
    public static assertSdk(root: string, engine: string, version: string): void {
        if (version !== '3.8.7') throw new Error('component_blit_material_version_unverified');
        const proof = this.proof(root); const sdk = realpathSync(engine);
        if (JSON.parse(readFileSync(join(sdk, 'package.json'), 'utf8')).version !== version) throw new Error('component_blit_material_sdk_mismatch');
        for (const source of proof.sources) {
            const path = join(sdk, source.path);
            if (!path.startsWith(sdk + sep) || realpathSync(path) !== path || this.hash(readFileSync(path)) !== source.sha256)
                throw new Error('component_blit_material_sdk_source_mismatch');
        }
        const meta = JSON.parse(readFileSync(join(sdk, 'editor/assets/effects/pipeline/post-process/blit-screen.effect.meta'), 'utf8'));
        if (meta.uuid !== proof.effectUuid) throw new Error('component_blit_material_sdk_effect_mismatch');
    }

    /**
     * @description 版本固定的来源回执，不接受其它管线或effect身份。
     */
    private static proof(root: string): { effectUuid: string; sources: { path: string; sha256: string }[]; authoredFiles: { path: string; sha256: string }[] } {
        const proof = JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/components/3.8.7/blit-screen-material.json'), 'utf8'));
        if (proof.creatorVersion !== '3.8.7' || proof.effectUuid !== '15049ccd-4dd7-451e-a8ae-af66735c929e'
            || proof.sources?.length !== 4 || proof.authoredFiles?.length !== 2) throw new Error('component_blit_material_proof_invalid');
        return proof;
    }

    /**
     * @description 原始字节摘要；不规范化或过滤源内容。
     */
    private static hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
}
