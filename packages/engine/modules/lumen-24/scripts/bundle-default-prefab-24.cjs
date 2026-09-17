#!/usr/bin/env node
/**
 * @description 从本机 Creator 2.4.x 安装包 `static/default-assets/prefab` 打入 lumen-24 `bundled/default_prefab_24`。
 * @oopException 构建脚本入口，无领域对象归属。
 */
const { createHash } = require('crypto');
const {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} = require('fs');
const { dirname, join, relative, sep } = require('path');

const packageRoot = join(__dirname, '..');
const bundledRoot = join(packageRoot, 'bundled');
const bundledTemplates = join(bundledRoot, 'default_prefab_24');
const manifestPath = join(bundledRoot, 'lumen-24-templates.manifest.json');
const DEFAULT_CREATOR_VERSION = '2.4.11';

/** @description 根目录 UI 控件需镜像到 `ui/` 以支持 `ui/editbox` 等别名。 */
const UI_MIRROR_IDS = [
    'button',
    'canvas',
    'editbox',
    'label',
    'layout',
    'pageview',
    'progressBar',
    'richtext',
    'scrollview',
    'slider',
    'sprite',
    'toggle',
    'toggleContainer',
    'videoplayer',
    'webview',
];

main();

/**
 * @description 构建入口。
 * @oopException 构建脚本。
 */
function main() {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    const packageVersion = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
    const cocosVersion = process.env.COCOS_CREATOR_24_VERSION?.trim() || DEFAULT_CREATOR_VERSION;
    const sourceRoot = resolvePrefabSourceRoot(cocosVersion);
    if (sourceRoot == null) {
        const bundledFiles = existsSync(bundledTemplates) ? listPrefabs(bundledTemplates) : [];
        if (bundledFiles.length === 0) {
            throw new Error('bundle_source_and_committed_templates_missing');
        }
        process.stdout.write(
            `bundle_default_prefab_24: Creator ${cocosVersion} not found; preserved ${bundledFiles.length} committed templates\n`,
        );
        return;
    }
    mkdirSync(bundledRoot, { recursive: true });
    if (existsSync(bundledTemplates)) {
        rmSync(bundledTemplates, { recursive: true, force: true });
    }
    copyPrefabsOnly(sourceRoot, bundledTemplates);
    mirrorUiAliases(bundledTemplates);
    const files = listPrefabs(bundledTemplates);
    const hash = createHash('sha256');
    hash.update(`v2\n${cocosVersion}\n${packageVersion}\n`);
    for (const relativePath of files) {
        hash.update(relativePath);
        hash.update('\0');
        hash.update(readFileSync(join(bundledTemplates, relativePath)));
        hash.update('\n');
    }
    const previousManifest = existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, 'utf8'))
        : null;
    const contentHash = hash.digest('hex');
    const generatedAt =
        previousManifest?.cocosVersion === cocosVersion &&
        previousManifest?.packageVersion === packageVersion &&
        previousManifest?.contentHash === contentHash &&
        previousManifest?.templateCount === files.length &&
        previousManifest?.sourceRoot === sourceRoot &&
        typeof previousManifest?.generatedAt === 'string'
            ? previousManifest.generatedAt
            : new Date().toISOString();
    const manifest = {
        cocosVersion,
        packageVersion,
        contentHash,
        templateCount: files.length,
        sourceRoot,
        generatedAt,
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stdout.write(
        `bundled default_prefab_24 ← ${sourceRoot} → ${bundledTemplates} (cocos=${cocosVersion}, ${manifest.templateCount} prefabs, hash=${manifest.contentHash.slice(0, 12)}…)\n`,
    );
}

/**
 * @description 解析 Creator 2.4 prefab 源目录。
 * @param {string} cocosVersion 目标 Creator 版本
 * @returns {string | null} 绝对路径；允许缺失时返回 `null` 并保留已提交模板。
 * @oopException 构建脚本。
 */
