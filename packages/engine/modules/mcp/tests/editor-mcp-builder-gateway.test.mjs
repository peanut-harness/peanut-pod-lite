#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { EditorMcpBuilderGateway } from '../dist/editor-mcp-builder-gateway.js';

test('builder fills warning-free web defaults on the first build', async () => {
    let submitted;
    const runtime = {
        message: {
            async request(_target, name, ...args) {
                if (name === 'add-task') {
                    submitted = args[0];
                    return 0;
                }
                if (name === 'query-task') {
                    throw new Error('query unavailable');
                }
                if (name === 'query-tasks-info') {
                    return { queue: {}, list: [], free: true };
                }
                throw new Error(`unsupported:${name}`);
            },
        },
    };
    await new EditorMcpBuilderGateway(runtime).build({ platform: 'web-desktop' });
    assert.equal(submitted.platform, 'web-desktop');
    assert.equal(submitted.outputName, 'web-desktop');
    assert.equal(submitted.taskName, 'web-desktop');
    assert.equal(submitted.mainBundleCompressionType, 'merge_dep');
    assert.equal(submitted.debug, false);
});

test('builder prefers Creator default options and keeps caller overrides', async () => {
    let submitted;
    const calls = [];
    const runtime = {
        message: {
            async request(_target, name, ...args) {
                calls.push(name);
                if (name === 'query-default-config') {
                    return {
                        options: {
                            platform: 'web-desktop',
                            outputName: 'creator-default',
                            taskName: 'creator-default',
                            mainBundleCompressionType: 'merge_dep',
                            debug: false,
                        },
                    };
                }
                if (name === 'add-task') {
                    submitted = args[0];
                    return 0;
                }
                if (name === 'query-task') {
                    throw new Error('query unavailable');
                }
                return {};
            },
        },
    };
    await new EditorMcpBuilderGateway(runtime).build({
        platform: 'web-desktop',
        options: { outputName: 'caller-name' },
    });
    assert.equal(submitted.outputName, 'caller-name');
    assert.equal(submitted.taskName, 'creator-default');
    assert.equal(submitted.debug, false);
    assert.equal(calls.includes('query-default-config'), true);
    assert.equal(calls.includes('query-tasks-info'), false);
});

test('builder does not inherit debug mode from historical tasks', async () => {
    let submitted;
    const runtime = {
        message: {
            async request(_target, name, ...args) {
                if (name === 'query-tasks-info') {
                    return {
                        list: [
                            {
                                options: {
                                    platform: 'web-desktop',
                                    outputName: 'web-desktop',
                                    taskName: 'web-desktop',
                                    mainBundleCompressionType: 'merge_dep',
                                    debug: true,
                                },
                            },
                        ],
                    };
                }
                if (name === 'add-task') {
                    submitted = args[0];
                    return 0;
                }
                if (name === 'query-task') {
                    throw new Error('query unavailable');
                }
                throw new Error(`unsupported:${name}`);
            },
        },
    };
    const gateway = new EditorMcpBuilderGateway(runtime);
    await gateway.build({ platform: 'web-desktop' });
    assert.equal(submitted.debug, false);
    await gateway.build({ platform: 'web-desktop', options: { debug: true } });
    assert.equal(submitted.debug, true);
});

test('builder.queryDefaultConfig asks Creator for defaults before task history', async () => {
    const calls = [];
    const gateway = new EditorMcpBuilderGateway({
        message: {
            async request(_target, name) {
                calls.push(name);
                if (name === 'query-default-config') {
                    return { platform: 'web-desktop', outputName: 'web-desktop' };
                }
                return { queue: {}, list: [] };
            },
        },
    });
    const result = await gateway.queryDefaultConfig({ platform: 'web-desktop' });
    assert.equal(result.message, 'builder_query_default_config_ok:query-default-config');
    assert.equal(result.data.outputName, 'web-desktop');
    assert.deepEqual(calls, ['query-default-config']);
});

test('builder.queryDefaultConfig does not report an empty task queue as defaults', async () => {
    const gateway = new EditorMcpBuilderGateway({
        message: {
            async request(_target, name) {
                if (name === 'query-tasks-info') {
                    return { queue: {}, list: [], free: true };
                }
                throw new Error(`unsupported:${name}`);
            },
        },
    });
    const result = await gateway.queryDefaultConfig({ platform: 'web-desktop' });
    assert.equal(result.available, false);
    assert.equal(result.message, 'builder_query_default_config_unavailable:no_executable_default_options');
});

test('builder verifies Creator project buildPath and outputName artifacts', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peanut-builder-artifact-'));
    const outputDirectory = join(projectRoot, 'build', 'web-desktop');
    let submitted;
    const runtime = {
        projectRead: {
            async getProjectPath() {
                return projectRoot;
            },
        },
        message: {
            async request(_target, name, ...args) {
                if (name === 'query-worker-ready') {
                    return true;
                }
                if (name === 'query-default-config') {
                    return {};
                }
                if (name === 'query-tasks-info') {
                    return { queue: {}, list: [] };
                }
                if (name === 'add-task') {
                    submitted = args[0];
                    mkdirSync(outputDirectory, { recursive: true });
                    writeFileSync(join(outputDirectory, 'index.html'), '<!doctype html>', 'utf8');
                    return 1;
                }
                if (name === 'query-task') {
                    return { id: submitted.taskId, state: 'success', stage: 'build', options: submitted };
                }
                throw new Error(`unsupported:${name}`);
            },
        },
    };
    const result = await new EditorMcpBuilderGateway(runtime).build({ platform: 'web-desktop' });
    assert.equal(result.status, 'completed');
    assert.equal(result.success, true);
    assert.deepEqual(result.artifacts, [realpathSync(join(outputDirectory, 'index.html'))]);
});
