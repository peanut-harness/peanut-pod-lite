import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { IComponentResourceBinding } from './component-value-recipe.mts';

/**
 * @description 使用本版SDK自身CubeMap创建模板；只有真实六面加载及GPU上下文通过才可释放字段门禁。
 */
export class ComponentDefaultCube383 {
    /**
     * @description 空文件是SDK查询得到的正式模板，不是空资产占位；不编造meta、资源身份或SDK库文件。
     */
    public static binding(root: string): IComponentResourceBinding {
        const proof = this.proof(root); const path = proof.input.path; const absolute = join(realpathSync(root), path);
        if (realpathSync(absolute) !== absolute || this.hash(readFileSync(absolute)) !== proof.input.sha256)
            throw new Error('component_default_cube_input_drift');
        return { nativeType: 'cc.TextureCube', fixtureReference: 'tests/fixtures/editor-stability/components/3.8.3/default-cube-provenance.json',
            sources: [{ path, sha256: proof.input.sha256 }], selector: '3.8.3 SDK native .cubemap root; six distinct actual default ImageAssets and GPU cube required' };
    }

    /**
     * @description 独立核对该版Inspector、运行时Cube及六张默认图像和meta原始摘要，拒绝其它SDK。
     */
    public static assertSdk(root: string, engine: string): void {
        const proof = this.proof(root); const sdk = realpathSync(engine);
        for (const source of proof.sdkSources) {
            const path = join(sdk, source.path);
            if (realpathSync(path) !== path || this.hash(readFileSync(path)) !== source.sha256)
                throw new Error('component_default_cube_sdk_drift');
        }
    }

    /**
     * @description 字段写入前独立核对SDK真实默认六面，而非把TextureCube类名或非空UUID当依赖通过。
     */
    public static assertLoaded(root: string, report: unknown): void {
        const record = this.record(report); const rows = record.rows;
        if (!Array.isArray(rows)) throw new Error('component_default_cube_report_missing');
        const selected = rows.map(row => this.record(row)).filter(row => row.type === 'cc.TextureCube');
        if (selected.length !== 1) throw new Error('component_default_cube_root_not_unique');
        const cube = this.record(this.record(this.record(selected[0]).loaded).native).cube;
        const faces = this.record(cube).faces; const expected = this.proof(root).defaultImageUuids;
        if (!Array.isArray(faces) || faces.length !== 6) throw new Error('component_default_cube_faces_missing');
        for (const face of faces) {
            const value = this.record(face);
            if (typeof value.face !== 'string' || value.uuid !== expected[value.face]) throw new Error('component_default_cube_face_source_mismatch');
        }
    }

    /**
     * @description 仅使用已冻结的精确创建契约及15项来源，来源采集的警告会话不作为原生通过。
     */
    private static proof(root: string): { input: { path: string; sha256: string }; defaultImageUuids: Record<string, string>;
        sdkSources: { path: string; sha256: string }[] } {
        const value = JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/components/3.8.3/default-cube-provenance.json'), 'utf8'));
        if (value.creatorVersion !== '3.8.3' || value.contract?.handler !== 'texture-cube' || value.contract?.template !== ''
            || value.contract?.fullFileName !== 'cubemap.cubemap' || value.sdkSources?.length !== 15
            || value.input?.path !== 'tests/fixtures/editor-stability/components/3.8.3/default-cube/cubemap.cubemap'
            || Object.keys(value.defaultImageUuids ?? {}).sort().join(',') !== 'back,bottom,front,left,right,top'
            || new Set(Object.values(value.defaultImageUuids)).size !== 6
            || value.sdkSources.some((s: { path: string; sha256: string }) => !/^[a-f0-9]{64}$/u.test(s.sha256)
                || s.path.includes('\\') || s.path.split('/').some(part => ['', '.', '..'].includes(part))))
            throw new Error('component_default_cube_contract_invalid');
        return value;
    }

    /**
     * @description 只读字节摘要。
     */
    private static hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
    /**
     * @description 只接受JSON记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_default_cube_record_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
