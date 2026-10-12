import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { PluginManagerApp } from '@peanut/pod-engine/kernel';
import { PluginWorkbench } from '../src/plugin-workbench.mts';

test('workbench opens a real declared panel and rejects stale callers, inactive plugins and escaped entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-workbench-'));
    try {
        const installedRoot = join(root, 'installed');
        mkdirSync(installedRoot);
        const entry = join(installedRoot, 'index.html');
        writeFileSync(entry, '<html><body>plugin</body></html>');
        writeFileSync(join(installedRoot, 'acme.panel.manifest.json'), '{}');
        let active = true;
        let panelEntry = entry;
        const calls: string[] = [];
        const manager = {
            resolveEmbeddedPluginPanel() {
                if (!active) throw new Error('plugin_panel_plugin_not_active');
                return { id: 'acme.panel.ui', title: 'Test', entry: panelEntry };
            },
            getInstalledPackageSnapshot: () => ({ activeVersion: '1.0.0', versions: [{ version: '1.0.0', installPath: installedRoot }] }),
            createPanelBridgeClient: () => ({ request: async () => ({ ok: true, payload: { reached: true } }) }),
        } as unknown as PluginManagerApp;
        const workbench = new PluginWorkbench(() => manager, () => ({ Project: { path: root }, Panel: { open: async (name) => { calls.push(name); } }, Message: { send: (_extension, message) => { calls.push(message); } } }), 'peanut-pod-lite-host');
        assert.throws(() => workbench.query(), /plugin_workbench_not_bound/u);
        const context = await workbench.open('acme.panel');
        assert.equal(context.entry, realpathSync(entry));
        assert.deepEqual(calls, ['peanut-pod-lite-host.plugin-workbench', 'refresh-plugin-workbench']);
        assert.deepEqual(await workbench.request('acme.panel', 'acme.panel.ui', { id: 'valid', event: 'read' }), { ok: true, payload: { reached: true } });
        await assert.rejects(workbench.request('other.plugin', 'acme.panel.ui', { id: 'old', event: 'read' }), /plugin_workbench_caller_mismatch/u);
        active = false;
        assert.throws(() => workbench.query(), /plugin_panel_plugin_not_active/u);
        active = true;
        panelEntry = join(root, 'outside.html');
        writeFileSync(panelEntry, 'outside');
        await assert.rejects(workbench.open('acme.panel'), /plugin_workbench_entry_escape/u);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
