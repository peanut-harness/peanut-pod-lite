import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { LumenCuratedSchemaCatalog } from '../../../../packages/engine/modules/lumen/source/schema/catalog.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { LumenNativeMeshPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/native-mesh-property-schema.ts';
import type { ILumenPropertyFieldSpec } from '../../../../packages/engine/modules/lumen/source/schema/component-property-contracts.ts';
import { ComponentNativeSourceReader } from './component-native-source-reader.mts';
import type { IComponentNativeDeclaration } from './component-native-source-reader.mts';
import { ComponentDependencyPlanner } from './component-dependency-plan.mts';

/**
 * @description 组件夹具准备阶段的独立目录审计；不会将源码或空字段槽记作完整夹具。
 */
export class ComponentCatalogAudit {
    /**
     * @description 从当前产品目录与精确版本源码生成完整字段和依赖分母。
     * @param repositoryRoot 当前已登记产品工作树。
     * @param engineRoot 所选 Creator 的实际 engine 根。
     * @param version 单一精确版本。
     * @returns 含全部字段槽及真实依赖装配的准备记录，task51Complete 固定为 false。
     */
    public static create(repositoryRoot: string, engineRoot: string, version: '3.8.3' | '3.8.7') {
        const packageBytes = readFileSync(join(engineRoot, 'package.json'));
        if ((JSON.parse(packageBytes.toString('utf8')) as { version?: unknown }).version !== version) {
            throw new Error('component_engine_version_mismatch');
        }
        const schemaRoot = join(repositoryRoot, 'packages/engine/modules/lumen/bundled/schema');
        const catalog = new LumenCuratedSchemaCatalog(schemaRoot);
        const declarations = ComponentNativeSourceReader.read(join(engineRoot, 'cocos'));
        const byType = new Map(declarations.map((row) => [row.type, row]));
        const names = catalog.listComponentTypes().slice().sort();
        const rows = names.map((componentType) => {
            const fields = catalog.componentFields(componentType);
            if (!fields) throw new Error(`component_catalog_fields_missing:${componentType}`);
            const declaration = byType.get(componentType);
            const effectiveFields = LumenNativeMeshPropertySchema.forVersion(LumenCocosVersion.parse(version), componentType, fields);
            const fieldRows = this.fields(componentType, effectiveFields, declaration, version);
            const schemaFile = join(schemaRoot, 'components', `${componentType}.json`);
            return { componentType, catalogReference: `packages/engine/modules/lumen/bundled/schema/components/${componentType}.json`,
                catalogSha256: this.digest(readFileSync(schemaFile)),
                declarationStatus: declaration ? 'source-declared-runtime-unverified' : 'source-absent-runtime-unverified',
                dependencyPlan: ComponentDependencyPlanner.create(componentType, declarations),
                nativeSources: declaration?.sources ?? [], fields: fieldRows,
                lifecycleActions: ['add', 'get', 'set', 'bind', 'remove', 'save', 'reopen'],
                fixturePreparation: 'pending', nativeAcceptance: false };
        });
        const componentDeclarations = declarations.filter((row) => row.type === 'cc.Component' || row.baseTypes.includes('cc.Component'));
        const sourceFiles = readdirSync(join(schemaRoot, 'types')).filter((name) => name.endsWith('.json')).sort();
        const schemaSources = sourceFiles.map((name) => ({ reference: `packages/engine/modules/lumen/bundled/schema/types/${name}`,
            sha256: this.digest(readFileSync(join(schemaRoot, 'types', name))) }));
        const overlayPath = 'packages/engine/modules/lumen/source/schema/native-mesh-property-schema.ts';
        schemaSources.push({ reference: overlayPath, sha256: this.digest(readFileSync(join(repositoryRoot, overlayPath))) });
        const propertyNames = new Map(names.map((name) => {
            const fields = catalog.componentFields(name);
            if (!fields) throw new Error(`component_catalog_fields_missing:${name}`);
            const effective = LumenNativeMeshPropertySchema.forVersion(LumenCocosVersion.parse(version), name, fields);
            return [name, new Set(effective.flatMap((field) => [field.apiName, field.serializedName]))];
        }));
        const collectEmbedded = (fields: readonly ILumenPropertyFieldSpec[]): void => {
            for (const field of fields) if (field.embeddedType && field.nestedFields?.length) {
                const names = propertyNames.get(field.embeddedType) ?? new Set<string>();
                field.nestedFields.forEach((nested) => { names.add(nested.apiName); names.add(nested.serializedName); });
                propertyNames.set(field.embeddedType, names); collectEmbedded(field.nestedFields);
            }
        };
        for (const name of names) {
            const fields = catalog.componentFields(name);
            if (!fields) throw new Error(`component_catalog_fields_missing:${name}`);
            collectEmbedded(LumenNativeMeshPropertySchema.forVersion(LumenCocosVersion.parse(version), name, fields));
        }
        for (const name of sourceFiles) {
            const document = JSON.parse(readFileSync(join(schemaRoot, 'types', name), 'utf8')) as { type?: unknown };
            if (typeof document.type !== 'string') throw new Error('component_embedded_catalog_type_missing');
            const fields = catalog.curatedFieldsForType(document.type);
            if (!fields) throw new Error(`component_embedded_catalog_fields_missing:${document.type}`);
            propertyNames.set(document.type, new Set(fields.flatMap((field) => [field.apiName, field.serializedName])));
        }
        const nativeDeclarations = declarations.map((row) => ({ ...row,
            properties: row.properties.filter((property) => propertyNames.get(row.type)?.has(property.name)) }));
        return { schemaVersion: 'peanut.component-fixture-preparation.v1', creatorVersion: version,
            enginePackageSha256: this.digest(packageBytes), schemaSources, curatedComponentCount: names.length,
            nativeRegisteredClassCount: declarations.length, nativeComponentDeclarationCount: componentDeclarations.length,
            curatedWithoutSource: names.filter((name) => !byType.has(name)),
            nativeOnlyComponents: componentDeclarations.filter((row) => !names.includes(row.type)).map((row) => row.type),
            fieldCount: rows.reduce((count, row) => count + row.fields.length, 0),
            dependencyReadyComponents: rows.filter((row) => row.dependencyPlan.blockers.length === 0).length,
            nativePassedRows: 0, task51Complete: false, rows, nativeDeclarations };
    }

