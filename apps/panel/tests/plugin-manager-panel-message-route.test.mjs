import assert from 'assert/strict';
import { readFileSync } from 'fs';
import path from 'path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const panelEntryPath = path.resolve(testsDirectory, '../panels/plugin-manager/embedded/index.js');

test('plugin manager panel opens generated plugin panels through the stable host message', () => {
    const source = readFileSync(panelEntryPath, 'utf8');

    assert.match(source, /Message\.request\(extensionName, 'open-generated-plugin-panel', pluginId\)/);
    assert.doesNotMatch(source, /createGeneratedPluginPanelMessageName/);
    assert.doesNotMatch(source, /open-generated-plugin-\$\{encodedPluginId\}/);
});

// Execute the shipped panel's presentation and bridge logic without a Creator process.
// Records below are test-only inputs; the standalone panel must remain empty.
function createPanelHarness({ embedded = false } = {}) {
    const nodes = new Map();
    const html = readFileSync(path.resolve(testsDirectory, '../panels/plugin-manager/embedded/index.html'), 'utf8');
    function node(attributes = {}) {
        const ancestors = new Map();
        const classes = new Set((attributes.class ?? '').split(' '));
        return {
            value: '', textContent: '', innerHTML: '', hidden: 'hidden' in attributes, disabled: false, listeners: {},
            tabIndex: Number(attributes.tabindex ?? 0), focused: false, children: [],
            get childElementCount() { return this.children.length; },
            appendChild(child) { this.children.push(child); child.parentNode = this; if (child.id) nodes.set(`#${child.id}`, child); },
            remove() { this.parentNode.children = this.parentNode.children.filter((child) => child !== this); if (this.id) nodes.delete(`#${this.id}`); },
            classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) },
            getAttribute(name) { return attributes[name] ?? null; }, setAttribute(name, value) { attributes[name] = value; },
            querySelectorAll() { return []; }, focus() { this.focused = true; },
            replaceChildren() { this.innerHTML = ''; }, addEventListener(event, callback) { this.listeners[event] = callback; },
            closest(selector) { if (!ancestors.has(selector)) ancestors.set(selector, node()); return ancestors.get(selector); },
        };
    }
    const allNodes = [];
    for (const tag of html.matchAll(/<[a-z][\w-]*\b([^<>]*)>/g)) {
        const attributes = Object.fromEntries([...tag[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((match) => [match[1], match[2] ?? '']));
        const element = node(attributes);
        allNodes.push(element);
        if (attributes.id) nodes.set(`#${attributes.id}`, element);
    }
    const document = {
        addEventListener() {}, documentElement: {}, body: node(), createElement: () => node(),
        appendChild() { throw new Error('Document already has a document element'); },
        querySelector: (selector) => nodes.get(selector) ?? null,
        querySelectorAll: (selector) => {
            const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1];
            return attribute ? allNodes.filter((element) => element.getAttribute(attribute) != null) : [];
        },
    };
    const root = embedded ? { ...node(), ownerDocument: document, querySelector: document.querySelector, querySelectorAll: document.querySelectorAll } : document;
    const window = { setTimeout() {}, __PEANUT_PLUGIN_MANAGER_PANEL_ROOT__: embedded ? root : undefined };
    const context = vm.createContext({ window, document, console, setTimeout, clearTimeout });
    const source = readFileSync(panelEntryPath, 'utf8').replace('bootstrap().catch((error) => {\n    applyError(error);\n});', '');
    vm.runInContext(source, context);
    return { nodes, context, document, root, run: (code) => vm.runInContext(code, context) };
}

function packageFixture(overrides = {}) {
    return { pluginId: 'test.plugin', displayName: 'Test Plugin', version: '2.0.0', sourceKind: 'registry', sourcePath: 'test-registry', packagePath: '/test/v2', installedActiveVersion: '1.0.0', ...overrides };
}

function stateFixture(overrides = {}) {
    return { status: 'ready', preferences: { locale: 'zh-CN' }, runtimeRecords: [], packageCatalog: [], selectedPluginId: null, selectedPackagePath: null, selectedRuntimeRecord: null, ...overrides };
}

