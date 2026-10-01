import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { CoreCocosMcpToolDefinitionCatalog } from '../../packages/engine/modules/policy/src/index.js';
import { LumenCuratedSchemaCatalog } from '../../packages/engine/modules/lumen/source/schema/catalog.ts';
import type { ICoverageInventory, ICoverageSource, ICoverageTarget } from './coverage-contracts.mjs';
import { CoverageManifestGenerator } from './coverage-manifest-generator.mjs';
import { CreatorAsarLayoutReader } from './creator-asar-layout-reader.mjs';
import { CreatorComponentSourceReader } from './creator-component-source-reader.mjs';

/**
 * @description 生成当前版本分母所需的本地只读路径；这些路径不进入输出清单。
 */
export interface ICoverageInventoryReadOptions {
    /**
     * @description 当前产品仓库根目录。
     */
    readonly repositoryRoot: string;
    /**
     * @description 当前 Creator 安装包 Contents/Resources 目录。
     */
    readonly creatorResourcesRoot: string;
    /**
     * @description 必须独立核对的精确版本。
     */
    readonly creatorVersion: '3.8.3' | '3.8.7';
}

/**
 * @description 绑定产品目录、原生声明及 importer 布局，生成不冒充运行时验收的完整草稿分母。
 */
export class CoverageInventoryReader {
    /**
     * @description 从实际目录构建分母，保留 native-only 与 curated-only 差异。
     * @param options 精确版本的只读输入。
     * @returns 全部声明可用性均待运行时核实的 inventory。
     */
    public static read(options: ICoverageInventoryReadOptions): ICoverageInventory {
        const enginePackage: unknown = JSON.parse(readFileSync(join(options.creatorResourcesRoot, 'resources/3d/engine/package.json'), 'utf8'));
        if (!this.record(enginePackage) || enginePackage.version !== options.creatorVersion) {
            throw new Error('coverage_installed_version_mismatch');
        }
        const schemaRoot = join(options.repositoryRoot, 'packages/engine/modules/lumen/bundled/schema');
        const curatedCatalog = new LumenCuratedSchemaCatalog(schemaRoot);
        const assetDocument: unknown = JSON.parse(readFileSync(join(schemaRoot, 'assets.json'), 'utf8'));
        if (!this.record(assetDocument) || !Array.isArray(assetDocument.entries)) {
            throw new Error('coverage_asset_catalog_invalid');
        }
        const targets: ICoverageTarget[] = [];
        const assetEntries: readonly unknown[] = assetDocument.entries;
        for (const entry of assetEntries) {
            if (!this.record(entry) || typeof entry.assetKind !== 'string' || typeof entry.scaffold !== 'boolean') {
                throw new Error('coverage_asset_catalog_invalid');
            }
            targets.push(this.target(`asset:${entry.assetKind}`, 'asset', entry.assetKind,
                [...(entry.scaffold ? ['create'] : []), 'import', 'query', 'inspect', 'patch', 'copy', 'move', 'rename', 'refresh', 'delete']));
            this.fields(entry.fields ?? [], `asset:${entry.assetKind}`, targets, options.creatorVersion);
        }
        for (const kind of ['prefab', 'scene']) {
            targets.push(this.target(`asset:${kind}`, 'asset', kind,
                ['create', 'import', 'query', 'inspect', 'patch', 'copy', 'move', 'rename', 'refresh', 'delete', 'save', 'reopen']));
        }
        const componentSources: { readonly name: string; readonly document: unknown }[] = [];
        const curatedNames: string[] = [];
        for (const name of readdirSync(join(schemaRoot, 'components')).filter((name) => name.endsWith('.json')).sort()) {
            const document: unknown = JSON.parse(readFileSync(join(schemaRoot, 'components', name), 'utf8'));
            if (!this.record(document) || typeof document.type !== 'string') {
                throw new Error('coverage_component_catalog_invalid');
            }
            curatedNames.push(document.type);
            componentSources.push({ name, document });
            targets.push(this.target(`component:${document.type}`, 'component', document.type,
                ['add', 'get', 'set', 'bind', 'remove', 'save', 'reopen']));
            this.fields(curatedCatalog.componentFields(document.type), `component:${document.type}`, targets, options.creatorVersion);
        }
        this.fields(curatedCatalog.nodeFields(), 'node:cc.Node', targets, options.creatorVersion);
        const embeddedSources = readdirSync(join(schemaRoot, 'types')).filter((name) => name.endsWith('.json')).sort()
            .map((name) => {
                const document: unknown = JSON.parse(readFileSync(join(schemaRoot, 'types', name), 'utf8'));
                return { name, document };
            });
        const nodeDocument: unknown = JSON.parse(readFileSync(join(schemaRoot, 'node.json'), 'utf8'));
        const metaImporters: unknown = JSON.parse(readFileSync(join(schemaRoot, 'meta-importers.json'), 'utf8'));
        const declarations = CreatorComponentSourceReader.read(join(options.creatorResourcesRoot, 'resources/3d/engine/cocos'));
        const layout = CreatorAsarLayoutReader.read(join(options.creatorResourcesRoot, 'app.asar'));
        for (const module of layout.importerModules) {
            targets.push(this.target(`importer:${module}`, 'importer', module, ['reconcile_runtime_registration']));
        }
        for (const alternative of declarations.registrationAlternatives) {
            targets.push(this.target(`registration:${alternative.name}`, 'operation', alternative.name, ['reconcile_registration_alternatives']));
        }
        for (const unresolved of declarations.unresolvedRegistrations) {
            const locator = `${unresolved.sourcePath}#${unresolved.line}`;
            targets.push(this.target(`registration:unresolved:${locator}`, 'operation', locator, ['reconcile_dynamic_registration']));
        }
        const curated = new Set(curatedNames);
        for (const native of declarations.componentDeclarations) {
            if (!curated.has(native)) {
                targets.push(this.target(`component:native:${native}`, 'component', native,
                    ['reconcile', 'add', 'get', 'set', 'bind', 'remove', 'save', 'reopen']));
            }
        }
        const operations = new CoreCocosMcpToolDefinitionCatalog().list();
        for (const operation of operations) {
            targets.push(this.target(`operation:${operation.operation}`, 'operation', operation.operation, ['valid', 'reject_invalid']));
        }
        for (const language of ['typescript', 'javascript']) {
            targets.push(this.target(`code:${language}`, 'code', language,
                ['single_read_write', 'batch_read_write', 'cross_file_import', 'field_reference_change', 'compile', 'reopen', 'preview']));
        }
        const sources: ICoverageSource[] = [
            { id: `creator/${options.creatorVersion}/engine-package`, kind: 'source_declaration', creatorVersion: options.creatorVersion, sha256: CoverageManifestGenerator.digest(enginePackage) },
            { id: 'product/assets.json', kind: 'product_catalog', creatorVersion: null, sha256: CoverageManifestGenerator.digest(assetDocument) },
            { id: 'product/components', kind: 'product_catalog', creatorVersion: null, sha256: CoverageManifestGenerator.digest(componentSources) },
            { id: 'product/embedded-types', kind: 'product_catalog', creatorVersion: null, sha256: CoverageManifestGenerator.digest(embeddedSources) },
            { id: 'product/node.json', kind: 'product_catalog', creatorVersion: null, sha256: CoverageManifestGenerator.digest(nodeDocument) },
            { id: 'product/meta-importers.json', kind: 'product_catalog', creatorVersion: null, sha256: CoverageManifestGenerator.digest(metaImporters) },
            { id: 'product/public-operations', kind: 'product_catalog', creatorVersion: null, sha256: CoverageManifestGenerator.digest(operations) },
            { id: `creator/${options.creatorVersion}/engine-cocos`, kind: 'source_declaration', creatorVersion: options.creatorVersion, sha256: declarations.sourceSha256 },
            { id: `creator/${options.creatorVersion}/app-asar-header`, kind: 'module_layout', creatorVersion: options.creatorVersion, sha256: layout.headerSha256 },
        ];
        const inventory: ICoverageInventory = {
            creatorVersion: options.creatorVersion,
            sources,
            nativeImporterModules: layout.importerModules,
            nativeRegisteredClasses: declarations.registeredClasses,
            nativeRegistrationAlternatives: declarations.registrationAlternatives,
            nativeUnresolvedRegistrations: declarations.unresolvedRegistrations,
            nativeComponentDeclarations: declarations.componentDeclarations,
            nativeAbstractComponentDeclarations: declarations.abstractComponentDeclarations,
            curatedComponentsWithoutDeclaration: curatedNames.filter((name) => !declarations.registeredClasses.includes(name)).sort(),
            targets: targets.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        };
        CoverageManifestGenerator.assertInventory(inventory);
        return inventory;
    }

