import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import test from 'node:test';

import { LumenAssetDbEditorRefreshAdapter } from '../source/io/asset-db-refresh.js';
import type { ILumenMessagePort } from '../source/types.js';

test('LumenAssetDbEditorRefreshAdapter leaves existing serialized assets to the watcher', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lumen-refresh-'));
    const relativePath = 'assets/mcp-verify/Foo.prefab';
    const absoluteDir = join(projectRoot, 'assets/mcp-verify');
    mkdirSync(absoluteDir, { recursive: true });
    writeFileSync(join(projectRoot, relativePath), '{"ok":true}', 'utf8');

    /** @type {string[]} */
    const calls: string[] = [];
    const message: ILumenMessagePort = {
        request: async (_target, messageName, dbUrl) => {
            calls.push(`${messageName}:${String(dbUrl)}`);
            if (messageName === 'query-asset-info') {
                return { uuid: 'abc' };
            }
            if (messageName === 'query-ready') {
                return true;
            }
            return null;
        },
    };

    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    const result = await adapter.refresh(projectRoot, [relativePath]);
    assert.equal(result.triggered, true);
    assert.equal(calls.includes('refresh-asset:db://assets/mcp-verify/Foo.prefab'), false);
    assert.equal(
        calls.some((entry) => entry.startsWith('save-asset:')),
        false,
        'existing disk-backed assets must not save-asset (Assets panel race)',
    );
});

test('LumenAssetDbEditorRefreshAdapter skips refresh-asset for existing imported prefab', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lumen-refresh-prefab-'));
    const relativePath = 'assets/mcp-verify/FeatureReplaceProbe.prefab';
    mkdirSync(join(projectRoot, 'assets/mcp-verify'), { recursive: true });
    writeFileSync(join(projectRoot, relativePath), '[]', 'utf8');
    writeFileSync(
        join(projectRoot, `${relativePath}.meta`),
        `${JSON.stringify(
            {
                ver: '1.1.50',
                importer: 'prefab',
                imported: true,
                uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                files: ['.json'],
                subMetas: {},
                userData: {},
            },
            null,
            2,
        )}\n`,
        'utf8',
    );

    /** @type {string[]} */
    const calls: string[] = [];
    const message: ILumenMessagePort = {
        request: async (_target, messageName, dbUrl) => {
            calls.push(`${messageName}:${String(dbUrl)}`);
            if (messageName === 'query-asset-info') {
                return { uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', path: relativePath };
            }
            if (messageName === 'query-ready') {
                return true;
            }
            return null;
        },
    };

    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    const result = await adapter.refresh(projectRoot, [relativePath]);
    assert.equal(result.triggered, true);
    assert.equal(
        calls.some((entry) => entry.startsWith('refresh-asset:')),
        false,
        'existing imported .prefab must not refresh-asset (Assets panel Window race)',
    );
});

test('LumenAssetDbEditorRefreshAdapter skips refresh-asset for existing imported typescript', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lumen-refresh-ts-'));
    const relativePath = 'assets/tests/FooHost.ts';
    mkdirSync(join(projectRoot, 'assets/tests'), { recursive: true });
    writeFileSync(join(projectRoot, relativePath), 'export class FooHost {}\n', 'utf8');
    writeFileSync(
        join(projectRoot, `${relativePath}.meta`),
        `${JSON.stringify(
            {
                ver: '4.0.23',
                importer: 'typescript',
                imported: true,
                uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                files: ['.js'],
                subMetas: {},
                userData: {},
            },
            null,
            2,
        )}\n`,
        'utf8',
    );

    /** @type {string[]} */
    const calls: string[] = [];
    const message: ILumenMessagePort = {
        request: async (_target, messageName, dbUrl) => {
            calls.push(`${messageName}:${String(dbUrl)}`);
            if (messageName === 'query-asset-info') {
                return { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', path: relativePath };
            }
            if (messageName === 'query-ready') {
                return true;
            }
            return null;
        },
    };

    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    const result = await adapter.refresh(projectRoot, [relativePath]);
    assert.equal(result.triggered, true);
    assert.equal(
        calls.some((entry) => entry.startsWith('refresh-asset:')),
        false,
        'existing imported .ts must not refresh-asset (Assets panel Window race)',
    );
});