    /**
     * @description 将未知保存记录与当前独立重算的目录逐项核对；缺字段或依赖边不能通过。
     * @param candidate 保存记录，不信任其计数或通过标志。
     * @param expected 从当前源码、目录和精确版本重新生成的可信记录。
     */
    public static validate(candidate: unknown, expected: ReturnType<typeof ComponentCatalogAudit.create>): void {
        if (!isDeepStrictEqual(candidate, expected)) throw new Error('component_catalog_audit_drift_or_missing_rows');
        if (expected.task51Complete !== false || expected.nativePassedRows !== 0
            || expected.rows.some((row) => row.nativeAcceptance !== false || row.fixturePreparation !== 'pending')) {
            throw new Error('component_preparation_cannot_claim_fixture_or_native_completion');
        }
    }

    /**
     * @description 递归展开完整字段选择器，包括内嵌数组和对象；字段值夹具仍明确待装配。
     */
    private static fields(componentType: string, fields: readonly ILumenPropertyFieldSpec[],
        declaration: IComponentNativeDeclaration | undefined, version: string, prefix: readonly string[] = [], depth = 0) {
        if (depth > 32) throw new Error('component_field_depth_exceeded');
        const rows: { id: string; selector: string[]; kind: string; serializedName: string;
            actions: string[]; sourceProperties: IComponentNativeDeclaration['properties']; valueFixtureStatus: string;
            since: string | null; until: string | null; versionGated: boolean }[] = [];
        for (const field of fields) {
            const selector = [...prefix, field.apiName];
            rows.push({ id: `field:component:${componentType}:${selector.join(':')}`, selector, kind: field.kind,
                serializedName: field.serializedName,
                actions: ['read', 'set', 'reject_invalid'],
                since: field.since ?? null, until: field.until ?? null,
                versionGated: field.since !== undefined && this.compareVersion(version, field.since) < 0
                    || field.until !== undefined && this.compareVersion(version, field.until) >= 0,
                sourceProperties: prefix.length === 0 ? declaration?.properties.filter((property) =>
                    property.name === field.apiName || property.name === field.serializedName) ?? [] : [],
                valueFixtureStatus: 'pending-valid-value-reference-and-rejection-fixtures' });
            if (field.nestedFields) rows.push(...this.fields(componentType, field.nestedFields, declaration, version, selector, depth + 1));
        }
        if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('component_field_duplicate');
        return rows;
    }

    /**
     * @description 绑定实际来源 bytes。
     */
    private static digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

    /**
     * @description 数值比较目录中的精确版本边界，非法版本直接拒绝。
     */
    private static compareVersion(left: string, right: string): number {
        if (!/^\d+\.\d+\.\d+$/u.test(left) || !/^\d+\.\d+\.\d+$/u.test(right)) throw new Error('component_catalog_version_invalid');
        const a = left.split('.').map(Number); const b = right.split('.').map(Number);
        for (let index = 0; index < 3; index += 1) {
            const difference = (a[index] ?? 0) - (b[index] ?? 0);
            if (difference !== 0) return difference;
        }
        return 0;
    }
}
