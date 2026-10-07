import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';

import { AssetImportBatchExecutor } from '../source/asset-import/asset-import-batch-executor.ts';
import { AssetImportPlanner } from '../source/asset-import/asset-import-planner.ts';

const atlasXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n\t<key>frames</key>\n\t<dict>\n\t\t<key>whole.png</key>\n\t\t<dict>\n\t\t\t<key>aliases</key>\n\t\t\t<array/>\n\t\t\t<key>spriteOffset</key>\n\t\t\t<string>{0,0}</string>\n\t\t\t<key>spriteSize</key>\n\t\t\t<string>{32,32}</string>\n\t\t\t<key>spriteSourceSize</key>\n\t\t\t<string>{32,32}</string>\n\t\t\t<key>textureRect</key>\n\t\t\t<string>{{0,0},{32,32}}</string>\n\t\t\t<key>textureRotated</key>\n\t\t\t<false/>\n\t\t</dict>\n\t</dict>\n\t<key>metadata</key>\n\t<dict>\n\t\t<key>format</key>\n\t\t<integer>3</integer>\n\t\t<key>realTextureFileName</key>\n\t\t<string>LegalAtlas.png</string>\n\t\t<key>size</key>\n\t\t<string>{32,32}</string>\n\t\t<key>textureFileName</key>\n\t\t<string>LegalAtlas.png</string>\n\t</dict>\n</dict>\n</plist>\n";
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAWklEQVR4nO3OwQkAIAxDUfefzH1Ezy7goSQpLZJAzv+N4XkesLXPfL0snA6JhlMgaFyGKAWwcRpRClDFYYQBBpQDlAgo3gKgQFDxFgAGIYkjEHk4CkkPe96Xu85fgSV8xrjfAAAAAElFTkSuQmCC", 'base64');

/**
 * @description 使用真实原生控制组同字节的格式 3 图集和合法 PNG；只清理本用例自有目录。
 */
function fixture(texture = 'LegalAtlas.png'): { root: string; atlas: string; image: string } {
    const root = mkdtempSync(join(tmpdir(), 'peanut-plist-dependency-'));
    const atlas = join(root, 'LegalAtlas.plist');
    const image = join(root, texture);
    writeFileSync(atlas, atlasXml.split('LegalAtlas.png').join(texture));
    writeFileSync(image, pngBytes);
    return { root, atlas, image };
}

test('format 3 plist seed discovers the native control PNG and orders it before atlas', (): void => {
    const f = fixture();
    try {
        const before = [readFileSync(f.atlas), readFileSync(f.image)];
        const planner = new AssetImportPlanner();
        const plan = planner.plan([f.atlas], { expandClosure: true });
        assert.deepEqual(plan.expandedSources.slice().sort(), [f.atlas, f.image].sort());
        assert.deepEqual(planner.flatten(plan), [f.image, f.atlas]);
        assert.equal(plan.layers.length, 2);
        assert.deepEqual(plan.missingDependencies, []);
        assert.deepEqual([readFileSync(f.atlas), readFileSync(f.image)], before);
    } finally {
        rmSync(f.root, { recursive: true });
    }
});

test('native import boundary receives PNG and readiness barrier before plist without explicit map', async (): Promise<void> => {
    const f = fixture();
    try {
        const calls: string[] = [];
        let imageReady = false;
        let imageImported = false;
        const executor = new AssetImportBatchExecutor({
            request: async (_target, message, ...args) => {
                calls.push(message);
                if (message === 'query-ready') {
                    imageReady = imageImported;
                    return true;
                }
                if (message === 'import-asset' || message === 'import') {
                    const source = String(args[0]);
                    if (source.endsWith('.plist')) {
                        assert.equal(imageReady, true, 'Texture not registered before atlas import');
                    } else {
                        assert.deepEqual(readFileSync(source), pngBytes);
                        imageImported = true;
                    }
                }
                return { ok: true };
            },
        });
        const result = await executor.importBatch({
            sources: [f.atlas, f.image], target: 'db://assets/Atlas', concurrency: 4,
            refreshAfter: true, allowMissingDependencies: false,
        });
        assert.deepEqual(result.imported.map(item => basename(item.source)), ['LegalAtlas.png', 'LegalAtlas.plist']);
        assert.deepEqual(result.imported.map(item => item.layer), [0, 1]);
        assert.ok(calls.indexOf('query-ready') < calls.lastIndexOf('import-asset'));
    } finally {
        rmSync(f.root, { recursive: true });
    }
});

