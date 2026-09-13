import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @description 解析 lumen-24 随包 `bundled/default_prefab_24` 根目录。
 */
export class Lumen24DefaultTemplateRoot {
    /**
     * @description 目录名。
     */
    public static readonly DIR_NAME = 'default_prefab_24';

    /**
     * @description 可选覆盖（测试 / Bridge 注入）。
     */
    private static _overrideRoot: string | null = null;

    /**
     * @description 已按工程解析过的根（避免重复扫 installed.json）。
     */
    private static _projectResolvedRoot: string | null = null;

    /**
     * @description 注入模板根（单测或插件显式路径）。
     * @param absoluteRoot 绝对路径或 null 清除
     * @returns void
     */
    public static setOverride(absoluteRoot: string | null): void {
        Lumen24DefaultTemplateRoot._overrideRoot =
            absoluteRoot == null || absoluteRoot.trim().length === 0 ? null : absoluteRoot.trim();
        Lumen24DefaultTemplateRoot._projectResolvedRoot = null;
    }

    /**
     * @description 从 Creator 工程内已安装的 `peanut.editor-mcp` 包解析模板根（fat bundle 下 `import.meta` 不可靠）。
     * @param projectRoot 工程根
     * @returns 模板根；找不到则 null
     */
    public static resolveFromProject(projectRoot: string): string | null {
        const normalized = projectRoot.replace(/\\/gu, '/').replace(/\/+$/u, '');
        if (normalized.length === 0) {
            return null;
        }
        const pluginHome = join(normalized, 'peanut-plugins', 'plugins', 'peanut.editor-mcp');
        if (!existsSync(pluginHome) || !statSync(pluginHome).isDirectory()) {
            return null;
        }
        const installedPath = join(normalized, 'peanut-plugins', 'installed.json');
        const activeVersion = Lumen24DefaultTemplateRoot._readActiveVersion(installedPath);
        const candidates: string[] = [];
        if (activeVersion != null) {
            candidates.push(join(pluginHome, activeVersion, 'bundled', Lumen24DefaultTemplateRoot.DIR_NAME));
        }
        for (const name of readdirSync(pluginHome).sort().reverse()) {
            candidates.push(join(pluginHome, name, 'bundled', Lumen24DefaultTemplateRoot.DIR_NAME));
        }
        for (const candidate of candidates) {
            if (Lumen24DefaultTemplateRoot._looksLikeTemplateRoot(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * @description 确保工程侧模板根已注入（幂等）。
     * @param projectRoot 工程根
     * @returns void
     */
    public static ensureForProject(projectRoot: string): void {
        if (Lumen24DefaultTemplateRoot._overrideRoot != null) {
            return;
        }
        if (Lumen24DefaultTemplateRoot._projectResolvedRoot != null) {
            return;
        }
        const fromProject = Lumen24DefaultTemplateRoot.resolveFromProject(projectRoot);
        if (fromProject != null) {
            Lumen24DefaultTemplateRoot._projectResolvedRoot = fromProject;
            Lumen24DefaultTemplateRoot._overrideRoot = fromProject;
        }
    }

    /**
     * @description 当前模板根绝对路径。
     * @returns 路径
     */
    public static resolve(): string {
        if (Lumen24DefaultTemplateRoot._overrideRoot != null) {
            return Lumen24DefaultTemplateRoot._overrideRoot;
        }
        let moduleDirectory = '';
        try {
            moduleDirectory = dirname(fileURLToPath(import.meta.url));
        } catch {
            moduleDirectory = '';
        }
        const candidates = [
            ...(moduleDirectory.length > 0
                ? [
                      join(moduleDirectory, 'bundled', Lumen24DefaultTemplateRoot.DIR_NAME),
                      join(moduleDirectory, '..', 'bundled', Lumen24DefaultTemplateRoot.DIR_NAME),
                      join(moduleDirectory, '..', '..', 'bundled', Lumen24DefaultTemplateRoot.DIR_NAME),
                  ]
                : []),
        ];
        for (const candidate of candidates) {
            if (Lumen24DefaultTemplateRoot._looksLikeTemplateRoot(candidate)) {
                return candidate;
            }
        }
        throw new Error(
            `lumen_24_default_prefab_missing:tried=${candidates.join('|') || '(no import.meta)'}`,
        );
    }

    /**
     * @description 从插件安装清单读取活动版本。
     * @param installedPath 安装清单绝对路径
     * @returns 活动版本；不可用时返回 null
     */
    private static _readActiveVersion(installedPath: string): string | null {
        if (!existsSync(installedPath)) {
            return null;
        }
        try {
            const parsed: unknown = JSON.parse(readFileSync(installedPath, 'utf8'));
            if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) {
                return null;
            }
            const plugins: unknown = Reflect.get(parsed, 'plugins');
            if (!Array.isArray(plugins)) {
                return null;
            }
            for (const entry of plugins) {
                if (typeof entry !== 'object' || entry == null || Array.isArray(entry)) {
                    continue;
                }
                if (Reflect.get(entry, 'pluginId') !== 'peanut.editor-mcp') {
                    continue;
                }
                const activeVersion: unknown = Reflect.get(entry, 'activeVersion');
                if (typeof activeVersion === 'string' && activeVersion.trim().length > 0) {
                    return activeVersion.trim();
                }
            }
        } catch {
            return null;
        }
        return null;
    }

    /**
     * @description 是否像模板根（含至少一个 `.prefab`）。
     * @param absoluteRoot 候选
     * @returns 是否可用
     */
    private static _looksLikeTemplateRoot(absoluteRoot: string): boolean {
        if (!existsSync(absoluteRoot) || !statSync(absoluteRoot).isDirectory()) {
            return false;
        }
        return Lumen24DefaultTemplateRoot._hasPrefab(absoluteRoot);
    }

    /**
     * @description 目录树是否含 `.prefab`。
     * @param absoluteRoot 根
     * @returns 是否含
     */
    private static _hasPrefab(absoluteRoot: string): boolean {
        for (const name of readdirSync(absoluteRoot)) {
            const full = join(absoluteRoot, name);
            if (statSync(full).isDirectory()) {
                if (Lumen24DefaultTemplateRoot._hasPrefab(full)) {
                    return true;
                }
                continue;
            }
            if (name.toLowerCase().endsWith('.prefab')) {
                return true;
            }
        }
        return false;
    }
}
