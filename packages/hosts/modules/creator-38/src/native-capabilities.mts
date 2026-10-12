import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { NativeCapabilityRegistry } from '@peanut/pod-engine/kernel';

/**
 * @description 从宿主发行包装配可选原生能力，保持能力注册与业务插件解耦。
 */
export class HostNativeCapabilities {
    /**
     * @description 实际使用时仍由注册表验证签名与文件摘要。
     * @param extensionRoot 当前 Creator 扩展发行包根目录
     * @returns 缺失载荷时保留默认的无原生能力注册表
     */
    public static createRegistry(extensionRoot: string): NativeCapabilityRegistry | undefined {
        // 只读取当前受校验宿主发行包内的可选能力目录。
        const capabilityRoot = resolve(extensionRoot, 'native-capabilities');
        if (!existsSync(capabilityRoot)) return undefined;
        // 公钥由宿主发行包携带，缺失时由能力验证器明确拒绝。
        const publicKeyPath = resolve(capabilityRoot, 'public-key.pem');
        const publicKey = existsSync(publicKeyPath) ? readFileSync(publicKeyPath, 'utf8') : undefined;
        return new NativeCapabilityRegistry(capabilityRoot, publicKey);
    }
}