test('hostless panel has no invented records and cannot simulate successful installs', async () => {
    const panel = createPanelHarness();
    const bridge = panel.run('createPreviewBridge()');
    const snapshot = await bridge.request({ id: 'snapshot', event: 'pluginManager.snapshot' });
    assert.equal(snapshot.payload.runtimeRecords.length, 0);
    assert.equal(snapshot.payload.packageCatalog.length, 0);
    assert.equal((await bridge.request({ id: 'install', event: 'pluginManager.package.install' })).ok, false);
});

test('catalog merges versions, searches names, and only counts higher releases as updates', () => {
    const panel = createPanelHarness();
    panel.context.state = stateFixture({ packageCatalog: [
        packageFixture(), packageFixture({ version: '0.9.0', packagePath: '/test/old' }),
        packageFixture({ version: '3.0.0', packagePath: '/test/dev', sourceKind: 'manual' }),
    ] });
    assert.equal(panel.run('filterPackageCatalog(getPackageCatalogEntries(state)).length'), 1);
    assert.equal(panel.run('filterPackageCatalog(getPackageCatalogEntries(state))[0].version'), '2.0.0');
    panel.run("uiState.packageSearch = 'test plugin'");
    assert.equal(panel.run('filterPackageCatalog(getPackageCatalogEntries(state)).length'), 1);
    panel.run("uiState.packageFilter = 'upgrade'");
    assert.equal(panel.run('filterPackageCatalog(state.packageCatalog)[0].version'), '2.0.0');
    assert.equal(panel.run("hasPackageUpdate({version:'1.0.0-beta.2',installedActiveVersion:'1.0.0'})"), false);
    assert.equal(panel.run("hasPackageUpdate({version:'1.0.0',installedActiveVersion:'1.0.0-beta.2'})"), true);
    assert.equal(panel.run("hasPackageUpdate({version:'1.0.0-beta.10',installedActiveVersion:'1.0.0-beta.2'})"), true);
    assert.equal(panel.run("hasPackageUpdate({version:'unknown',installedActiveVersion:'1.0.0'})"), false);
});

test('runtime-only plugin retains description and lifecycle controls without an installable package', () => {
    const panel = createPanelHarness();
    const record = { pluginId: 'test.runtime', displayName: 'Real runtime', version: '1.0.0', state: 'active', description: { 'zh-CN': '实际运行记录简介' } };
    panel.context.state = stateFixture({ runtimeRecords: [record], selectedRuntimeRecord: record, selectedPluginId: record.pluginId });
    panel.run('renderPackageSelection(state); renderActions(state)');
    assert.equal(panel.nodes.get('#packageSelectionTitle').textContent, 'Real runtime');
    assert.equal(panel.nodes.get('#packageSelectionDescription').textContent, '实际运行记录简介');
    assert.equal(panel.nodes.get('#packageRuntimeControls').hidden, false);
    assert.equal(panel.nodes.get('#deactivateButton').disabled, false);
    assert.equal(panel.nodes.get('#openPanelButton').disabled, false);
    assert.equal(panel.nodes.get('#installPackageButton').disabled, true);
    assert.equal(panel.nodes.get('#packagePathInput').value, '');
    assert.equal(panel.run('getPackageCatalogEntries(state)[0].packagePath'), null);
});

test('detail never controls the previous plugin during selection and pending actions', () => {
    const panel = createPanelHarness();
    panel.context.state = stateFixture({ packageCatalog: [packageFixture()], selectedPackagePath: '/test/v2',
        selectedPluginId: 'old.plugin', selectedRuntimeRecord: { pluginId: 'old.plugin', state: 'active' } });
    panel.run('renderPackageSelection(state); renderActions(state)');
    assert.equal(panel.nodes.get('#packageRuntimeControls').hidden, true);
    assert.equal(panel.nodes.get('#deactivateButton').disabled, true);
    assert.equal(panel.nodes.get('#uninstallPackageButton').disabled, true);
    panel.context.state.status = 'loading';
    panel.run('renderPackageSelection(state)');
    assert.equal(panel.nodes.get('#installPackageButton').disabled, true);
});

