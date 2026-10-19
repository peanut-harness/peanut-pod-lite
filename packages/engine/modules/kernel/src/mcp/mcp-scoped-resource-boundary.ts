import { existsSync, lstatSync, realpathSync } from 'fs';
import { join, resolve } from 'path';
import { McpControlFlowRefusal } from './mcp-control-flow-refusal.js';

/**
 * @description 六项组件验收写能力的真实路径与引用边界，不信任申报资源代替业务目标。
 */
export class McpScopedResourceBoundary {
    /**
     * @description 此阶段可精确挂接的既有能力；不增加业务目录。
     */
    public static readonly names: readonly string[] = Object.freeze(['lumen-comp-add', 'lumen-comp-rm', 'lumen-comp-set',
        'lumen-commit', 'scene-open', 'preview-refresh'].map((name) => `peanut.editor-mcp.${name}`));
    /**
     * @description 当前组件验收允许的两个项目相对根。
     */
    public static readonly roots: readonly string[] = Object.freeze(['assets/components', 'assets/fixtures']);
    /**
     * @description 由 Hub 配置注入的工程根。
     */
    private readonly _project: string;
    /**
     * @description 实际 AssetDB 查询端口；缺失时拒绝 UUID 绑定。
     */
    protected readonly _queryAsset: ((uuid: string) => Promise<unknown>) | null;
    /**
     * @description 已由挂接记录验证的相对根；组件配置保持原两个根。
     */
    private readonly _roots: readonly string[];

    /**
     * @description 创建与当前工程绑定的资源校验器。
     * @param project 工程根。
     * @param queryAsset 实际 AssetDB 查询端口。
     * @param roots 受信profile已经校验的工程相对根。
     */
    public constructor(project: string, queryAsset: ((uuid: string) => Promise<unknown>) | null,
        roots: readonly string[] = McpScopedResourceBoundary.roots) {
        this._project = resolve(project); this._queryAsset = queryAsset; this._roots = roots;
    }

    /**
     * @description 从真实业务字段和声明资源核对范围，拒绝全工程刷新与隐含写操作。
     * @param name 已挂接能力名。
     * @param input 未受信业务输入。
     * @returns 规范化的明确审批资源。
     */
    public validate(name: string, input: unknown): readonly string[] {
        const record = this._record(input);
        const declared = this._paths(record.resources);
        if (declared.length === 0) this._deny('resources_required');
        declared.forEach((path) => this._checkPath(path));
        const targets: string[] = [];
        if (name.endsWith('.preview-refresh')) {
            if (record.refreshAssets !== false) this._deny('global_refresh_forbidden');
        } else if (name.endsWith('.lumen-commit')) {
            if (record.paths !== undefined) targets.push(...this._paths(record.paths));
            for (const key of ['prefabRelativePath', 'assetRelativePath']) if (record[key] !== undefined) targets.push(this._path(record[key]));
            if (targets.length === 0) this._deny('commit_paths_required');
        } else {
            const target = this._path(name.endsWith('.scene-open') ? record.path : record.prefabRelativePath);
            if (!/\.(?:scene|prefab)$/u.test(target) || name.endsWith('.scene-open') && !target.endsWith('.scene')) this._deny('hierarchy_path_required');
            targets.push(target);
            if (record.autoCommit === true) this._deny('implicit_commit_forbidden');
            if (record.scriptName !== undefined) {
                if (typeof record.scriptName !== 'string' || !/^(?:assets\/|db:\/\/)/u.test(record.scriptName)) this._deny('script_path_required');
                targets.push(this._path(record.scriptName));
            }
        }
        for (const target of targets) {
            this._checkPath(target);
            if (!declared.includes(target)) this._deny('actual_target_not_approved');
        }
        for (const reference of this._references(record.props)) if (reference.startsWith('assets/') || reference.startsWith('db://')) {
            const path = this._path(reference); this._checkPath(path);
            if (!declared.includes(path)) this._deny('reference_not_approved');
        }
        return declared;
    }

