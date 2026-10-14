import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @description 按原始启动身份仅向本任务实例发送正常退出请求；没有全局退出或强杀入口。
 */
class ComponentCreatorClose {
    /**
     * @description 再核对登记、PID、启动时间和完整工程参数后关闭，并保存退出观测。
     */
    public static async run(project: string): Promise<void> {
        const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
        project = realpathSync(project); const output = dirname(project);
        if (!project.startsWith(`${root}${sep}evidence${sep}task-5.1${sep}`) || project !== join(output, 'project'))
            throw new Error('component_creator_close_project_out_of_scope');
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8'));
        const lease = JSON.parse(readFileSync(join(output, 'creator-owned-start.json'), 'utf8'));
        if (registration.owner !== '01a13478-7931-7e82-86a4-f4f2fcd47bb1' || registration.task !== '5.1'
            || registration.projectPath !== project || lease.owner !== registration.owner || lease.runId !== registration.runId
            || lease.project !== project || !Number.isInteger(lease.pid) || lease.pid <= 0) throw new Error('component_creator_close_ownership_invalid');
        const identity = (): string | null => {
            const result = spawnSync('/bin/ps', ['-p', String(lease.pid), '-o', 'pid=,ppid=,lstart=,args=', '-ww'], { encoding: 'utf8' });
            if (result.status === 1 && !result.stdout.trim()) return null;
            if (result.status !== 0 || result.stdout.trim() !== lease.identity.trim()) throw new Error('component_creator_close_identity_changed');
            return result.stdout.trim();
        };
        if (!identity()) throw new Error('component_creator_close_original_process_missing');
        const requestedAt = new Date().toISOString();
        const result = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
            `ObjC.import('AppKit'); var app=$.NSRunningApplication.runningApplicationWithProcessIdentifier(${lease.pid}); if(!app) throw Error('owned instance missing'); app.terminate;`], { encoding: 'utf8' }).trim();
        writeFileSync(join(output, 'owned-normal-close-request.json'), JSON.stringify({
            pid: lease.pid, method: 'pid-scoped-NSRunningApplication-normal-terminate', requestedAt, result,
        }, null, 2) + '\n', { flag: 'wx' });
        if (result !== 'true') throw new Error('component_creator_normal_close_not_accepted');
        const until = Date.now() + 30000;
        while (identity()) {
            if (Date.now() >= until) throw new Error('component_creator_normal_close_not_observed');
            await new Promise((done) => setTimeout(done, 500));
        }
        const receipt = { pid: lease.pid, owner: lease.owner, runId: lease.runId, requestedAt,
            observedExitedAt: new Date().toISOString(), originalProcessGone: true, forced: false };
        writeFileSync(join(output, 'owned-normal-close-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
        process.stdout.write(JSON.stringify(receipt) + '\n');
    }
}

const project = process.argv[process.argv.indexOf('--project') + 1];
if (!project) throw new Error('component_creator_close_project_required');
await ComponentCreatorClose.run(project);
