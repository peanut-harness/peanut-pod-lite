#!/usr/bin/env node
/**
 * @description 将仓库 `products/cocos/default_prefab` 打进 lumen 包内 `bundled/default_prefab`，供单独分发与缓存同步。
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
const repoTemplateRoot = join(packageRoot, '..', '..', '..', 'default_prefab');
const bundledRoot = join(packageRoot, 'bundled');
const bundledTemplates = join(bundledRoot, 'default_prefab');
const manifestPath = join(bundledRoot, 'lumen-templates.manifest.json');

main();

/**
 * @description 构建入口。
 * @oopException 构建脚本。
 */
function main() {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    const packageVersion = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
    const cocosVersion = '3.8.3';
    mkdirSync(bundledRoot, { recursive: true });
    // Lite 仓已随包携带 bundled/；无 monorepo default_prefab 源时复用现有产物。
    if (!existsSync(repoTemplateRoot)) {
        if (existsSync(bundledTemplates) && existsSync(manifestPath)) {
            process.stdout.write(
                JSON.stringify(
                    { ok: true, skipped: true, reason: 'bundled_present', bundledTemplates, manifestPath },
                    null,
                    2,
                ) + '\n',
            );
            return;
        }
        throw new Error(`bundle_source_missing:${repoTemplateRoot}`);
    }
    if (existsSync(bundledTemplates)) {
        rmSync(bundledTemplates, { recursive: true, force: true });
    }
    copyDirectory(repoTemplateRoot, bundledTemplates);
    const files = listPrefabs(bundledTemplates);
    const hash = createHash('sha256');
    hash.update(`v2\n${cocosVersion}\n${packageVersion}\n`);
    for (const relativePath of files) {
        hash.update(relativePath);
        hash.update('\0');
        hash.update(readFileSync(join(bundledTemplates, relativePath), 'utf8').replace(/\r\n?/gu, '\n'));
        hash.update('\n');
    }
    const manifest = {
        cocosVersion,
        packageVersion,
        contentHash: hash.digest('hex'),
        templateCount: files.length,
        generatedAt: new Date().toISOString(),
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stdout.write(
        `bundled default_prefab → ${bundledTemplates} (cocos=${cocosVersion}, ${manifest.templateCount} prefabs, hash=${manifest.contentHash.slice(0, 12)}…)\n`,
    );
}

/**
 * @description 递归复制。
 * @param source 源
 * @param target 目标
 * @oopException 构建脚本。
 */
function copyDirectory(source, target) {
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source)) {
        if (name.startsWith('.')) {
            continue;
        }
        const from = join(source, name);
        const to = join(target, name);
        const stat = statSync(from);
        if (stat.isDirectory()) {
            copyDirectory(from, to);
        } else {
            mkdirSync(dirname(to), { recursive: true });
            copyFileSync(from, to);
        }
    }
}

/**
 * @description 列出 prefab 相对路径。
 * @param root 根
 * @returns 排序列表
 * @oopException 构建脚本。
 */
function listPrefabs(root) {
    const out = [];
    walk(root, root, out);
    return out.sort();
}

/**
 * @description 递归收集。
 * @param root 根
 * @param current 当前
 * @param out 输出
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
