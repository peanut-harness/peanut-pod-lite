import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ComponentNativeClient } from './component-native-client.mts';

/**
 * @description 只替代测试网络边界，不允许打开、导入或写入原生工程。
 */
class RegistrationClient extends ComponentNativeClient {
    /**
     * @description 注入模拟AssetDB导入进度，真实meta仍从隔离测试磁盘读取。
     */
    public observe: () => unknown = () => [];
    /**
     * @description 记录只读调用以检查没有重放打开。
     */
    public calls: string[] = [];
    /**
     * @description 拦截传输，只接受只读组件资源查询。
     * @param action 只读动作。
     * @param input 固定范围。
     * @returns 模拟AssetDB结果。
     */
    public override async probe(action: string, input: Record<string, unknown> = {}): Promise<unknown> {
        this.calls.push(action); assert.equal(action, 'assets'); assert.deepEqual(input, { scope: 'components' });
        return this.observe();
    }
}

/**
 * @description 构造受限任务根中的临时注册，退出后清理。
 * @param run 对真实客户端方法的行为验证。
 */
async function fixture(run: (client: RegistrationClient) => Promise<void>): Promise<void> {
    const root = new URL('../../../../', import.meta.url).pathname;
    const output = mkdtempSync(join(root, 'evidence/task-5.1/test-scene-registration-')); const project = join(output, 'project');
    mkdirSync(join(project, 'assets/components'), { recursive: true });
    const identity = { owner: '01a13478-7931-7e82-86a4-f4f2fcd47bb1', runId: 'unit-only' };
    writeFileSync(join(output, 'project-ownership.json'), JSON.stringify({ ...identity, task: '5.1', projectPath: project }));
    writeFileSync(join(output, 'creator-owned-start.json'), JSON.stringify({ ...identity, project }));
    try { await run(new RegistrationClient(project)); } finally { rmSync(output, { recursive: true, force: true }); }
}

test('scene identity waits for AssetDB and meta agreement before returning, without opening or importing', async () => {
    await fixture(async client => {
        const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; let reads = 0;
        client.observe = () => {
            reads++;
            if (reads === 1) return [];
            writeFileSync(join(client.project, 'assets/components/cc.Label.scene.meta'), JSON.stringify({ uuid: reads === 2 ? 'stale' : uuid }));
            return [{ url: 'db://assets/components/cc.Label.scene', uuid }];
        };
        assert.equal(await client.sceneIdentity('assets/components/cc.Label.scene'), uuid);
        assert.equal(reads, 3); assert.deepEqual(client.calls, ['assets', 'assets', 'assets']);
    });
});

test('scene identity rejects escaped paths and broken metadata without attempting an open', async () => {
    await fixture(async client => {
        await assert.rejects(client.sceneIdentity('assets/components/../../secret.scene'), /scene_path_invalid/);
        assert.equal(client.calls.length, 0);
        client.observe = () => [{ url: 'db://assets/components/cc.Label.scene', uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }];
        writeFileSync(join(client.project, 'assets/components/cc.Label.scene.meta'), '{broken');
        await assert.rejects(client.sceneIdentity('assets/components/cc.Label.scene'), SyntaxError);
        assert.deepEqual(client.calls, ['assets']);
    });
});
