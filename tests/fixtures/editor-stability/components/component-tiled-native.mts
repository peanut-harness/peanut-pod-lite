import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ComponentNativeClient } from './component-native-client.mts';
import { ComponentNativeAssetLoader } from './component-native-asset-loader.ts';
import { ComponentNativeTiledContext } from './component-native-tiled-context.ts';
import { ComponentNativeRawLogs } from './component-native-raw-logs.mts';
import { ComponentNativeMatrixReport } from './component-native-matrix-report.mts';

/**
 * @description TMX拥有关系专用实机矩阵；字段、拒绝和生命周期分别验证，始终保留99/795完整分母。
 */
class ComponentTiledNative {
    /**
     * @description 同候选、同owner、同原始PID的认证传输。
     */
    private readonly client: ComponentNativeClient;
    /**
     * @description 已登记的独立输入证明，不作原生通过依据。
     */
    private readonly proof: Record<string, unknown>;
    /**
     * @description 当前场景实际AssetDB与落盘meta共同确认的身份。
     */
    private sceneUuid = '';
    /**
     * @description 真实动作及读回证据，不含批准令牌。
     */
    private readonly events: Record<string, unknown>[] = [];
    /**
     * @description 实际完成的组件行；未完成项由报告补为pending。
     */
    private readonly rows: Record<string, unknown>[] = [];
    /**
     * @description 全部步骤与原始日志均通过后才置真，实际画面验收单独保留false。
     */
    private accepted = false;
    /**
     * @description 独立实机工具摘要，与被测Host/Core候选身份分别记录，运行中禁止变更。
     */
    private readonly runnerSha256 = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');

    /**
     * @description 仅允许显式Tiled上下文的3.8.7新登记工程。
     */
    public constructor(project: string) {
        this.client = new ComponentNativeClient(project);
        this.proof = this.client.record(JSON.parse(readFileSync(join(this.client.output, 'tiled-source-staging.json'), 'utf8')));
        if (this.client.registration.tiledHierarchy !== true || this.client.registration.creatorVersion !== '3.8.7'
            || this.proof.scene !== 'assets/components/task51-tiled-source.scene' || this.proof.target !== '/Root/Canvas/Target'
            || this.proof.tmx !== 'assets/fixtures/media/assets/map/source-owned.tmx'
            || this.proof.script !== 'assets/components/TiledUserDependency.ts') throw new Error('component_tiled_campaign_context_invalid');
    }

