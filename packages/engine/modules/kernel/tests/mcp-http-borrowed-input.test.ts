import assert from 'node:assert/strict';
import test from 'node:test';

import { McpHubInvocationContext } from '../src/mcp/mcp-hub-control.js';
import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';

/**
 * @description 只提供 body reader 的借用输入，记录协议消费与所有者结束动作；不模拟原生或业务执行器。
 */
class BorrowedInputFixture {
    /**
     * @description 测试输入按真实读取次序提供，不改变其错误对象。
     */
    private readonly _chunks: readonly unknown[];
    /**
     * @description 可选原始读取错误，只供错误身份控制。
     */
    private readonly _failure: Error | null;
    /**
     * @description next 已消费的项数。
     */
    private _nextCount = 0;
    /**
     * @description 输入所有者的 return 调用计数。
     */
    private _returnCount = 0;

    /**
     * @description 建立独立借用输入；不创建 HTTP、文件、任务或 native 控制。
     * @param chunks 有序输入分块。
     * @param failure 下一次读取需要直接传播的原错误。
     */
    public constructor(chunks: readonly unknown[], failure: Error | null = null) {
        this._chunks = chunks;
        this._failure = failure;
    }

    /**
     * @description 只让 reader 读取，结束权仍属于 fixture 所有者。
     * @returns 具有可观察 next/return 的借用协议输入。
     */
    public input(): AsyncIterable<unknown> {
        return {
            [Symbol.asyncIterator]: (): AsyncIterator<unknown> => ({
                next: () => this._next(),
                return: () => this._return(),
            }),
        };
    }

    /**
     * @description 读取已发生的协议动作，不更改 reader 的观测。
     * @returns 当前 next 和 return 次数。
     */
    public counts(): Readonly<{ next: number; returned: number }> {
        return { next: this._nextCount, returned: this._returnCount };
    }

    /**
     * @description 仅由输入所有者显式结束输入。
     * @returns 所有者正常结束回执。
     */
    public close(): Promise<IteratorResult<unknown>> {
        return this._return();
    }

    /**
     * @description 读取下一输入；失败直接保留原对象。
     * @returns 原分块或真实已读完状态。
     */
    private async _next(): Promise<IteratorResult<unknown>> {
        const index = this._nextCount++;
        if (this._failure != null) {
            throw this._failure;
        }
        return index < this._chunks.length
            ? { value: this._chunks[index], done: false }
            : { value: undefined, done: true };
    }

    /**
     * @description 结束动作由输入所有者统计，不能被 reader 的错误早退触发。
     * @returns 真实结束协议状态。
     */
    private async _return(): Promise<IteratorResult<unknown>> {
        this._returnCount += 1;
        return { value: undefined, done: true };
    }
}

/**
 * @description 建立真实 payload reader，任何与 body 无关的业务访问立即失败。
 */
class PayloadReaderFixture {
    /**
     * @description 只测试真实 parser；能力、writer、revision 不在这些输入控制中执行。
     * @returns 当前生产 reader。
     */
    public static create(): McpHubInvocationContext {
        return new McpHubInvocationContext(
            () => { throw new Error('unexpected_capability_lookup'); },
            async () => { throw new Error('unexpected_capability_execution'); },
            () => '/owned-offline-body-reader',
            () => ({ revision: 0, activeWriters: 0 }),
            async () => {},
            () => {},
        );
    }
}

test('borrowed input oversized rejection leaves return to its owner and reads no later chunk', async (): Promise<void> => {
    const input = new BorrowedInputFixture([Buffer.alloc(CoreTextFileIoContract.limits.maxInputBytes + 1), Buffer.from('not-consumed')]);
    await assert.rejects(PayloadReaderFixture.create().readPayload(input.input()), /cocos_mcp_hub_request_too_large/u);
    assert.deepEqual(input.counts(), { next: 1, returned: 0 });
    await input.close();
    assert.deepEqual(input.counts(), { next: 1, returned: 1 });
});

test('borrowed input invalid chunk leaves return to its owner without an alias replay', async (): Promise<void> => {
    const input = new BorrowedInputFixture([42, Buffer.from('not-consumed')]);
    await assert.rejects(PayloadReaderFixture.create().readPayload(input.input()), /cocos_mcp_hub_payload_invalid/u);
    assert.deepEqual(input.counts(), { next: 1, returned: 0 });
    await input.close();
    assert.deepEqual(input.counts(), { next: 1, returned: 1 });
});

test('borrowed input next original Error identity is propagated without reader-owned cleanup', async (): Promise<void> => {
    const original = new Error('owned_original_stream_error');
    const input = new BorrowedInputFixture([], original);
    await assert.rejects(PayloadReaderFixture.create().readPayload(input.input()), error => error === original);
    assert.deepEqual(input.counts(), { next: 1, returned: 0 });
    await input.close();
});

test('borrowed input complete split UTF8 payload keeps every byte and normal completion', async (): Promise<void> => {
    const value = { action: 'call', name: 'peanut.editor-mcp.asset-read-text', input: { path: 'assets/雪😀.json' } };
    const bytes = Buffer.from(JSON.stringify(value));
    const split = bytes.indexOf(Buffer.from('雪'));
    assert.ok(split > 0);
    const input = new BorrowedInputFixture([bytes.subarray(0, split + 1), bytes.subarray(split + 1, split + 2), bytes.subarray(split + 2)]);
    assert.deepEqual(await PayloadReaderFixture.create().readPayload(input.input()), value);
    assert.deepEqual(input.counts(), { next: 4, returned: 0 });
    await input.close();
});
