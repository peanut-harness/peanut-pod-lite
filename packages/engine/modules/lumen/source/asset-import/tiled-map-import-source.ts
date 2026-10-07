import { existsSync, lstatSync, readFileSync, realpathSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

/**
 * @description 有限 orthogonal TMX 的本地 PNG 声明；只解析受支持子集，不执行 DTD 或外部实体。
 */
export class TiledMapImportSource {
    /**
     * @description 读取并验证内联 tileset 的同目录 PNG 依赖。
     * @param source TMX 源路径。
     * @returns 稳定去重的 PNG 源路径。
     */
    public static images(source: string): readonly string[] {
        this._regularFile(source);
        const bytes = readFileSync(source);
        const xml = bytes.toString('utf8');
        if (!Buffer.from(xml, 'utf8').equals(bytes)) { throw new Error('asset_import_tmx_utf8_invalid'); }
        if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/iu.test(xml)) {
            throw new Error('asset_import_tmx_declaration_unsupported');
        }
        const body = xml.replace(/<!--[\s\S]*?-->/gu, '').replace(/^\s*<\?xml[^?]*\?>/u, '');
        const tokens = body.match(/<[^>]*>|[^<]+/gu) ?? [];
        if (tokens.join('') !== body) { throw new Error('asset_import_tmx_xml_invalid'); }
        const stack: string[] = [];
        const images: string[] = [];
        let roots = 0;
        for (const token of tokens) {
            if (!token.startsWith('<')) {
                if (token.trim() && (stack[stack.length - 1] !== 'data' || !/^[\d,\s]+$/u.test(token))) {
                    throw new Error('asset_import_tmx_text_unsupported');
                }
                continue;
            }
            const closing = /^<\/([A-Za-z][\w.-]*)\s*>$/u.exec(token);
            if (closing != null) {
                if (stack.pop() !== closing[1]) { throw new Error('asset_import_tmx_xml_unbalanced'); }
                continue;
            }
            const match = /^<([A-Za-z][\w.-]*)([\s\S]*?)(\/?)>$/u.exec(token);
            if (match == null) { throw new Error('asset_import_tmx_xml_invalid'); }
            const name = match[1] ?? '';
            const attrs = this._attributes(match[2] ?? '');
            this._validateTag(name, attrs, stack);
            if (name === 'map') { roots += 1; }
            if (name === 'image') {
                const file = attrs.get('source') ?? '';
                if (!file || basename(file) !== file || file === '.' || file === '..' ||
                    /[/\\:\u0000-\u001f\u007f<>?%]/u.test(file) || !/\.png$/iu.test(file)) {
                    throw new Error('asset_import_tmx_image_path_invalid');
                }
                const path = join(dirname(source), file);
                if (existsSync(path)) { this._regularFile(path); }
                images.push(path);
            }
            if (match[3] !== '/') { stack.push(name); }
        }
        if (roots !== 1 || stack.length || !images.length) { throw new Error('asset_import_tmx_images_or_root_missing'); }
        return [...new Set(images)];
    }

    /**
     * @description 校验 XML 属性，拒绝重复属性与未解析文本。
     * @param text 起始标签属性段。
     * @returns 原生名称到解码值。
     */
    private static _attributes(text: string): ReadonlyMap<string, string> {
        const result = new Map<string, string>();
        let rest = text;
        while (rest.trim()) {
            const match = /^\s+([A-Za-z][\w.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/u.exec(rest);
            if (match == null || result.has(match[1] ?? '')) { throw new Error('asset_import_tmx_attribute_invalid'); }
            result.set(match[1] ?? '', this._decode(match[2] ?? match[3] ?? ''));
            rest = rest.slice(match[0].length);
        }
        return result;
    }

    /**
     * @description 一次性解码 XML 内建与合法数值实体，不加载任何外部声明。
     * @param value 原始属性值。
     * @returns 解码值。
     */
    private static _decode(value: string): string {
        if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/u.test(value)) {
            throw new Error('asset_import_tmx_entity_invalid');
        }
        const literals: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
        return value.replace(/&([^;]+);/gu, (_match: string, entity: string): string => {
            if (literals[entity] != null) { return literals[entity]; }
            const point = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
            if (!Number.isInteger(point) || point <= 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
                throw new Error('asset_import_tmx_entity_invalid');
            }
            return String.fromCodePoint(point);
        });
    }

    /**
     * @description 限定有限地图、内联 tileset、CSV 图层，不猜测外部 TSX、压缩或无限地图能力。
     * @param name 标签名。
     * @param attrs 属性。
     * @param stack 当前父链。
     * @returns 无。
     */
    private static _validateTag(name: string, attrs: ReadonlyMap<string, string>, stack: readonly string[]): void {
        const parent = stack[stack.length - 1];
        const parents: Readonly<Record<string, string | undefined>> = { map: undefined, tileset: 'map', image: 'tileset', layer: 'map', data: 'layer' };
        if (!(name in parents) || parent !== parents[name]) { throw new Error('asset_import_tmx_structure_unsupported'); }
        if (name === 'map') {
            const version = (attrs.get('version') ?? '1.0').split('.').map(Number);
            if (version.length > 3 || version[0] !== 1 || !version.every(Number.isInteger) ||
                (version[1] ?? 0) < 0 || (version[1] ?? 0) > 4 || (version[2] ?? 0) !== 0 ||
                attrs.get('orientation') !== 'orthogonal' || !['0', undefined].includes(attrs.get('infinite'))) {
                throw new Error('asset_import_tmx_map_unsupported');
            }
            for (const key of ['width', 'height', 'tilewidth', 'tileheight']) { this._positive(attrs.get(key)); }
        }
        if (name === 'tileset') {
            if (attrs.has('source')) { throw new Error('asset_import_tmx_external_tileset_unsupported'); }
            this._positive(attrs.get('firstgid'));
        }
        if (name === 'data' && (attrs.get('encoding') !== 'csv' || attrs.has('compression'))) {
            throw new Error('asset_import_tmx_data_unsupported');
        }
    }

    /**
     * @description 校验地图尺寸或首 GID 为有限正整数。
     * @param value XML 数值。
     * @returns 无。
     */
    private static _positive(value: string | undefined): void {
        if (value == null || !/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
            throw new Error('asset_import_tmx_dimension_invalid');
        }
    }

    /**
     * @description 依赖只接受单链接普通文件，拒绝源或父目录符号别名。
     * @param path 源路径。
     * @returns 无。
     */
    private static _regularFile(path: string): void {
        if (!existsSync(path)) { throw new Error('asset_import_tmx_source_missing'); }
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== resolve(path)) {
            throw new Error('asset_import_tmx_source_identity_invalid');
        }
    }
}