    /**
     * @description 依次确认输入、SDK用户登记、三项持久字段、两项拒绝和四类生命周期。
     */
    public async run(): Promise<void> {
        this.raw(); const health = await this.client.health();
        const safety = this.client.record(JSON.parse(readFileSync(join(this.client.root, 'evidence/task-5.1/preview-safety-approved-3.8.7.json'), 'utf8')));
        if (safety.verified !== true || safety.projectPath !== this.client.project
            || ['candidateSourceCommit', 'hostSha256', 'coreSha256'].some(key => safety[key] !== this.client.registration[key]))
            throw new Error('component_tiled_campaign_preview_safety_invalid');
        const staging = this.client.record(JSON.parse(readFileSync(join(this.client.output, 'staging-receipt.json'), 'utf8')));
        if (typeof health.pid !== 'number') throw new Error('component_tiled_campaign_pid_invalid');
        ComponentNativeAssetLoader.assertResources(JSON.parse(readFileSync(join(this.client.output, 'native-resource-loads.json'), 'utf8')), {
            candidateSourceCommit: this.string(this.client.registration.candidateSourceCommit), creatorVersion: '3.8.7', pid: health.pid,
            types: Object.keys(this.client.record(staging.bindings)),
        });
        const components = this.records(await this.client.probe('assets', { scope: 'components' }));
        const fixtures = this.records(await this.client.probe('assets'));
        for (const path of [this.scene(), this.string(this.proof.script), this.string(this.proof.tmx)]) {
            const matches = [...components, ...fixtures].filter(asset => asset.url === 'db://' + path);
            const meta = this.client.record(JSON.parse(readFileSync(join(this.client.project, path + '.meta'), 'utf8')));
            if (matches.length !== 1 || matches[0]?.uuid !== meta.uuid || typeof meta.uuid !== 'string') throw new Error('component_tiled_campaign_asset_identity');
            if (path === this.scene()) this.sceneUuid = meta.uuid;
            if (path === this.proof.tmx && meta.uuid !== this.proof.sourceUuid) throw new Error('component_tiled_campaign_source_identity');
        }
        await this.client.attach(true);
        try {
            await this.open(this.scene()); await this.context('sdk-tmx-initialized', true, false);
            await this.client.write('lumen-comp-add', { ...this.input('/Root/Canvas/Target'), scriptName: this.proof.script });
            await this.reopen(); await this.context('sdk-user-registered', true, true);
            const color = { r: 128, g: 160, b: 192, a: 255 };
            for (const field of [
                { type: 'cc.TiledLayer', path: '/Root/Canvas/Target/Ground', key: 'color', value: color },
                { type: 'cc.TiledTile', path: '/Root/Canvas/Target/Ground/OwnedTile', key: 'x', value: 1 },
                { type: 'cc.TiledTile', path: '/Root/Canvas/Target/Ground/OwnedTile', key: 'y', value: 1 },
            ]) {
                const input = { ...this.input(field.path), componentType: field.type };
                await this.refuse('lumen-comp-set', { ...input, props: { [field.key]: 'invalid' } }, /^lumen_property_(?:type|value|enum|field)/u);
                await this.client.write('lumen-comp-set', { ...input, props: { [field.key]: field.value } });
                await this.reopen(); const result = await this.fields(field.type, field.path, true);
                const found = this.records(result.fields).find(row => row.id === `field:component:${field.type}:${field.key}`);
                if (found?.status !== 'read' || JSON.stringify(found.value) !== JSON.stringify(field.value)) throw new Error('component_tiled_campaign_field_mismatch');
                this.events.push({ step: 'persistent-field', ...field, result, sha256: this.hash() }); this.save();
                await this.context('persistent-field-dependencies', true, true);
            }
            for (const field of [
                { type: 'cc.TiledLayer', path: '/Root/Canvas/Target/Ground', key: 'enableCulling' },
                { type: 'cc.TiledObjectGroup', path: '/Root/Canvas/Target/Objects', key: 'premultiplyAlpha' },
            ]) await this.refuse('lumen-comp-set', { ...this.input(field.path), componentType: field.type,
                props: field.type === 'cc.TiledLayer' ? { color: { r: 0, g: 0, b: 0, a: 255 }, enableCulling: true } : { premultiplyAlpha: true } }, /^lumen_property_not_persistent(?::|$)/u);
            for (const [type, path] of [['cc.TiledLayer', '/Root/Canvas/Target/Ground'], ['cc.TiledObjectGroup', '/Root/Canvas/Target/Objects']] as const) {
                const before = this.hash(); await this.client.write('lumen-comp-add', { ...this.input(path), builtinType: type });
                if (this.hash() !== before) throw new Error('component_tiled_campaign_idempotent_attach_changed_source');
                await this.refuse('lumen-comp-rm', { ...this.input(path), componentType: type, confirmDestructive: true }, /^lumen_component_source_owned(?::|$)/u);
                await this.reopen(); await this.fields(type, path, true); await this.context('source-owner-reopen', true, true);
            }
            const user = this.input('/Root/Canvas/Target/Ground/OwnedUser');
            await this.refuse('lumen-comp-add', { ...user, builtinType: 'cc.TiledUserNodeData' }, /^lumen_component_source_owned(?::|$)/u);
            await this.refuse('lumen-comp-rm', { ...user, componentType: 'cc.TiledUserNodeData', confirmDestructive: true }, /^lumen_component_source_owned(?::|$)/u);
            await this.fields('cc.TiledUserNodeData', '/Root/Canvas/Target/Ground/OwnedUser', true);
            const tile = this.input('/Root/Canvas/Target/Ground/OwnedTile');
            for (const action of ['remove', 'add', 'remove'] as const) {
                if (action === 'add') await this.client.write('lumen-comp-add', { ...tile, builtinType: 'cc.TiledTile' });
                else await this.client.write('lumen-comp-rm', { ...tile, componentType: 'cc.TiledTile', confirmDestructive: true });
                await this.reopen(); await this.fields('cc.TiledTile', '/Root/Canvas/Target/Ground/OwnedTile', action === 'add');
                await this.context('tile-' + action + '-reopened', action === 'add', true);
            }
            for (const [type, fields, lifecycle] of [
                ['cc.TiledLayer', ['color', 'enableCulling'], 'idempotent attach; TMX-owned removal refused; saved/reopened'],
                ['cc.TiledObjectGroup', ['premultiplyAlpha'], 'idempotent attach; TMX-owned removal refused; saved/reopened'],
                ['cc.TiledTile', ['x', 'y'], 'remove/add/remove; each saved/switched/reopened'],
                ['cc.TiledUserNodeData', [], 'actual SDK addUserNode registration; manual attach/remove refused'],
            ] as const) this.rows.push({ componentType: type, status: 'native-verified', lifecycle, fields: fields.map(field => ({
                id: `field:component:${type}:${field}`, status: ['enableCulling', 'premultiplyAlpha'].includes(field)
                    ? 'expected-public-refusal' : 'native-field-readback-verified',
            })) });
            this.raw();
        } finally {
            try { await this.open('assets/components/cc.Label.scene'); }
            finally { await this.client.attach(false); this.save(); }
        }
        this.raw(); this.accepted = true; this.save();
    }

    /**
     * @description 逐次检查真实场景身份和固定地图上下文，记录原生状态。
     */
    private async context(step: string, tile: boolean, user: boolean): Promise<void> {
        const result = this.client.record(await this.client.probe('scene-snapshot'));
        if (result.sceneUuid !== this.sceneUuid) throw new Error('component_tiled_campaign_scene_mismatch');
        const maps = this.records(result.nodes).flatMap(node => this.records(node.components)).filter(component => component.type === 'cc.TiledMap');
        if (maps.length !== 1) throw new Error('component_tiled_campaign_map_count');
        ComponentNativeTiledContext.assert(maps[0]?.observed, this.string(this.proof.sourceUuid), tile, user);
        this.events.push({ step, result }); this.save();
    }

