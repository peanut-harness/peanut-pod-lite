import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { PluginTemplateGenerator } from '../src/development/plugin-template-generator.js';

test('generates Creator 3.8 host and Peanut Core templates', (): void => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-plugin-template-'));
    const generator = new PluginTemplateGenerator();
    try {
        const hostPath = join(root, 'host-plugin');
        const host = generator.generate({ pluginId: 'acme.creator-tools', displayName: 'Creator Tools', kind: 'creator-38-host', targetDirectory: hostPath });
        assert.equal(host.files.includes('main.js'), true);
        assert.equal(JSON.parse(readFileSync(join(hostPath, 'package.json'), 'utf8')).editor, '>=3.8.0 <3.9.0');

        const corePath = join(root, 'core-plugin');
        const core = generator.generate({ pluginId: 'acme.core-tools', displayName: 'Core Tools', kind: 'peanut-core', targetDirectory: corePath });
        assert.equal(core.files.includes('acme.core-tools.manifest.json'), true);
        assert.equal(JSON.parse(readFileSync(join(corePath, 'acme.core-tools.manifest.json'), 'utf8')).id, 'acme.core-tools');
        const coreModule = createRequire(import.meta.url)(join(corePath, 'acme.core-tools.bundle.js')).createPluginModule();
        for (const method of ['register', 'activate', 'deactivate', 'dispose']) {
            assert.equal(typeof coreModule[method], 'function', `generated core plugin must implement ${method}`);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('invalid identifiers and occupied directories are left unchanged', (): void => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-plugin-template-'));
    const generator = new PluginTemplateGenerator();
    const occupied = join(root, 'occupied');
    mkdirSync(occupied);
    writeFileSync(join(occupied, 'keep.txt'), 'keep');
    try {
        assert.throws(() => generator.generate({ pluginId: '../escape', displayName: 'Bad', kind: 'peanut-core', targetDirectory: join(root, 'invalid') }), /plugin_template_id_invalid/u);
        assert.equal(existsSync(join(root, 'invalid')), false);
        assert.throws(() => generator.generate({ pluginId: 'acme.valid', displayName: 'Valid', kind: 'peanut-core', targetDirectory: occupied }), /plugin_template_target_not_empty/u);
        assert.equal(readFileSync(join(occupied, 'keep.txt'), 'utf8'), 'keep');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
