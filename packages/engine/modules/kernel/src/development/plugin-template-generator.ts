import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export type PluginTemplateKind = 'creator-38-host' | 'peanut-core';

export interface IPluginTemplateRequest {
    readonly pluginId: string;
    readonly displayName: string;
    readonly targetDirectory: string;
    readonly kind: PluginTemplateKind;
}

export interface IPluginTemplateResult {
    readonly pluginId: string;
    readonly kind: PluginTemplateKind;
    readonly targetDirectory: string;
    readonly files: readonly string[];
}

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

/**
 * Generates a minimal, safe Creator host or Peanut Core plugin project.
 */
export class PluginTemplateGenerator {
    public generate(request: IPluginTemplateRequest): IPluginTemplateResult {
        const pluginId = request.pluginId.trim();
        const displayName = request.displayName.trim();
        if (!PLUGIN_ID_PATTERN.test(pluginId)) throw new Error('plugin_template_id_invalid');
        if (displayName.length < 1 || displayName.length > 120 || /[\r\n\0]/u.test(displayName)) {
            throw new Error('plugin_template_display_name_invalid');
        }
        if (request.kind !== 'creator-38-host' && request.kind !== 'peanut-core') {
            throw new Error('plugin_template_kind_invalid');
        }
        if (typeof request.targetDirectory !== 'string' || request.targetDirectory.trim().length === 0 || !isAbsolute(request.targetDirectory)) {
            throw new Error('plugin_template_target_invalid');
        }
        const requestedTargetDirectory = resolve(request.targetDirectory);
        if (basename(requestedTargetDirectory) === '' || requestedTargetDirectory === dirname(requestedTargetDirectory)) throw new Error('plugin_template_target_invalid');
        const parent = dirname(requestedTargetDirectory);
        const parentStat = lstatSync(parent);
        if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('plugin_template_parent_invalid');
        const targetDirectory = join(realpathSync(parent), basename(requestedTargetDirectory));
        try {
            const targetStat = lstatSync(targetDirectory);
            if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error('plugin_template_target_invalid');
            if (readdirSync(targetDirectory).length > 0) throw new Error('plugin_template_target_not_empty');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }

        const files = request.kind === 'creator-38-host'
            ? this._hostFiles(pluginId, displayName)
            : this._coreFiles(pluginId, displayName);
        const staging = mkdtempSync(join(parent, `.${basename(targetDirectory)}.peanut-`));
        try {
            for (const [path, content] of Object.entries(files)) {
                const filePath = join(staging, path);
                mkdirSync(dirname(filePath), { recursive: true });
                writeFileSync(filePath, content, { flag: 'wx', mode: 0o600 });
            }
            try {
                renameSync(staging, targetDirectory);
            } catch (error) {
                if (lstatSync(targetDirectory).isDirectory()) throw new Error('plugin_template_target_not_empty');
                throw error;
            }
        } finally {
            rmSync(staging, { recursive: true, force: true });
        }
        return Object.freeze({ pluginId, kind: request.kind, targetDirectory, files: Object.freeze(Object.keys(files)) });
    }

    private _coreFiles(pluginId: string, displayName: string): Readonly<Record<string, string>> {
        const files: Record<string, string> = {
            'package.json': `${JSON.stringify({ name: pluginId, version: '0.1.0', private: true, description: displayName }, null, 2)}\n`,
            [`${pluginId}.ts`]: `export function createPluginModule() {\n    return {\n        manifest: { id: '${pluginId}', version: '0.1.0' },\n        async register() {},\n        async activate() {},\n        async deactivate() {},\n        async dispose() {},\n    };\n}\n`,
            [`${pluginId}.bundle.js`]: `'use strict';\n\nmodule.exports.createPluginModule = () => ({\n    manifest: { id: '${pluginId}', version: '0.1.0' },\n    async register() {},\n    async activate() {},\n    async deactivate() {},\n    async dispose() {},\n});\n`,
            'README.md': `# ${displayName}\n\nPeanut Core plugin ${pluginId}.\n`,
            'libs/.keep': '',
        };
        const fileRecords = Object.keys(files).sort().map((path) => ({
            path,
            digest: createHash('sha256').update(files[path] ?? '').digest('hex'),
        }));
        const packageDigest = createHash('sha256').update(fileRecords.map(({ path, digest }) => `${path}:${digest}`).join('\n')).digest('hex');
        files[`${pluginId}.manifest.json`] = `${JSON.stringify({
                id: pluginId, version: '0.1.0', kind: 'tooling-plugin', displayName,
                main: `./${pluginId}.bundle.js`, engines: { host: '^0.1.0' },
                activation: { autoActivate: false, events: [] }, permissions: {},
                package: { schemaVersion: 1, digest: packageDigest, packedAt: new Date().toISOString(), sdkVersion: '0.1.0', files: fileRecords, libraries: [], changelog: [] },
            }, null, 2)}\n`;
        return files;
    }

    private _hostFiles(pluginId: string, displayName: string): Readonly<Record<string, string>> {
        return {
            'package.json': `${JSON.stringify({
                package_version: 2, name: pluginId, version: '0.1.0', private: true,
                description: displayName, editor: '>=3.8.0 <3.9.0', main: './main.js',
                panels: {}, contributions: { menu: [] },
            }, null, 2)}\n`,
            'main.js': `'use strict';\n\nmodule.exports = { load() {}, unload() {} };\n`,
            'README.md': `# ${displayName}\n\nCreator 3.8 extension ${pluginId}.\n`,
        };
    }
}
