import { ComponentProjectUrlFiles } from './component-project-url-files.ts';

/**
 * @description 在认证观测后核对真实HTTP正文，再将项目文件配方转成公开URL输入。
 */
export class ComponentProjectUrlResolver {
    /**
     * @description 仅访问当前已验证probe端口的两条精确路由，不跟随重定向。
     * @param project 本任务隔离工程。
     * @param identity 候选及owner登记。
     * @param port 实际端点描述符端口。
     * @param result 认证probe返回结果。
     * @returns 真实字节验证后的有限URL清单。
     */
    public static async verify(project: string, identity: Readonly<Record<string, unknown>>, port: number, result: unknown) {
        const files = new ComponentProjectUrlFiles(project, identity); const expected = files.urls(port);
        const observed = this.record(result);
        if (['projectPath', 'owner', 'runId', 'candidateSourceCommit'].some(key => observed[key] !== identity[key]) ||
            JSON.stringify(observed.files) !== JSON.stringify(expected)) throw new Error('component_url_endpoint_identity_invalid');
        for (const file of expected) {
            const response = await fetch(file.url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
            if (response.status !== 200 || response.headers.get('content-type') !== file.mime ||
                ComponentProjectUrlFiles.hash(new Uint8Array(await response.arrayBuffer())) !== file.sha256)
                throw new Error('component_url_http_bytes_invalid');
        }
        return expected;
    }

    /**
     * @description 配方来源与摘要必须唯一吻合；写入令牌仅包含场景及精确夹具DB路径。
     * @param files 已核验HTTP正文的清单。
     * @param projectFile 冻结的原始项目文件配方。
     * @returns 公共输入与原生getter期望。
     */
    public static resolve(files: readonly { sourcePath: string; sha256: string; relativePath: string; url: string }[], projectFile: unknown) {
        const source = this.record(projectFile);
        const matches = files.filter(file => file.sourcePath === source.path && file.sha256 === source.sha256);
        const file = matches[0];
        if (matches.length !== 1 || !file) throw new Error('component_url_recipe_not_verified');
        return { input: file.url, expected: file.url, resources: [`db://${file.relativePath}`] };
    }

    /**
     * @description 将JSON观测限制为普通键值记录，避免宽泛类型断言。
     * @param value 未信任JSON。
     * @returns 普通对象副本。
     */
    private static record(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
    }
}
