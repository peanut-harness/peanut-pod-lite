import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CocosMcpHub } from '../src/mcp/cocos-mcp-hub.js';
import { PluginManagerApp } from '../src/app/plugin-manager-app.js';
import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';
import { RuntimeFacade } from '@peanut/pod-engine/runtime';

/**
 * @description 真实 HTTP 回执只保留公开状态和原 JSON，绝不返回认证 token。
 */
interface IHttpBodyResult {
    /**
     * @description 实际 HTTP 状态码。
     */
    readonly status: number | undefined;
    /**
     * @description 原 JSON 回执，使用前按公开字段缩窄。
     */
    readonly body: unknown;
}

/**
 * @description 使用真实 Hub、Runtime 与 PluginManager 验证传输拒绝，不注册模拟业务 handler。
 */
class ActualHttpFixture {
    /**
     * @description 当前进程自有的临时工程。
     */
    private readonly _project = mkdtempSync(join(tmpdir(), 'peanut-borrowed-http-'));
    /**
     * @description 实际运行时及其插件治理对象，不替换方法或 IPC。
     */
    private readonly _manager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    /**
     * @description 当前真实本机服务。
     */
    private readonly _hub = new CocosMcpHub(() => this._manager, { projectPath: this._project, port: 0 });
    /**
     * @description start 后读取的本机端口。
     */
    private _port: number | null = null;
    /**
     * @description 仅在测试进程内使用的公开描述认证 token。
     */
    private _token: string | null = null;

    /**
     * @description 绑定真实服务并核对实际监听所有者。
     * @returns 服务已就绪。
     */
    public async start(): Promise<void> {
        mkdirSync(join(this._project, 'temp/logs'), { recursive: true });
        await this._hub.start();
        const descriptor: unknown = JSON.parse(readFileSync(join(this._project, '.peanut-ai/cocos-mcp.json'), 'utf8'));
        assert.ok(typeof descriptor === 'object' && descriptor != null);
        const token: unknown = Reflect.get(descriptor, 'token');
        const port = this._hub.getPort();
        assert.ok(typeof token === 'string' && typeof port === 'number');
        this._token = token;
        this._port = port;
        this._assertListener();
        console.log('owned_real_HTTP_started', JSON.stringify({ pid: process.pid, port, project: this._project }));
    }

