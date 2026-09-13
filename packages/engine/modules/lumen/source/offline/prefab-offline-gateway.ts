import { writeFileSync } from 'fs';
import { join } from 'path';

import { CocosUuidCodec } from '@peanut/pod-engine/assets';

import { LumenPrefabDocument } from '../hierarchy/prefab-document';
import { OfflinePrefabControllerBinder } from './offline-prefab-controller-binder';

/** @description 离线控制器绑定 MCP 入参。 */
export interface IPrefabBindScriptMcpInput {
    readonly prefabRelativePath: string;
    readonly scriptRelativePath: string;
    readonly className: string;
    readonly propertyBindings: Readonly<Record<string, string>>;
    readonly propertyComponents?: Readonly<Record<string, string>>;
    readonly buttonEvents?: readonly Readonly<{
        readonly nodeName: string;
        readonly nodePath?: string;
        readonly handler: string;
        readonly customEventData?: string;
    }>[];
}

/**
 * @description 离线改写 Prefab 文件以绑定同名控制器脚本（3.x lumen 消化面）。
 */
export class LumenPrefabOfflineGateway {
    /**
     * @description 在 Prefab 源文件上绑定控制器脚本与点击事件。
     * @param projectRoot Creator 项目绝对路径
     * @param input 绑定入参
     * @param resolveScriptUuid 按脚本相对路径查询 Asset UUID
     * @returns 绑定摘要
     */
    public async bindScriptInPrefab(
        projectRoot: string,
        input: IPrefabBindScriptMcpInput,
        resolveScriptUuid: (scriptRelativePath: string) => Promise<string | undefined>,
    ): Promise<Record<string, unknown>> {
        const prefabRelativePath = readNonEmptyString(input.prefabRelativePath, 'prefabRelativePath');
        const scriptRelativePath = readNonEmptyString(input.scriptRelativePath, 'scriptRelativePath');
        const className = readNonEmptyString(input.className, 'className');
        const scriptUuid = await resolveScriptUuid(scriptRelativePath);
        if (scriptUuid == null) {
            throw new Error(`editor_mcp_bind_script_not_found:${scriptRelativePath}`);
        }
        const prefabAbsolutePath = join(projectRoot, prefabRelativePath);
        const document = LumenPrefabDocument.open(projectRoot, prefabRelativePath);
        const bound = OfflinePrefabControllerBinder.bind(document, {
            compressedUuid: new CocosUuidCodec().compress(scriptUuid),
            className,
            propertyBindings: input.propertyBindings ?? {},
            propertyComponents: input.propertyComponents,
            buttonEvents: (input.buttonEvents ?? []).map((event) => ({
                nodeName: event.nodeName,
                nodePath: event.nodePath,
                handler: event.handler,
                customEventData: event.customEventData,
            })),
        });
        writeFileSync(prefabAbsolutePath, `${JSON.stringify(document.entries, null, 2)}\n`, 'utf8');
        return {
            prefabRelativePath,
            scriptRelativePath,
            className,
            rootPath: bound.rootPath,
            bound: bound.bound,
            buttonEvents: {
                bound: bound.boundButtons,
                notFound: bound.notFound.filter((value) => value.includes(':')),
            },
            notFound: bound.notFound.filter((value) => !value.includes(':')),
            ambiguous: bound.ambiguous,
            degraded: bound.degraded,
            method: 'lumen-offline',
        };
    }
}

/**
 * @description 以同一实现导出兼容旧名，避免为别名创建无职责子类。
 */
export { LumenPrefabOfflineGateway as EditorMcpPrefabOfflineGateway };

/**
 * @description 读取非空字符串字段。
 * @param value 未校验值
 * @param field 字段名
 * @returns 去空白字符串
 */
function readNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`editor_mcp_bind_${field}_required`);
    }
    return value.trim().replace(/\\/g, '/');
}
