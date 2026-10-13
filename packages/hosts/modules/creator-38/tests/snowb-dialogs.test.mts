import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SnowbDialogs } from '../src/snowb-dialogs.mts';

test('SnowB dialogs select SBF and constrain published assets to the current project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-snowb-dialogs-'));
    try {
        const assets = join(root, 'assets');
        const fonts = join(assets, 'fonts');
        mkdirSync(fonts, { recursive: true });
        let selected = join(root, 'saved.sbf');
        const dialogs = new SnowbDialogs(() => ({ showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }) }));
        assert.equal(await dialogs.pickSbfFile(root), selected);
        selected = fonts;
        assert.equal(await dialogs.pickPublishTarget(root), 'db://assets/fonts');
        selected = root;
        await assert.rejects(dialogs.pickPublishTarget(root), /snowb_asset_target_outside_assets/u);
        const cancelled = new SnowbDialogs(() => ({ showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }));
        assert.equal(await cancelled.pickSbfFile(root), null);
        assert.equal(await cancelled.pickPublishTarget(root), null);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
