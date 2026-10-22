import type { ContractPayload, EditorMcpOperationId } from '@peanut/pod-protocol';
import { ProjectLogDiagnostics } from '@peanut/pod-engine/runtime';

import type { EditorMcpPreviewGateway } from './editor-mcp-preview-gateway.js';

/**
 * @description 复用原预览入口并隔离通用日志观测，不改变写后验收语义。
 */
export class EditorMcpObservationGateway {
    /**
     * @description 原有预览网关。
     */
    private readonly _preview: EditorMcpPreviewGateway;
    /**
     * @description 由当前runtime提供的工程根解析器。
     */
    private readonly _projectRoot: () => Promise<string>;
    /**
     * @description 当前宿主的有界日志读取器。
     */
    private readonly _logs = new ProjectLogDiagnostics();

    /**
     * @description 注入原有预览能力与已授权工程路径。
     * @param preview 既有网关。
     * @param projectRoot 已授权的工程解析器。
     */
    public constructor(preview: EditorMcpPreviewGateway, projectRoot: () => Promise<string>) {
        this._preview = preview;
        this._projectRoot = projectRoot;
    }

    /**
     * @description 在计划执行前校验观测或原预览刷新输入。
     * @param operation 稳定操作标识。
     * @param input 不可信输入。
     * @returns 无返回值。
     */
    public validate(operation: EditorMcpOperationId, input: ContractPayload | undefined): void {
        switch (operation) {
            case 'diagnostics.queryLogs': this._logs.readInput(input); return;
            case 'preview.query': this._preview.readQueryInput(input); return;
            case 'preview.queryErrors': this._preview.readErrorsInput(input); return;
            case 'preview.refresh': this._preview.readRefreshInput(input); return;
            default: throw new Error('editor_mcp_observation_operation_invalid');
        }
    }

    /**
     * @description 仅分发明确操作，预览刷新仍由外层受管写入路径控制。
     * @param operation 稳定操作。
     * @param input 不可信输入。
     * @returns 原接口结果或日志观测结果。
     */
    public async execute(operation: EditorMcpOperationId, input: ContractPayload | undefined): Promise<unknown> {
        switch (operation) {
            case 'diagnostics.queryLogs': return this._logs.query(await this._projectRoot(), this._logs.readInput(input));
            case 'preview.query': return this._preview.query(this._preview.readQueryInput(input));
            case 'preview.queryErrors': return this._preview.queryErrors(this._preview.readErrorsInput(input));
            case 'preview.refresh': return this._preview.refresh(this._preview.readRefreshInput(input));
            default: throw new Error('editor_mcp_observation_operation_invalid');
        }
    }
}