    /**
     * @description 发送真实认证请求；分块与固定长度都保持完整原 bytes。
     * @param bytes 本次完整编码输入。
     * @param chunked 是否省略 Content-Length 并分块发送。
     * @returns 原有界 HTTP JSON 回执。
     */
    public post(bytes: Buffer, chunked: boolean): Promise<IHttpBodyResult> {
        this._assertListener();
        const token = this._token;
        const port = this._port;
        assert.ok(typeof token === 'string' && typeof port === 'number');
        return new Promise((resolve, reject) => {
            const request = httpRequest({
                hostname: '127.0.0.1', port, path: '/mcp', method: 'POST',
                headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': token, ...(!chunked ? { 'content-length': bytes.length } : {}) },
            }, response => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('end', () => {
                    try {
                        const raw = Buffer.concat(chunks);
                        assert.ok(raw.length < 65536);
                        const body: unknown = JSON.parse(raw.toString('utf8'));
                        resolve({ status: response.statusCode, body });
                    } catch (error: unknown) {
                        reject(error);
                    }
                });
                response.on('error', reject);
            });
            request.on('error', reject);
            request.setTimeout(5000, () => request.destroy(new Error('owned_real_HTTP_response_timeout')));
            if (chunked) {
                for (let index = 0; index < bytes.length; index += 65536) {
                    request.write(bytes.subarray(index, index + 65536));
                }
                request.end();
            } else {
                request.end(bytes);
            }
        });
    }

    /**
     * @description 正常停止服务并独立核对端口闭合，不通过信号清理服务。
     * @returns 服务及临时工程已结束。
     */
    public async stop(): Promise<void> {
        const port = this._port;
        try {
            await this._hub.stop();
            if (port != null) {
                await new Promise<void>((resolve, reject) => {
                    const client = createConnection({ host: '127.0.0.1', port });
                    client.once('connect', () => {
                        client.destroy();
                        reject(new Error('owned HTTP listener remained after normal stop'));
                    });
                    client.once('error', (error: Error) => {
                        if (Reflect.get(error, 'code') === 'ECONNREFUSED') {
                            resolve();
                        } else {
                            reject(error);
                        }
                    });
                    client.setTimeout(1000, () => client.destroy(new Error('owned_HTTP_close_probe_timeout')));
                });
            }
            console.log('owned_real_HTTP_closed', JSON.stringify({ pid: process.pid, port, normalStop: true, signals: 0 }));
        } finally {
            rmSync(this._project, { recursive: true, force: true });
        }
    }

    /**
     * @description 核对监听属于当前测试进程，且只位于回环地址。
     * @returns 无返回值。
     */
    private _assertListener(): void {
        const port = this._port;
        assert.ok(typeof port === 'number');
        assert.equal(this._hub.getPort(), port);
        // macOS 的独立 OS owner 核验只适用于本机；其它平台仍执行真实服务、认证与 TCP closure 全部断言。
        if (process.platform !== 'darwin') {
            return;
        }
        const output = execFileSync('/usr/sbin/lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-Fpcn'], { encoding: 'utf8' });
        const owners = [...output.matchAll(/^p(\d+)$/gm)].map(value => Number(value[1]));
        assert.ok(owners.length > 0 && owners.every(value => value === process.pid));
        assert.ok(output.split('\n').filter(value => value.startsWith('n')).every(value => /^n(?:127\.0\.0\.1|\[::1\]):/u.test(value)));
    }

    /**
     * @description 创建完整字节边界输入，正文与补齐字节都属于真实 HTTP request。
     * @param bytes 目标完整编码字节数。
     * @param name 实际公开工具名。
     * @returns 精确大小的合法 UTF-8 JSON 输入。
     */
    public static body(bytes: number, name = 'peanut.editor-mcp.asset-read-text'): Buffer {
        const prefix = Buffer.from(JSON.stringify({ action: 'call', name, connectionId: 'a'.repeat(32), input: { path: 'assets/owned-雪😀.json' } }));
        assert.ok(bytes >= prefix.length);
        return Buffer.concat([prefix, Buffer.alloc(bytes - prefix.length, 32)]);
    }

    /**
     * @description 验证原安全拒绝，不将原 client Error 字符串当 native 回执。
     * @param result 实际 HTTP 回执。
     * @param code 原稳定错误码或能力不可用前缀。
     * @returns 无返回值。
     */
    public static refusal(result: IHttpBodyResult, code: string): void {
        assert.equal(result.status, 400);
        const body = result.body;
        assert.ok(typeof body === 'object' && body != null);
        assert.equal(Reflect.get(body, 'ok'), false);
        const error: unknown = Reflect.get(body, 'error');
        assert.ok(typeof error === 'string');
        if (code === 'mcp_capability_unavailable') {
            assert.ok(error.startsWith(code));
        } else {
            assert.equal(error, code);
        }
        assert.equal(Reflect.get(body, 'result'), undefined);
    }
}

test('real HTTP full4MiB text bytes reach original unregistered capability refusal', async (): Promise<void> => {
    const fixture = new ActualHttpFixture();
    try {
        await fixture.start();
        ActualHttpFixture.refusal(await fixture.post(ActualHttpFixture.body(CoreTextFileIoContract.limits.maxInputBytes), false), 'mcp_capability_unavailable');
    } finally {
        await fixture.stop();
    }
});

test('real HTTP fixed Content-Length 4MiB+1 returns the original capacity refusal', async (): Promise<void> => {
    const fixture = new ActualHttpFixture();
    try {
        await fixture.start();
        ActualHttpFixture.refusal(await fixture.post(ActualHttpFixture.body(CoreTextFileIoContract.limits.maxInputBytes + 1), false), 'cocos_mcp_hub_request_too_large');
    } finally {
        await fixture.stop();
    }
});

test('real HTTP chunked 4MiB+16KiB returns the original capacity refusal', async (): Promise<void> => {
    const fixture = new ActualHttpFixture();
    try {
        await fixture.start();
        ActualHttpFixture.refusal(await fixture.post(ActualHttpFixture.body(CoreTextFileIoContract.limits.maxInputBytes + 16384), true), 'cocos_mcp_hub_request_too_large');
    } finally {
        await fixture.stop();
    }
});

test('real HTTP malformed UTF8 returns the original payload refusal', async (): Promise<void> => {
    const fixture = new ActualHttpFixture();
    try {
        await fixture.start();
        const bytes = Buffer.concat([Buffer.from('{"path":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
        ActualHttpFixture.refusal(await fixture.post(bytes, true), 'cocos_mcp_hub_payload_invalid');
    } finally {
        await fixture.stop();
    }
});

test('real HTTP non-text capability keeps the original 128KiB limit', async (): Promise<void> => {
    const fixture = new ActualHttpFixture();
    try {
        await fixture.start();
        ActualHttpFixture.refusal(await fixture.post(ActualHttpFixture.body(128 * 1024 + 1, 'peanut.example.inspect'), false), 'cocos_mcp_hub_request_too_large');
    } finally {
        await fixture.stop();
    }
});
