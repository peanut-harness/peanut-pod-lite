import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { RuntimeFacade } from '@peanut/pod-engine/runtime';
import { CoreCocosMcpToolDefinitionCatalog } from '@peanut/pod-engine/policy';
import { EditorMcpActionRouter } from '../src/editor-mcp-action-router.js';
import { EditorMcpToolCatalog } from '../src/editor-mcp-tool-catalog.js';

test('public diagnostic schema, read-only profile and actual router return current project context', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-log-router-'));
    mkdirSync(join(root, 'temp/logs'), { recursive: true });
    writeFileSync(join(root, 'temp/logs/project.log'), 'before\n2026 - error: 真实错误\n at frame\n');
    try {
        const runtime = new RuntimeFacade('3.8.7');
        const router = new EditorMcpActionRouter({ version: runtime.version, projectRead: { getProjectPath: async () => root } });
        const descriptors = router.listCapabilities();
        const core = new CoreCocosMcpToolDefinitionCatalog().list().find((tool) => tool.operation === 'diagnostics.queryLogs');
        assert.ok(core);
        assert.equal(core.readOnly, true);
        assert.equal(core.requiresLocalApproval, false);
        assert.equal(core.throughput.read?.cache, 'none');
        assert.equal(core.throughput.read?.coalescing, 'none');
        const tool = new EditorMcpToolCatalog().buildDefinitions(descriptors).find((item) => item.name === core.name);
        assert.deepEqual(tool?.inputSchema, core.inputSchema);
        const result = await router.execute({ operation: 'diagnostics.queryLogs', input: { mode: 'search', contains: '真实错误' } });
        assert.equal(result.operation, 'diagnostics.queryLogs');
        assert.equal(result.data.ok, true);
        assert.equal(result.data.matches[0].after[0].text, ' at frame\n');
        assert.equal('verified' in result.data, false);
        await assert.rejects(router.execute({ operation: 'diagnostics.queryLogs', input: { mode: 'tail', path: '/etc/hosts' } }), /unknown_field/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('diagnostics requires project grant and refuses a missing project log', async () => {
    const runtime = new RuntimeFacade('3.8.7');
    const router = new EditorMcpActionRouter({ version: runtime.version });
    assert.equal(router.plan({ operation: 'diagnostics.queryLogs', input: { mode: 'tail' } }).executable, false);
    await assert.rejects(router.execute({ operation: 'diagnostics.queryLogs', input: { mode: 'tail' } }), /project_read_not_granted/);
});
