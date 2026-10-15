import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectLogPostflightMonitor } from '../../../../packages/engine/modules/runtime/src/cocos/foundation/editor-resource/project-log-postflight-monitor.ts';
import type { IProjectLogCheckpoint, IProjectLogPostflightResult } from '../../../../packages/engine/modules/runtime/src/cocos/foundation/editor-resource/project-log-postflight-monitor.ts';

/**
 * @description 原生只读观测和整轮矩阵都必须验收日志增量，不能把有警告的字段读回记作干净通过。
 */
export class ComponentNativeLogGuard {
    /**
     * @description 日志写盘后需要连续安静的毫秒数，用于捕获异步转发的日志。
     */
    private static readonly _quietMs = 200;
    /**
     * @description 只读轮询间隔毫秒数，不重放原生动作。
     */
    private static readonly _pollMs = 50;
    /**
     * @description 等待日志稳定的总预算毫秒数，持续变化时明确停止。
     */
    private static readonly _budgetMs = 1000;

    /**
     * @description 先固定真实日志身份，再执行一次动作；成功与异常路径均记录日志后验。
     * @param project 已验证归属的工程。
     * @param action 证据中的固定动作名。
     * @param execute 单次原生动作或整轮编排。
     * @param record 保存无令牌的后验证据。
     * @returns 动作结果；日志有警告、错误、轮换或缺失时抛错。
     */
    public static async run<T>(project: string, action: string, execute: () => Promise<T>, record: (event: Record<string, unknown>) => void): Promise<T> {
        const monitor = new ProjectLogPostflightMonitor(); const path = join(project, 'temp/logs/project.log');
        let identity: string;
        try { identity = this.identity(path); }
        catch (error) {
            record({ step: 'native-log-preflight', action, actionSucceeded: false, verified: false, reason: 'component_native_log_unavailable' });
            throw error;
        }
        const checkpoint = monitor.checkpoint(project);
        let actionSucceeded = false;
        try { const value = await execute(); actionSucceeded = true; return value; }
        finally {
            let result: IProjectLogPostflightResult;
            try { result = await this.settled(monitor, checkpoint, identity); }
            catch (error) {
                record({ step: 'native-log-postflight', action, actionSucceeded, verified: false, reason: error instanceof Error ? error.message : String(error) });
                throw error;
            }
            record({ step: 'native-log-postflight', action, actionSucceeded, result });
            if (!result.logChecked || !result.verified || result.newErrorCount > 0 || result.newWarningCount > 0) {
                throw new Error('component_native_log_failed:' + action);
            }
        }
    }

    /**
     * @description 等待日志短暂稳定；新增诊断立即返回失败，轮询仅观察本地文件。
     * @param monitor 既有日志分类器。
     * @param checkpoint 动作前的字节偏移。
     * @param identity 动作前真实文件身份。
     * @returns 稳定的日志增量。
     */
    private static async settled(monitor: ProjectLogPostflightMonitor, checkpoint: IProjectLogCheckpoint, identity: string): Promise<IProjectLogPostflightResult> {
        const deadline = Date.now() + this._budgetMs; let quietSince = Date.now(); let size = checkpoint.offset;
        do {
            if (this.identity(checkpoint.path) !== identity) { throw new Error('component_native_log_replaced'); }
            const next = statSync(checkpoint.path).size;
            if (next < checkpoint.offset || next < size) { throw new Error('component_native_log_truncated'); }
            if (next !== size) { quietSince = Date.now(); size = next; }
            const result = monitor.readDelta(checkpoint);
            if (!result.verified || result.newErrorCount || result.newWarningCount) { return result; }
            if (Date.now() - quietSince >= this._quietMs) { return result; }
            if (Date.now() >= deadline) { throw new Error('component_native_log_not_settled'); }
            await new Promise(done => setTimeout(done, this._pollMs));
        } while (true);
    }

    /**
     * @description 拒绝缺失、符号链接和非普通文件，不把失去日志观测当作零诊断。
     * @param path 已验证工程中的固定日志路径。
     * @returns 实际文件系统身份。
     */
    private static identity(path: string): string {
        try {
            const stat = statSync(path);
            if (realpathSync(path) !== path || !stat.isFile()) { throw new Error('invalid'); }
            return stat.dev + ':' + stat.ino;
        } catch { throw new Error('component_native_log_unavailable'); }
    }
}
