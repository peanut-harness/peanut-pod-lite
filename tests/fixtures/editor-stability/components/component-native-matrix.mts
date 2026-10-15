import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ComponentNativeClient } from './component-native-client.mts';
import { ComponentNativeLogGuard } from './component-native-log-guard.mts';
import { ComponentNativeAssetLoader } from './component-native-asset-loader.ts';
import { ComponentNativeMatrixReport } from './component-native-matrix-report.mts';

/**
 * @description 保留99组件/795字段分母，逐场景验证实际六项写、原生getter和拒绝后的零文件变化。
 */
class ComponentNativeMatrix {
    /**
     * @description 绑定原生工程的认证传输。
     */
    private readonly client: ComponentNativeClient;
    /**
     * @description 从已暂存版本契约读取的完整组件配方。
     */
    private readonly components: Record<string, unknown>[];
    /**
     * @description 所有装配候选及不能替换为占位的阻塞。
     */
    private readonly staged: Record<string, unknown>[];
    /**
     * @description 原始分片标识，拒绝覆盖旧执行结果。
     */
    private readonly campaign: string;
    /**
     * @description 只读实际AssetDB条目，不能使用配方中的静态UUID。
     */
    private assets: Record<string, unknown>[] = [];
    /**
     * @description 当前工程真实后端观测。
     */
    private backend: Record<string, unknown> = {};
    /**
     * @description 逐组件、逐字段验收结果。
     */
    private readonly rows: Record<string, unknown>[] = [];

    /**
     * @description 包含全部读写、异常和撤销阶段的整轮日志证据。
     */
    private campaignLog: Record<string, unknown> | null = null;
    /**
     * @description 展示场景冻结摘要，字段测试只能改变独立副本。
     */
    private readonly presentationDigests = new Map<string, string>();
    /**
     * @description finally中实际核对的展示文件不变性。
     */
    private presentationsUnchanged: boolean | null = null;

