import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * @description 只暴露任务5.1两份非敏感夹具的真实字节，不提供任意路径或目录服务。
 */
export class ComponentProjectUrlFiles {
    /**
     * @description 固定来源与响应类型；不能从请求或磁盘清单扩展。
     */
    private static readonly _sources = [
        { path: 'tests/fixtures/editor-stability/media/assets/video/blue.mp4', mime: 'video/mp4', extension: '.mp4' },
        { path: 'tests/fixtures/editor-stability/components/fixtures/web/index.html', mime: 'text/html; charset=utf-8', extension: '.html' },
    ];
    /**
     * @description 当前工程已核对的精确两份清单。
     */
    public readonly rows: readonly { sourcePath: string; relativePath: string; sha256: string; mime: string; route: string }[];

    /**
     * @description 将清单绑定工程、owner、run与候选；文件替换仍在每次读取时检查。
     * @param project 真实工程目录。
     * @param identity 本任务工程登记。
     */
    public constructor(private readonly project: string, identity: Readonly<Record<string, unknown>>) {
        const manifest = JSON.parse(readFileSync(join(project, 'extensions/peanut-component-probe/project-url-files.json'), 'utf8'));
        if (identity.projectPath !== realpathSync(project) ||
            ['projectPath', 'owner', 'runId', 'candidateSourceCommit'].some(key => manifest[key] !== identity[key]) ||
            !Array.isArray(manifest.rows) || manifest.rows.length !== 2) throw new Error('component_url_manifest_identity_invalid');
        this.rows = ComponentProjectUrlFiles._sources.map((source, index) => {
            const row = manifest.rows[index];
            const relativePath = `assets/fixtures/${source.path.slice('tests/fixtures/editor-stability/'.length)}`;
            if (!row || row.sourcePath !== source.path || row.relativePath !== relativePath || row.mime !== source.mime ||
                typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sha256) ||
                row.route !== `/task51-fixtures/${row.sha256}${source.extension}`) throw new Error('component_url_manifest_row_invalid');
            return { sourcePath: source.path, relativePath, sha256: row.sha256, mime: source.mime, route: row.route };
        });
        this.rows.forEach(row => this.bytes(row));
    }

    /**
     * @description 仅暂存固定源；已有视频副本必须字节相同，禁止覆盖或跟随符号链接。
     * @param root 当前工作树。
     * @param project 新隔离工程。
     * @param identity 工程登记。
     */
    public static stage(root: string, project: string, identity: Readonly<Record<string, unknown>>): void {
        if (realpathSync(root) !== root || realpathSync(project) !== project || identity.projectPath !== project)
            throw new Error('component_url_stage_identity_invalid');
        const rows = this._sources.map(source => {
            const original = join(root, source.path);
            if (realpathSync(original) !== original) throw new Error('component_url_source_link');
            const bytes = readFileSync(original); const sha256 = this.hash(bytes);
            const relativePath = `assets/fixtures/${source.path.slice('tests/fixtures/editor-stability/'.length)}`;
            const destination = join(project, relativePath); this.prepareDirectory(dirname(destination));
            if (existsSync(destination)) {
                if (realpathSync(destination) !== destination || this.hash(readFileSync(destination)) !== sha256)
                    throw new Error('component_url_staged_bytes_changed');
            } else writeFileSync(destination, bytes, { flag: 'wx' });
            return { sourcePath: source.path, relativePath, sha256, mime: source.mime,
                route: `/task51-fixtures/${sha256}${source.extension}` };
        });
        this.prepareDirectory(join(project, 'extensions/peanut-component-probe'));
        writeFileSync(join(project, 'extensions/peanut-component-probe/project-url-files.json'), JSON.stringify({
            projectPath: identity.projectPath, owner: identity.owner, runId: identity.runId,
            candidateSourceCommit: identity.candidateSourceCommit, rows,
        }, null, 2) + '\n', { flag: 'wx' });
    }

    /**
     * @description 固定夹具路由支持GET/HEAD及单段字节范围；认证观测路由交回原处理器。
     * @param request 本机HTTP请求。
     * @param response 原服务响应。
     * @returns 是否已处理固定夹具路由。
     */
    public serve(request: IncomingMessage, response: ServerResponse): boolean {
        if (!request.url?.startsWith('/task51-fixtures/')) return false;
        const row = this.rows.find(item => item.route === request.url);
        if (!row) { response.writeHead(404); response.end(); return true; }
        if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405, { allow: 'GET, HEAD' }); response.end(); return true; }
        let bytes: Buffer;
        try { bytes = this.bytes(row); }
        catch { response.writeHead(503); response.end(); return true; }
        response.setHeader('content-type', row.mime); response.setHeader('cache-control', 'no-store');
        response.setHeader('x-content-type-options', 'nosniff'); response.setHeader('access-control-allow-origin', '*');
        // 只允许已通过整文件SHA验证的HTML中精确style字节；脚本、外部资源和任意内联样式仍禁止。
        const styles = row.mime.startsWith('text/html') ? [...bytes.toString('utf8').matchAll(/<style>([\s\S]*?)<\/style>/gu)] : [];
        const hashes = styles.map(match => "'sha256-" + createHash('sha256').update(match[1] ?? '').digest('base64') + "'");
        response.setHeader('content-security-policy', "default-src 'none'; " +
            (hashes.length ? 'style-src ' + hashes.join(' ') + '; ' : '') + "base-uri 'none'; form-action 'none'; sandbox");
        response.setHeader('accept-ranges', 'bytes');
        let start = 0; let end = bytes.length - 1;
        const range = request.headers.range;
        if (range !== undefined) {
            const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
            const from = match?.[1] ?? ''; const to = match?.[2] ?? '';
            if (from) { start = Number(from); end = to ? Number(to) : end; }
            else if (to) start = Math.max(0, bytes.length - Number(to));
            if (!match || !from && !to || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
                !from && (!Number.isSafeInteger(Number(to)) || Number(to) <= 0) || start < 0 || start >= bytes.length || end < start) {
                response.writeHead(416, { 'content-range': `bytes */${bytes.length}` }); response.end(); return true;
            }
            end = Math.min(end, bytes.length - 1);
            response.statusCode = 206; response.setHeader('content-range', `bytes ${start}-${end}/${bytes.length}`);
        }
        response.setHeader('content-length', end - start + 1);
        response.end(request.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1)); return true;
    }

    /**
     * @description 从已监听的同一socket生成真实回环URL，逐次重验两份文件身份。
     * @param port 实际服务端口。
     * @returns 精确来源、字节摘要、令牌资源及URL。
     */
    public urls(port: number) {
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('component_url_port_invalid');
        return this.rows.map(row => { this.bytes(row); return { ...row, url: `http://127.0.0.1:${port}${row.route}` }; });
    }

    /**
     * @description 文件每次必须仍为精确工程内路径且摘要不变，拒绝链接或替换。
     * @param row 已核对的固定清单项。
     * @returns 真实完整文件字节。
     */
    private bytes(row: { relativePath: string; sha256: string }): Buffer {
        const absolute = join(this.project, row.relativePath);
        if (realpathSync(absolute) !== absolute) throw new Error('component_url_file_link');
        const bytes = readFileSync(absolute);
        if (ComponentProjectUrlFiles.hash(bytes) !== row.sha256) throw new Error('component_url_bytes_changed');
        return bytes;
    }

    /**
     * @description 创建目录前先检查最近的已有祖先，禁止先沿链接在工程外创建目录。
     * @param directory 固定工程内目标目录。
     */
    private static prepareDirectory(directory: string): void {
        let existing = directory;
        while (!existsSync(existing)) existing = dirname(existing);
        if (realpathSync(existing) !== existing) throw new Error('component_url_destination_link');
        mkdirSync(directory, { recursive: true });
    }

    /**
     * @description 使用相同SHA-256核对来源、副本与HTTP正文。
     * @param bytes 真实文件字节。
     * @returns 十六进制摘要。
     */
    public static hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
}
