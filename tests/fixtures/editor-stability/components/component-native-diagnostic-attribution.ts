import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * @description 仅对未变化原工程的精确启动命名警告记录有界归因；完整原始诊断永不删除。
 */
export class ComponentNativeDiagnosticAttribution {
    /**
     * @description 根据版本化SDK身份、工程前像及完整日志句式推断命名规则来源，不覆盖其他诊断门禁。
     * @param raw 完整原始通道扫描结果。
     * @param project 当前已登记工程。
     * @param version 当前实际Creator版本。
     * @param baseline 原工程清单的已验证备份字节。
     * @param current 当前工程清单字节。
     * @param sdkManifest 当前精确版本的SDK清单字节。
     * @returns 原始诊断、归因依据和独立Pod前置判定；不声称环境零诊断。
     */
    public static classify(raw: { newErrors: readonly string[]; newWarnings: readonly string[] }, project: string,
        version: string, baseline: Uint8Array, current: Uint8Array, sdkManifest: Uint8Array) {
        const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
        let projectName: unknown;
        try {
            const manifest: unknown = JSON.parse(Buffer.from(current).toString('utf8'));
            if (manifest && typeof manifest === 'object' && 'name' in manifest) projectName = manifest.name;
        } catch { /* Unknown manifests retain the original blocking decision. */ }
        const inputVerified = version === '3.8.7' && sha(baseline) === sha(current)
            && sha(sdkManifest) === '14f5c51d349123656acd76652a03468f754a76df12874e61b176b2d8419926cf'
            && typeof projectName === 'string' && projectName.length > 0 && !/^[A-Za-z0-9_-]+$/u.test(projectName)
            && !/[\r\n]/u.test(projectName);
        const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const message = `The provided project name ${JSON.stringify(projectName)} is not suitable for use as an executable name. 'CocosGame' is applied instead.`;
        const pattern = new RegExp('^' + escape(join(project, 'temp/logs/project.log'))
            + ': \\d{2}-\\d{2}-\\d{4} \\d{2}:\\d{2}:\\d{2} - warn: ' + escape(message) + '$', 'u');
        const onlyNamingWarning = inputVerified && raw.newErrors.length === 0 && raw.newWarnings.length === 1
            && pattern.test(raw.newWarnings[0] ?? '');
        return { raw, podPreflightMayContinue: onlyNamingWarning || raw.newErrors.length + raw.newWarnings.length === 0,
            attribution: onlyNamingWarning ? 'creator-project-name-rule-inferred' : 'not-classified',
            proof: onlyNamingWarning ? { creatorVersion: version, manifestSha256: sha(current), sdkManifestSha256: sha(sdkManifest),
                officialRule: 'https://docs.cocos.com/creator/3.8/manual/en/editor/publish/mac/build-options-mac.html',
                limitation: '版本化SDK身份、未变工程名和实际启动日志支持该推断；未取得Creator闭源命名实现的直接调用栈。' } : null,
            zeroDiagnosticsClaimed: false };
    }
}
