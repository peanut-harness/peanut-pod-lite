import { randomBytes } from 'crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { McpControlFlowRefusal } from './mcp-control-flow-refusal.js';
import { McpScopedResourceBoundary } from './mcp-scoped-resource-boundary.js';
import type { McpCapabilityRegistry } from './mcp-capability-registry.js';
import { toHex } from '../shared/random-hex.js';

/**
 * @description 项目内精确名单的持久化记录；owner用于审计和撤销匹配，认证由私有Hub端口完成。
 */
interface IMcpScopedAttachmentRecord {
    /**
     * @description 记录格式版本。
     */
    readonly schemaVersion: 1;
    /**
     * @description 当前真实工程根。
     */
    readonly projectPath: string;
    /**
     * @description 经当前工程认证连接申报的操作归属。
     */
    readonly owner: string;
    /**
     * @description 本工程允许公开的明确能力名。
     */
    readonly capabilities: readonly string[];
    /**
     * @description 不可扩大到全assets的两个范围。
     */
    readonly resourceRoots: readonly string[];
}

/**
 * @description 精确挂接与撤销的项目授权，独立于read_only/all档位且不免除每次写审批。
 */
export class McpScopedCapabilityAttachments {
    /**
     * @description 当前持久化记录；缺失或非法状态默认拒绝全部挂接。
     */
    private _record: IMcpScopedAttachmentRecord | null = null;
    /**
     * @description 目录和排队任务共同使用的授权代数。
     */
    private _revision = 0;
    /**
     * @description 真实路径及AssetDB引用校验器。
     */
    private readonly _boundary: McpScopedResourceBoundary;
    /**
     * @description 当前工程的状态位置，不读取其它工程记录。
     */
    private readonly _path: string;

    /**
     * @description 恢复当前工程的精确授权，保留原公开档位。
     * @param project 工程根。
     * @param queryAsset 实际AssetDB查询端口。
     */
    public constructor(project: string, queryAsset: ((uuid: string) => Promise<unknown>) | null) {
        this._boundary = new McpScopedResourceBoundary(project, queryAsset);
        this._path = join(project, '.peanut-ai', 'cocos-mcp-attachments.json');
        if (!existsSync(this._path)) return;
        try { this._assertStatePath(); this._record = this._parse(JSON.parse(readFileSync(this._path, 'utf8'))); }
        catch { this._record = null; }
    }

    /**
     * @description 获取授权代数；每次挂接变化单调递增。
     * @returns 当前代数。
     */
    public get revision(): number { return this._revision; }

    /**
     * @description 判断已注册能力是否恰在本项目精确名单。
     * @param pluginId 注册提供者。
     * @param name 明确能力名。
     * @returns 是否有独立精确授权。
     */
    public has(pluginId: string, name: string): boolean {
        return pluginId === 'peanut.editor-mcp' && this._record?.capabilities.includes(name) === true;
    }

    /**
     * @description 返回无令牌的授权审计快照。
     * @returns 当前记录或null。
     */
    public snapshot(): IMcpScopedAttachmentRecord | null { return this._record; }

    /**
     * @description 在Hub认证之后处理精确名单控制，不通过all档位实现。
     * @param payload 经过私有端口认证的控制请求。
     * @param registry 当前实际注册表。
     * @returns 授权及目录的明确结果。
     */
    public dispatch(payload: Record<string, unknown>, registry: McpCapabilityRegistry): unknown {
        if (payload.action === 'queryCapabilityAttachments') return { attachment: this.snapshot() };
        const proposed = this._parse({ ...payload, schemaVersion: 1 });
        if (this._record && this._record.owner !== proposed.owner) this._deny('owner_mismatch');
        if (payload.action === 'attachCapabilities') {
            for (const name of proposed.capabilities) {
                const definition = registry.getRegisteredDefinition(name);
                if (!definition || definition.readOnly || registry.getRegisteredProviderPluginId(name) !== 'peanut.editor-mcp') this._deny('capability_unregistered');
            }
            this._save(proposed);
        } else if (payload.action === 'detachCapabilities') {
            this._save({ ...proposed, capabilities: (this._record?.capabilities ?? []).filter((name) => !proposed.capabilities.includes(name)) });
        } else this._deny('control_action_invalid');
        return { attachment: this.snapshot(), catalog: registry.getCatalog() };
    }