    /**
     * @description 按产品明确字段及版本边界建立字段分母，包含有效读写和边界拒绝。
     * @param fields 未受信的字段数组。
     * @param owner 所属目标标识。
     * @param targets 完整目标集合。
     * @param version 当前版本。
     * @param depth 当前嵌套字段深度。
     * @returns 无返回值。
     */
    private static fields(fields: unknown, owner: string, targets: ICoverageTarget[], version: string, depth = 0): void {
        if (!Array.isArray(fields) || depth > 32) {
            throw new Error('coverage_field_catalog_invalid');
        }
        const fieldEntries: readonly unknown[] = fields;
        for (const field of fieldEntries) {
            if (!this.record(field) || typeof field.apiName !== 'string' || typeof field.kind !== 'string') {
                throw new Error('coverage_field_catalog_invalid');
            }
            const gated = typeof field.since === 'string' && this.compareVersion(version, field.since) < 0
                || typeof field.until === 'string' && this.compareVersion(version, field.until) >= 0;
            targets.push({
                ...this.target(`field:${owner}:${field.apiName}`, 'field', `${owner}.${field.apiName}`,
                    field.writable === false ? ['read', 'reject_write'] : ['read', 'set', 'reject_invalid']),
                fieldKind: `${field.kind}${gated ? ':version_gated' : ''}`,
            });
            if (field.nestedFields != null) {
                this.fields(field.nestedFields, `${owner}:${field.apiName}`, targets, version, depth + 1);
            }
        }
    }

