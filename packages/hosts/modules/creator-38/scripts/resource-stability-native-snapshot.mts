import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { IResourceSnapshot, IResourceSemanticAuthority } from './resource-stability-contracts.mts';

/**
 * @description 固定只读观测，不接受 SDK message 名称、脚本或写回数据。
 */
export interface IResourceNativeReadPort {
    assetInfo(pathOrUuid: string): Promise<unknown>;
    dependencies(uuid: string): Promise<readonly string[]>;
    inspector(uuid: string): Promise<{ readonly origin: 'creator-native'; readonly actualUuid: string;
        readonly valid: boolean; readonly semantic: Readonly<Record<string, unknown>>;
        readonly authorities?: Readonly<Record<string, IResourceSemanticAuthority>> }>;
}

/**
 * @description 同时核对真实源 meta、独立 AssetDB、依赖与原生 Inspector；缺少任一读回即停止。
 */
export class ResourceStabilityNativeSnapshot {
    public constructor(private readonly project: string, private readonly namespace: string,
        private readonly native: IResourceNativeReadPort) {
        if (realpathSync(project) !== project || !/^assets\/fixtures\/resource-stability\/[a-z0-9][a-z0-9-]{0,95}$/u.test(namespace)) {
            throw new Error('resource_native_snapshot_scope_invalid');
        }
    }

    /**
     * @description 只读取当前独占 namespace；删除后仍向 AssetDB 查询，不能由磁盘缺失推定注销。
     */
    public async read(relativePath: string): Promise<IResourceSnapshot> {
        const source = this.path(relativePath);
        const exists = existsSync(source);
        const info = this.recordOrNull(await this.native.assetInfo(`db://${relativePath}`));
        const metaPath = `${source}.meta`;
        if (!exists) {
            return { path: relativePath, exists: false, metaUuid: existsSync(metaPath) ? this.meta(metaPath).uuid as string : null,
                assetDbUuid: info && typeof info.uuid === 'string' ? info.uuid : null, subassets: [],
                unresolvedReferences: [], semantic: {}, readbackOrigin: 'creator-native' };
        }
        const meta = this.meta(metaPath);
        if (!info || info.uuid !== meta.uuid || info.url !== `db://${relativePath}` || info.imported !== true || info.invalid === true) {
            throw new Error('resource_native_root_not_registered');
        }
        const subassets: { metaUuid: string; assetDbUuid: string | null }[] = [];
        const visit = async (value: unknown, depth: number): Promise<void> => {
            if (depth > 8) throw new Error('resource_native_subasset_depth_exceeded');
            const map = this.recordOrNull(value);
            if (!map) throw new Error('resource_native_submeta_invalid');
            for (const entry of Object.values(map)) {
                if (subassets.length >= 4096) throw new Error('resource_native_subasset_budget_exceeded');
                const sub = this.recordOrNull(entry);
                if (!sub || typeof sub.uuid !== 'string') throw new Error('resource_native_submeta_invalid');
                const registered = this.recordOrNull(await this.native.assetInfo(sub.uuid));
                subassets.push({ metaUuid: sub.uuid, assetDbUuid: registered?.uuid === sub.uuid
                    && registered.imported === true && registered.invalid !== true ? sub.uuid : null });
                if (sub.subMetas !== undefined) await visit(sub.subMetas, depth + 1);
            }
        };
        if (meta.subMetas !== undefined) await visit(meta.subMetas, 0);
        const unresolved = new Set<string>(); const visited = new Set<string>();
        const references = async (uuid: string): Promise<void> => {
            if (visited.has(uuid)) return;
            if (visited.size >= 4096) throw new Error('resource_native_reference_budget_exceeded');
            visited.add(uuid);
            for (const dependency of await this.native.dependencies(uuid)) {
                const resolved = this.recordOrNull(await this.native.assetInfo(dependency));
                if (!resolved || resolved.uuid !== dependency || resolved.imported !== true || resolved.invalid === true) {
                    unresolved.add(dependency); continue;
                }
                await references(dependency);
            }
        };
        await references(String(meta.uuid));
        const inspector = await this.native.inspector(String(meta.uuid));
        if (inspector.origin !== 'creator-native' || inspector.actualUuid !== meta.uuid || inspector.valid !== true) {
            throw new Error('resource_native_inspector_identity_mismatch');
        }
        return { path: relativePath, exists, metaUuid: String(meta.uuid), assetDbUuid: String(info.uuid), subassets,
            unresolvedReferences: [...unresolved].sort(), semantic: inspector.semantic, authorities: inspector.authorities, readbackOrigin: 'creator-native' };
    }

    /**
     * @description 不允许路径穿越、符号链接或原工程读取。
     */
    private path(relativePath: string): string {
        if (!relativePath.startsWith(`${this.namespace}/`) || relativePath.split('/').some((part) => !part || part === '.' || part === '..')
            || /[\\%\u0000-\u001f]/u.test(relativePath)) throw new Error('resource_native_path_out_of_scope');
        let current = this.project;
        for (const segment of relativePath.split('/')) {
            current = join(current, segment);
            try {
                if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) throw new Error('resource_native_path_symlink');
            } catch (error) {
                if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') break;
                throw error;
            }
        }
        return current;
    }
    /**
     * @description meta 是独立磁盘证据，不能拿查询结果替代。
     */
    private meta(path: string): Record<string, unknown> {
        if (!existsSync(path) || realpathSync(path) !== path) throw new Error('resource_native_meta_missing_or_linked');
        if (statSync(path).size > 4 * 1024 * 1024) throw new Error('resource_native_meta_budget_exceeded');
        const value = this.recordOrNull(JSON.parse(readFileSync(path, 'utf8')));
        if (!value || typeof value.uuid !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value.uuid)) {
            throw new Error('resource_native_meta_invalid');
        }
        return value;
    }
    /**
     * @description 仅收缩对象，不隐去 AssetDB 拒绝和传输错误。
     */
    private recordOrNull(value: unknown): Record<string, unknown> | null {
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
    }
}
