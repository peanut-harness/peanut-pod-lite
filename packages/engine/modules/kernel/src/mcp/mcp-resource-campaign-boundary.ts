import { lstatSync, realpathSync } from 'fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'path';
import { McpScopedResourceBoundary } from './mcp-scoped-resource-boundary.js';

/**
 * @description 单次资源验收目录的精确写边界；不扩大既有组件挂接或公开档位。
 */
export class McpResourceCampaignBoundary extends McpScopedResourceBoundary {
    /**
     * @description 资源矩阵所需的既有公开能力，不新增业务operation。
     */
    public static readonly names: readonly string[] = Object.freeze(['asset-import', 'asset-copy', 'asset-move',
        'asset-rename', 'asset-create-folder', 'asset-delete', 'asset-reimport', 'asset-open',
        'lumen-scaffold', 'lumen-asset-set', 'lumen-node-set', 'lumen-commit'].map(name => `peanut.editor-mcp.${name}`));
    /**
     * @description 单次已登记的输出目录。
     */
    private readonly _namespace: string;

    /**
     * @description 仅允许固定前缀下的一个运行标识，拒绝祖先根和多根。
     * @param roots 未信任记录。
     * @returns 是否为精确资源profile。
     */
    public static isRoots(roots: unknown): roots is readonly [string] {
        return Array.isArray(roots) && roots.length === 1 && typeof roots[0] === 'string'
            && /^assets\/fixtures\/resource-stability\/[a-z0-9][a-z0-9-]{0,63}$/u.test(roots[0]);
    }

    /**
     * @description 构造经过profile验证的目录边界。
     * @param project 实际工程根。
     * @param queryAsset 实际AssetDB查询。
     * @param namespace 固定运行根。
     */
    public constructor(project: string, queryAsset: ((uuid: string) => Promise<unknown>) | null, namespace: string) {
        super(project, queryAsset, [namespace]);
        if (!McpResourceCampaignBoundary.isRoots([namespace])) this._deny('attachment_roots_invalid');
        this._namespace = namespace;
    }

    /**
     * @description 核对所有实际源、输出、别名与显式资源，不允许隐含全局刷新。
     * @param name 精确能力名。
     * @param input 公开业务输入。
     * @returns 规范化资源集合。
     */
    public override validate(name: string, input: unknown): readonly string[] {
        if (!McpResourceCampaignBoundary.names.includes(name)) this._deny('attachment_names_invalid');
        this._assertAncestors();
        const record = this._record(input); const declared = this._paths(record.resources);
        if (declared.length === 0 || record.autoCommit === true) this._deny('implicit_commit_forbidden');
        declared.forEach(path => this._checkCampaignPath(path));
        const targets = this._targets(name.slice('peanut.editor-mcp.'.length), record);
        if (targets.length === 0) this._deny('actual_target_required');
        for (const path of targets) {
            if (name.endsWith('.asset-import') && this._paths(record.sources).includes(path)) this._checkInputPath(path);
            else this._checkPath(path);
            if (!declared.includes(path)) this._deny('actual_target_not_approved');
        }
        for (const reference of this._references(record.props)) {
            if (!reference.startsWith('assets/') && !reference.startsWith('db://')) continue;
            const path = this._path(reference); this._checkPath(path);
            if (!declared.includes(path)) this._deny('reference_not_approved');
        }
        return declared;
    }

    /**
     * @description 实际writer内重新计算的闭包必须完整留在批准目录，不能只检查种子。
     * @param paths executor提供的闭包，不能由业务JSON冒充。
     * @param importing 本次是否只读导入本轮私有输入。
     * @param declared 当前一次性审批的明确资源。
     * @returns 所有路径及真实UUID映射校验完成时结束。
     */
    public async validateClosure(paths: readonly string[] | undefined, importing: boolean, declared: readonly string[]): Promise<void> {
        this._assertAncestors();
        if (!paths || paths.length === 0 || paths.length > 1536) this._deny('resource_closure_required');
        for (const value of paths) {
            if (value.startsWith('uuid:')) {
                if (!this._queryAsset) this._deny('reference_lookup_unavailable');
                const uuid = value.slice(5); const info = this._record(await this._queryAsset(uuid));
                if (info.uuid !== uuid || info.imported !== true || info.invalid === true) this._deny('reference_not_imported');
                const path = this._path(info.url); this._checkPath(path);
                if (!declared.includes(path)) this._deny('reference_not_approved');
                continue;
            }
            const path = this._path(value);
            if (path === `${this._namespace}.meta`) { this._checkIdentity(path); continue; }
            if (importing) this._checkCampaignPath(path); else this._checkPath(path);
        }
        this._assertAncestors();
    }