    /**
     * @description 构造未核实原生可用性的目标，避免由文件存在推断 supported。
     * @param id 目标标识。
     * @param domain 目标领域。
     * @param subject 稳定类型或操作名称。
     * @param actions 必须验收的动作。
     * @returns 保留在分母中的目标。
     */
    private static target(id: string, domain: ICoverageTarget['domain'], subject: string, actions: readonly string[]): ICoverageTarget {
        return { id, domain, subject, actions, fieldKind: null, availability: 'unverified', availabilitySourceId: null };
    }

    /**
     * @description 比较完整语义版本，拒绝含糊的字段门槛。
     * @param left 当前版本。
     * @param right 策展边界。
     * @returns 版本比较结果。
     */
    private static compareVersion(left: string, right: string): number {
        if (!/^\d+\.\d+\.\d+$/u.test(left) || !/^\d+\.\d+\.\d+$/u.test(right)) {
            throw new Error('coverage_field_version_invalid');
        }
        const a = left.split('.').map(Number);
        const b = right.split('.').map(Number);
        for (let index = 0; index < 3; index += 1) {
            const difference = (a[index] ?? 0) - (b[index] ?? 0);
            if (difference !== 0) {
                return difference;
            }
        }
        return 0;
    }

    /**
     * @description 收窄策展 JSON 对象。
     * @param value 未知节点。
     * @returns 是否为非数组对象。
     */
    private static record(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
