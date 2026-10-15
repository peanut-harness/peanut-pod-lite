/**
 * @description 粒子根资产通过不等于纹理闭包通过；先核对AssetDB，再真实加载依赖。
 */
export class ComponentNativeAssetLoader {
    /**
     * @description 矩阵写入前要求同候选、同实例全部暂存类型通过，并保留粒子纹理闭包证据。
     * @param report 本工程原生资源检查报告。
     * @param expected 当前登记身份及完整暂存分母。
     */
    public static assertResources(report: any, expected: { candidateSourceCommit: string; creatorVersion: string; pid: number; types: string[] }): void {
        if (report?.candidateSourceCommit !== expected.candidateSourceCommit || report?.creatorVersion !== expected.creatorVersion
            || report?.pid !== expected.pid || !Array.isArray(report?.rows) || report.rows.length !== expected.types.length
            || new Set(expected.types).size !== expected.types.length) throw new Error('component_native_resource_preflight_identity_invalid');
        for (const type of expected.types) {
            const matches = report.rows.filter((row: any) => row?.type === type);
            const row = matches[0]; const loaded = row?.loaded; const native = loaded?.native;
            if (matches.length !== 1 || row.status !== 'native-loaded' || native?.type !== type || native.valid !== true
                || !native.actualUuid || native.actualUuid !== loaded?.info?.uuid) throw new Error('component_native_resource_preflight_incomplete');
            if (type === 'cc.ParticleAsset' && (!Array.isArray(native.dependencies) || native.dependencies.length !== 1
                || native.dependencies[0]?.type !== 'cc.SpriteFrame' || native.dependencies[0]?.valid !== true
                || !native.dependencies[0]?.uuid || native.dependencies[0].uuid !== native.dependencies[0].actualUuid)) {
                throw new Error('component_native_resource_preflight_particle_dependency_unproven');
            }
        }
    }

    /**
     * @description 在发起原生加载前拒绝缺失或错误类型的粒子SpriteFrame登记。
     * @param info 已确认在夹具范围内的根资源。
     * @param query 只读AssetDB请求。
     * @returns 必须实际加载的依赖身份，不推导子资源UUID。
     */
    public static async dependencies(info: { type: string; uuid: string }, query: (message: string, uuid: string) => Promise<any>): Promise<string[]> {
        if (info.type !== 'cc.ParticleAsset') return [];
        const meta = await query('query-asset-meta', info.uuid);
        const uuid = meta?.userData?.spriteFrameUuid;
        if (meta?.uuid !== info.uuid || meta?.importer !== 'particle' || typeof uuid !== 'string' || !uuid) {
            throw new Error('component_native_particle_dependency_missing');
        }
        const frame = await query('query-asset-info', uuid);
        if (frame?.uuid !== uuid || frame.type !== 'cc.SpriteFrame' || frame.imported !== true || frame.invalid === true
            || typeof frame.url !== 'string' || !frame.url.startsWith('db://assets/fixtures/')) {
            throw new Error('component_native_particle_sprite_frame_not_registered');
        }
        return [uuid];
    }

    /**
     * @description 根和依赖都通过真实assetManager加载；核对粒子对象所绑定的原生SpriteFrame。
     * @param uuid 根身份。
     * @param dependencies 先前AssetDB读出的依赖。
     * @param port 原生加载和类型检查边界。
     * @returns 含依赖实际类型、身份与有效性的有界纯JSON证据。
     */
    public static async load(uuid: string, dependencies: readonly string[], port: {
        load: (uuid: string) => Promise<any>; valid: (asset: any) => boolean; type: (asset: any) => string;
    }) {
        const describe = (asset: any, expected: string) => {
            if (!asset || !port.valid(asset) || asset._uuid !== expected) throw new Error('component_native_asset_invalid');
            return { uuid: expected, actualUuid: asset._uuid as string, type: port.type(asset), valid: true };
        };
        const asset = await port.load(uuid); const root = describe(asset, uuid);
        if (root.type !== 'cc.ParticleAsset') {
            if (dependencies.length) throw new Error('component_native_unexpected_asset_dependencies');
            return { ...root, dependencies: [] };
        }
        if (dependencies.length !== 1 || !dependencies[0]) throw new Error('component_native_particle_dependency_missing');
        const expected = dependencies[0];
        const bound = describe(asset.spriteFrame, expected);
        if (bound.type !== 'cc.SpriteFrame') throw new Error('component_native_particle_sprite_frame_type_mismatch');
        const frame = describe(await port.load(expected), expected);
        if (frame.type !== 'cc.SpriteFrame') throw new Error('component_native_particle_sprite_frame_type_mismatch');
        return { ...root, dependencies: [frame] };
    }
}
