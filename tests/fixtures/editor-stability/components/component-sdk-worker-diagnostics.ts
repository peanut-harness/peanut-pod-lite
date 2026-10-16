import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { ComponentSdkDiagnostics } from './component-sdk-diagnostics';

/**
 * @description 仅在显式登记的计时诊断工程观察SDK资产工作进程，不变更数据库、计时事件或原始日志。
 */
class ComponentSdkWorkerDiagnostics {
    /**
     * @description 由SDK实际全局生命周期钩子触发固定函数源码和真实计时缓存的只读快照。
     */
    public static observe(hook: string): void {
        const project = realpathSync(join(__dirname, '../..')); const output = dirname(project);
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8'));
        if (registration.task !== '5.1' || registration.sdkTimerTrace !== true || registration.projectPath !== project
            || registration.creatorVersion !== '3.8.7'
            || !project.startsWith(realpathSync(registration.worktree) + sep + 'evidence' + sep + 'task-5.1' + sep))
            throw new Error('component_sdk_worker_diagnostics_project_not_registered');
        const editor = Reflect.get(globalThis, 'Editor');
        appendFileSync(join(output, 'sdk-worker-source-observation.ndjson'), JSON.stringify({ hook, at: Date.now(), pid: process.pid,
            ...ComponentSdkDiagnostics.worker(Reflect.get(globalThis, 'Manager'), editor.Metrics, require.cache) as object }) + '\n');
    }
}

export const afterInit = (): void => ComponentSdkWorkerDiagnostics.observe('afterInit');
export const beforePreStart = (): void => ComponentSdkWorkerDiagnostics.observe('beforePreStart');
export const beforeReady = (): void => ComponentSdkWorkerDiagnostics.observe('beforeReady');
