import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { ILumenMessagePort, LumenSession } from '@peanut/pod-engine/lumen';

/**
 * @description 把独立资产的 meta 编辑提交给 AssetDB，并回读真实字段而非只检查登记状态。
 */
export class EditorMcpLumenMetaSave {
    /**
     * @description 保存源文档；已有 meta 变化时使用 Creator 的原生 meta 写入接口。
     * @param session 已编辑的真实 Lumen 会话。
     * @param relativePath 工程内资产路径。
     * @param message 可选原生端口；离线保存维持原行为。
     * @param verifyTimeoutMs 原生完成后的最大回读等待。
     */
    public static async save(
        session: LumenSession,
        relativePath: string,
        message: ILumenMessagePort | null,
        verifyTimeoutMs = 2500,
    ): Promise<void> {
        const source = join(session.projectRoot, relativePath);
        const metaPath = `${source}.meta`;
        const before = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null;
        const nativeMeta = message == null ? null : session.getNativeMetaSnapshot();
        if (nativeMeta == null || before == null) {
            session.save();
        }
        if (message == null || before == null || !existsSync(metaPath)) {
            return;
        }
        const expected = nativeMeta ?? JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
        if (isDeepStrictEqual(before, expected)) {
            return;
        }
        const contentHash = this._hash(source);
        const url = `db://${relativePath.replace(/\\/gu, '/')}`;
        const info = await message.request<Record<string, unknown> | null>('asset-db', 'query-asset-info', url);
        if (info == null || info.uuid !== expected.uuid || info.importer !== expected.importer) {
            throw new Error(`editor_mcp_lumen_meta_identity_unproven:${relativePath}`);
        }
        const changes = this._changes(before, expected);
        await message.request('asset-db', 'save-asset-meta', url, JSON.stringify(expected, null, 2));
        const deadline = Date.now() + verifyTimeoutMs;
        const stableMs = Math.min(300, verifyTimeoutMs / 2);
        let matchedSince: number | null = null;
        do {
            const live = await message.request<Record<string, unknown> | null>('asset-db', 'query-asset-meta', url);
            const disk = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
            if (this._matches(expected, live, changes) && this._matches(expected, disk, changes)) {
                if (this._hash(source) !== contentHash) {
                    throw new Error(`editor_mcp_lumen_meta_source_changed:${relativePath}`);
                }
                matchedSince ??= Date.now();
                if (Date.now() - matchedSince >= stableMs) {
                    return;
                }
            } else {
                matchedSince = null;
            }
            if (Date.now() < deadline) {
                await new Promise<void>((resolve) => setTimeout(resolve,
                    Math.min(50, stableMs, deadline - Date.now())));
            }
        } while (Date.now() < deadline);
        throw new Error(`editor_mcp_lumen_meta_readback_mismatch:${relativePath}`);
    }

    /**
     * @description 计算本次保存后的源字节身份，meta 提交不得再改源文件。
     * @param path 文件绝对路径。
     * @returns SHA256。
     */
    private static _hash(path: string): string {
        return createHash('sha256').update(readFileSync(path)).digest('hex');
    }

    /**
     * @description 收集本次真实 meta 改动；导入器补充的其他字段无需逐字相同。
     * @param before 保存前 JSON。
     * @param after 保存后 JSON。
     * @param path 当前字段路径。
     * @returns 改动字段及删除状态。
     */
    private static _changes(before: unknown, after: unknown, path: readonly string[] = []): readonly {
        path: readonly string[]; value: unknown; exists: boolean;
    }[] {
        if (isDeepStrictEqual(before, after)) {
            return [];
        }
        if (before != null && after != null && typeof before === 'object' && typeof after === 'object' &&
            !Array.isArray(before) && !Array.isArray(after)) {
            const old = before as Record<string, unknown>;
            const next = after as Record<string, unknown>;
            return [...new Set([...Object.keys(old), ...Object.keys(next)])].flatMap((key) => {
                if (!Object.prototype.hasOwnProperty.call(next, key)) {
                    return [{ path: [...path, key], value: undefined, exists: false }];
                }
                return this._changes(old[key], next[key], [...path, key]);
            });
        }
        return [{ path, value: after, exists: true }];
    }

    /**
     * @description 校验主资产和预期子资源身份，以及所有实际修改字段。
     * @param expected 保存目标。
     * @param actual 原生或磁盘回读。
     * @param changes 原字段差异。
     * @returns 所有承诺均被独立回读证明时为 true。
     */
    private static _matches(expected: Record<string, unknown>, actual: unknown, changes: readonly {
        path: readonly string[]; value: unknown; exists: boolean;
    }[]): boolean {
        if (actual == null || typeof actual !== 'object' || Array.isArray(actual)) {
            return false;
        }
        const record = actual as Record<string, unknown>;
        if (record.uuid !== expected.uuid || record.importer !== expected.importer) {
            return false;
        }
        const children = expected.subMetas as Record<string, { uuid?: unknown }> | undefined;
        const actualChildren = record.subMetas as Record<string, { uuid?: unknown }> | undefined;
        if (children != null && Object.entries(children).some(([key, child]) =>
            child.uuid != null && actualChildren?.[key]?.uuid !== child.uuid)) {
            return false;
        }
        return changes.every((change) => {
            let value: unknown = record;
            let present = true;
            for (const key of change.path) {
                if (value == null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) {
                    present = false;
                    break;
                }
                value = (value as Record<string, unknown>)[key];
            }
            return present === change.exists && (!present || isDeepStrictEqual(value, change.value));
        });
    }
}
