import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { Lumen24DefaultTemplateRoot } from './lumen-24-default-template-root.js';
import type { Lumen24PrefabEntry } from './lumen-24-prefab-document.js';

export { Lumen24DefaultTemplateRoot } from './lumen-24-default-template-root.js';

/**
 * @description 模板目录条目。
 */
export interface ILumen24CatalogTemplate {
    /**
     * @description 模板 id（相对路径无扩展名）。
     */
    readonly id: string;
    /**
     * @description 绝对路径。
     */
    readonly absolutePath: string;
    /**
     * @description 种类。
     */
    readonly kind: 'prefab';
}

/**
 * @description 扫描 `default_prefab_24` 列出模板 id。
 */
export class Lumen24TemplateCatalog {
    /**
     * @description 列出全部模板。
     * @param templateRoot 可选根；缺省用默认解析
     * @returns 模板列表
     */
    public static list(templateRoot?: string): readonly ILumen24CatalogTemplate[] {
        const root = templateRoot ?? Lumen24DefaultTemplateRoot.resolve();
        const collected: ILumen24CatalogTemplate[] = [];
        Lumen24TemplateCatalog._walk(root, root, collected);
        collected.sort((left, right) => left.id.localeCompare(right.id));
        return collected;
    }

    /**
     * @description 将模板 id 解析为绝对 `.prefab` 路径。
     * @param templateId 模板 id
     * @param templateRoot 可选根
     * @returns 绝对路径
     */
    public static resolveAbsolutePath(templateId: string, templateRoot?: string): string {
        const root = templateRoot ?? Lumen24DefaultTemplateRoot.resolve();
        const normalized = templateId.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.prefab$/i, '');
        const candidates = [
            join(root, `${normalized}.prefab`),
            join(root, 'ui', `${normalized.replace(/^ui\//i, '')}.prefab`),
        ];
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                return candidate;
            }
        }
        throw new Error(`lumen_24_template_file_missing:${templateId}`);
    }

    /**
     * @description 读取模板 JSON 数组。
     * @param absolutePath 绝对路径
     * @returns 条目
     */
    public static readEntries(absolutePath: string): Lumen24PrefabEntry[] {
        const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
        if (!Array.isArray(parsed)) {
            throw new Error(`lumen_24_template_not_array:${absolutePath}`);
        }
        return parsed.map((entry, index) => {
            if (!Lumen24TemplateCatalog._isPrefabEntry(entry)) {
                throw new Error(`lumen_24_template_entry_invalid:${absolutePath}:${index}`);
            }
            return entry;
        });
    }

    /**
     * @description 判断未知值是否为 Prefab 条目记录。
     * @param value 未受信值
     * @returns 普通记录返回 `true`
     */
    private static _isPrefabEntry(value: unknown): value is Lumen24PrefabEntry {
        return typeof value === 'object' && value != null && !Array.isArray(value);
    }

    /**
     * @description 递归收集 prefab。
     * @param root 模板根
     * @param directory 当前目录
     * @param out 输出
     * @returns void
     */
    private static _walk(root: string, directory: string, out: ILumen24CatalogTemplate[]): void {
        for (const name of readdirSync(directory)) {
            if (name === 'README.md' || name.startsWith('.')) {
                continue;
            }
            const full = join(directory, name);
            if (statSync(full).isDirectory()) {
                Lumen24TemplateCatalog._walk(root, full, out);
                continue;
            }
            if (!name.toLowerCase().endsWith('.prefab')) {
                continue;
            }
            const relative = full.slice(root.length).replace(/\\/g, '/').replace(/^\//, '');
            const id = relative.replace(/\.prefab$/i, '');
            out.push({ id, absolutePath: full, kind: 'prefab' });
        }
    }
}
