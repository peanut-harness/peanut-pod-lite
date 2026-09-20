/**
 * @description 将打进 Creator 主进程的 bundle 中的 `node:` 内置模块前缀去掉。
 * Creator 3.8.x 仍跑旧 Electron（Node 14 级），`require('node:fs')` 会 module_load 失败；
 * 裸名 `fs` / `path` / `module` 可加载。源码可继续写 `node:`；仅产物需归一化。
 */

/**
 * @description 归一化单段 JS 文本中的 node: 协议前缀（require / import / from）。
 * @param {string} source 源码
 * @returns {string} 归一化后源码
 */
export function stripNodeBuiltinProtocol(source) {
    return source
        .replace(/\brequire\(\s*(['"])node:/g, 'require($1')
        .replace(/\bimport\(\s*(['"])node:/g, 'import($1')
        .replace(/\bfrom\s+(['"])node:/g, 'from $1');
}

const CREATOR_383_UNSUPPORTED_RUNTIME = /Object\.hasOwn|\.replaceAll\(|\.at\(\s*-1\s*\)|AbortSignal\.timeout/u;

/**
 * @description 拒绝 Creator 3.8.3（Electron 13 / Node 14）主进程缺失的运行时 API。
 * @param {string} source 已归一化 bundle
 * @returns {void}
 */
export function assertCreator383BundleCompatibility(source) {
    const match = source.match(CREATOR_383_UNSUPPORTED_RUNTIME);
    if (match != null) {
        throw new Error(`creator_383_bundle_runtime_unsupported:${match[0]}`);
    }
}
