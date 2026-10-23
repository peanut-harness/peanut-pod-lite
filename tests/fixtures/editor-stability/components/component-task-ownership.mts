import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * @description 从设备登记读取当前任务归属；换会话后拒绝旧 owner 的工程与启动租约。
 */
export class ComponentTaskOwnership {
    /**
     * @description 核对真实工作树、设备登记及当前调用会话，不在源码中固定某个会话 ID。
     * @param repository 当前产品工作树。
     * @param actor 当前会话身份，默认采用宿主提供的 CODEX_THREAD_ID。
     * @returns 登记的当前独占 owner。
     */
    public static current(repository: string, actor: unknown = process.env.CODEX_THREAD_ID): string {
        repository = realpathSync(repository);
        const workspace = resolve(repository, '../../..');
        const path = join(workspace, '.peanut-ai/worktree-registry.json');
        if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error('component_task_registry_link');
        return this.fromRegistry(repository, workspace, actor, JSON.parse(readFileSync(path, 'utf8')));
    }

    /**
     * @description 校验唯一活动登记、工作树绑定及三项 self-delivery 所有权。
     * @param repository 当前真实工作树。
     * @param workspace 所属设备工作空间。
     * @param actor 当前会话身份。
     * @param registry 未信任的登记快照。
     * @returns 与当前会话一致的 owner。
     */
    public static fromRegistry(repository: string, workspace: string, actor: unknown, registry: unknown): string {
        if (typeof actor !== 'string' || !actor || actor.trim() !== actor) throw new Error('component_task_actor_missing');
        const data = this.record(registry);
        if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error('component_task_registry_invalid');
        const matches = data.entries.map(entry => this.record(entry)).filter(entry => entry.repo === 'peanut-pod-lite'
            && entry.change === 'stabilize-editor-operations-and-bulk-file-io');
        if (matches.length !== 1) throw new Error('component_task_registry_ambiguous');
        const entry = matches[0];
        if (!entry || entry.state !== 'active' || entry.deliveryMode !== 'self-delivery'
            || entry.path !== '.worktrees/peanut-pod-lite/stabilize-editor-operations-and-bulk-file-io'
            || relative(workspace, repository) !== entry.path
            || entry.branch !== 'change/stabilize-editor-operations-and-bulk-file-io'
            || entry.owner !== actor || entry.checkpointOwner !== actor || entry.integrationOwner !== actor)
            throw new Error('component_task_owner_mismatch');
        return actor;
    }

    /**
     * @description 只接受普通 JSON 对象，拒绝数组及空值。
     * @param value 未信任 JSON。
     * @returns 已缩窄的键值记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_task_registry_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
