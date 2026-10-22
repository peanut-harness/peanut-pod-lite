import assert from 'node:assert/strict';
import test from 'node:test';

import { RuntimeFacade } from '@peanut/pod-engine/runtime';
import { CoreCocosNativeWriteCapabilityCatalog, CoreCocosMcpCapabilityCatalog, CoreCocosMcpToolDefinitionCatalog } from '@peanut/pod-engine/policy';
import { EditorMcpActionRouter } from '../src/editor-mcp-action-router.js';
import { EditorMcpToolCatalog } from '../src/editor-mcp-tool-catalog.js';
import { EditorMcpViewportGateway } from '../src/editor-mcp-viewport-gateway.js';

interface IFixture {
    readonly gateway: EditorMcpViewportGateway;
    readonly calls: string[];
    readonly setCameraMovement: (enabled: boolean) => void;
    readonly setCameraQueryFailure: (failure: Error | null) => void;
    readonly failGridSetter: (enabled: boolean) => void;
}

/**
 * @oopException 测试夹具工厂仅负责可复用的原生消息桩。
 */
function createFixture(version = '3.8.7', nodes: readonly Record<string, unknown>[] = [{ uuid: 'node-a', path: '/Root/A' }]): IFixture {
    const runtime = new RuntimeFacade(version);
    const calls: string[] = [];
    let mode = false;
    let grid = true;
    let cameraMoves = true;
    let cameraQueryFailure: Error | null = null;
    let failGrid = false;
    const camera = { position: { x: 0, y: 0, z: 10 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, viewCenter: { x: 0, y: 0, z: 0 }, contentRect: { x: 0, y: 0, width: 100, height: 100 }, scale: 1 };
    const message = {
        request: async <TData = unknown>(_target: string, name: string, ...args: unknown[]): Promise<TData> => {
            calls.push(name);
            let result: unknown;
            if (name === 'query-is2D') result = mode;
            else if (name === 'query-is-grid-visible') result = grid;
            else if (name === 'change-is2D') { mode = args[0] === true; result = undefined; }
            else if (name === 'set-grid-visible') { if (failGrid) throw new Error('grid setter rejected'); grid = args[0] === true; result = undefined; }
            else if (name === 'focus-camera') { if (cameraMoves) camera.viewCenter.x = 5; result = undefined; }
            else throw new Error(`unexpected_message:${name}`);
            return result as TData;
        },
        send: async (): Promise<void> => undefined,
        broadcast: async (): Promise<void> => undefined,
    };
    const scene = {
        getManifestField: () => 'contributions.scene.script' as const,
        getCurrent: async () => null,
        getHierarchy: async () => nodes,
        execute: async <TData = unknown>(_package: string, method: string): Promise<TData> => {
            if (method !== 'queryViewportCamera') throw new Error('unexpected_scene_script_method');
            if (cameraQueryFailure != null) throw cameraQueryFailure;
            return structuredClone(camera) as TData;
        },
    };
    return {
        gateway: new EditorMcpViewportGateway({ version: runtime.version, message, scene }),
        calls,
        setCameraMovement: (enabled) => { cameraMoves = enabled; },
        setCameraQueryFailure: (failure) => { cameraQueryFailure = failure; },
        failGridSetter: (enabled) => { failGrid = enabled; },
    };
}

test('queryState reads current Creator mode, grid and scene-script camera snapshot', async () => {
    const { gateway } = createFixture();
    const result = await gateway.queryState();
    assert.equal(result.creatorVersion, '3.8.7');
    assert.equal(result.is2D, false);
    assert.equal(result.gridVisible, true);
    assert.equal(result.camera?.viewCenter[0], 0);
    assert.equal(result.fields.camera?.available, true);
});

test('queryState preserves allowlisted camera diagnostic codes and hides unknown exception text', async () => {
    const { gateway, setCameraQueryFailure } = createFixture();
    setCameraQueryFailure(new Error('creator_viewport_camera_unavailable'));
    assert.equal((await gateway.queryState()).fields.camera?.failureCode, 'creator_viewport_camera_unavailable');
    setCameraQueryFailure(new Error('private environment detail'));
    assert.equal((await gateway.queryState()).fields.camera?.failureCode, 'creator_camera_query_failed');
});

test('setState writes each field through official messages and verifies readback', async () => {
    const { gateway } = createFixture();
    const result = await gateway.setState({ is2D: true, gridVisible: false });
    assert.equal(result.status, 'verified');
    assert.equal(result.fields.is2D?.actual, true);
    assert.equal(result.fields.gridVisible?.actual, false);
    assert.equal(result.fields.is2D?.verified, true);
});

test('setState reports a per-field partial failure without hiding the successful field', async () => {
    const { gateway, failGridSetter } = createFixture();
    failGridSetter(true);
    const result = await gateway.setState({ is2D: true, gridVisible: false });
    assert.equal(result.status, 'partial_failure');
    assert.equal(result.fields.is2D?.verified, true);
    assert.equal(result.fields.gridVisible?.accepted, false);
    assert.equal(result.fields.gridVisible?.failureCode, 'creator_set_failed');
});

test('focusNodes resolves exact targets and calls camera focus without changing selection', async () => {
    const { gateway, calls } = createFixture();
    const result = await gateway.focusNodes(['/Root/A']);
    assert.equal(result.status, 'verified');
    assert.ok(calls.includes('focus-camera'));
    assert.equal(calls.some((name) => name.includes('select')), false);
});

test('focus refuses ambiguous nodes and leaves void-only focus acceptance unverified', async () => {
    const ambiguous = createFixture('3.8.7', [{ uuid: 'one', path: '/Root/A' }, { uuid: 'two', path: '/Root/A' }]);
    const refused = await ambiguous.gateway.focusNodes(['/Root/A']);
    assert.equal(refused.status, 'refused');
    assert.equal(ambiguous.calls.includes('focus-camera'), false);

    const unchanged = createFixture();
    unchanged.setCameraMovement(false);
    const accepted = await unchanged.gateway.focusNodes(['/Root/A']);
    assert.equal(accepted.status, 'accepted_unverified');
    assert.equal(accepted.ok, false);
});

test('unsupported Creator versions reject writes and stay explicit in query capabilities', async () => {
    const { gateway, calls } = createFixture('3.8.6');
    const query = await gateway.queryState();
    assert.equal(query.fields.is2D?.supported, false);
    const result = await gateway.setState({ is2D: true });
    assert.equal(result.status, 'refused');
    assert.equal(calls.length, 0);
});

test('viewport write capabilities require local approval and query remains local read', () => {
    for (const operation of ['viewport.focusNodes', 'viewport.setState']) {
        assert.equal(CoreCocosNativeWriteCapabilityCatalog.find(operation)?.policy.requiresLocalApproval, true);
    }
    assert.equal(CoreCocosMcpCapabilityCatalog.find('viewport.queryState')?.policy.requiresLocalApproval, false);
});

test('Creator and Core catalogs publish the same query schema and approval-gated write tools', () => {
    const runtime = new RuntimeFacade('3.8.7');
    const router = new EditorMcpActionRouter({ version: runtime.version });
    const core = new CoreCocosMcpToolDefinitionCatalog();
    const local = new EditorMcpToolCatalog().buildDefinitions(router.listCapabilities());
    const coreQuery = core.findByOperation('viewport.queryState');
    const localQuery = local.find((tool) => tool.name === 'peanut.editor-mcp.viewport-query-state');
    assert.ok(coreQuery);
    assert.ok(localQuery);
    assert.deepEqual(localQuery.inputSchema, coreQuery.inputSchema);
    for (const operation of ['viewport.focusNodes', 'viewport.setState']) {
        const definition = core.findByOperation(operation);
        assert.ok(definition);
        assert.equal(definition.requiresLocalApproval, true);
        assert.equal(definition.executionModel, 'managed_task');
        assert.ok(definition.aiHandling.successSignals.includes('result.data.status=verified'));
    }
});
