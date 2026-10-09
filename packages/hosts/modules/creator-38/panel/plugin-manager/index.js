'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @description 解析 Plugin Manager 静态资源目录；完整的扩展内置资源优先，避免环境依赖解析到旧版本 UI。
 * @returns {string} 含 index.html、CSS 与页面脚本的静态资源目录
 */
function resolveStaticPanelDirectory() {
    const embeddedDirectory = path.resolve(__dirname, '../../panels/plugin-manager/embedded');
    const requiredAssets = ['index.html', 'index.css', 'index.js'];
    const hasEmbeddedAssets = requiredAssets.every((assetName) => fs.existsSync(path.join(embeddedDirectory, assetName)));
    if (hasEmbeddedAssets) {
        return embeddedDirectory;
    }

    try {
        return path.dirname(require.resolve('@peanut/pod-panel/panels/plugin-manager/embedded/index.js'));
    } catch {
        throw new Error(`plugin_manager_static_assets_missing:${embeddedDirectory}`);
    }
}
/**
 * @description 解析源码布局或部署扁平布局中的面板资源文件。
 * @param sourceName 源码目录使用的文件名
 * @param deployedName 自包含宿主使用的扁平文件名
 * @returns 当前静态资源目录中实际存在的文件路径
 */
function resolveStaticPanelAsset(sourceName, deployedName) {
    const sourcePath = path.join(staticPanelDirectory, sourceName);
    return fs.existsSync(sourcePath) ? sourcePath : path.join(staticPanelDirectory, deployedName);
}

/**
 * @description 从当前扩展清单解析真实宿主名称，避免自包含部署继续使用 example 消息命名空间。
 * @returns 当前 Creator 扩展的稳定名称
 */
function resolveExtensionName() {
    try {
        const extensionPackagePath = path.resolve(__dirname, '../../package.json');
        const extensionPackage = JSON.parse(fs.readFileSync(extensionPackagePath, 'utf8'));
        return typeof extensionPackage.name === 'string' && extensionPackage.name.length > 0
            ? extensionPackage.name
            : 'peanut-pod';
    } catch {
        return 'peanut-pod';
    }
}

const staticPanelDirectory = resolveStaticPanelDirectory();
const staticPanelHtml = fs.readFileSync(path.join(staticPanelDirectory, 'index.html'), 'utf8');
const staticPanelBody = staticPanelHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '';

exports.template = `<div id="pluginManagerRoot">${staticPanelBody.replace(/<script[^>]*src=[^>]*><\/script>/i, '')}</div>`;
exports.style = fs.readFileSync(resolveStaticPanelAsset('index.css', 'plugin-manager-panel.css'), 'utf8');

exports.$ = {
    pluginManagerRoot: '#pluginManagerRoot',
};

/**
 * @description 在 Cocos 已将模板挂载到面板 DOM 后启动 Plugin Manager 页面脚本。
 * @returns void
 */
exports.ready = function () {
    // 每次挂载都从实际扩展清单刷新命名空间，清除面板热重载遗留的 example 值。
    window.__PEANUT_COCOS_EXTENSION_NAME__ = resolveExtensionName();
    window.__PEANUT_PLUGIN_MANAGER_PANEL_ROOT__ = this.$.pluginManagerRoot;
    window.__PEANUT_PLUGIN_MANAGER_STATIC_ASSET_DIRECTORY__ = staticPanelDirectory;
    console.info('[peanut-plugin-manager] static assets loaded from', staticPanelDirectory);

    const panelScriptPath = require.resolve(resolveStaticPanelAsset('index.js', 'plugin-manager-panel.js'));
    delete require.cache[panelScriptPath];
    require(panelScriptPath);
};