    /**
     * @description 验证新分片和完整分母；可选择定向分片，但不能据此改变分母。
     * @param project 当前任务工程。
     * @param campaign 新证据标识。
     */
    public constructor(project: string, campaign: string) {
        this.client = new ComponentNativeClient(project); this.campaign = campaign;
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(campaign)) throw new Error('component_matrix_campaign_invalid');
        const fields = this.client.record(JSON.parse(readFileSync(join(this.client.project, 'extensions/peanut-component-probe/public-field-contract.json'), 'utf8')));
        const staging = this.client.record(JSON.parse(readFileSync(join(this.client.output, 'component-matrix-staging.json'), 'utf8')));
        this.components = this.records(fields.components); this.staged = this.records(staging.rows);
        if (this.staged.some(row => row.status !== 'blocked' && row.scenePath !== `assets/components/_lifecycle/${row.componentType}.scene`)) {
            throw new Error('component_matrix_disposable_lifecycle_scene_required');
        }
        for (const row of this.staged) {
            const presentation = this.client.record(row.presentation);
            if (typeof presentation.scenePath !== 'string') continue;
            if (presentation.scenePath !== `assets/components/${row.componentType}.scene` ||
                this.hash(presentation.scenePath) !== presentation.stagedSha256) throw new Error('component_matrix_presentation_identity_invalid');
            this.presentationDigests.set(presentation.scenePath, this.hash(presentation.scenePath));
        }
        if (fields.componentCount !== 99 || fields.fieldCount !== 795 || this.components.length !== 99 || this.staged.length !== 99
            || this.components.reduce((sum, row) => sum + this.records(row.cases).length, 0) !== 795) throw new Error('component_matrix_denominator_invalid');
        writeFileSync(join(this.client.output, `matrix-${campaign}-start.json`), JSON.stringify({ startedAt: new Date().toISOString(),
            candidateSourceCommit: this.client.registration.candidateSourceCommit, componentCount: 99, fieldCount: 795 }) + '\n', { flag: 'wx' });
    }

    /**
     * @description 依赖次序是实际导入、真实后端、六项挂接、逐文件生命周期、撤销；失败行保留并恢复控制场景。
     * @param selected 可选定向组件名单。
     * @returns 分母不变的完整状态报告。
     */
    public async run(selected: readonly string[]): Promise<void> {
        await ComponentNativeLogGuard.run(this.client.project, 'matrix-campaign', () => this.runMatrix(selected), event => {
            this.campaignLog = event; this.client.events.push(event); this.save();
        });
    }

    /**
     * @description 固定候选和安全回执后串行执行；执行异常立即停止，由finally撤销精确挂接。
     * @param selected 可选定向组件名单。
     */
    private async runMatrix(selected: readonly string[]): Promise<void> {
        const descriptor = this.client.record(JSON.parse(readFileSync(join(this.client.root, 'release/peanut.pod-lite-0.2.0/lite-release-descriptor.json'), 'utf8')));
        const safetyPath = join(this.client.root, 'evidence/task-5.1', `preview-safety-approved-${this.client.registration.creatorVersion}.json`);
        let safety: Record<string, unknown>;
        try { safety = this.client.record(JSON.parse(readFileSync(safetyPath, 'utf8'))); }
        catch { throw new Error('component_matrix_preview_branch_paused_by_user'); }
        if (safety.verified !== true || safety.candidateSourceCommit !== this.client.registration.candidateSourceCommit
            || safety.hostSha256 !== this.client.record(descriptor.host).sha256 || safety.coreSha256 !== this.client.record(descriptor.core).sha256)
            throw new Error('component_matrix_preview_safety_receipt_mismatch');
        const health = await this.client.health();
        if (typeof health.pid !== 'number' || !Number.isInteger(health.pid)) throw new Error('component_matrix_pid_invalid');
        const resources = this.client.record(JSON.parse(readFileSync(join(this.client.output, 'staging-receipt.json'), 'utf8')));
        ComponentNativeAssetLoader.assertResources(JSON.parse(readFileSync(join(this.client.output, 'native-resource-loads.json'), 'utf8')), {
            candidateSourceCommit: this.string(this.client.registration.candidateSourceCommit),
            creatorVersion: this.string(this.client.registration.creatorVersion), pid: health.pid,
            types: Object.keys(this.client.record(resources.bindings)),
        });
        const rawAssets = await this.client.probe('assets'); this.assets = this.records(rawAssets);
        try {
            await this.client.attach(true);
            await this.open('assets/components/_lifecycle/cc.UIOpacity.scene');
            this.backend = this.client.record(await this.client.probe('scene-snapshot'));
            for (const component of this.components) {
                const type = this.string(component.componentType); const cases = this.records(component.cases);
                if (selected.length && !selected.includes(type)) { this.rows.push({ componentType: type, status: 'not-selected', fields: cases.map(f => ({ id: f.id, status: 'pending' })) }); continue; }
                const staged = this.staged.find((row) => row.componentType === type); if (!staged) throw new Error('component_matrix_staging_row_missing');
                const blocked = this.blockers(component, staged);
                if (blocked.length) { this.rows.push({ componentType: type, status: 'blocked', blockers: blocked,
                    fields: cases.map(f => ({ id: f.id, status: 'component-precondition-blocked' })) }); this.save(); continue; }
                try { await this.component(component, staged); }
                catch (error) {
                    this.rows.push({ componentType: type, status: 'failed', reason: error instanceof Error ? error.message : String(error),
                        fields: cases.map(f => ({ id: f.id, status: 'component-execution-failed' })) }); this.save();
                    throw error;
                }
                process.stdout.write(JSON.stringify({ componentType: type, status: this.rows.at(-1)?.status }) + '\n');
            }
        } finally {
            try {
                this.presentationsUnchanged = [...this.presentationDigests].every(([path, digest]) => this.hash(path) === digest);
                if (!this.presentationsUnchanged) throw new Error('component_matrix_presentation_changed');
            } finally { await this.client.attach(false); this.save(); }
        }
    }

    /**
     * @description 暂存候选不能作为后端或源拥有层次的实际证明。
     * @param row 配方要求。
     * @param staged 已暂存场景。
     * @returns 当前实际阻塞。
     */
    private blockers(row: Record<string, unknown>, staged: Record<string, unknown>): string[] {
        if (staged.status === 'blocked') return this.recordsOrStrings(staged.blockers);
        const req = this.client.record(row.assemblyRequirements); const errors: string[] = [];
        const p3: unknown = Reflect.get(this.client.record(this.backend.physics3d), 'constructor');
        const p2: unknown = Reflect.get(this.client.record(this.backend.physics2d), 'constructor');
        if (req.physicsBackend === 'bullet' && p3 !== 'BulletWorld') errors.push('actual-bullet-backend-missing');
        if (req.physicsBackend === 'box2d' && p2 !== 'b2PhysicsWorld') errors.push('actual-box2d-backend-missing');
        if (req.physicsBackend === 'physx' && p3 !== 'PhysXWorld') errors.push('actual-physx-backend-missing');
        if (req.highQualityRenderPipeline === true) errors.push('high-quality-render-pipeline-not-yet-proven');
        return errors;
    }

    /**
     * @description 受管删除再添加、写完整公开根字段、commit和切场景重开；字段读回与错误类型拒绝分别记账。
     * @param component 当前配方。
     * @param staged 场景与节点装配。
     */
    private async component(component: Record<string, unknown>, staged: Record<string, unknown>): Promise<void> {
        const type = this.string(component.componentType); const scene = this.string(staged.scenePath); const target = this.string(staged.targetPath);
        const expectedSceneUuid = await this.client.sceneIdentity(scene);
        const suffix = target.replace(/^\/Root/u, ''); const cases = this.records(component.cases); const paths = this.client.record(staged.nodePaths);
        const carrier = this.client.record(this.client.record(component.assemblyRequirements).modelRendererCarrier);
        if (type === 'cc.Sorting' && (carrier.componentType !== 'cc.MeshRenderer' || carrier.requiredBase !== 'cc.ModelRenderer')) {
            throw new Error('component_sorting_renderer_precondition_missing');
        }
        const mesh = carrier.componentType ? this.assets.filter(asset => asset.type === 'cc.Mesh' && asset.imported === true
            && asset.invalid !== true && typeof asset.url === 'string' && asset.url.startsWith('db://assets/fixtures/')) : [];
        if (carrier.componentType && mesh.length !== 1) throw new Error('component_sorting_mesh_precondition_missing');
        const roots = new Map<string, { input: unknown; expected: unknown; resources: string[] }>();
        const fieldRows: Record<string, unknown>[] = [];
        for (const field of cases) {
            const selector = this.recordsOrStrings(field.selector); const root = selector[0]; if (!root) throw new Error('component_matrix_selector_missing');
            if (field.expectedWrite !== 'set-and-readback' || roots.has(root)) continue;
            try { roots.set(root, this.resolve(field.rootValue, paths)); }
            catch (error) { fieldRows.push({ id: field.id, status: 'native-input-blocked', reason: error instanceof Error ? error.message : String(error) }); }
        }
        const resources = [...new Set([`db://${scene}`, ...[...roots.values()].flatMap(value => value.resources),
            ...mesh.map(asset => this.string(asset.url))])];
        const input = { prefabRelativePath: scene, nodePath: target, resources };
        await this.open(scene);
        const initial = this.client.record(await this.client.probe('component-fields', { nodeSuffix: suffix, componentType: type, expectedSceneUuid }));
        this.requireScene(initial, expectedSceneUuid);
        if (initial.present === true) {
            await this.client.write('lumen-comp-rm', { ...input, componentType: type, confirmDestructive: true });
        } else if (initial.present !== false || initial.reason !== 'target-component-missing') {
            throw new Error('component_matrix_initial_presence_unknown');
        }
        await this.client.write('lumen-comp-add', { ...input, builtinType: type });
        if (carrier.componentType && mesh[0]) {
            await this.client.write('lumen-comp-set', { ...input, componentType: this.string(carrier.componentType),
                props: { mesh: mesh[0].uuid, enabled: false } });
        }
        // 先装配完整引用上下文；例如defaultClip必须存在于clips中，随后逐根字段独立验证别名。
        if (roots.size) await this.client.write('lumen-comp-set', { ...input, componentType: type,
            props: Object.fromEntries([...roots].map(([key, value]) => [key, value.input])) });
        let persisted = this.hash(scene);
        const control = scene === 'assets/components/_lifecycle/cc.UIOpacity.scene' ? 'assets/components/_lifecycle/cc.Sprite.scene' : 'assets/components/_lifecycle/cc.UIOpacity.scene';
        for (const [root, value] of roots) {
            await this.client.write('lumen-comp-set', { ...input, componentType: type, props: { [root]: value.input } });
            await this.commit(scene); persisted = this.hash(scene);
            await this.open(control); await this.open(scene);
            const read = await this.read(suffix, type, true, expectedSceneUuid);
            if (this.hash(scene) !== persisted) throw new Error('component_matrix_reopen_wrote_scene');
            const actual = this.records(read.fields);
            const current = cases.filter(field => this.recordsOrStrings(field.selector)[0] === root && field.expectedWrite === 'set-and-readback');
            for (const field of current) {
                const selector = this.recordsOrStrings(field.selector);
                const observed = actual.find(row => row.id === field.id);
                let expected = this.select(value.expected, selector.slice(1));
                if (field.nativeBooleanEnum === true && typeof expected === 'boolean') expected = expected ? 1 : 0;
                const matched = observed?.status === 'read' && this.equal(expected, observed.value);
                await this.refuse(scene, { ...input, componentType: type,
                    props: { [root]: this.replace(value.input, selector.slice(1), field.invalidValue) } }, false);
                fieldRows.push({ id: field.id, status: matched ? 'native-field-readback-verified' : 'native-field-readback-failed',
                    expected, observed, invalidTypeRefused: true, persistedAndReopened: true });
            }
            const after = await this.read(suffix, type, true, expectedSceneUuid);
            const ids = new Set(current.map(field => field.id));
            if (JSON.stringify(this.records(read.fields).filter(field => ids.has(field.id)))
                !== JSON.stringify(this.records(after.fields).filter(field => ids.has(field.id))))
                throw new Error('component_matrix_refusal_changed_native_fields');
        }
        for (const field of cases) {
            if (fieldRows.some(row => row.id === field.id)) continue;
            const selector = this.recordsOrStrings(field.selector); const root = selector[0];
            if (!root) throw new Error('component_matrix_selector_missing');
            if (field.expectedWrite === 'set-and-readback') {
                fieldRows.push({ id: field.id, status: 'native-input-blocked', reason: 'root-input-unavailable' }); continue;
            }
            const value = this.resolve(field.rootValue, paths);
            await this.refuse(scene, { ...input, componentType: type, props: { [root]: value.input } }, true);
            fieldRows.push({ id: field.id, status: 'expected-public-refusal-verified' });
        }
        await this.client.write('lumen-comp-rm', { ...input, componentType: type, confirmDestructive: true });
        await this.commit(scene); const removed = this.hash(scene);
        await this.open(control); await this.open(scene);
        await this.read(suffix, type, false, expectedSceneUuid);
        if (this.hash(scene) !== removed) throw new Error('component_matrix_removed_reopen_wrote_scene');
        this.rows.push({ componentType: type, status: fieldRows.every(row => ['native-field-readback-verified', 'expected-public-refusal-verified'].includes(String(row.status)))
            ? 'native-verified' : 'field-gaps', fields: fieldRows, addedAndRemoved: true, persistedAndReopened: true,
            removedAndReopened: true, persistedSha256: persisted, removedSha256: removed }); this.save();
    }

    /**
     * @description 验证公共类型/持久化拒绝，任何审批或原生失败均不得冒充类型拒绝。
     * @param scene 被测场景。
     * @param input 单字段拒绝输入。
     * @param persistence 是否是既有持久化拒绝字段。
     */
    private async refuse(scene: string, input: Record<string, unknown>, persistence: boolean): Promise<void> {
        const before = this.hash(scene); let rejected = false;
        try { await this.client.write('lumen-comp-set', input); }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            if (!new RegExp(persistence ? '^lumen_property_not_persistent' : '^lumen_property_(?:type|value|enum|field)', 'u').test(reason)) throw error;
            rejected = true;
        }
        if (!rejected) throw new Error('component_matrix_invalid_write_accepted');
        if (this.hash(scene) !== before) throw new Error('component_matrix_refused_write_changed_file');
    }

    /**
     * @description 根据真实AssetDB源/type选择身份，并把节点/组件引用映射到真实装配路径。
     * @param value 固定配方。
     * @param paths 已装配路径。
     * @returns 公开输入、原生期望与完整资源集合。
     */
    private resolve(value: unknown, paths: Record<string, unknown>): { input: unknown; expected: unknown; resources: string[] } {
        const recipe = this.client.record(value);
        if (recipe.form === 'resource') {
            const resource = this.client.record(recipe.resource); const sources = this.records(resource.sources)
                .filter(source => !this.string(source.path).endsWith('.meta')).map(source => `db://assets/fixtures/${this.string(source.path).replace('tests/fixtures/editor-stability/', '')}`);
            const assets = this.assets.filter(asset => asset.type === resource.nativeType && asset.imported === true && asset.invalid !== true
                && sources.some(url => asset.url === url || typeof asset.url === 'string' && asset.url.startsWith(url + '/')));
            const asset = assets[0]; if (assets.length !== 1 || !asset) throw new Error('component_matrix_resource_not_unique:' + resource.nativeType);
            return { input: this.string(asset.uuid), expected: { reference: 'asset', uuid: asset.uuid, type: asset.type, valid: true }, resources: [this.string(asset.url)] };
        }
        if (recipe.form === 'node-reference' || recipe.form === 'component-reference') {
            const path = this.string(paths[this.string(recipe.value)]); return { input: path, expected: {
                reference: recipe.form === 'node-reference' ? 'node' : 'component', path: path.replace(/^\/Root/u, ''),
                ...(recipe.form === 'component-reference' ? { type: recipe.componentType } : {}), valid: true }, resources: [] };
        }
        if (recipe.form === 'project-file-url') throw new Error('component_matrix_project_preview_url_pending');
        if (recipe.form === 'literal') {
            const input = structuredClone(recipe.value);
            if (Array.isArray(input)) {
                const expected = input.map(item => {
                    if (item && typeof item === 'object' && typeof item.target === 'string') {
                        const path = this.string(paths[item.target]); item.target = path;
                        return { ...item, target: { reference: 'node', path: path.replace(/^\/Root/u, ''), valid: true } };
                    }
                    return item;
                }); return { input, expected, resources: [] };
            }
            return { input, expected: input, resources: [] };
        }
        if (recipe.form === 'list') {
            if (!Array.isArray(recipe.items)) throw new Error('component_matrix_recipe_list');
            const items = recipe.items.map(item => this.resolve(item, paths));
            return { input: items.map(item => item.input), expected: items.map(item => item.expected), resources: items.flatMap(item => item.resources) };
        }
        if (recipe.form === 'object') {
            const items = Object.entries(this.client.record(recipe.properties)).map(([key, item]) => [key, this.resolve(item, paths)] as const);
            return { input: Object.fromEntries(items.map(([key, item]) => [key, item.input])),
                expected: Object.fromEntries(items.map(([key, item]) => [key, item.expected])), resources: items.flatMap(([, item]) => item.resources) };
        }
        throw new Error('component_matrix_recipe_form_unknown');
    }

    /**
     * @description 只重试原生读取，不重放写入；目标类型必须实际有效。
     * @param suffix 场景根以下路径。
     * @param type 实际组件类型。
     * @param present 预期存在或已移除。
     * @param expectedSceneUuid 目标场景真实UUID。
     * @returns 原生字段快照。
     */
    private async read(suffix: string, type: string, present: boolean, expectedSceneUuid: string): Promise<Record<string, unknown>> {
        const until = Date.now() + 30000;
        do {
            const result = this.client.record(await this.client.probe('component-fields', { nodeSuffix: suffix, componentType: type, expectedSceneUuid }));
            this.requireScene(result, expectedSceneUuid);
            if (result.present === present && (!present || result.valid === true)) {
                this.client.events.push({ step: 'native-fields', componentType: type, result }); this.client.save(); return result;
            }
            if (Date.now() >= until) throw new Error('component_matrix_native_component_presence_mismatch:' + type);
            await new Promise(done => setTimeout(done, 500));
        } while (true);
    }

    /**
     * @description 公共保存仅提交明确场景，不刷新预览或启动全资产刷新。
     * @param scene 明确场景文件。
     */
    private async commit(scene: string): Promise<void> {
        await this.client.write('lumen-commit', { paths: [scene], resources: [`db://${scene}`] });
        // 矩阵只做原生场景验证，不对每个字段重载浏览器预览。
    }

    /**
     * @description 使用精确挂接的公开scene.open呈现指定场景。
     * @param scene 明确场景文件。
     */
    private async open(scene: string): Promise<void> {
        const expectedSceneUuid = await this.client.sceneIdentity(scene);
        await this.client.write('scene-open', { path: `db://${scene}`, resources: [`db://${scene}`] });
        this.requireScene(this.client.record(await this.client.probe('scene-snapshot')), expectedSceneUuid);
    }

    /**
     * @description 原生场景漂移立即停止并保留观测，不重放打开或写入。
     * @param result 原生观测。
     * @param expectedSceneUuid 目标UUID。
     */
    private requireScene(result: Record<string, unknown>, expectedSceneUuid: string): void {
        if (result.sceneUuid === expectedSceneUuid) return;
        this.client.events.push({ step: 'native-scene-identity-refused', expectedSceneUuid, result }); this.client.save();
        throw new Error('component_matrix_native_scene_identity_mismatch');
    }

    /**
     * @description 错误类型输入保留其它有效嵌套字段，数组逐项替换相同公开叶字段。
     * @param value 有效根值。
     * @param selector 根字段以下选择器。
     * @param invalid 固定错误类型。
     * @returns 独立的错误输入。
     */
    private replace(value: unknown, selector: readonly string[], invalid: unknown): unknown {
        if (!selector.length) return structuredClone(invalid);
        if (Array.isArray(value)) return value.map(item => this.replace(item, selector, invalid));
        const key = selector[0]; if (!key || !value || typeof value !== 'object') throw new Error('component_matrix_invalid_selector');
        const record = this.client.record(value); return { ...record, [key]: this.replace(record[key], selector.slice(1), invalid) };
    }

    /**
     * @description 从完整原生期望中独立选择当前矩阵叶字段。
     * @param value 完整期望。
     * @param selector 根以下字段。
     * @returns 对应叶值。
     */
    private select(value: unknown, selector: readonly string[]): unknown {
        if (!selector.length) return value;
        if (Array.isArray(value)) return value.map(item => this.select(item, selector));
        const key = selector[0]; if (!key) throw new Error('component_matrix_expected_selector');
        return this.select(this.client.record(value)[key], selector.slice(1));
    }

    /**
     * @description 仅对浮点表示容许1e-5相对误差；类型、引用身份及对象字段必须相同。
     * @param expected 配方期望。
     * @param actual 真正原生getter。
     * @returns 是否匹配。
     */
    private equal(expected: unknown, actual: unknown): boolean {
        if (typeof expected === 'number' && typeof actual === 'number') return Math.abs(expected - actual) <= 1e-5 * Math.max(1, Math.abs(expected));
        if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((item, index) => this.equal(item, actual[index]));
        if (expected && typeof expected === 'object') {
            const a = this.client.record(actual); const e = this.client.record(expected);
            return Object.keys(e).length === Object.keys(a).length && Object.entries(e).every(([key, value]) => this.equal(value, a[key]));
        }
        return expected === actual;
    }

    /**
     * @description 原始落盘字节摘要用于保存、重开和拒绝的副作用检查。
     * @param scene 本工程场景。
     * @returns 实际SHA。
     */
    private hash(scene: string): string { return createHash('sha256').update(readFileSync(join(this.client.project, scene))).digest('hex'); }

    /**
     * @description 验证对象数组，不丢弃非法条目。
     * @param value 未知JSON。
     * @returns 实际记录列表。
     */
    private records(value: unknown): Record<string, unknown>[] {
        if (!Array.isArray(value)) throw new Error('component_matrix_records_invalid');
        return value.map(item => { if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('component_matrix_record_invalid'); return this.client.record(item); });
    }

    /**
     * @description 验证字符串列表，拒绝丢弃非法输入。
     * @param value 未知JSON。
     * @returns 字符串列表。
     */
    private recordsOrStrings(value: unknown): string[] {
        if (!Array.isArray(value)) throw new Error('component_matrix_strings_invalid'); return value.map(item => this.string(item));
    }

    /**
     * @description 在固定契约边界验证非空字符串。
     * @param value 未知JSON。
     * @returns 非空字符串。
     */
    private string(value: unknown): string { if (typeof value !== 'string' || !value.length) throw new Error('component_matrix_string_invalid'); return value; }

    /**
     * @description 保留原始分母和所有逐字段状态，不把字段或资源通过等同完整任务完成。
     */
    private save(): void {
        const completeRows = ComponentNativeMatrixReport.complete(this.components.map(component => ({
            componentType: this.string(component.componentType), cases: this.records(component.cases).map(field => ({ id: this.string(field.id) })),
        })), this.rows);
        const counts: Record<string, number> = {};
        for (const row of completeRows) for (const field of this.records(row.fields)) counts[String(field.status)] = (counts[String(field.status)] ?? 0) + 1;
        const log = this.client.record(this.campaignLog?.result);
        const campaignAccepted = this.campaignLog?.actionSucceeded === true && log.logChecked === true && log.verified === true
            && log.newErrorCount === 0 && log.newWarningCount === 0;
        const fieldVerifiedComponents = this.rows.filter(row => row.status === 'native-verified').length;
        writeFileSync(join(this.client.output, `matrix-${this.campaign}-report.json`), JSON.stringify({ schemaVersion: 1,
            creatorVersion: this.client.registration.creatorVersion, candidateSourceCommit: this.client.registration.candidateSourceCommit,
            componentCount: 99, fieldCount: 795, processedComponents: this.rows.length,
            nativeVerifiedComponents: campaignAccepted ? fieldVerifiedComponents : 0,
            nativeFieldVerifiedComponents: fieldVerifiedComponents, fieldStatusCounts: counts,
            backend: { physics3d: this.backend.physics3d, physics2d: this.backend.physics2d, pipeline: this.backend.pipelineConstructor },
            campaignLogPostflight: this.campaignLog,
            campaignAcceptance: this.campaignLog === null ? 'pending' : campaignAccepted ? 'accepted' : 'rejected',
            presentationFilesUnchanged: this.presentationsUnchanged, presentationRenderedComponents: 0,
            allEnabled: false, zeroDiagnosticsClaimed: false, task51Complete: false, rows: completeRows }, null, 2) + '\n');
        this.client.save();
    }
}

const args = process.argv.slice(2); const project = args[args.indexOf('--project') + 1];
const campaign = args.includes('--campaign-id') ? args[args.indexOf('--campaign-id') + 1] : 'full';
const selected = args.includes('--components') ? (args[args.indexOf('--components') + 1] ?? '').split(',') : [];
if (!project || !campaign || selected.some(type => !/^[a-zA-Z0-9_.]+$/u.test(type))) throw new Error('component_matrix_arguments_invalid');
await new ComponentNativeMatrix(project, campaign).run(selected);
