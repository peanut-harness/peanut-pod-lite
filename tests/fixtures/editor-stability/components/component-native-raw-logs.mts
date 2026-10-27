import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ComponentMatrixScope } from './component-matrix-scope.mts';

/**
 * @description 自有Creator各原始通道的身份、真实字节游标及未完成行。
 */
export type ComponentRawCheckpoint = { path: string; identity: string; offset: number; partial: string; prefixSha256: string };

/**
 * @description 同一动作的原始通道增量；诊断不忽略、不去重为零，也不替代整会话验收。
 */
export type ComponentRawDelta = { newErrors: string[]; newWarnings: string[];
    sources: { path: string; offset: number; end: number; newErrorCount: number; newWarningCount: number }[] };

/**
 * @description 精确绑定已有启动租约的stdout/stderr及应用启动器日志，防止project.log遗漏原生诊断。
 */
export class ComponentNativeRawLogs {
    /**
     * @description 新campaign先验收本会话全部原始来源，不能靠重新取游标跳过启动阶段失败。
     * @param project 当前或已关闭的已登记隔离工程。
     * @returns 从真实字节零起扫描的所有诊断。
     */
    public static readAll(project: string): ComponentRawDelta {
        const empty = createHash('sha256').digest('hex');
        const sources = this.checkpoint(project).map(item => ({ ...item, offset: 0, partial: '', prefixSha256: empty }));
        const path = join(project, 'temp/logs/project.log');
        const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
        const scope = existsSync(join(project, 'extensions/peanut-component-probe/project-ownership.json'))
            ? ComponentMatrixScope.locate(root, project) : null;
        const lease = scope?.mode === 'existing' ? JSON.parse(readFileSync(join(scope.output, 'creator-owned-start.json'), 'utf8')) : null;
        let offset = lease?.projectLogOffset;
        if (scope?.mode === 'existing' && (!Number.isSafeInteger(offset) || offset < 0))
            throw new Error('component_existing_raw_log_baseline_missing');
        const bytes = readFileSync(path);
        if (offset > bytes.length) {
            const startedAt = Date.parse(String(lease?.startedAt));
            if (scope?.mode !== 'existing' || !Number.isFinite(startedAt)
                || statSync(path).mtimeMs < startedAt) throw new Error('component_existing_raw_log_truncated');
            // Creator rebuilt project.log after the owned launch. Scan every byte of this new generation.
            offset = 0;
        }
        sources.push({ path, identity: this.identity(path), offset: offset ?? 0, partial: '',
            prefixSha256: createHash('sha256').update(bytes.subarray(0, offset ?? 0)).digest('hex') });
        return this.readDelta(sources);
    }

    /**
     * @description 真实会话必须具备全部约定通道；没有启动租约的独立monitor单元测试保持原路径。
     * @param project 已登记且已核对进程身份的工程。
     * @returns 每个实际原始通道的动作前游标。
     */
    public static checkpoint(project: string): ComponentRawCheckpoint[] {
        const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
        const output = existsSync(join(project, 'extensions/peanut-component-probe/project-ownership.json'))
            ? ComponentMatrixScope.locate(root, project).output : dirname(project);
        const leasePath = join(output, 'creator-owned-start.json');
        if (!existsSync(leasePath)) {
            if (existsSync(join(output, 'project-ownership.json'))) throw new Error('component_native_raw_lease_missing');
            return [];
        }
        const lease = JSON.parse(readFileSync(leasePath, 'utf8'));
        if (lease.project !== project || !['direct-binary', 'open-new-instance-wait'].includes(lease.launchMethod))
            throw new Error('component_native_raw_lease_invalid');
        const names = ['stdout.log', 'stderr.log', ...(lease.launchMethod === 'open-new-instance-wait'
            ? ['launcher-stdout.log', 'launcher-stderr.log'] : [])];
        return names.map(name => {
            const path = join(output, name); const identity = this.identity(path); const bytes = readFileSync(path);
            if (bytes.length > 32 * 1024 * 1024) throw new Error('component_native_raw_log_budget_exceeded');
            const last = bytes.lastIndexOf(10);
            return { path, identity, offset: bytes.length, partial: bytes.subarray(last + 1).toString('utf8'),
                prefixSha256: createHash('sha256').update(bytes).digest('hex') };
        });
    }

    /**
     * @description 读取动作后的完整增量，额外识别Node类型化Warning；文件丢失或轮换一律拒绝。
     * @param checkpoints 动作前原始通道游标。
     * @returns 按通道保留的所有错误与警告行。
     */
    public static readDelta(checkpoints: readonly ComponentRawCheckpoint[]): ComponentRawDelta {
        const result: ComponentRawDelta = { newErrors: [], newWarnings: [], sources: [] };
        for (const checkpoint of checkpoints) {
            if (this.identity(checkpoint.path) !== checkpoint.identity) throw new Error('component_native_raw_log_replaced');
            const bytes = readFileSync(checkpoint.path);
            if (bytes.length < checkpoint.offset) throw new Error('component_native_raw_log_truncated');
            if (createHash('sha256').update(bytes.subarray(0, checkpoint.offset)).digest('hex') !== checkpoint.prefixSha256)
                throw new Error('component_native_raw_log_prefix_changed');
            if (bytes.length > 32 * 1024 * 1024) throw new Error('component_native_raw_log_budget_exceeded');
            const errors: string[] = []; const warnings: string[] = [];
            if (bytes.length > checkpoint.offset) {
                const text = checkpoint.partial + bytes.subarray(checkpoint.offset).toString('utf8');
                for (const line of text.split(/\r?\n/u)) {
                    if (/\b(?:error|exception|failed|failure|unhandled|uncaught)\b|object has been destroyed/iu.test(line)
                        || /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|AssertionError)\b/u.test(line)
                        || /\bcc\.TiledMap\.initWithXML\(\):\s*Map not found\b/u.test(line)) errors.push(line);
                    else if (/\bwarn(?:ing)?\b/iu.test(line) || /\b[A-Za-z][A-Za-z0-9]*Warning\b/u.test(line)
                        || /\bTMXFormat:\s*Unsupported TMX version\b|\bthe importer version need to upgrade\b/iu.test(line)) warnings.push(line);
                }
            }
            result.sources.push({ path: checkpoint.path, offset: checkpoint.offset, end: bytes.length,
                newErrorCount: errors.length, newWarningCount: warnings.length });
            result.newErrors.push(...errors.map(line => checkpoint.path + ': ' + line));
            result.newWarnings.push(...warnings.map(line => checkpoint.path + ': ' + line));
        }
        return result;
    }

    /**
     * @description 固定原始文件身份，拒绝链接、非普通文件和无法观测的通道。
     * @param path 本会话固定日志路径。
     * @returns 设备和inode身份。
     */
    private static identity(path: string): string {
        try {
            const stat = statSync(path);
            if (!stat.isFile() || realpathSync(path) !== path) throw new Error('invalid');
            return stat.dev + ':' + stat.ino;
        } catch { throw new Error('component_native_raw_log_unavailable'); }
    }
}