test('LumenAssetDbEditorRefreshAdapter never mutates an unregistered disk-backed text URL', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lumen-refresh-'));
    const relativePath = 'assets/ui/New.ts';
    mkdirSync(join(projectRoot, 'assets/ui'), { recursive: true });
    writeFileSync(join(projectRoot, relativePath), '[]', 'utf8');

    /** @type {string[]} */
    const calls: string[] = [];
    let childQueryCount = 0;
    const message: ILumenMessagePort = {
        request: async (_target, messageName, dbUrl) => {
            calls.push(`${messageName}:${String(dbUrl ?? '')}`);
            if (messageName === 'query-asset-info') {
                if (dbUrl === 'db://assets/ui/' || dbUrl === 'db://assets/ui') {
                    return { uuid: 'parent' };
                }
                if (dbUrl === 'db://assets/ui/New.ts') {
                    childQueryCount += 1;
                    return childQueryCount >= 3 ? { uuid: 'child' } : null;
                }
                return null;
            }
            if (messageName === 'query-ready') {
                return true;
            }
            return null;
        },
    };

    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    await adapter.refresh(projectRoot, [relativePath]);
    assert.equal(calls.some((entry) => entry.startsWith('create-asset:')), false);
    assert.equal(calls.some((entry) => entry.startsWith('refresh-asset:db://assets/ui/New.ts')), false);
    assert.equal(
        calls.some((entry) => entry === 'refresh-asset:db://assets/ui/' || entry === 'refresh-asset:db://assets/ui'),
        false,
        'new child discovery must not refresh its parent directory',
    );
});

test('LumenAssetDbEditorRefreshAdapter reconciles stale url when file path already removed', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lumen-refresh-missing-'));
    mkdirSync(join(projectRoot, 'assets/mcp-verify/lifecycle-out'), { recursive: true });

    /** @type {string[]} */
    const calls: string[] = [];
    const message: ILumenMessagePort = {
        request: async (_target, messageName, dbUrl) => {
            calls.push(`${messageName}:${String(dbUrl ?? '')}`);
            if (messageName === 'query-asset-info') {
                return dbUrl === 'db://assets/mcp-verify/lifecycle-out/Probe.png' ? { uuid: 'stale' } : null;
            }
            if (messageName === 'query-ready') {
                return true;
            }
            return null;
        },
    };

    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    await adapter.refresh(projectRoot, ['assets/mcp-verify/lifecycle-out/Probe.png']);
    assert.ok(calls.some((entry) => entry === 'delete-asset:db://assets/mcp-verify/lifecycle-out/Probe.png'));
    assert.equal(
        calls.some(
            (entry) =>
                entry.startsWith('refresh-asset:') &&
                entry.includes('Probe.png') &&
                !entry.endsWith('lifecycle-out/'),
        ),
        false,
        'missing file url must not be refreshed directly before stale delete',
    );
});

test('LumenAssetDbEditorRefreshAdapter lets watcher register new prefab sidecar without changed messages', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lumen-refresh-ancestors-'));
    const relativePath = 'assets/tests/peanut-perf/PeanutPerfTest.prefab';
    mkdirSync(join(projectRoot, 'assets/tests/peanut-perf'), { recursive: true });
    writeFileSync(
        join(projectRoot, 'assets/tests/peanut-perf.meta'),
        `${JSON.stringify(
            {
                ver: '1.2.0',
                importer: 'directory',
                imported: false,
                uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                files: [],
                subMetas: {},
                userData: {},
            },
            null,
            2,
        )}\n`,
        'utf8',
    );
    writeFileSync(join(projectRoot, relativePath), '[]', 'utf8');
    writeFileSync(
        join(projectRoot, `${relativePath}.meta`),
        '{"ver":"1.1.50","importer":"prefab","imported":false,"uuid":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}\n',
        'utf8',
    );

    /** @type {string[]} */
    const calls: string[] = [];
    const queryCounts = new Map<string, number>();
    const message: ILumenMessagePort = {
        request: async (_target, messageName, dbUrl) => {
            const key = `${messageName}:${String(dbUrl ?? '')}`;
            calls.push(key);
            if (messageName === 'query-asset-info') {
                const url = String(dbUrl ?? '');
                const count = (queryCounts.get(url) ?? 0) + 1;
                queryCounts.set(url, count);
                if (url === 'db://assets/tests/' || url === 'db://assets/tests') {
                    return { uuid: 'tests-dir' };
                }
                if (url === 'db://assets/tests/peanut-perf/' || url === 'db://assets/tests/peanut-perf') {
                    return count >= 2 ? { uuid: 'perf-dir' } : null;
                }
                if (url === 'db://assets/tests/peanut-perf/PeanutPerfTest.prefab') {
                    return count >= 2 ? { uuid: 'prefab' } : null;
                }
                return null;
            }
            if (messageName === 'query-ready') {
                return true;
            }
            return null;
        },
    };

    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    await adapter.refresh(projectRoot, [relativePath]);
    assert.equal(
        calls.some((entry) => entry.startsWith('refresh-asset:') || entry.startsWith('create-asset:')),
        false,
        'new prefab and directories with sidecars must settle through watcher events only',
    );
});

