import type { ICreatorContext } from '@peanut/pod-protocol';

import { CoreCocosMcpCapabilityCatalog } from './core-cocos-mcp-capability-catalog.js';
import { CoreCocosNativeWriteCapabilityCatalog } from './core-cocos-native-write-capability-catalog.js';
import type { CoreCocosMcpPublicOperation } from './core-cocos-mcp-tool-name-resolver.js';

/**
 * @description Creator 上下文中单项 Lite 操作的执行状态。
 */
export type CreatorOperationAvailability = 'available' | 'read_only' | 'write' | 'refused';

/**
 * @description 一项 Creator 操作的版本能力矩阵记录。
 */
export interface ICreatorOperationAvailabilityEntry {
    /**
     * @description Lite 公开操作标识。
     */
    readonly operation: CoreCocosMcpPublicOperation;

    /**
     * @description 当前可信 Creator 上下文中的状态。
     */
    readonly availability: CreatorOperationAvailability;
}

/**
 * @description 从可信 Creator 上下文生成完整 Lite 操作能力矩阵。
 */
export class CreatorOperationAvailabilityMatrix {
    /**
     * @description 生成全部 83 项操作的状态。
     * @param context 宿主解析后的可信 Creator 上下文
     * @returns 与公开目录一一对应的不可变矩阵
     */
    public static list(context: ICreatorContext): readonly ICreatorOperationAvailabilityEntry[] {
        const readEntries = CoreCocosMcpCapabilityCatalog.list().map((capability) =>
            Object.freeze({
                operation: capability.operation,
                availability: CreatorOperationAvailabilityMatrix._readAvailability(context),
            }),
        );
        const writeEntries = CoreCocosNativeWriteCapabilityCatalog.list().map((capability) =>
            Object.freeze({
                operation: capability.operation,
                availability: CreatorOperationAvailabilityMatrix._writeAvailability(context),
            }),
        );
        return Object.freeze([...readEntries, ...writeEntries]);
    }

    /**
     * @description 解析只读操作状态。
     * @param context Creator 上下文
     * @returns 可用或拒绝
     */
    private static _readAvailability(context: ICreatorContext): CreatorOperationAvailability {
        return context.support === 'unsupported' ? 'refused' : 'available';
    }

    /**
     * @description 解析写操作状态。
     * @param context Creator 上下文
     * @returns 可写、只读降级或拒绝
     */
    private static _writeAvailability(context: ICreatorContext): CreatorOperationAvailability {
        if (context.support === 'unsupported') {
            return 'refused';
        }
        return context.writesAllowed ? 'write' : 'read_only';
    }
}
