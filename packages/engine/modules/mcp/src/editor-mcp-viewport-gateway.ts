import type { ContractPayload, IViewportCameraSnapshot, IViewportMutationResult, IViewportSetStateInput, IViewportState } from '@peanut/pod-protocol';
import type { IGrantedRuntimeClientSet } from '@peanut/pod-sdk';

type IViewportRuntime = Pick<IGrantedRuntimeClientSet, 'version' | 'message' | 'scene'>;

const SUPPORTED_CREATOR_VERSIONS: ReadonlySet<string> = new Set(['3.8.3', '3.8.7']);
const HUB_CONTROL_FIELDS: ReadonlySet<string> = new Set(['execution', 'approvalId', 'approvalToken', 'confirmDestructive', 'resources']);

/**
 * @description 通过 Creator 原生 scene 消息和 POD 场景脚本桥查询或控制视口。
 */
export class EditorMcpViewportGateway {
    /**
     * @description 当前宿主能力。
     */
    private readonly _runtime: IViewportRuntime;

    /**
     * @description 绑定当前受限 Creator runtime。
     * @param runtime 已授予能力集合。
     */
    public constructor(runtime: IViewportRuntime) {
        this._runtime = runtime;
    }

    /**
     * @description 检查查询输入必须为空。
     */
    public validateQueryInput(input: ContractPayload | undefined): void {
        this._assertEmpty(input);
    }

    /**
     * @description 校验当前操作的视口输入。
     */
    public validate(operation: string, input: ContractPayload | undefined): void {
        if (operation === 'viewport.queryState') this.validateQueryInput(input);
        else if (operation === 'viewport.focusNodes') this.readFocusInput(input);
        else if (operation === 'viewport.setState') this.readSetStateInput(input);
        else throw new Error('viewport_operation_invalid');
    }

    /**
     * @description 判断当前Creator版本和场景桥是否支持视口操作。
     */
    public isAvailable(): boolean {
        return SUPPORTED_CREATOR_VERSIONS.has(this._version()) && this._runtime.message != null && this._runtime.scene != null;
    }

    /**
     * @description 执行一个已校验的视口operation。
     */
    public async execute(operation: string, input: ContractPayload | undefined): Promise<unknown> {
        switch (operation) {
            case 'viewport.queryState': return this.queryState();
            case 'viewport.focusNodes': return this.focusNodes(this.readFocusInput(input));
            case 'viewport.setState': return this.setState(this.readSetStateInput(input));
            default: throw new Error('viewport_operation_invalid');
        }
    }

    /**
     * @description 校验唯一节点目标输入。
     */
    public readFocusInput(input: ContractPayload | undefined): readonly string[] {
        if (input == null || Object.keys(input).some((key) => key !== 'targets' && !HUB_CONTROL_FIELDS.has(key))) throw new Error('viewport_focus_input_invalid');
        const targets = input.targets;
        if (!Array.isArray(targets) || targets.length < 1 || targets.length > 32 || targets.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
            throw new Error('viewport_focus_targets_invalid');
        }
        const normalized: string[] = [];
        for (const value of targets) {
            if (typeof value !== 'string' || value.trim().length === 0) throw new Error('viewport_focus_targets_invalid');
            normalized.push(value.trim().replace(/\\/gu, '/'));
        }
        if (new Set(normalized).size !== normalized.length) throw new Error('viewport_focus_targets_duplicate');
        return normalized;
    }

    /**
     * @description 校验视口状态设置请求。
     */
    public readSetStateInput(input: ContractPayload | undefined): IViewportSetStateInput {
        if (input == null || Object.keys(input).some((key) => key !== 'is2D' && key !== 'gridVisible' && !HUB_CONTROL_FIELDS.has(key))) throw new Error('viewport_set_state_input_invalid');
        const is2D = input.is2D;
        const gridVisible = input.gridVisible;
        if ((is2D !== undefined && typeof is2D !== 'boolean') || (gridVisible !== undefined && typeof gridVisible !== 'boolean')) throw new Error('viewport_set_state_value_invalid');
        if (is2D === undefined && gridVisible === undefined) throw new Error('viewport_set_state_empty');
        return { ...(is2D === undefined ? {} : { is2D }), ...(gridVisible === undefined ? {} : { gridVisible }) };
    }