function resolvePrefabSourceRoot(cocosVersion) {
    const envResources = process.env.COCOS_CREATOR_24_RESOURCES?.trim();
    if (envResources != null && envResources.length > 0) {
        const fromEnv = join(envResources, 'static', 'default-assets', 'prefab');
        if (existsSync(fromEnv)) {
            return fromEnv;
        }
        throw new Error(`bundle_source_missing:${fromEnv} (COCOS_CREATOR_24_RESOURCES=${envResources})`);
    }
    const discovered = discoverCreatorPrefabRoot(cocosVersion);
    if (discovered != null) {
        return discovered;
    }
    process.stderr.write(
        `bundle_default_prefab_24: Creator ${cocosVersion} not found; preserving committed templates\n`,
    );
    return null;
}

/**
 * @description 发现本机 Creator 2.4 prefab 目录。
 * @param {string} preferredVersion 优先版本
 * @returns {string | null} prefab 根或 null
 * @oopException 构建脚本。
 */
function discoverCreatorPrefabRoot(preferredVersion) {
    const candidates = [];
    if (process.platform === 'darwin') {
        candidates.push(join('/Applications/Cocos/Creator', preferredVersion));
    }
    const hubRoot = join(process.env.HOME ?? '', 'Applications', 'CocosCreator', 'Creator');
    if (existsSync(hubRoot)) {
        for (const entry of readdirSync(hubRoot, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                candidates.push(join(hubRoot, entry.name));
            }
        }
    }
    candidates.push(join('/Applications/Cocos/Creator', preferredVersion));
    for (const installRoot of candidates) {
        const prefabRoot = join(
            installRoot,
            'CocosCreator.app',
            'Contents',
            'Resources',
            'static',
            'default-assets',
            'prefab',
        );
        if (existsSync(prefabRoot)) {
            return prefabRoot;
        }
    }
    return null;
}

/**
 * @description 只复制 `.prefab`（跳过 `.meta` 与其它文件）。
 * @param {string} source 源根
 * @param {string} target 目标根
 * @oopException 构建脚本。
 */
function copyPrefabsOnly(source, target) {
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source)) {
        if (name.startsWith('.') || name === 'README.md') {
            continue;
        }
        const from = join(source, name);
        const to = join(target, name);
        const stat = statSync(from);
        if (stat.isDirectory()) {
            copyPrefabsOnly(from, to);
            continue;
        }
        if (!name.endsWith('.prefab')) {
            continue;
        }
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
    }
}

/**
 * @description 为 `ui/*` 模板别名镜像根目录 UI prefab。
 * @param {string} bundledRootDir bundled 根
 * @returns {void}
 * @oopException 构建脚本。
 */
function mirrorUiAliases(bundledRootDir) {
    const uiDir = join(bundledRootDir, 'ui');
    mkdirSync(uiDir, { recursive: true });
    for (const id of UI_MIRROR_IDS) {
        const source = join(bundledRootDir, `${id}.prefab`);
        if (!existsSync(source)) {
            continue;
        }
        copyFileSync(source, join(uiDir, `${id}.prefab`));
    }
}

/**
 * @description 列出 prefab 相对路径。
 * @param {string} root 根
 * @returns {string[]} 排序列表
 * @oopException 构建脚本。
 */
function listPrefabs(root) {
    const out = [];
    walk(root, root, out);
    return out.sort();
}

/**
 * @description 递归收集 prefab。
 * @param {string} root 根
 * @param {string} current 当前目录
 * @param {string[]} out 输出
 * @oopException 构建脚本。
 */
function walk(root, current, out) {
    for (const name of readdirSync(current)) {
        if (name.startsWith('.')) {
            continue;
        }
        const absolute = join(current, name);
        const stat = statSync(absolute);
        if (stat.isDirectory()) {
            walk(root, absolute, out);
            continue;
        }
        if (name.endsWith('.prefab')) {
            out.push(relative(root, absolute).split(sep).join('/'));
        }
    }
}
