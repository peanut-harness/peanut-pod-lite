import type { IEditorMcpAssetDbCreationFailureEvidence } from './editor-mcp-asset-db-creation-coordinator.js';

/**
 * @description 带 allow-list 创建失败证据的错误。
 */
export class EditorMcpAssetDbCreationError extends Error {
    /**
     * @description 结构化失败证据。
     */
    public readonly evidence: IEditorMcpAssetDbCreationFailureEvidence;

    /**
     * @description 创建错误。
     * @param message 稳定错误码。
     * @param evidence 安全失败证据。
     */
    public constructor(message: string, evidence: IEditorMcpAssetDbCreationFailureEvidence) {
        super(message);
        this.name = 'EditorMcpAssetDbCreationError';
        this.evidence = evidence;
    }
}