test('detail version selector stays within its channel and escapes source data', () => {
    const panel = createPanelHarness();
    panel.context.state = stateFixture({ selectedPackagePath: '/test/v2', packageCatalog: [
        packageFixture({ displayName: '<img onerror=alert(1)>' }),
        packageFixture({ version: '3.0.0', sourceKind: 'manual', packagePath: '/test/dev' }),
    ] });
    panel.run('latestRenderedState = state; renderPackageSelection(state)');
    assert.equal(panel.nodes.get('#packageCatalogVersionSelect').closest('.package-version-field').hidden, false);
    assert.doesNotMatch(panel.nodes.get('#packageCatalogVersionSelect').innerHTML, /test\/dev/);
    assert.match(panel.run('buildPackageCatalogCard(state.packageCatalog[0],state.selectedPackagePath)'), /&lt;img/);
    panel.run("uiState.packageChannel = 'development'; renderPackageSelection(state)");
    assert.equal(panel.nodes.get('#packageSelectionMeta').hidden, true);
    assert.equal(panel.nodes.get('#installPackageButton').disabled, true);
});

test('bridge-backed search uses the rendered snapshot and authoring packages its own source directory', async () => {
    const panel = createPanelHarness();
    const calls = [];
    panel.context.state = stateFixture({ packageCatalog: [packageFixture()] });
    panel.context.driver = {
        async packPackage(source) { calls.push(source); return { pluginId: 'test.plugin', version: '2.0.0', packagePath: '/test/packed' }; },
    };
    panel.run('latestRenderedState = state; bindActions(driver)');
    panel.nodes.get('#packageSearchInput').value = 'no match';
    panel.nodes.get('#packageSearchInput').listeners.input();
    assert.match(panel.nodes.get('#packageCatalog').innerHTML, /没有符合筛选条件/);
    panel.nodes.get('#packagePathInput').value = '/wrong/hidden-selection';
    panel.nodes.get('#packageAuthoringPathInput').value = '/test/source';
    await panel.nodes.get('#packPackageButton').listeners.click();
    assert.deepEqual(calls, ['/test/source']);
    assert.equal(panel.nodes.get('#packageSourcePackagePathInput').value, '/test/packed');
    assert.match(panel.nodes.get('#packageAuthoringStatus').textContent, /test.plugin@2.0.0/);
});


test('detail tabs support keyboard navigation and fall back when the next plugin has no runtime', () => {
    const panel = createPanelHarness();
    const record = { pluginId: 'test.plugin', state: 'active', version: '1.0.0' };
    panel.context.state = stateFixture({ selectedPackagePath: '/test/v2', packageCatalog: [packageFixture()],
        selectedPluginId: record.pluginId, selectedRuntimeRecord: record, runtimeRecords: [record] });
    panel.run('renderPackageSelection(state); bindPackageDetailTabs()');
    const description = panel.nodes.get('#packageDescriptionTab');
    const versions = panel.nodes.get('#packageVersionsTab');
    const runtime = panel.nodes.get('#packageRuntimeTab');
    let prevented = false;
    description.listeners.keydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(versions.getAttribute('aria-selected'), 'true');
    assert.equal(versions.tabIndex, 0);
    assert.equal(description.tabIndex, -1);
    assert.equal(versions.focused, true);
    assert.equal(panel.nodes.get('#packageDescriptionView').hidden, true);
    assert.equal(panel.nodes.get('#packageVersionsView').hidden, false);
    versions.listeners.keydown({ key: 'End', preventDefault() {} });
    assert.equal(runtime.getAttribute('aria-selected'), 'true');
    panel.context.state.selectedPluginId = 'old.plugin';
    panel.run('renderPackageSelection(state)');
    assert.equal(runtime.hidden, true);
    assert.equal(runtime.tabIndex, -1);
    assert.equal(runtime.getAttribute('aria-selected'), 'false');
    assert.equal(description.getAttribute('aria-selected'), 'true');
    assert.equal(panel.nodes.get('#packageRuntimeView').hidden, true);
    description.listeners.keydown({ key: 'ArrowLeft', preventDefault() {} });
    assert.equal(versions.getAttribute('aria-selected'), 'true');
    versions.listeners.keydown({ key: 'Home', preventDefault() {} });
    assert.equal(description.getAttribute('aria-selected'), 'true');
});