    /**
     * @description 查询版本、模式、网格和相机文本快照。
     */
    public async queryState(): Promise<IViewportState> {
        const creatorVersion = this._version();
        const supported = SUPPORTED_CREATOR_VERSIONS.has(creatorVersion);
        const fields: Record<string, { supported: boolean; available: boolean; failureCode: string | null }> = {};
        let is2D: boolean | null = null;
        let gridVisible: boolean | null = null;
        let camera: IViewportCameraSnapshot | null = null;
        if (!supported) {
            fields.is2D = { supported: false, available: false, failureCode: 'creator_version_unsupported' };
            fields.gridVisible = { supported: false, available: false, failureCode: 'creator_version_unsupported' };
            fields.camera = { supported: false, available: false, failureCode: 'creator_version_unsupported' };
        } else {
            const message = this._runtime.message;
            if (message == null) {
                fields.is2D = { supported: true, available: false, failureCode: 'creator_message_unavailable' };
                fields.gridVisible = { supported: true, available: false, failureCode: 'creator_message_unavailable' };
            } else {
                try { const value = await message.request<boolean>('scene', 'query-is2D'); is2D = typeof value === 'boolean' ? value : null; fields.is2D = { supported: true, available: is2D != null, failureCode: is2D != null ? null : 'creator_response_invalid' }; }
                catch { fields.is2D = { supported: true, available: false, failureCode: 'creator_query_failed' }; }
                try { const value = await message.request<boolean>('scene', 'query-is-grid-visible'); gridVisible = typeof value === 'boolean' ? value : null; fields.gridVisible = { supported: true, available: gridVisible != null, failureCode: gridVisible != null ? null : 'creator_response_invalid' }; }
                catch { fields.gridVisible = { supported: true, available: false, failureCode: 'creator_query_failed' }; }
            }
            try {
                const value = await this._readCamera();
                camera = value;
                fields.camera = { supported: true, available: true, failureCode: null };
            } catch (error) {
                fields.camera = { supported: true, available: false, failureCode: this._cameraFailureCode(error) };
            }
        }
        return { creatorVersion, is2D, gridVisible, camera, fields };
    }

    /**
     * @description 对节点发出原生相机聚焦，并核对相机视点是否变化。
     */
    public async focusNodes(targets: readonly string[]): Promise<IViewportMutationResult> {
        const creatorVersion = this._version();
        if (!SUPPORTED_CREATOR_VERSIONS.has(creatorVersion)) return this._refused(creatorVersion, 'targets', targets, 'creator_version_unsupported');
        const resolved = await this._resolveTargets(targets);
        if (!resolved.ok) return this._refused(creatorVersion, 'targets', targets, resolved.failureCode);
        const before = await this._readCamera().catch(() => null);
        const message = this._runtime.message;
        if (message == null) return this._refused(creatorVersion, 'targets', targets, 'creator_message_unavailable');
        try { await message.request<void>('scene', 'focus-camera', [...resolved.uuids]); }
        catch { return this._refused(creatorVersion, 'targets', targets, 'creator_focus_failed'); }
        const after = await this._waitForCameraChange(before);
        const verified = before != null && after != null && !this._sameCamera(before, after);
        return {
            ok: verified,
            status: verified ? 'verified' : 'accepted_unverified',
            creatorVersion,
            fields: { targets: { requested: [...targets], accepted: true, verified, actual: after, failureCode: verified ? null : 'camera_focus_not_verified' } },
        };
    }

