const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
type Node = { name: string; children: Node[]; getComponents(base: unknown): unknown[] };
type Runtime = { scene: Node & { uuid: string }; componentBase: unknown;
    className(component: unknown): string; isValid(value: unknown): boolean };

/**
 * Read native scene getters only. No editor write, scene save/open or asset load is available here.
 */
export class ComponentExistingSpriteNativeProbeScene {
    public static snapshot(runtime: Runtime, expectedSceneUuid: string,
        expectedFrameUuid: string, expectOpacity: boolean): Record<string, unknown> {
        if (!UUID.test(expectedSceneUuid) || !UUID.test(expectedFrameUuid)
            || typeof expectOpacity !== 'boolean') throw new Error('component_sprite_scene_probe_arguments_invalid');
        if (!runtime.scene || runtime.scene.uuid !== expectedSceneUuid)
            throw new Error('component_sprite_scene_probe_scene_identity_mismatch');
        const matches: Node[] = [];
        let visited = 0;
        const walk = (node: Node, parent: string, depth: number): void => {
            visited += 1;
            if (visited > 4096 || depth > 64) throw new Error('component_sprite_scene_probe_hierarchy_limit');
            const path = `${parent}/${node.name}`;
            if (path.endsWith('/Root/Canvas/Target')) matches.push(node);
            if (!Array.isArray(node.children)) throw new Error('component_sprite_scene_probe_hierarchy_invalid');
            for (const child of node.children) walk(child, path, depth + 1);
        };
        walk(runtime.scene, '', 0);
        if (matches.length !== 1) throw new Error('component_sprite_scene_probe_target_missing_or_ambiguous');
        const components = matches[0].getComponents(runtime.componentBase);
        if (!Array.isArray(components)) throw new Error('component_sprite_scene_probe_components_invalid');
        const sprite = components.filter(item => runtime.className(item) === 'cc.Sprite');
        const opacity = components.filter(item => runtime.className(item) === 'cc.UIOpacity');
        if (sprite.length !== 1 || opacity.length !== (expectOpacity ? 1 : 0))
            throw new Error('component_sprite_scene_probe_component_mismatch');
        const item = sprite[0] as { grayscale?: unknown; spriteFrame?: unknown };
        const frame = item.spriteFrame as { _uuid?: unknown } | null;
        if (typeof item.grayscale !== 'boolean' || !frame || frame._uuid !== expectedFrameUuid
            || runtime.className(frame) !== 'cc.SpriteFrame' || runtime.isValid(frame) !== true)
            throw new Error('component_sprite_scene_probe_frame_mismatch');
        const opacityValue = expectOpacity ? (opacity[0] as { opacity?: unknown }).opacity : null;
        if (expectOpacity && (!Number.isInteger(opacityValue) || Number(opacityValue) < 0 || Number(opacityValue) > 255))
            throw new Error('component_sprite_scene_probe_opacity_invalid');
        return { sceneUuid: runtime.scene.uuid, targetPath: '/Root/Canvas/Target',
            frameUuid: frame._uuid, frameType: 'cc.SpriteFrame', frameValid: true,
            grayscale: item.grayscale, opacity: opacityValue };
    }
}

export const methods = {
    snapshot(expectedSceneUuid: string, expectedFrameUuid: string, expectOpacity: boolean): Record<string, unknown> {
        const cc = require('cc');
        return ComponentExistingSpriteNativeProbeScene.snapshot({
            scene: cc.director.getScene(), componentBase: cc.Component,
            className: (value: unknown) => cc.js.getClassName(value),
            isValid: (value: unknown) => cc.isValid(value),
        }, expectedSceneUuid, expectedFrameUuid, expectOpacity);
    },
};