    /**
     * @description 原资产写器会补祖先meta；要求全部已存在，避免隐含写入namespace外。
     */
    private _assertAncestors(): void {
        const segments = this._namespace.split('/');
        for (let count = 1; count <= segments.length; count += 1) {
            const path = segments.slice(0, count).join('/'); this._checkIdentity(path);
            try {
                if (!lstatSync(join(this.project(), path)).isDirectory()) this._deny('ancestor_registration_required');
                if (path === 'assets') continue;
                this._checkIdentity(`${path}.meta`);
                if (!lstatSync(join(this.project(), `${path}.meta`)).isFile()) this._deny('ancestor_registration_required');
            } catch { this._deny('ancestor_registration_required'); }
        }
    }

    /**
     * @description 独立资源操作的明确路径语法；未支持的别名和全局形式失败关闭。
     * @param operation 固定名称后缀。
     * @param record 原业务记录。
     * @returns 实际读写路径。
     */
    private _targets(operation: string, record: Record<string, unknown>): string[] {
        if (operation === 'asset-import') {
            if (record.expandClosure !== false || record.allowMissingDependencies !== false
                || record.dependencyMap !== undefined || record.planId !== undefined || record.overwrite === true
                || record.mode !== undefined) this._deny('import_contract_invalid');
            const sources = this._paths(record.sources);
            if (sources.length === 0) this._deny('import_sources_required');
            const target = this._path(record.target); this._checkPath(target);
            sources.forEach(path => this._checkInputPath(path));
            return [...sources, target, ...sources.map(path => `${target}/${basename(path)}`)];
        }
        if (operation === 'asset-copy') return [...this._paths(record.paths), this._path(record.targetDirectory)];
        if (operation === 'asset-move') return [this._path(record.from), this._path(record.to)];
        if (operation === 'asset-rename') {
            if (typeof record.newName !== 'string' || !/^[^./\\%\u0000-\u001f][^/\\%\u0000-\u001f]*$/u.test(record.newName)
                || record.newName === '..') this._deny('path_invalid');
            const path = this._path(record.path); return [path, `${dirname(path)}/${record.newName}`];
        }
        if (operation === 'asset-create-folder') return [this._path(record.path)];
        if (operation === 'asset-delete') return this._paths(record.paths);
        if (operation === 'asset-reimport') {
            const paths = record.paths === undefined ? [] : this._paths(record.paths);
            if (record.path !== undefined) paths.push(this._path(record.path));
            return paths;
        }
        if (operation === 'asset-open') {
            if (record.uuid !== undefined) this._deny('path_required');
            return this._aliases(record, ['path', 'url']);
        }
        if (operation === 'lumen-commit' && record.paths !== undefined) {
            const paths = this._paths(record.paths);
            const aliases = this._aliases(record, ['prefabRelativePath', 'assetRelativePath']);
            if (aliases.some(path => !paths.includes(path))) this._deny('target_alias_mismatch');
            return paths;
        }
        return this._aliases(record, ['prefabRelativePath', 'assetRelativePath']);
    }

    /**
     * @description 绝对路径只作为工程私有导入源的别名；其余路径沿用组件严格语法。
     * @param value 未受信路径。
     * @returns 规范化工程相对路径。
     */
    protected override _path(value: unknown): string {
        if (typeof value === 'string' && isAbsolute(value)) {
            if (value.split(sep).some(part => part === '.' || part === '..')) this._deny('path_invalid');
            const path = super._path(relative(this.project(), value).split(sep).join('/'));
            this._checkInputPath(path); return path;
        }
        return super._path(value);
    }

    /**
     * @description 同义字段同时存在时必须指向同一目标。
     * @param record 输入记录。
     * @param keys 支持的别名。
     * @returns 零个或一个实际目标。
     */
    private _aliases(record: Record<string, unknown>, keys: readonly string[]): string[] {
        const paths = keys.filter(key => record[key] !== undefined).map(key => this._path(record[key]));
        if (new Set(paths).size > 1) this._deny('target_alias_mismatch');
        return paths.length === 0 ? [] : [paths[0]!];
    }

    /**
     * @description 输出只在本轮namespace；输入只读且必须为本轮独立普通文件。
     * @param path 规范化相对路径。
     */
    private _checkCampaignPath(path: string): void {
        if (path.startsWith('.peanut-ai/resource-stability-inputs/')) { this._checkInputPath(path); return; }
        this._checkPath(path);
    }

    /**
     * @description 只允许工程私有暂存目录的同run普通文件，拒绝路径和祖先链接。
     * @param path 工程相对输入。
     */
    private _checkInputPath(path: string): void {
        const prefix = `.peanut-ai/resource-stability-inputs/${basename(this._namespace)}/`;
        if (!path.startsWith(prefix)) this._deny('import_source_out_of_scope');
        let current = this.project();
        for (const part of path.split('/')) {
            current = join(current, part);
            try {
                if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) this._deny('resource_identity_invalid');
            } catch { this._deny('resource_identity_invalid'); }
        }
        if (!lstatSync(current).isFile()) this._deny('import_source_invalid');
    }
}