test('versions tab never presents another plugin installation snapshot', () => {
    const panel = createPanelHarness();
    panel.context.state = stateFixture({ selectedPackagePath: '/test/v2', packageCatalog: [packageFixture()],
        selectedPluginId: 'old.plugin', selectedInstalledPackageSnapshot: { pluginId: 'old.plugin', activeVersion: '9.0.0', versions: ['9.0.0'] } });
    panel.run('renderPackageSelection(state); renderPackageVersions(state)');
    assert.equal(panel.nodes.get('#packageVersionCard').hidden, true);
    assert.equal(panel.nodes.get('#packageVersionSelect').innerHTML, '');
    assert.equal(panel.nodes.get('#packageVersionsUnavailable').hidden, false);
    panel.context.state.selectedPluginId = 'test.plugin';
    panel.context.state.selectedInstalledPackageSnapshot = { pluginId: 'test.plugin', activeVersion: '1.0.0', versions: ['1.0.0', '0.9.0'] };
    panel.run('renderPackageVersions(state)');
    assert.equal(panel.nodes.get('#packageVersionCard').hidden, false);
    assert.match(panel.nodes.get('#packageVersionSelect').innerHTML, /0.9.0/);
    assert.equal(panel.nodes.get('#packageVersionsUnavailable').hidden, true);
});

test('empty selection hides detail chrome while a chosen local folder keeps its install action', () => {
    const panel = createPanelHarness();
    panel.context.state = stateFixture();
    panel.run('renderPackageSelection(state)');
    assert.equal(panel.nodes.get('#packageSelectionPanel').classList.contains('is-empty'), true);
    assert.equal(panel.nodes.get('#packageDetailTabs').hidden, true);
    assert.equal(panel.nodes.get('#installPackageButton').hidden, true);
    panel.run("uiState.packageChannel = 'development'; uiState.localPackagePath = '/real/local/folder'; renderPackageSelection(state)");
    assert.equal(panel.nodes.get('#packageSelectionPanel').classList.contains('is-empty'), false);
    assert.equal(panel.nodes.get('#packageDetailTabs').hidden, true);
    assert.equal(panel.nodes.get('#installPackageButton').hidden, false);
    assert.equal(panel.nodes.get('#installPackageButton').disabled, false);
    assert.equal(panel.nodes.get('#packagePathInput').value, '/real/local/folder');
});


test('full hostless bootstrap renders an empty catalog and all navigation without inventing data', async () => {
    const panel = createPanelHarness();
    await panel.run('bootstrap()');
    assert.equal(panel.run('latestRenderedState.bridgeMode'), 'preview');
    assert.equal(panel.run('latestRenderedState.runtimeRecords.length'), 0);
    assert.match(panel.nodes.get('#packageCatalog').innerHTML, /Creator/);
    assert.equal(panel.nodes.get('#packageDetailTabs').hidden, true);
    assert.deepEqual(panel.document.querySelectorAll('[data-workbench-view]').map((view) => view.getAttribute('data-workbench-view')), [
        'packages', 'authoring', 'mcp', 'about', 'settings',
    ]);
    for (const [button, view] of [['authoringTabButton', 'authoring'], ['mcpTabButton', 'mcp'], ['settingsButton', 'settings'], ['aboutTabButton', 'about'], ['packagesTabButton', 'packages']]) {
        panel.nodes.get(`#${button}`).listeners.click();
        assert.equal(panel.run('uiState.activeWorkbenchTab'), view);
        const visible = panel.document.querySelectorAll('[data-workbench-view]').filter((node) => !node.hidden);
        assert.deepEqual(visible.map((node) => node.getAttribute('data-workbench-view')), [view]);
    }
});

