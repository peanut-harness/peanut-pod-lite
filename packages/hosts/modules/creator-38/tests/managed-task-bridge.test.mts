import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const host = require('../src/main.js');
const TOOL_NAME = 'peanut.editor-mcp.test-managed';

test('Creator Bridge keeps managed task control connection-scoped', async () => {
    const temporaryRoot = resolve(import.meta.dirname, '..', '.test-temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const projectRoot = mkdtempSync(join(temporaryRoot, 'managed-task-bridge-'));
    const owner = { connectionId: 'a'.repeat(32), resourceIds: ['db://assets/a.prefab'] };
    const other = { connectionId: 'b'.repeat(32), resourceIds: ['db://assets/a.prefab'] };
    try {
        const core = writePackage(projectRoot, managedCoreBundle());
        writeInstalledIndex(projectRoot, [core]);
        writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ creator: { version: '3.8.7' } }));
        globalThis.Editor = createEditor(projectRoot);
        await host.load();

        const synchronous = await host.methods.invokeTool(TOOL_NAME, { execution: { mode: 'sync' }, delayMs: 1 }, owner);
        assert.equal(synchronous.taskStatus, 'succeeded');
        assert.equal((await host.methods.queryTaskStatus(synchronous.taskId, owner))?.status, 'succeeded');
        assert.equal(await host.methods.queryTaskStatus(synchronous.taskId, other), null);
        assert.equal((await host.methods.queryTaskEvidence(synchronous.taskId, owner))?.entries[0]?.kind, 'artifact');
        assert.equal(await host.methods.queryTaskEvidence(synchronous.taskId, other), null);

        const blocker = await host.methods.invokeTool(TOOL_NAME, { execution: { mode: 'async' }, delayMs: 80 }, owner);
        const cancellable = await host.methods.invokeTool(TOOL_NAME, { execution: { mode: 'async' }, delayMs: 5 }, owner);
        assert.equal(cancellable.taskStatus, 'queued');
        assert.deepEqual(await host.methods.cancelTask(cancellable.taskId, other), {
            taskId: cancellable.taskId,
            cancelled: false,
            reason: 'task_unavailable',
        });
        assert.equal((await host.methods.cancelTask(cancellable.taskId, owner)).cancelled, true);
        assert.equal((await waitForTerminal(cancellable.taskId, owner)).status, 'cancelled');
        assert.equal((await waitForTerminal(blocker.taskId, owner)).status, 'succeeded');

        const completed = await host.methods.invokeTool(TOOL_NAME, { execution: { mode: 'async' }, delayMs: 5 }, owner);
        assert.equal((await waitForTerminal(completed.taskId, owner)).status, 'succeeded');
    } finally {
        await host.unload();
        delete globalThis.Editor;
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

async function waitForTerminal(taskId, invocation) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const status = await host.methods.queryTaskStatus(taskId, invocation);
        if (status != null && ['succeeded', 'failed', 'cancelled'].includes(status.status)) {
            return status;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
    }
    throw new Error(`managed_task_terminal_timeout:${taskId}`);
}

function managedCoreBundle() {
    return `
module.exports.createPluginModule=()=>({
  manifest:{id:'peanut.pod-lite',version:'0.1.0'},
  activate:async(context)=>{
    context.tasks.managed.registerExecutor('bridge.test',async(request,executorContext)=>{
      executorContext.recordEvidence({id:'artifact',kind:'artifact',status:'completed',summary:'Bridge task completed.',recordedAt:new Date().toISOString()});
      await new Promise(resolve=>setTimeout(resolve,request.payload.delayMs));
      return {done:true};
    });
    context.mcp.register({
      name:'${TOOL_NAME}',description:'Managed bridge test',category:'cocos',readOnly:false,risk:'write',executionModel:'managed_task',
      inputSchema:{type:'object',properties:{execution:{type:'object',properties:{mode:{type:'string',enum:['sync','async']}},required:['mode'],additionalProperties:false},delayMs:{type:'number'}},required:['execution','delayMs'],additionalProperties:false},
      outputSchema:{type:'object',properties:{taskId:{type:'string'},taskStatus:{type:'string',enum:['queued','succeeded']}},required:['taskId','taskStatus'],additionalProperties:true}
    },async(input,invocation)=>{
      const receipt=await context.tasks.managed.enqueue({requestId:'bridge:'+Date.now()+':'+Math.random(),scope:'project',priority:'normal',kind:'bridge.test',payload:{delayMs:input.delayMs},mergePolicy:'none'},invocation);
      if(input.execution.mode==='async')return {taskId:receipt.taskId,taskStatus:'queued'};
      const result=await context.tasks.managed.wait(receipt.taskId);
      return {...result.data,taskId:receipt.taskId,taskStatus:'succeeded'};
    });
  },
  deactivate:async()=>{}
});`;
}

function writePackage(projectRoot, bundle) {
    const pluginId = 'peanut.pod-lite';
    const version = '0.1.0';
    const installPath = join('peanut-plugins', 'plugins', pluginId, version);
    const packagePath = resolve(projectRoot, installPath);
    mkdirSync(join(packagePath, 'libs'), { recursive: true });
    const packageJson = JSON.stringify({ type: 'commonjs' });
    writeFileSync(join(packagePath, `${pluginId}.bundle.js`), bundle);
    writeFileSync(join(packagePath, 'package.json'), packageJson);
    writeFileSync(join(packagePath, 'libs', '.keep'), '');
    const files = [
        { path: `${pluginId}.bundle.js`, digest: digest(bundle) },
        { path: 'libs/.keep', digest: digest('') },
        { path: 'package.json', digest: digest(packageJson) },
    ];
    const manifest = {
        id: pluginId,
        version,
        kind: 'tooling-plugin',
        main: `./${pluginId}.bundle.js`,
        package: {
            schemaVersion: 1,
            digest: digest([...files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => `${file.path}:${file.digest}`).join('\n')),
            files,
        },
    };
    writeFileSync(join(packagePath, `${pluginId}.manifest.json`), JSON.stringify(manifest));
    return { pluginId, activeVersion: version, versions: [{ version, installPath }] };
}

function writeInstalledIndex(projectRoot, packages) {
    writeFileSync(join(projectRoot, 'peanut-plugins', 'installed.json'), JSON.stringify({ schemaVersion: 2, plugins: packages }));
}

function digest(value) {
    return createHash('sha256').update(value).digest('hex');
}

function createEditor(projectRoot) {
    const safeStorage = {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'dpapi',
        encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
        decryptString: (value) => value.toString('utf8').slice('encrypted:'.length),
    };
    return {
        Project: { path: projectRoot, name: 'host-test' },
        App: { version: '3.8.7', safeStorage },
        Selection: { getSelected: () => [] },
        Message: { request: async () => ({}) },
        log: () => {},
        warn: () => {},
        error: () => {},
    };
}
