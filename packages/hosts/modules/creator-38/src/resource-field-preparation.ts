import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { types } from 'node:util';
import type { EditorMcpLumenGateway } from '@peanut/pod-engine/mcp';

/**
 * @description 可信Host组装的固定字段producer，复用实际Gateway codec；不接收Core Error、回调或状态证明。
 */
export class HostResourceFieldPreparation {
    /**
     * @description Host准备输入数据属性节点上限，单位：节点；仅收紧已有MCP输入容量。
     */
    private static readonly MAX_INPUT_NODES = 10000;
    /**
     * @description Host准备输入嵌套深度上限，单位：层。
     */
    private static readonly MAX_INPUT_DEPTH = 32;
    private readonly root: string;
    private readonly version: string;
    private gateway: Promise<EditorMcpLumenGateway> | null = null;

    /**
     * @description 工程与版本由Host真实运行时捕获，不能由Core payload覆盖。
     */
    public constructor(projectRoot: string, version: string) {
        this.root = realpathSync(projectRoot);
        if (!/^3\.8\.[0-9]+$/u.test(version)) throw new Error('resource_field_host_version_invalid');
        this.version = version;
    }

    /**
     * @description 原输入身份不变；Host固定codec仅在当前Host ALS中登记其原始无写入异常。
     */
    public async prepare(projectRoot: string, input: unknown): Promise<void> {
        if (realpathSync(projectRoot) !== this.root) throw new Error('resource_field_host_root_mismatch');
        this.assertData(input, new Set(), 0, { remaining: HostResourceFieldPreparation.MAX_INPUT_NODES });
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('resource_field_host_input_invalid');
        const record = input as Record<string, unknown>;
        if (record.cocosVersion != null && record.cocosVersion !== this.version) throw new Error('resource_field_host_version_mismatch');
        if (record.prefabRelativePath != null && record.assetRelativePath != null && record.prefabRelativePath !== record.assetRelativePath) {
            throw new Error('editor_mcp_lumen_path_conflict');
        }
        const path = record.assetRelativePath ?? record.prefabRelativePath;
        if (typeof path !== 'string') throw new Error('resource_field_host_path_invalid');
        const relative = path.trim().replace(/\\/gu, '/').replace(/^db:\/\//u, '').replace(/^\/+/u, '');
        if (relative.split('/').includes('..')) throw new Error('resource_field_host_path_invalid');
        const canonical = normalize(relative).replace(/\\/gu, '/'); const absolute = join(this.root, canonical);
        if (!canonical.startsWith('assets/') || existsSync(absolute)
            && (lstatSync(absolute).isSymbolicLink() || realpathSync(absolute) !== absolute)) throw new Error('resource_field_host_path_invalid');
        const business = { ...record };
        for (const key of ['confirmDestructive', 'approvalToken', 'approvalId', 'resources']) delete business[key];
        this.gateway ??= import('@peanut/pod-engine/mcp').then(module => new module.EditorMcpLumenGateway(async () => this.root, null, this.version));
        await (await this.gateway).prepareAssetSet(business, input);
    }

    /**
     * @description 检查自有JSON数据属性，不触发getter/proxy或外部函数；有界拒绝循环及超深输入。
     */
    private assertData(value: unknown, seen: Set<object>, depth: number, budget: { remaining: number }): void {
        if (--budget.remaining < 0 || depth > HostResourceFieldPreparation.MAX_INPUT_DEPTH) throw new Error('resource_field_host_input_invalid');
        if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean'
            || typeof value === 'number' && Number.isFinite(value)) return;
        if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)
            || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('resource_field_host_input_invalid');
        seen.add(value);
        for (const key of Reflect.ownKeys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (typeof key !== 'string' || !descriptor || !('value' in descriptor)) throw new Error('resource_field_host_input_invalid');
            this.assertData(descriptor.value, seen, depth + 1, budget);
        }
        seen.delete(value);
    }
}