    /**
     * @description 逐字段设置模式和网格，并通过Creator查询消息核对实际值。
     */
    public async setState(input: IViewportSetStateInput): Promise<IViewportMutationResult> {
        const creatorVersion = this._version();
        if (!SUPPORTED_CREATOR_VERSIONS.has(creatorVersion)) {
            const fields = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, { requested: value, accepted: false, verified: false, actual: null, failureCode: 'creator_version_unsupported' }]));
            return { ok: false, status: 'refused', creatorVersion, fields };
        }
        const message = this._runtime.message;
        if (message == null) {
            const fields = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, { requested: value, accepted: false, verified: false, actual: null, failureCode: 'creator_message_unavailable' }]));
            return { ok: false, status: 'refused', creatorVersion, fields };
        }
        const fields: Record<string, { requested: unknown; accepted: boolean; verified: boolean; actual: unknown; failureCode: string | null }> = {};
        const before = await this.queryState();
        if (input.is2D !== undefined) fields.is2D = await this._setField(message, input.is2D, 'change-is2D', 'query-is2D', before.is2D);
        if (input.gridVisible !== undefined) fields.gridVisible = await this._setField(message, input.gridVisible, 'set-grid-visible', 'query-is-grid-visible', before.gridVisible);
        const values = Object.values(fields);
        const allVerified = values.every((field) => field.verified);
        const anyAccepted = values.some((field) => field.accepted);
        return { ok: allVerified, status: allVerified ? 'verified' : anyAccepted ? 'partial_failure' : 'refused', creatorVersion, fields };
    }

    /**
     * @description 执行单字段设置后从官方查询消息读取实际值。
     */
    private async _setField(message: NonNullable<IGrantedRuntimeClientSet['message']>, requested: boolean, setter: string, query: string, previous: boolean | null): Promise<{ requested: unknown; accepted: boolean; verified: boolean; actual: unknown; failureCode: string | null }> {
        try { await message.request<void>('scene', setter, requested); }
        catch { return { requested, accepted: false, verified: false, actual: previous, failureCode: 'creator_set_failed' }; }
        try {
            const actual = await message.request<boolean>('scene', query);
            const verified = actual === requested;
            return { requested, accepted: true, verified, actual, failureCode: verified ? null : 'creator_readback_mismatch' };
        } catch { return { requested, accepted: true, verified: false, actual: null, failureCode: 'creator_readback_failed' }; }
    }

    /**
     * @description 通过已有POD场景脚本入口读取Creator相机数值并归一化为JSON。
     */
    private async _readCamera(): Promise<IViewportCameraSnapshot> {
        const scene = this._runtime.scene;
        if (scene == null) throw new Error('creator_scene_unavailable');
        const result = await scene.execute<unknown>('peanut-pod-lite-host', 'queryViewportCamera', []);
        if (typeof result !== 'object' || result == null || Array.isArray(result)) throw new Error('creator_camera_response_invalid');
        const record = result as Record<string, unknown>;
        return {
            position: this._vector3(record.position),
            rotation: this._vector4(record.rotation),
            viewCenter: this._vector3(record.viewCenter),
            contentRect: this._rect(record.contentRect),
            scale: this._number(record.scale),
        };
    }

    /**
     * @description 将场景脚本错误归一为有限的诊断代码，避免原始错误信息外泄。
     */
    private _cameraFailureCode(error: unknown): string {
        const allowedCodes = new Set([
            'creator_scene_unavailable',
            'creator_viewport_camera_unavailable',
            'creator_viewport_camera_info_invalid',
            'creator_viewport_vector_invalid',
            'creator_viewport_rect_invalid',
            'creator_viewport_number_invalid',
            'creator_camera_response_invalid',
        ]);
        const code = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
        return allowedCodes.has(code) ? code : 'creator_camera_query_failed';
    }

    /**
     * @description 以原生层级快照把每个目标唯一解析为UUID。
     */
    private async _resolveTargets(targets: readonly string[]): Promise<{ ok: true; uuids: readonly string[] } | { ok: false; failureCode: string }> {
        const scene = this._runtime.scene;
        if (scene == null) return { ok: false, failureCode: 'creator_scene_unavailable' };
        try {
            const nodes = await scene.getHierarchy();
            const uuids: string[] = [];
            for (const target of targets) {
                const matches = nodes.filter((node) => node.uuid === target || node.id === target || node.path === target);
                if (matches.length !== 1) return { ok: false, failureCode: matches.length === 0 ? 'viewport_target_not_found' : 'viewport_target_ambiguous' };
                const uuid = matches[0]?.uuid ?? matches[0]?.id;
                if (typeof uuid !== 'string' || uuid.length === 0) return { ok: false, failureCode: 'viewport_target_uuid_missing' };
                uuids.push(uuid);
            }
            return { ok: true, uuids };
        } catch { return { ok: false, failureCode: 'creator_hierarchy_query_failed' }; }
    }

    /**
     * @description 等待相机动画完成并读取最终状态。
     */
    private async _waitForCameraChange(before: IViewportCameraSnapshot | null): Promise<IViewportCameraSnapshot | null> {
        const deadline = Date.now() + 2500;
        let current: IViewportCameraSnapshot | null = null;
        while (Date.now() < deadline) {
            current = await this._readCamera().catch(() => null);
            if (current != null && before != null && !this._sameCamera(before, current)) return current;
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
        return current;
    }

    /**
     * @description 比较相机位置、朝向、中心与比例。
     */
    private _sameCamera(left: IViewportCameraSnapshot, right: IViewportCameraSnapshot): boolean {
        return JSON.stringify(left) === JSON.stringify(right);
    }

    /**
     * @description 检查并读取固定Creator版本。
     */
    private _version(): string { return this._runtime.version.getCurrentVersion().raw; }

    /**
     * @description 创建安全拒绝结果。
     */
    private _refused(creatorVersion: string, field: string, requested: unknown, failureCode: string): IViewportMutationResult {
        return { ok: false, status: 'refused', creatorVersion, fields: { [field]: { requested, accepted: false, verified: false, actual: null, failureCode } } };
    }

    /**
     * @description 校验相机向量并拷贝有限数字。
     */
    private _vector3(value: unknown): readonly [number, number, number] {
        if (typeof value !== 'object' || value == null) throw new Error('creator_camera_vector_invalid');
        const record = value as Record<string, unknown>;
        return [this._number(record.x), this._number(record.y), this._number(record.z)];
    }

    /**
     * @description 校验四元数并拷贝有限数字。
     */
    private _vector4(value: unknown): readonly [number, number, number, number] {
        if (typeof value !== 'object' || value == null) throw new Error('creator_camera_vector_invalid');
        const record = value as Record<string, unknown>;
        return [this._number(record.x), this._number(record.y), this._number(record.z), this._number(record.w)];
    }

    /**
     * @description 校验视口矩形。
     */
    private _rect(value: unknown): Readonly<{ x: number; y: number; width: number; height: number }> {
        if (typeof value !== 'object' || value == null) throw new Error('creator_camera_rect_invalid');
        const record = value as Record<string, unknown>;
        return { x: this._number(record.x), y: this._number(record.y), width: this._number(record.width), height: this._number(record.height) };
    }

    /**
     * @description 校验有限数值。
     */
    private _number(value: unknown): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('creator_camera_number_invalid');
        return value;
    }

    /**
     * @description 拒绝非空查询输入。
     */
    private _assertEmpty(input: ContractPayload | undefined): void {
        if (input != null && Object.keys(input).length > 0) throw new Error('viewport_query_input_invalid');
    }
}
