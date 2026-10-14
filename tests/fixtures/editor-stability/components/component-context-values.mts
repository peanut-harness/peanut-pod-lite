import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IComponentResourceBinding, IComponentValueRecipe } from './component-value-recipe.mts';

/**
 * @description 从真实依赖读取皮肤、动画、骨架和本地 URL，避免虚构名称产生原生日志。
 */
export class ComponentContextValues {
    /**
     * @description 固定源数据约束的字段值；URL 在本次隔离工程启动预览后解析。
     * @param root 当前产品工作树。
     * @param bindings 已独立核对原始摘要的资源闭包。
     * @returns 有真实来源的公开输入配方。
     */
    public static create(root: string, bindings: Readonly<Record<string, IComponentResourceBinding>>): Readonly<Record<string, IComponentValueRecipe>> {
        const spineFile = 'tests/fixtures/editor-stability/media/supplemental/skeletal/one-bone-spine.json';
        const dragonFile = 'tests/fixtures/editor-stability/media/supplemental/skeletal/one-bone-dragonbones.json';
        const spine = JSON.parse(readFileSync(join(root, spineFile), 'utf8')) as { skins?: { name?: unknown }[]; animations?: Record<string, unknown> };
        const dragon = JSON.parse(readFileSync(join(root, dragonFile), 'utf8')) as { armature?: { name?: unknown; animation?: { name?: unknown }[] }[] };
        const skin = spine.skins?.[0]?.name; const animation = Object.keys(spine.animations ?? {})[0];
        const armature = dragon.armature?.[0]?.name; const dragonAnimation = dragon.armature?.[0]?.animation?.[0]?.name;
        if (typeof skin !== 'string' || !animation || typeof armature !== 'string' || typeof dragonAnimation !== 'string') {
            throw new Error('component_skeletal_context_missing');
        }
        const video = bindings['cc.VideoClip']?.sources.find((source) => source.path.endsWith('.mp4'));
        if (!video) throw new Error('component_video_context_missing');
        const webPath = 'tests/fixtures/editor-stability/components/fixtures/web/index.html';
        const webHash = createHash('sha256').update(readFileSync(join(root, webPath))).digest('hex');
        return {
            'sp.Skeleton.defaultSkin': { form: 'literal', value: skin },
            'sp.Skeleton.defaultAnimation': { form: 'literal', value: animation },
            'dragonBones.ArmatureDisplay.armatureName': { form: 'literal', value: armature },
            'dragonBones.ArmatureDisplay.animationName': { form: 'literal', value: dragonAnimation },
            'cc.VideoPlayer.remoteURL': { form: 'project-file-url', projectFile: video },
            'cc.WebView.url': { form: 'project-file-url', projectFile: { path: webPath, sha256: webHash } },
        };
    }
}