test('settings stays inside the current workbench and cancel returns to its previous tab', async () => {
    const panel = createPanelHarness();
    panel.context.state = stateFixture();
    panel.context.driver = { updatePreferences: async (preferences) => ({ ...panel.context.state, preferences }) };
    panel.run('latestRenderedState = state; bindActions(driver)');
    panel.nodes.get('#settingsButton').listeners.click();
    assert.equal(panel.run("uiState.activeWorkbenchTab === 'settings'"), true);
    assert.equal(panel.run("document.querySelectorAll('[data-workbench-view]').find((view) => view.getAttribute('data-workbench-view') === 'settings').hidden"), false);
    assert.equal(panel.run("document.querySelectorAll('[data-workbench-view]').find((view) => view.getAttribute('data-workbench-view') === 'packages').hidden"), true);
    assert.equal(panel.nodes.has('#settingsOverlay'), false);
    assert.equal(panel.nodes.has('#settingsCloseButton'), false);
    const html = readFileSync(path.resolve(testsDirectory, '../panels/plugin-manager/embedded/index.html'), 'utf8');
    assert.match(html, /<div class="workbench-panel">[\s\S]*?<section id="settingsView"/);
    panel.nodes.get('#settingsCancelButton').listeners.click();
    assert.equal(panel.run("uiState.activeWorkbenchTab === 'packages'"), true);
    panel.nodes.get('#settingsButton').listeners.click();
    panel.nodes.get('#settingsLocaleSelect').value = 'en-US';
    await panel.run('saveSettingsPage(driver)');
    assert.equal(panel.run("uiState.activeWorkbenchTab === 'settings'"), true);
});

test('adding a local folder from the release channel opens a usable development install selection', async () => {
    const panel = createPanelHarness();
    panel.context.state = stateFixture();
    const selections = [];
    panel.context.driver = { pickPackageDirectory: async () => '/test/local-plugin', selectPackageCatalogItem: async (path) => selections.push(path) };
    panel.run('latestRenderedState = state');
    await panel.run('choosePackageDirectory(driver)');
    assert.equal(panel.run('uiState.packageChannel'), 'development');
    assert.equal(panel.nodes.get('#packagePathInput').value, '/test/local-plugin');
    assert.equal(panel.nodes.get('#installPackageButton').hidden, false);
    assert.equal(panel.nodes.get('#installPackageButton').disabled, false);
    assert.equal(panel.document.querySelectorAll('[data-package-channel]').find((node) => node.getAttribute('aria-selected') === 'true').getAttribute('data-package-channel'), 'development');
    assert.deepEqual(selections, [null]);
});

test('cancelled local folder selection preserves the existing channel and detail', async () => {
    const panel = createPanelHarness();
    panel.context.state = stateFixture({ packageCatalog: [packageFixture()], selectedPackagePath: '/test/v2' });
    panel.context.driver = { pickPackageDirectory: async () => null, selectPackageCatalogItem: async () => assert.fail('cancel must not clear selection') };
    panel.run('latestRenderedState = state; renderPackageSelection(state)');
    await panel.run('choosePackageDirectory(driver)');
    assert.equal(panel.run('uiState.packageChannel'), 'release');
    assert.equal(panel.nodes.get('#packagePathInput').value, '/test/v2');
});

test('standalone errors mount in document body and Creator errors stay inside its panel root', () => {
    for (const embedded of [false, true]) {
        const panel = createPanelHarness({ embedded });
        assert.doesNotThrow(() => panel.run("applyError(new Error('test error'))"));
        const container = embedded ? panel.root : panel.document.body;
        assert.equal(container.children[0].id, 'pluginManagerToastRegion');
        assert.equal(container.children[0].children[0].textContent, 'test error');
    }
});

test('authoring result remains visible after later host refreshes', async () => {
    const panel = createPanelHarness();
    panel.context.state = stateFixture();
    panel.context.driver = { createPluginTemplate: async () => ({ targetDirectory: '/test/new-plugin', files: ['package.json'] }) };
    panel.run('latestRenderedState = state; bindActions(driver)');
    await panel.nodes.get('#createPluginButton').listeners.click();
    panel.run('render(state)');
    assert.match(panel.nodes.get('#authoringResult').textContent, /test\/new-plugin/);
    assert.equal(panel.nodes.get('#packageAuthoringPathInput').value, '/test/new-plugin');
});
