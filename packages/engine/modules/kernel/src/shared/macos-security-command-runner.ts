import { execFile } from 'child_process';

/**
 * @description macOS `security` 命令的最小可替换执行端口。
 */
export interface IMacOsKeychainCommandRunner {
    /**
     * @description 运行不含 shell 的 `security` 子命令。
     * @param argumentsValue 已验证的命令参数。
     * @returns 命令退出码和标准输出；不得将密钥内容写入日志。
     */
    run(argumentsValue: readonly string[]): Promise<{ readonly exitCode: number; readonly stdout: string }>;
}

/**
 * @description 不经 shell 调用 macOS `/usr/bin/security` 的生产命令运行器。
 */
export class MacOsSecurityCommandRunner implements IMacOsKeychainCommandRunner {
    /**
     * @description 运行 macOS security 子命令；失败时仅返回状态码，不回传 stderr 以免泄露敏感输出。
     * @param argumentsValue 已验证命令参数。
     * @returns 命令退出码与标准输出。
     */
    public async run(argumentsValue: readonly string[]): Promise<{ readonly exitCode: number; readonly stdout: string }> {
        return new Promise((resolve) => {
            execFile('/usr/bin/security', [...argumentsValue], { encoding: 'utf8', maxBuffer: 8_192 }, (error, stdout) => {
                resolve(
                    error == null
                        ? Object.freeze({ exitCode: 0, stdout })
                        : Object.freeze({ exitCode: MacOsSecurityCommandRunner._exitCode(error), stdout: '' }),
                );
            });
        });
    }

    /**
     * @description 从 child-process 异常安全提取有限退出码。
     * @param value 未信任异常。
     * @returns 非零退出码。
     */
    private static _exitCode(value: unknown): number {
        if (typeof value !== 'object' || value == null) {
            return 1;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, 'code');
        return descriptor != null && 'value' in descriptor && typeof descriptor.value === 'number' && Number.isInteger(descriptor.value)
            ? descriptor.value
            : 1;
    }
}