    /**
     * @description 字段和缺失证明只来自当前实际场景，拒绝用文件读回代替。
     */
    private async fields(type: string, path: string, present: boolean): Promise<Record<string, unknown>> {
        const result = this.client.record(await this.client.probe('component-fields', { componentType: type,
            nodeSuffix: path.replace(/^\/Root/u, ''), expectedSceneUuid: this.sceneUuid }));
        if (result.sceneUuid !== this.sceneUuid || result.present !== present || present && result.valid !== true)
            throw new Error('component_tiled_campaign_component_mismatch');
        this.events.push({ step: 'native-fields', type, result }); this.save(); return result;
    }

    /**
     * @description 只接受明确产品边界拒绝；其它失败与SDK原始诊断都继续抛出。
     */
    private async refuse(operation: string, input: Record<string, unknown>, expected: RegExp): Promise<void> {
        const before = this.hash(); let reason = '';
        try { await this.client.write(operation, input); }
        catch (error) { if (!(error instanceof Error) || !expected.test(error.message)) throw error; reason = error.message; }
        if (!reason || this.hash() !== before) throw new Error('component_tiled_campaign_refusal_not_atomic');
        this.events.push({ step: 'expected-public-refusal', operation, input, reason, unchangedSha256: before }); this.save();
    }

    /**
     * @description 每个输入声明完整资源闭包，不扩大固定六项能力。
     */
    private input(nodePath: string): Record<string, unknown> {
        return { prefabRelativePath: this.scene(), nodePath, resources: [this.scene(), this.string(this.proof.tmx), this.string(this.proof.script),
            'assets/fixtures/media/assets/map/one-tile.tsx', 'assets/fixtures/media/assets/image/checker.png'].map(path => 'db://' + path) };
    }

    /**
     * @description 正常提交、切换控制场景和重开；不刷新浏览器。
     */
    private async reopen(): Promise<void> {
        await this.client.write('lumen-commit', { paths: [this.scene()], resources: ['db://' + this.scene()] });
        await this.open('assets/components/cc.Label.scene'); await this.open(this.scene());
    }

    /**
     * @description 只打开明确输入场景。
     */
    private async open(path: string): Promise<void> { await this.client.write('scene-open', { path: 'db://' + path, resources: ['db://' + path] }); }

    /**
     * @description 原始日志从零起检查，不取新游标跳过既有错误。
     */
    private raw(): void {
        const raw = ComponentNativeRawLogs.readAll(this.client.project);
        if (raw.newErrors.length || raw.newWarnings.length) throw new Error('component_tiled_campaign_raw_diagnostics_present');
    }

    /**
     * @description 固定源文件字节用于所有拒绝和重开副作用检查。
     */
    private hash(): string { return createHash('sha256').update(readFileSync(join(this.client.project, this.scene()))).digest('hex'); }

    /**
     * @description 已登记的独立场景路径。
     */
    private scene(): string { return this.string(this.proof.scene); }

    /**
     * @description 按完整字段契约补齐pending，拒绝缩小分母或将画面未验提升为通过。
     */
    private save(): void {
        if (createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex') !== this.runnerSha256)
            throw new Error('component_tiled_campaign_runner_changed');
        const contract = this.client.record(JSON.parse(readFileSync(join(this.client.project, 'extensions/peanut-component-probe/public-field-contract.json'), 'utf8')));
        const components = this.records(contract.components).map(row => ({ componentType: this.string(row.componentType),
            cases: this.records(row.cases).map(field => ({ id: this.string(field.id) })) }));
        if (components.length !== 99 || components.reduce((sum, row) => sum + row.cases.length, 0) !== 795)
            throw new Error('component_tiled_campaign_denominator_invalid');
        writeFileSync(join(this.client.output, 'tiled-native-campaign.json'), JSON.stringify({ candidateSourceCommit: this.client.registration.candidateSourceCommit, runnerSha256: this.runnerSha256,
            accepted: this.accepted, renderedAcceptance: false, task51Complete: false, componentCount: 99, fieldCount: 795,
            nativeVerifiedComponents: this.rows.length, rows: ComponentNativeMatrixReport.complete(components, this.rows), events: this.events }, null, 2) + '\n');
    }

    /**
     * @description 未受信列表逐项检查，非法值不静默丢弃。
     */
    private records(value: unknown): Record<string, unknown>[] {
        if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('component_tiled_campaign_records_invalid');
        return value.map(item => this.client.record(item));
    }

    /**
     * @description 拒绝缺失路径或身份。
     */
    private string(value: unknown): string { if (typeof value !== 'string' || !value) throw new Error('component_tiled_campaign_string_invalid'); return value; }
}

const project = process.argv[process.argv.indexOf('--project') + 1];
if (!project) throw new Error('component_tiled_campaign_project_required');
await new ComponentTiledNative(project).run();
