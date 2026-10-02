import type { ITextFileIoLimits } from '@peanut/pod-protocol';
import type { ICoreMcpJsonSchema } from './core-cocos-mcp-read-tool-schema-catalog.js';

/**
 * @description 文本读写的容量默认值与公开 schema 单一来源；不依赖文件系统或协议运行时。
 */
export class CoreTextFileIoContract {
    /**
     * @description 默认每批 32 文件、每文件 1 MiB、完整编码请求及响应各 4 MiB；调用方应稳定分批。
     */
    public static readonly limits: ITextFileIoLimits = Object.freeze({
        maxFiles: 32,
        maxFileBytes: 1024 * 1024,
        maxInputBytes: 4 * 1024 * 1024,
        maxOutputBytes: 4 * 1024 * 1024,
    });

    /**
     * @description 生成 path 与 paths 严格二选一的输入；字节、真实路径和重复项由执行前守卫校验。
     * @param limits 调用方注入的容量配置；默认使用产品容量。
     * @returns 公开只读输入契约。
     */
    public static readInputSchema(limits: ITextFileIoLimits = this.limits): ICoreMcpJsonSchema {
        return {
            type: 'object',
            description: '读取 assets 内允许的 UTF-8 文本；默认每文件 1 MiB，完整请求和响应各 4 MiB。保留 BOM、换行与 Unicode，拒绝非法 UTF-8、二进制、.meta、Prefab、Scene。',
            properties: {
                path: { type: 'string', description: '单文件 assets/... 或 db://assets/... 路径；与 paths 严格二选一。' },
                paths: {
                    type: 'array',
                    description: '按输入顺序读取的路径列表；归一化后不得重复。超过容量时稳定分批，每批独立验收。',
                    minItems: 1,
                    maxItems: limits.maxFiles,
                    items: { type: 'string' },
                },
            },
            additionalProperties: false,
            oneOf: [
                { type: 'object', required: ['path'], additionalProperties: true },
                { type: 'object', required: ['paths'], additionalProperties: true },
            ],
        };
    }

    /**
     * @description 生成兼容 files 优先语义的写入业务字段；不改变审批和执行控制。
     * @param limits 调用方注入的容量配置；默认使用产品容量。
     * @returns 供 Core 与旧插件目录复用的业务字段。
     */
    public static writeProperties(limits: ITextFileIoLimits = this.limits): Readonly<Record<string, ICoreMcpJsonSchema>> {
        const path: ICoreMcpJsonSchema = { type: 'string', description: '目标 assets/... 或 db://assets/... 文本路径。' };
        const content: ICoreMcpJsonSchema = {
            type: 'string',
            description: '原样 UTF-8 内容；默认每文件最多 1 MiB，完整编码请求及响应各最多 4 MiB。禁止二进制、.meta、Prefab 和 Scene。',
        };
        const expectedSha256: ICoreMcpJsonSchema = {
            type: 'string',
            pattern: '^(?:[0-9a-fA-F]{64}|absent)(?![\\s\\S])',
            description: '可选写入前 SHA-256（64 位十六进制）或 absent；省略保持原行为，全批在首次写入前再次复核。',
        };
        return {
            path,
            content,
            expectedSha256,
            files: {
                type: 'array',
                description: '提供时优先并忽略单文件 path、content、expectedSha256；默认最多 32 项，每批独立验收。',
                minItems: 1,
                maxItems: limits.maxFiles,
                items: {
                    type: 'object',
                    properties: { path, content, expectedSha256 },
                    required: ['path', 'content'],
                    additionalProperties: false,
                },
            },
        };
    }

    /**
     * @description 公开有序逐文件结果，支持明确失败以及未取得稳定快照时的空版本。
     * @param limits 调用方注入的容量配置；默认使用产品容量。
     * @returns 需要一致快照和有序逐文件证据的输出契约。
     */
    public static readOutputSchema(limits: ITextFileIoLimits = this.limits): ICoreMcpJsonSchema {
        return {
            type: 'object',
            properties: {
                schemaVersion: { type: 'integer' },
                ok: { type: 'boolean' },
                consistent: { type: 'boolean' },
                revision: { type: ['integer', 'null'] },
                files: {
                    type: 'array',
                    minItems: 1,
                    maxItems: limits.maxFiles,
                    items: {
                        type: 'object',
                        additionalProperties: true,
                        oneOf: [
                            {
                                type: 'object',
                                properties: {
                                    path: { type: 'string' },
                                    status: { type: 'string', enum: ['read'] },
                                    content: { type: 'string' },
                                    byteCount: { type: 'integer' },
                                    sha256: { type: 'string', pattern: '^[0-9a-f]{64}(?![\\s\\S])' },
                                    revision: { type: 'integer' },
                                },
                                required: ['path', 'status', 'content', 'byteCount', 'sha256', 'revision'],
                                additionalProperties: false,
                            },
                            {
                                type: 'object',
                                properties: {
                                    path: { type: 'string' },
                                    status: { type: 'string', enum: ['failed'] },
                                    code: { type: 'string' },
                                },
                                required: ['path', 'status', 'code'],
                                additionalProperties: false,
                            },
                        ],
                    },
                },
            },
            required: ['schemaVersion', 'ok', 'consistent', 'revision', 'files'],
            additionalProperties: false,
        };
    }
}
