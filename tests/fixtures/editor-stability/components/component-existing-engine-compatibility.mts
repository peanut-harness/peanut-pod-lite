import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentCatalogAudit } from './component-catalog-audit.mts';
import { ComponentFieldFixtures } from './component-field-fixtures.mts';
import { ComponentEngineProfile } from './component-engine-profile.mts';

const CUSTOM_383 = '/Users/alex/workspaces/VVGame-engine/engine-3.8.3';
const DIFFERENT_SOURCES: Readonly<Record<string, string>> = {
    'gfx/base/pipeline-state.editor.ts': '3ee077ecf36566a41de4c66b98eac37ce121ff3d335a5477ef8b06de13fe3091',
    'particle-2d/particle-system-2d.ts': 'efd1994c7ed47d4bb48cfd98708e160beb7d2b78d3a5cbabfa6f2206ed05b868',
    '2d/components/rich-text.ts': 'db473ec3960d5da94ab4bfcc963ceebe1f027ac42a6eeca26f4151d1c6299410',
    'spine/skeleton.ts': '9b99cae0a0fbad7da5a75ba2305cf39b09b3c17dc768066bef9e62dfd1efc9e5',
};

/**
 * Accept only the installed custom engine whose curated matrix was compared with the official SDK.
 */
export class ComponentExistingEngineCompatibility {
    private static verified = false;

    public static assert(profile: unknown, repository: string, version: string): void {
        if (version === '3.8.7') { ComponentEngineProfile.assertBuiltin(profile, version); return; }
        if (version !== '3.8.3') throw new Error('component_existing_engine_version_invalid');
        const selection = this.record(this.record(this.record(profile).engine)['383']);
        if (this.record(selection.javascript).builtin !== false
            || this.record(selection.javascript).custom !== CUSTOM_383
            || this.record(selection.native).builtin !== true
            || realpathSync(CUSTOM_383) !== CUSTOM_383
            || JSON.parse(readFileSync(join(CUSTOM_383, 'package.json'), 'utf8')).version !== '3.8.3')
            throw new Error('component_existing_engine_identity_mismatch');
        if (this.verified) return;
        const expected = JSON.parse(readFileSync(join(repository,
            'tests/fixtures/editor-stability/components/3.8.3/component-assembly-audit.json'), 'utf8'));
        const actual = ComponentCatalogAudit.create(repository, CUSTOM_383, '3.8.3');
        if (expected.curatedComponentCount !== 99 || actual.curatedComponentCount !== 99
            || expected.fieldCount !== 795 || actual.fieldCount !== 795)
            throw new Error('component_existing_engine_denominator_mismatch');
        const names = expected.rows.map((row: { componentType: string }) => row.componentType);
        if (JSON.stringify(names) !== JSON.stringify(actual.rows.map(row => row.componentType)))
            throw new Error('component_existing_engine_component_set_changed');
        const pick = (value: any) => value ? { requiredComponents: value.requiredComponents, baseTypes: value.baseTypes,
            unresolvedDependencies: value.unresolvedDependencies?.map((item: any) => item.expression),
            properties: value.properties?.map((item: any) => ({ name: item.name, type: item.type,
                registeredTypes: item.registeredTypes, numericEnumValues: item.numericEnumValues })) } : null;
        const byType = new Map(actual.nativeDeclarations.map(row => [row.type, row]));
        const old = new Map(expected.nativeDeclarations.map((row: { type: string }) => [row.type, row]));
        if (names.some((name: string) => JSON.stringify(pick(old.get(name))) !== JSON.stringify(pick(byType.get(name)))))
            throw new Error('component_existing_engine_curated_declaration_changed');
        const sources = new Map<string, string>(expected.nativeDeclarations.flatMap((row: { sources: { reference: string; sha256: string }[] }) =>
            row.sources.map(source => [source.reference, source.sha256] as const)));
        const differences = [...sources].filter(([reference, oldHash]) => {
            const bytes = readFileSync(join(CUSTOM_383, 'cocos', reference));
            const current = createHash('sha256').update(bytes).digest('hex');
            if (current === oldHash) return false;
            if (DIFFERENT_SOURCES[reference] !== current) throw new Error('component_existing_engine_source_changed:' + reference);
            return true;
        }).map(([reference]) => reference).sort();
        if (JSON.stringify(differences) !== JSON.stringify(Object.keys(DIFFERENT_SOURCES).sort()))
            throw new Error('component_existing_engine_source_difference_changed');
        const recipes = (declarations: any) => ComponentFieldFixtures.create(repository, '3.8.3', declarations).components.map(row => ({
            type: row.componentType, cases: row.cases.map(field => ({ id: field.id, selector: field.selector,
                expectedWrite: field.expectedWrite, rootValue: field.rootValue, validValue: field.validValue,
                invalidValue: field.invalidValue })) }));
        if (JSON.stringify(recipes(expected.nativeDeclarations)) !== JSON.stringify(recipes(actual.nativeDeclarations)))
            throw new Error('component_existing_engine_curated_recipes_changed');
        this.verified = true;
    }

    private static record(value: unknown): Record<string, any> {
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
    }
}