test('LumenAssetDbEditorRefreshAdapter syncs directory paths without create-asset', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lumen-refresh-directory-'));
    const relativePath = 'assets/mcp-verify/lifecycle-out';
    mkdirSync(join(projectRoot, relativePath), { recursive: true });
    writeFileSync(
        join(projectRoot, `${relativePath}.meta`),
        `${JSON.stringify(
            {
                ver: '1.2.0',
                importer: 'directory',
                imported: true,
                uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                files: [],
                subMetas: {},
                userData: {},
            },
            null,
            2,
        )}\n`,
        'utf8',
    );

    /** @type {string[]} */
    const calls: string[] = [];
    const message: ILumenMessagePort = {
        request: async (_target, messageName, dbUrl) => {
            calls.push(`${messageName}:${String(dbUrl ?? '')}`);
            if (messageName === 'query-asset-info') {
                return dbUrl === 'db://assets/mcp-verify/lifecycle-out/' ? { uuid: 'dir' } : null;
            }
            if (messageName === 'query-ready') {
                return true;
            }
            return null;
        },
    };

    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    await adapter.refresh(projectRoot, [relativePath]);
    assert.ok(calls.includes('refresh-asset:db://assets/mcp-verify/lifecycle-out/'));
    assert.equal(
        calls.some((entry) => entry.startsWith('create-asset:')),
        false,
        'directories must not go through create-asset',
    );
});

test('LumenAssetDbEditorRefreshAdapter never refresh-asset unregistered directory URL', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lumen-refresh-dir-new-'));
    const relativePath = 'assets/mcp-verify/lifecycle-out';
    mkdirSync(join(projectRoot, relativePath), { recursive: true });
    writeFileSync(
        join(projectRoot, `${relativePath}.meta`),
        `${JSON.stringify(
            {
                ver: '1.2.0',
                importer: 'directory',
                imported: false,
                uuid: 'cccccccc-dddd-eeee-ffff-000000000000',
                files: [],
                subMetas: {},
                userData: {},
            },
            null,
            2,
        )}\n`,
        'utf8',
    );

    /** @type {string[]} */
    const calls: string[] = [];
    const message: ILumenMessagePort = {
        request: async (_target, messageName, dbUrl) => {
            calls.push(`${messageName}:${String(dbUrl ?? '')}`);
            if (messageName === 'query-asset-info') {
                // 模拟尚未入树：始终 null，逼出「禁止对自身 refresh」路径。
                return null;
            }
            if (messageName === 'query-ready') {
                return true;
            }
            return null;
        },
    };

    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    await adapter.refresh(projectRoot, [relativePath]);
    assert.equal(
        calls.some(
            (entry) =>
                entry === 'refresh-asset:db://assets' ||
                entry === 'refresh-asset:db://assets/' ||
                entry === 'refresh-asset:db://assets/mcp-verify/' ||
                entry === 'refresh-asset:db://assets/mcp-verify/lifecycle-out/',
        ),
        false,
        'must not refresh assets root, parent, or unregistered self URL',
    );
});

test('LumenAssetDbEditorRefreshAdapter skips empty paths instead of refreshing assets root', async (): Promise<void> => {
    /** @type {string[]} */
    const calls: string[] = [];
    const message: ILumenMessagePort = {
        request: async (_target, messageName, dbUrl) => {
            calls.push(`${messageName}:${String(dbUrl ?? '')}`);
            return null;
        },
    };
    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    const result = await adapter.refresh('/tmp/unused-project', []);
    assert.equal(result.triggered, false);
    assert.equal(result.message, 'lumen_asset_db_refresh:skipped_assets_root');
    assert.equal(
        calls.some((entry) => entry.startsWith('refresh-asset:')),
        false,
        'empty paths must not refresh-asset db://assets',
    );
});

