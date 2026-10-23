import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { ComponentSdkArchive } from './component-sdk-archive.mts';

interface IComponentOwnedQuitEditor {
    readonly App: { readonly version: string; readonly quit: () => unknown };
    readonly Project: { readonly path: string };
}

/**
 * @description 仅关闭已登记且与原始启动租约匹配的本进程；沿用SDK原始窗口清理及公开退出流程。
 */
export class ComponentOwnedCreatorQuit {
    /**
     * @description 两项摘要来自3.8.3已加载SDK App.quit源码及原始归档模块，不执行来源文本。
     */
    private static readonly pins = {
        fn: '6e5b1af63ee6ccfccc0aa9a7a3cdc2c4195c7d9cadbbf409c60377ab9b45009c',
        module: 'cf93cef51b13e8d5a6dd1929656379aed76144a9bc86467d85a0df3b994f23ea',
    };

    /**
     * @description 校验固定请求形状、登记与启动身份；不接受API名称、脚本、其它PID或工程。
     */
    public static authorize(registration: Record<string, unknown>, lease: Record<string, unknown>, input: unknown,
        runtime: { pid: number; projectPath: string; creatorVersion: string }): Record<string, unknown> {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('component_owned_quit_request_invalid');
        const body = Object.fromEntries(Object.entries(input));
        if (Object.keys(body).sort().join(',') !== 'owner,pid,projectPath,runId' || registration.sdkOwnedQuit !== true
            || registration.task !== '5.1' || registration.creatorVersion !== '3.8.3' || runtime.creatorVersion !== '3.8.3'
            || !Number.isInteger(runtime.pid) || runtime.pid <= 0 || lease.pid !== runtime.pid || body.pid !== runtime.pid
            || registration.projectPath !== runtime.projectPath || lease.project !== runtime.projectPath || body.projectPath !== runtime.projectPath
            || typeof registration.owner !== 'string' || !registration.owner || lease.owner !== registration.owner || body.owner !== registration.owner
            || typeof registration.runId !== 'string' || !registration.runId || lease.runId !== registration.runId || body.runId !== registration.runId)
            throw new Error('component_owned_quit_identity_invalid');
        return { accepted: true, pid: runtime.pid, owner: registration.owner, runId: registration.runId,
            method: 'original-sdk-public-App.quit', forced: false };
    }

    /**
     * @description 只读当前SDK公开方法身份，供正常关闭前核验；不调用方法。
     */
    public static inspect(editor: IComponentOwnedQuitEditor): { source: string | null; sha256: string | null; expectedSha256: string } {
        const source = typeof editor?.App?.quit === 'function' ? Function.prototype.toString.call(editor.App.quit) : null;
        return { source, sha256: source === null ? null : createHash('sha256').update(source).digest('hex'), expectedSha256: this.pins.fn };
    }

    /**
     * @description 认证响应发完后才能调用返回的原始SDK方法；所有校验失败均保留错误，不降级或吞掉异常。
     */
    public static prepare(editor: IComponentOwnedQuitEditor, registration: Record<string, unknown>, lease: Record<string, unknown>, input: unknown):
        { receipt: Record<string, unknown>; run: () => void } {
        const receipt = this.authorize(registration, lease, input,
            { pid: process.pid, projectPath: realpathSync(editor.Project.path), creatorVersion: editor.App.version });
        const observed = this.inspect(editor);
        if (process.versions.electron !== '13.1.4' || observed.sha256 !== this.pins.fn) throw new Error('component_owned_quit_sdk_function_drift');
        const originalFs = createRequire(join(String(registration.projectPath), 'package.json'))('original-fs');
        const bytes = ComponentSdkArchive.read(join(String(registration.creatorApp), 'Contents/Resources'), 'app-lifecycle', originalFs);
        if (createHash('sha256').update(bytes).digest('hex') !== this.pins.module) throw new Error('component_owned_quit_sdk_module_drift');
        const original = editor.App.quit;
        return { receipt, run: (): void => { original.call(editor.App); } };
    }
}
