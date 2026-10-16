/**
 * @description 只读六个真实ImageAsset及GPU立方体尺寸，不读取像素或以资源类名替代依赖证明。
 */
export class ComponentNativeCubeContext {
    /**
     * @description 3.8.3新CubeMap输入须已有六个不同图像及六层GPU纹理，空壳、缺面和大小漂移直接拒绝。
     */
    public static read(asset: object, describe: (value: unknown) => { uuid: string; type: string; valid: boolean }): unknown {
        const width = Reflect.get(asset, 'width'); const height = Reflect.get(asset, 'height'); const mipmaps = Reflect.get(asset, 'mipmaps');
        if (!Number.isInteger(width) || width <= 0 || height !== width || !Array.isArray(mipmaps) || !mipmaps[0]
            || typeof mipmaps[0] !== 'object') throw new Error('component_native_cube_shape_missing');
        const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'].map(face => {
            const image: unknown = Reflect.get(mipmaps[0], face); const info = describe(image);
            if (!image || typeof image !== 'object' || info.type !== 'cc.ImageAsset' || !info.valid || !info.uuid
                || Reflect.get(image, 'width') !== width || Reflect.get(image, 'height') !== height)
                throw new Error('component_native_cube_face_invalid:' + face);
            return { face, ...info, width, height };
        });
        if (new Set(faces.map(face => face.uuid)).size !== 6) throw new Error('component_native_cube_faces_not_distinct');
        const getTexture: unknown = Reflect.get(asset, 'getGFXTexture');
        const texture: unknown = typeof getTexture === 'function' ? getTexture.call(asset) : null;
        if (!texture || typeof texture !== 'object' || Reflect.get(texture, 'layerCount') !== 6
            || Reflect.get(texture, 'width') !== width || Reflect.get(texture, 'height') !== height)
            throw new Error('component_native_cube_gpu_missing');
        return { width, height, gpuLayers: 6, faces };
    }
}