test('LumenAssetDbEditorRefreshAdapter never refresh-asset assets root for top-level folder', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lumen-refresh-top-'));
    const relativePath = 'assets/chaos-stress';
    mkdirSync(join(projectRoot, relativePath), { recursive: true });
    writeFileSync(
        join(projectRoot, `${relativePath}.meta`),
        `${JSON.stringify(
            {
                ver: '1.2.0',
                importer: 'directory',
                imported: false,
                uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                files: [],
                subMetas: {},
                userData: {},
            },
            null,
            2,
        )}\n`,
        'utf8',
    );
    /** @type {string[]} */
    const calls: string[] = [];
    const message: ILumenMessagePort = {
        request: async (_target, messageName, dbUrl) => {
            calls.push(`${messageName}:${String(dbUrl ?? '')}`);
            if (messageName === 'query-asset-info') {
                return null;
            }
            if (messageName === 'query-ready') {
                return true;
            }
            return null;
        },
    };
    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    await adapter.refresh(projectRoot, [relativePath]);
    assert.equal(
        calls.some(
            (entry) => entry === 'refresh-asset:db://assets' || entry === 'refresh-asset:db://assets/',
        ),
        false,
        'top-level folder must not refresh-asset assets root',
    );
});

test('LumenAssetDbEditorRefreshAdapter splits mixed stale and present paths in one batch', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lumen-refresh-mixed-'));
    const presentPath = 'assets/mcp-verify/lifecycle-out/Renamed.prefab';
    mkdirSync(join(projectRoot, 'assets/mcp-verify/lifecycle-out'), { recursive: true });
    writeFileSync(join(projectRoot, presentPath), '[]', 'utf8');

    /** @type {string[]} */
    const calls: string[] = [];
    const message: ILumenMessagePort = {
        request: async (_target, messageName, dbUrl) => {
            calls.push(`${messageName}:${String(dbUrl ?? '')}`);
            if (messageName === 'query-asset-info') {
                if (dbUrl === 'db://assets/mcp-verify/lifecycle-out/Probe.png') {
                    return { uuid: 'stale' };
                }
                if (dbUrl === 'db://assets/mcp-verify/lifecycle-out/Renamed.prefab') {
                    return { uuid: 'present' };
                }
                return null;
            }
            if (messageName === 'query-ready') {
                return true;
            }
            return null;
        },
    };

    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    const result = await adapter.refresh(projectRoot, [
        'assets/mcp-verify/lifecycle-out/Probe.png',
        presentPath,
    ]);
    assert.equal(result.triggered, true);
    assert.ok(result.message.includes('Probe.png'));
    assert.ok(result.message.includes('Renamed.prefab'));
    assert.ok(calls.some((entry) => entry === 'delete-asset:db://assets/mcp-verify/lifecycle-out/Probe.png'));
    assert.equal(
        calls.some((entry) => entry.startsWith('refresh-asset:db://assets/mcp-verify/lifecycle-out/Renamed.prefab')),
        false,
    );
});

test('LumenAssetDbEditorRefreshAdapter refreshBarrier settles registered paths', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lumen-refresh-barrier-'));
    const relativePath = 'assets/mcp-verify/Barrier.prefab';
    mkdirSync(join(projectRoot, 'assets/mcp-verify'), { recursive: true });
    writeFileSync(join(projectRoot, relativePath), '[]', 'utf8');

    const message: ILumenMessagePort = {
        request: async (_target, messageName) => {
            if (messageName === 'query-asset-info') {
                return { uuid: 'barrier-uuid' };
            }
            if (messageName === 'query-ready') {
                return true;
            }
            return null;
        },
    };

    // coalesceWindowMs=0：只验证 barrier settle 字段，合并窗由 coalescer 单测覆盖。
    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    const barrier = await adapter.refreshBarrier(projectRoot, [relativePath]);
    assert.ok(barrier.settle != null);
    assert.equal(barrier.settle?.registered, 1);
    assert.equal(barrier.settle?.pending, 0);
    assert.equal(barrier.settle?.ready, true);
    assert.ok((barrier.settle?.waitedMs ?? 0) >= 0);
    assert.ok(barrier.message.includes('settle:'));
});

test('LumenAssetDbEditorRefreshAdapter fails closed when a new asset remains unregistered', async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'lumen-refresh-pending-'));
    const relativePath = 'assets/mcp-verify/Pending.prefab';
    mkdirSync(join(projectRoot, 'assets/mcp-verify'), { recursive: true });
    writeFileSync(join(projectRoot, relativePath), '[]', 'utf8');

    const message: ILumenMessagePort = {
        request: async (_target, messageName) => {
            if (messageName === 'query-ready') {
                return true;
            }
            return null;
        },
    };

    const adapter = new LumenAssetDbEditorRefreshAdapter(message, 0);
    await assert.rejects(
        adapter.refreshBarrier(projectRoot, [relativePath]),
        /lumen_asset_db_registration_pending:db:\/\/assets\/mcp-verify\/Pending\.prefab/u,
    );
});
