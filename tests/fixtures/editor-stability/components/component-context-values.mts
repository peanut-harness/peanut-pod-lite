import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IComponentResourceBinding, IComponentValueRecipe } from './component-value-recipe.mts';

/**
 * @description 从真实依赖读取皮肤、动画、骨架和本地 URL，避免虚构名称产生原生日志。
 */
export class ComponentContextValues {
    /**
     * @description 蒙皮专用配方从相同glTF的实际导入子资源选动画，保持普通Animation的原独立来源。
     * @param bindings 已核对的真实资源闭包。
     * @returns 同源动画和SDK合法合批输入；不增加公开字段分母。
     */
    public static skinned(bindings: Readonly<Record<string, IComponentResourceBinding>>): Readonly<Record<string, IComponentValueRecipe>> {
        const mesh = bindings['cc.Mesh'];
        if (!mesh || mesh.sources.filter(source => source.path.endsWith('.gltf')).length !== 1) throw new Error('component_skinned_gltf_source_not_unique');
        const clip: IComponentValueRecipe = { form: 'resource', resource: { ...mesh, nativeType: 'cc.AnimationClip',
            selector: '相同glTF原生导入的唯一AnimationClip；禁止替换为独立default.anim' } };
        return { 'cc.SkeletalAnimation.defaultClip': clip, 'cc.SkeletalAnimation.clips': { form: 'list', items: [clip] },
            'cc.SkinnedMeshBatchRenderer.atlasSize': { form: 'literal', value: 1024 },
            'cc.SkinnedMeshBatchRenderer.batchableTextureNames': { form: 'list', items: [] } };
    }

    /**
     * @description 固定源数据约束的字段值；URL 在本次原生probe回环socket启动后解析并核验真实字节。
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
