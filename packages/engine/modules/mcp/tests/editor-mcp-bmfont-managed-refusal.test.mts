import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { IGrantedRuntimeClientSet, IPluginManagedTaskApi } from '@peanut/pod-sdk';
import { RuntimeFacade } from '@peanut/pod-engine/runtime';
import { createEditorMcpExecuteOperation } from '../src/editor-mcp-gateway-factory.js';

for (const version of ['3.8.3', '3.8.7']) {
    for (const mixed of [false, true]) {
        test(version + ' managed FNT refusal occurs before submission, wait, native or ledger ' + mixed, async () => {
            const root = mkdtempSync(join(tmpdir(), 'fnt-managed-refusal-'));
            mkdirSync(join(root, 'assets')); mkdirSync(join(root, 'temp/logs'), { recursive: true });
            writeFileSync(join(root, 'temp/logs/project.log'), '');
            writeFileSync(join(root, 'package.json'), JSON.stringify({ creator: { version } }));
            const text = 'info face="Probe" size=16\ncommon pages=1 lineHeight=16 scaleW=32 scaleH=32\npage id=0 file="pages/Page.png"\nchars count=0\n';
            const font = join(root, 'Bad.fnt'); writeFileSync(font, text);
            const unrelated = join(root, 'Input.txt'); writeFileSync(unrelated, 'unchanged');
            const calls: string[] = [];
            const runtime = new RuntimeFacade(version, { allowMemoryPanelWindowProviderFallback: true });
            const clients: IGrantedRuntimeClientSet = { version: runtime.version, designSources: [], native: {}, projectRead: { getProjectPath: async () => root, getProjectName: async () => 'FNTManaged' }, message: { request: async <TData = unknown,>(_target: string, name: string): Promise<TData> => { calls.push(name); throw new Error('must refuse before native'); }, send: async () => {}, broadcast: async () => {} } };
            const managed: IPluginManagedTaskApi = { registerExecutor: () => () => {}, enqueue: async () => { calls.push('enqueue'); throw new Error('must refuse before managed submission'); }, enqueueBatch: async () => { calls.push('enqueueBatch'); throw new Error('must refuse before managed batch'); }, wait: async () => { calls.push('wait'); throw new Error('must refuse before managed wait'); } };
            const execute = createEditorMcpExecuteOperation(clients, managed);
            const before = readdirSync(root).sort();
            try {
                await assert.rejects(execute('asset.import', { sources: mixed ? [unrelated, font] : [font], target: 'db://assets/Fonts', allowMissingDependencies: false }), (error: unknown) => { assert.equal(error instanceof Error && Reflect.get(error, 'isMcpControlFlowRefusal'), true); assert.equal(error instanceof Error && error.message, 'asset_import_fnt_page_path_unsupported'); return true; });
                assert.deepEqual(calls, []); assert.deepEqual(readdirSync(root).sort(), before); assert.deepEqual(readdirSync(join(root, 'assets')), []); assert.equal(readFileSync(font, 'utf8'), text); assert.equal(readFileSync(join(root, 'temp/logs/project.log'), 'utf8'), '');
            } finally { execute.dispose(); runtime.execution.dispose(); rmSync(root, { recursive: true, force: true }); }
        });
    }
}
