import { existsSync, lstatSync, readFileSync, realpathSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

/**
 * @description 已验证的有限单页文本 BMFont 声明，不改变原字体源字节。
 */
export interface IBitmapFontImportSource {
    /**
     * @description 同层 PNG 源绝对路径。
     */
    readonly image: string;
    /**
     * @description 原生同层 page 文件名。
     */
    readonly page: string;
}

/**
 * @description 安全解析已实测的单页文本 FNT；嵌套 page 不伪装为原生支持。
 */
export class BitmapFontImportSource {
    /**
     * @description 在计划阶段读取有限声明并校验路径/实体文件身份。
     * @param source 字体普通源文件。
     * @returns 已验证的同层 page。
     */
    public static read(source: string): IBitmapFontImportSource {
        this.regularFile(source);
        const bytes = readFileSync(source);
        const text = bytes.toString('utf8');
        if (!Buffer.from(text, 'utf8').equals(bytes) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) {
            throw new Error('asset_import_fnt_text_unsupported');
        }
        const records = new Map<string, ReadonlyMap<string, string>[]>();
        for (const line of text.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
            if (!line.trim()) { continue; }
            const match = /^([a-z]+)(\s[\s\S]*)$/u.exec(line.trim());
            if (match == null || !['info', 'common', 'page', 'chars', 'char', 'kernings', 'kerning'].includes(match[1] ?? '')) {
                throw new Error('asset_import_fnt_grammar_unsupported');
            }
            const name = match[1] ?? '';
            const row = name === 'char' ? this._charAttributes(match[2] ?? '') : this._attributes(match[2] ?? '');
            const keys: Readonly<Record<string, readonly string[]>> = {
                info: ['face', 'size', 'bold', 'italic', 'charset', 'unicode', 'stretchH', 'smooth', 'aa', 'padding', 'spacing', 'outline'],
                common: ['lineHeight', 'base', 'scaleW', 'scaleH', 'pages', 'packed', 'alphaChnl', 'redChnl', 'greenChnl', 'blueChnl'],
                page: ['id', 'file'], chars: ['count'],
                char: ['id', 'x', 'y', 'width', 'height', 'xoffset', 'yoffset', 'xadvance', 'page', 'chnl'],
                kernings: ['count'], kerning: ['first', 'second', 'amount'],
            };
            if ([...row.keys()].some(key => !(keys[name] ?? []).includes(key))) { throw new Error('asset_import_fnt_attribute_unsupported'); }
            if (name === 'page' && !/\bfile=(?:"[^"\r\n]*"|'[^'\r\n]*')/u.test(line)) {
                throw new Error('asset_import_fnt_page_unsupported');
            }
            records.set(name, [...(records.get(name) ?? []), row]);
        }
        for (const name of ['info', 'common', 'page', 'chars']) {
            if (records.get(name)?.length !== 1) { throw new Error('asset_import_fnt_header_unsupported'); }
        }
        const common = records.get('common')?.[0];
        const page = records.get('page')?.[0];
        const chars = records.get('char') ?? [];
        if (common == null || page == null) { throw new Error('asset_import_fnt_header_unsupported'); }
        if (common?.get('pages') !== '1' || page?.get('id') !== '0' ||
            this._integer(records.get('chars')?.[0]?.get('count')) !== chars.length) {
            throw new Error('asset_import_fnt_single_page_required');
        }
        for (const name of ['lineHeight', 'scaleW', 'scaleH']) {
            if (this._integer(common.get(name)) <= 0) { throw new Error('asset_import_fnt_dimension_invalid'); }
        }
        for (const row of chars) {
            if (row.get('page') !== '0') { throw new Error('asset_import_fnt_char_page_unsupported'); }
            for (const name of ['id', 'x', 'y', 'width', 'height']) { this._integer(row.get(name)); }
        }
        const file = page.get('file') ?? '';
        if (!file || basename(file) !== file || file === '.' || file === '..' ||
            /[/\\:\u0000-\u001f\u007f<>?%]/u.test(file) || !/\.png$/iu.test(file)) {
            throw new Error('asset_import_fnt_page_path_unsupported');
        }
        const image = join(dirname(source), file);
        if (existsSync(image)) { this.regularFile(image); }
        return { image, page: file };
    }

    /**
     * @description 拒绝符号链接、硬链接与父链别名；允许从已授权工程外普通源导入。
     * @param file 已规范化源文件。
     * @returns 无。
     */
    public static regularFile(file: string): void {
        if (!existsSync(file)) { throw new Error('asset_import_fnt_source_missing'); }
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(file) !== resolve(file)) {
            throw new Error('asset_import_fnt_source_identity_invalid');
        }
    }

    /**
     * @description 解析已声明键值，不执行转义、DTD 或隐式路径展开。
     * @param text 单行属性。
     * @returns 无重复键的原字符串。
     */
    private static _attributes(text: string): ReadonlyMap<string, string> {
        const values = new Map<string, string>();
        let rest = text;
        while (rest.trim()) {
            const match = /^\s+([A-Za-z][\w]*)=(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s"'=]+))/u.exec(rest);
            const key = match?.[1] ?? '';
            if (match == null || values.has(key)) { throw new Error('asset_import_fnt_attribute_unsupported'); }
            values.set(key, match[2] ?? match[3] ?? match[4] ?? '');
            rest = rest.slice(match[0].length);
        }
        return values;
    }

    /**
     * @description 解析原生已接受的末尾 letter 辅助标记；只接受与字符 ID 相同的单个 Unicode 字符。
     * @param text 字符行属性。
     * @returns 不含辅助标记的完整字符属性。
     */
    private static _charAttributes(text: string): ReadonlyMap<string, string> {
        if (!/\sletter=/u.test(text)) { return this._attributes(text); }
        const match = /^(.*?)\sletter=(["'])(.*)\2\s*$/u.exec(text);
        if (match == null) { throw new Error('asset_import_fnt_letter_unsupported'); }
        const row = this._attributes(match[1] ?? '');
        const raw = match[3] ?? '';
        const letter = raw === '\\\\' ? '\\' : raw;
        if (Array.from(letter).length !== 1 || letter.codePointAt(0) !== this._integer(row.get('id'))) {
            throw new Error('asset_import_fnt_letter_unsupported');
        }
        return row;
    }

    /**
     * @description 读取非负安全整数，拒绝 NaN、负值和非数值字串。
     * @param value 原始数值。
     * @returns 已验证整数。
     */
    private static _integer(value: string | undefined): number {
        if (value == null || !/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) {
            throw new Error('asset_import_fnt_number_invalid');
        }
        return Number(value);
    }
}