    /**
     * @description 将 UUID 绑定到实际 AssetDB 源，并核对明确审批资源；不使用合成 UUID 证明。
     * @param name 能力名。
     * @param input 业务输入。
     * @returns 所有引用完成核对时结束。
     */
    public async validateReferences(name: string, input: unknown): Promise<void> {
        const declared = this.validate(name, input); const record = this._record(input);
        for (const value of this._references(record.props)) {
            if (!/^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[A-Za-z0-9+/]{22})(?:@[a-zA-Z0-9]+)*$/u.test(value)) continue;
            if (!this._queryAsset) this._deny('reference_lookup_unavailable');
            const info = this._record(await this._queryAsset(value));
            if (info.uuid !== value || info.imported !== true || info.invalid === true) this._deny('reference_not_imported');
            const path = this._path(info.url); this._checkPath(path);
            if (!declared.includes(path)) this._deny('reference_not_approved');
        }
    }

    /**
     * @description 拒绝当前工程及祖先的链接身份，防止受保护状态目录逃逸。
     * @returns 验证后的工程根。
     */
    public project(): string {
        if (!existsSync(this._project) || !lstatSync(this._project).isDirectory() || realpathSync(this._project) !== this._project)
            this._deny('project_identity_invalid');
        return this._project;
    }

    /**
     * @description 校验项目内根与所有已存在路径段；缺文件保留原始范围，不解析到其它资产。
     * @param value 规范化相对路径。
     */
    protected _checkPath(value: string): void {
        if (!this._roots.some((root) => value === root || value.startsWith(`${root}/`))) this._deny('resource_out_of_scope');
        this._checkIdentity(value);
    }

    /**
     * @description 路径范围由profile先核验；随后逐祖先拒绝链接身份变化。
     * @param value 已通过范围检查的相对路径。
     */
    protected _checkIdentity(value: string): void {
        let current = this.project();
        for (const part of value.split('/')) {
            current = join(current, part);
            let stat: ReturnType<typeof lstatSync>;
            try { stat = lstatSync(current); }
            catch (error) {
                const code = error != null && typeof error === 'object' ? Reflect.get(error, 'code') : null;
                if (code === 'ENOENT' || code === 'ENOTDIR') break;
                throw error;
            }
            if (stat.isSymbolicLink() || realpathSync(current) !== current) this._deny('resource_identity_invalid');
        }
    }

    /**
     * @description 规范化实际支持的资产 URL 或相对路径，拒绝穿越和歧义编码。
     * @param value 未受信路径。
     * @returns 明确项目相对路径。
     */
    protected _path(value: unknown): string {
        if (typeof value !== 'string' || value.length > 512 || /[\\%\u0000-\u001f\u007f]/u.test(value)) this._deny('path_invalid');
        const path = value.startsWith('db://') ? value.slice(5) : value;
        if (path.split('/').some((part) => part === '' || part === '.' || part === '..')) this._deny('path_invalid');
        return path;
    }

    /**
     * @description 读取有界路径数组，不丢弃非法条目。
     * @param value 未受信集合。
     * @returns 已规范化路径。
     */
    protected _paths(value: unknown): string[] {
        if (!Array.isArray(value) || value.length > 128) this._deny('resources_invalid');
        return value.map((item) => this._path(item));
    }

    /**
     * @description 有界遍历字段值中的资产路径和 UUID，拒绝循环或过深对象。
     * @param value 字段对象。
     * @returns 待核对字符串。
     */
    protected _references(value: unknown): readonly string[] {
        const result: string[] = []; const seen = new Set<object>(); let count = 0;
        const visit = (item: unknown, depth: number): void => {
            if (++count > 4096 || depth > 16) this._deny('reference_budget_exceeded');
            if (typeof item === 'string') { result.push(item); return; }
            if (item == null || typeof item !== 'object') return;
            if (seen.has(item)) this._deny('reference_cycle'); seen.add(item);
            for (const child of Object.values(item)) visit(child, depth + 1);
            seen.delete(item);
        };
        visit(value, 0); return result;
    }

    /**
     * @description 缩窄网络及 AssetDB 返回的记录。
     * @param value 未受信值。
     * @returns 普通字段记录。
     */
    protected _record(value: unknown): Record<string, unknown> {
        if (typeof value !== 'object' || value == null || Array.isArray(value)) this._deny('input_invalid');
        return Object.fromEntries(Object.entries(value));
    }

    /**
     * @description 返回稳定预期拒绝，不将权限拒绝写成项目诊断。
     * @param reason 受控原因。
     * @returns 始终抛出。
     */
    protected _deny(reason: string): never { return McpControlFlowRefusal.reject(`cocos_mcp_scoped_${reason}`); }
}