test('missing declared plist texture refuses before any native request', async (): Promise<void> => {
    const f = fixture();
    try {
        rmSync(f.image);
        const before = readFileSync(f.atlas);
        let requests = 0;
        const executor = new AssetImportBatchExecutor({ request: async () => { requests += 1; return true; } });
        await assert.rejects(() => executor.importBatch({ sources: [f.atlas], target: 'db://assets/Atlas' }), /asset_import_missing_dependencies/);
        assert.equal(requests, 0);
        assert.deepEqual(readFileSync(f.atlas), before);
    } finally {
        rmSync(f.root, { recursive: true });
    }
});

test('XML text entities decode once and duplicate texture metadata collapses to one dependency', (): void => {
    const f = fixture('Page&2.png');
    try {
        writeFileSync(f.atlas, atlasXml.split('LegalAtlas.png').join('Page&amp;&#50;.png'));
        const planner = new AssetImportPlanner();
        const plan = planner.plan([f.atlas], { expandClosure: true });
        assert.deepEqual(planner.flatten(plan), [f.image, f.atlas]);
        assert.deepEqual(plan.missingDependencies, []);
    } finally {
        rmSync(f.root, { recursive: true });
    }
});

test('realTextureFileName is discovered when textureFileName is omitted', (): void => {
    const f = fixture();
    try {
        writeFileSync(f.atlas, atlasXml.replace(/<key>textureFileName<\/key>\s*<string>[^<]*<\/string>/u, ''));
        const planner = new AssetImportPlanner();
        assert.deepEqual(planner.flatten(planner.plan([f.atlas], { expandClosure: true })), [f.image, f.atlas]);
    } finally {
        rmSync(f.root, { recursive: true });
    }
});

test('particle plist does not acquire SpriteAtlas texture dependencies', (): void => {
    const f = fixture();
    try {
        writeFileSync(f.atlas, '<plist><dict><key>textureFileName</key><string>Missing.png</string><key>emitterType</key><integer>0</integer></dict></plist>');
        const planner = new AssetImportPlanner();
        const plan = planner.plan([f.atlas], { expandClosure: true });
        assert.deepEqual(planner.flatten(plan), [f.atlas]);
        assert.deepEqual(plan.missingDependencies, []);
    } finally {
        rmSync(f.root, { recursive: true });
    }
});

test('plist implicit path discovery rejects traversal, absolute, URI and encoded traversal before native calls', async (): Promise<void> => {
    const f = fixture();
    try {
        for (const unsafe of ['../Outside.png', '/tmp/Outside.png', 'https://example.invalid/a.png', '..&#47;Outside.png', 'Folder\\Outside.png']) {
            writeFileSync(f.atlas, atlasXml.split('LegalAtlas.png').join(unsafe));
            const before = readFileSync(f.atlas);
            let requests = 0;
            const executor = new AssetImportBatchExecutor({ request: async () => { requests += 1; return true; } });
            await assert.rejects(() => executor.importBatch({ sources: [f.atlas], target: 'db://assets/Atlas' }), /asset_import_plist_texture_path_invalid/);
            assert.equal(requests, 0);
            assert.deepEqual(readFileSync(f.atlas), before);
            assert.deepEqual(readFileSync(f.image), pngBytes);
        }
    } finally {
        rmSync(f.root, { recursive: true });
    }
});

test('unsupported XML entities and missing atlas texture metadata refuse before import', async (): Promise<void> => {
    const f = fixture();
    try {
        for (const document of [atlasXml.split('LegalAtlas.png').join('&external;.png'), atlasXml.replace(/<key>(?:realTextureFileName|textureFileName)<\/key>\s*<string>[^<]*<\/string>/gu, '')]) {
            writeFileSync(f.atlas, document);
            let requests = 0;
            const executor = new AssetImportBatchExecutor({ request: async () => { requests += 1; return true; } });
            await assert.rejects(() => executor.importBatch({ sources: [f.atlas], target: 'db://assets/Atlas' }), /asset_import_plist_/);
            assert.equal(requests, 0);
        }
    } finally {
        rmSync(f.root, { recursive: true });
    }
});
