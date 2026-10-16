import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @description 暂存模板只携带真实SDK导入层次；资源及关节仍须在本次Creator中重新核验。
 */
export interface IComponentSkinnedContext {
    /**
     * @description 当前隔离工程重映射后的glTF根身份，不作为AssetDB登记证明。
     */
    readonly sourceUuid: string;
    /**
     * @description 位于本次证据目录的SDK导入模板副本，不能作为独立展示通过。
     */
    readonly templatePath: string;
}

/**
 * @description 重用已冻结的真实glTF导入结果装配场景，不创建空骨架、假动画或伪造资源。
 */
export class ComponentSkinnedHierarchy {
    /**
     * @description 精确匹配SDK源码和原输入，在全新未启动工程中暂存同源meta及层次副本。
     * @param root 当前工作树。
     * @param project 本任务全新隔离工程。
     * @param engine 已核验SDK源码根。
     * @param version 实际精确版本。
     * @param sdkSourceHash SDK只读摘要端口，默认读取实际安装文件；离线测试替换此IO边界。
     * @returns 尚待原生导入的同源上下文；未证明版本返回null。
     */
    public static stage(root: string, project: string, engine: string, version: string,
        sdkSourceHash: (path: string) => string = path => createHash('sha256').update(readFileSync(path)).digest('hex')): IComponentSkinnedContext | null {
        if (version !== '3.8.7') return null;
        project = realpathSync(project); const output = dirname(project);
        if (['library', 'temp', '.peanut-ai/component-probe.json'].some(path => existsSync(join(project, path)))
            || existsSync(join(output, 'creator-owned-start.json'))) throw new Error('component_skinned_project_already_started');
        const sourceRoot = join(root, 'tests/fixtures/editor-stability/components/3.8.7');
        const proof = this.record(JSON.parse(readFileSync(join(sourceRoot, 'skinned-hierarchy-provenance.json'), 'utf8')));
        if (proof.creatorVersion !== version || typeof proof.sourceRootUuid !== 'string'
            || !/^[a-f0-9-]{36}$/u.test(proof.sourceRootUuid) || !Array.isArray(proof.sdkSources) || proof.sdkSources.length !== 6)
            throw new Error('component_skinned_source_proof_invalid');
        for (const item of proof.sdkSources) {
            const source = this.record(item);
            if (typeof source.path !== 'string' || source.path.split('/').some(part => ['', '.', '..'].includes(part))
                || source.path.includes('\\')) throw new Error('component_skinned_sdk_path_invalid');
            if (sdkSourceHash(join(engine, source.path)) !== source.sha256) throw new Error('component_skinned_sdk_source_mismatch');
        }
        const input = this.record(proof.input);
        if (input.path !== 'tests/fixtures/editor-stability/media/assets/model/triangle.gltf') throw new Error('component_skinned_input_invalid');
        this.bytes(join(root, input.path), input.sha256);
        const gltf = join(project, 'assets/fixtures/media/assets/model/triangle.gltf');
        this.bytes(gltf, input.sha256);
        if (!Array.isArray(proof.files) || proof.files.length !== 2) throw new Error('component_skinned_files_invalid');
        const files = proof.files;
        const read = (file: string): unknown => {
            const matches = files.filter(item => this.record(item).file === file);
            if (matches.length !== 1) throw new Error('component_skinned_file_not_unique');
            return JSON.parse(this.bytes(join(sourceRoot, file), this.record(matches[0]).sha256).toString('utf8'));
        };
        const meta = this.record(read('gltf-skinned-source.meta.json')); const prefab = read('gltf-skinned-source.prefab.json');
        if (meta.uuid !== proof.sourceRootUuid || meta.importer !== 'gltf' || !Array.isArray(prefab)
            || this.record(prefab[0]).__type__ !== 'cc.Prefab') throw new Error('component_skinned_native_source_identity_invalid');
        const sourceUuid = randomUUID();
        const remap = (value: unknown): unknown => {
            if (typeof value === 'string' && (value === proof.sourceRootUuid || value.startsWith(proof.sourceRootUuid + '@')))
                return sourceUuid + value.slice(String(proof.sourceRootUuid).length);
            if (Array.isArray(value)) return value.map(remap);
            if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
            return value;
        };
        const templatePath = join(output, 'skinned-sdk-import-template.prefab');
        writeFileSync(gltf + '.meta', JSON.stringify(remap(meta), null, 2) + '\n', { flag: 'wx' });
        writeFileSync(templatePath, JSON.stringify(remap(prefab), null, 2) + '\n', { flag: 'wx' });
        writeFileSync(join(output, 'skinned-source-staging.json'), JSON.stringify({ creatorVersion: version, sourceUuid,
            nativeSourceRun: proof.nativeRun, input, sdkSources: proof.sdkSources, sourcePrefabSha256: this.record(proof.files[0]).sha256,
            templatePath, nativeAcceptance: false, jointPaths: proof.jointPaths }, null, 2) + '\n', { flag: 'wx' });
        return { sourceUuid, templatePath };
    }

    /**
     * @description 比较实际字节与冻结摘要，未知或漂移输入直接拒绝。
     * @param path 已限定来源路径。
     * @param expected 冻结SHA256。
     * @returns 已核对原始字节。
     */
    private static bytes(path: string, expected: unknown): Buffer {
        if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/u.test(expected) || realpathSync(path) !== path)
            throw new Error('component_skinned_source_path_or_hash_invalid');
        const bytes = readFileSync(path);
        if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('component_skinned_source_hash_mismatch');
        return bytes;
    }

    /**
     * @description 只接受普通JSON记录，不通过断言跳过证据校验。
     * @param value 未受信JSON。
     * @returns 已缩窄记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_skinned_record_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