    /**
     * @description 校验真实业务输入及明确审批资源。
     * @param name 当前已挂接能力名。
     * @param input 未受信业务输入。
     */
    public validate(name: string, input: unknown): void { this._boundary.validate(name, input); }

    /**
     * @description 核对实际导入引用；未知UUID和范围外引用拒绝。
     * @param name 能力名。
     * @param input 业务输入。
     * @returns 校验完成时结束。
     */
    public async validateReferences(name: string, input: unknown): Promise<void> { await this._boundary.validateReferences(name, input); }

    /**
     * @description 将execute控制请求的一次性令牌合入原计划，不允许改写计划业务参数。
     * @param input 原计划输入。
     * @param approvalToken 本次控制请求的审批令牌。
     * @returns 保留全部原业务字段的执行输入。
     */
    public planInput(input: unknown, approvalToken: unknown): unknown {
        if (approvalToken === undefined) return input;
        if (typeof approvalToken !== 'string' || approvalToken.length === 0
            || input == null || typeof input !== 'object' || Array.isArray(input)) this._deny('approval_invalid');
        return { ...Object.fromEntries(Object.entries(input)), approvalToken };
    }

    /**
     * @description 捕获本次授权代数，原writer窗口再次验证；撤销后重新挂接也不能恢复旧任务。
     * @param name 能力名。
     * @param input 原受理业务输入。
     * @returns 必须在写入前执行的宿主守卫。
     */
    public captureGuard(name: string, input: unknown): (actualInput: unknown) => Promise<void> {
        const revision = this._revision; const resources = this._boundary.validate(name, input);
        return async (actualInput) => {
            if (revision !== this._revision || !this.has('peanut.editor-mcp', name)) this._deny('attachment_revoked');
            if (actualInput == null || typeof actualInput !== 'object' || Array.isArray(actualInput)) this._deny('input_invalid');
            await this.validateReferences(name, { ...Object.fromEntries(Object.entries(actualInput)), resources });
        };
    }

    /**
     * @description 校验存储或控制边界，名单只有已批准六项，资源根不能由输入扩大。
     * @param value 未受信记录。
     * @returns 明确的项目记录。
     */
    private _parse(value: unknown): IMcpScopedAttachmentRecord {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) this._deny('attachment_invalid');
        const record = Object.fromEntries(Object.entries(value));
        if (record.schemaVersion !== 1 || record.projectPath !== this._boundary.project()
            || typeof record.owner !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(record.owner)) this._deny('attachment_identity_invalid');
        const capabilities = record.capabilities; const roots = record.resourceRoots;
        if (!Array.isArray(capabilities) || capabilities.length > 6
            || !capabilities.every((name): name is string => typeof name === 'string' && McpScopedResourceBoundary.names.includes(name))
            || new Set(capabilities).size !== capabilities.length) this._deny('attachment_names_invalid');
        if (!Array.isArray(roots) || roots.length !== 2 || !McpScopedResourceBoundary.roots.every((root) => roots.includes(root))) this._deny('attachment_roots_invalid');
        return Object.freeze({ schemaVersion: 1, projectPath: record.projectPath, owner: record.owner,
            capabilities: Object.freeze([...capabilities]), resourceRoots: McpScopedResourceBoundary.roots });
    }

    /**
     * @description 原子保存已校验记录，落盘失败时保留既有内存授权。
     * @param record 新授权记录。
     */
    private _save(record: IMcpScopedAttachmentRecord): void {
        this._assertStatePath(); const temporary = `${this._path}.${toHex(randomBytes(12))}.tmp`;
        writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        renameSync(temporary, this._path); this._record = Object.freeze({ ...record, capabilities: Object.freeze([...record.capabilities]) }); this._revision += 1;
    }

    /**
     * @description 确认状态目录和文件归属当前工程且无符号链接。
     */
    private _assertStatePath(): void {
        const directory = join(this._boundary.project(), '.peanut-ai');
        if (existsSync(directory) && (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())) this._deny('attachment_state_invalid');
        mkdirSync(directory, { recursive: true });
        if (existsSync(this._path) && (!lstatSync(this._path).isFile() || lstatSync(this._path).isSymbolicLink())) this._deny('attachment_state_invalid');
    }

    /**
     * @description 返回稳定预期权限拒绝。
     * @param reason 受控原因。
     * @returns 始终抛出。
     */
    private _deny(reason: string): never { return McpControlFlowRefusal.reject(`cocos_mcp_scoped_${reason}`); }
}
