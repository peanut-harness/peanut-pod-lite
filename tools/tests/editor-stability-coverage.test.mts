import assert from 'node:assert/strict';
import test from 'node:test';

import type { ICoverageEvidenceReader, ICoverageInventory, ICoverageResolvedResult } from '../editor-stability/coverage-contracts.mjs';
import { CoverageManifestGenerator } from '../editor-stability/coverage-manifest-generator.mjs';
import { CoverageManifestValidator } from '../editor-stability/coverage-manifest-validator.mjs';

const fixtureHash = 'a'.repeat(64);
const resultHash = 'b'.repeat(64);

/**
 * @description 构造仅供校验器单元测试的合成目录；不是任何 Creator 的实机通过证据。
 * @returns 独立的两动作测试分母。
 */
const inventory = (): ICoverageInventory => ({
    creatorVersion: '3.8.7',
    sources: [{ id: 'creator/3.8.7/runtime', sha256: 'c'.repeat(64), kind: 'runtime_catalog', creatorVersion: '3.8.7' }],
    nativeImporterModules: [],
    nativeRegisteredClasses: [],
    nativeRegistrationAlternatives: [],
    nativeUnresolvedRegistrations: [],
    nativeComponentDeclarations: [],
    nativeAbstractComponentDeclarations: [],
    curatedComponentsWithoutDeclaration: [],
    targets: [{ id: 'asset:text', domain: 'asset', subject: 'text', actions: ['read', 'write'], fieldKind: null,
        availability: 'supported', availabilitySourceId: 'creator/3.8.7/runtime' }],
});

/**
 * @description 为合成目录生成独立内存证明，专门测试清单和证明之间的交叉检查。
 * @param source 测试目录。
 * @returns 清单与独立结果映射；不能用作实机验收。
 */
const proof = (source = inventory()) => {
    const results = new Map<string, ICoverageResolvedResult>();
    const draft = CoverageManifestGenerator.createDraft(source);
    const manifest = { ...draft, cases: draft.cases.map((row, index) => {
        const reference = `results/case-${index}.json`;
        const unsupported = source.targets.find((target) => target.id === row.targetId)?.availability === 'unsupported';
        const outcome = unsupported ? 'not_applicable' : 'passed';
        const readback = unsupported ? null : 'exact_content_and_uuid';
        results.set(reference, { sha256: resultHash, creatorVersion: source.creatorVersion, caseId: row.id, outcome,
            readback, readbackVerified: true, nativeVerified: true, rawLogsVerified: true, warnings: 0, errors: 0 });
        return { ...row, status: outcome, readback, fixture: unsupported ? null : { reference: 'fixtures/text.txt', sha256: fixtureHash },
            result: { reference, sha256: resultHash } };
    }) };
    const reader: ICoverageEvidenceReader = {
        fixture: (reference) => reference === 'fixtures/text.txt' ? { sha256: fixtureHash, valid: true, dependencies: [] } : null,
        result: (reference) => results.get(reference) ?? null,
    };
    return { source, manifest, reader, results };
};

test('draft ordering and digest are deterministic without declaring coverage passed', () => {
    const source = inventory();
    const reordered = { ...source, targets: source.targets.map((target) => ({ ...target, actions: ['write', 'read'] })) };
    assert.deepEqual(CoverageManifestGenerator.createDraft(source).cases, CoverageManifestGenerator.createDraft(reordered).cases);
    assert.equal(CoverageManifestGenerator.digest({ a: 1, b: 2 }), CoverageManifestGenerator.digest({ b: 2, a: 1 }));
    const result = CoverageManifestValidator.validate(CoverageManifestGenerator.createDraft(source), source, proof().reader);
    assert.equal(result.ok, false);
    assert.equal(result.requiredCases, 2);
    assert.equal(result.passed, 0);
});

test('all matching independent synthetic proofs pass without reducing the denominator', () => {
    const sample = proof();
    assert.deepEqual(CoverageManifestValidator.validate(sample.manifest, sample.source, sample.reader), {
        ok: true, requiredCases: 2, passed: 2, notApplicable: 0, issueCount: 0, issues: [],
    });
});

test('a new authoritative catalog entry invalidates an older manifest', () => {
    const sample = proof();
    const current = { ...sample.source, targets: [...sample.source.targets, {
        id: 'asset:new', domain: 'asset' as const, subject: 'new', actions: ['read'], fieldKind: null,
        availability: 'unverified' as const, availabilitySourceId: null,
    }] };
    const result = CoverageManifestValidator.validate(sample.manifest, current, sample.reader);
    assert.equal(result.ok, false);
    assert.equal(result.requiredCases, 3);
    assert.equal(result.issues[0], 'coverage_manifest_binding_or_shape_invalid');
});

test('missing, duplicated and unexpected rows fail with the full denominator', () => {
    const sample = proof();
    const first = sample.manifest.cases[0];
    assert.ok(first);
    for (const cases of [sample.manifest.cases.slice(1), [...sample.manifest.cases, first],
        [...sample.manifest.cases, { ...first, id: 'unknown' }]]) {
        const result = CoverageManifestValidator.validate({ ...sample.manifest, cases }, sample.source, sample.reader);
        assert.equal(result.ok, false);
        assert.equal(result.requiredCases, 2);
    }
});

for (const status of ['pending', 'skipped', 'failed']) {
    test(`${status} cannot be counted as passed or removed from coverage`, () => {
        const sample = proof();
        const manifest = { ...sample.manifest, cases: sample.manifest.cases.map((row) => ({ ...row, status })) };
        const result = CoverageManifestValidator.validate(manifest, sample.source, sample.reader);
        assert.equal(result.ok, false);
        assert.equal(result.requiredCases, 2);
        assert.equal(result.passed, 0);
    });
}

test('editing status alone cannot establish native availability', () => {
    const source = { ...inventory(), targets: inventory().targets.map((target) => ({ ...target,
        availability: 'unverified' as const, availabilitySourceId: null })) };
    const sample = proof(source);
    assert.equal(CoverageManifestValidator.validate(sample.manifest, source, sample.reader).passed, 0);
});

test('source declarations cannot authorize a not-applicable decision', () => {
    const source = inventory();
    assert.throws(() => CoverageManifestGenerator.createDraft({ ...source,
        sources: source.sources.map((entry) => ({ ...entry, kind: 'source_declaration' as const })),
        targets: source.targets.map((target) => ({ ...target, availability: 'unsupported' as const })),
    }), /coverage_inventory_availability_unsubstantiated/u);
});

test('version-specific runtime not-applicable evidence remains in the denominator', () => {
    const source = { ...inventory(), targets: inventory().targets.map((target) => ({ ...target, availability: 'unsupported' as const })) };
    const sample = proof(source);
    const result = CoverageManifestValidator.validate(sample.manifest, source, sample.reader);
    assert.equal(result.ok, true);
    assert.equal(result.requiredCases, 2);
    assert.equal(result.passed, 0);
    assert.equal(result.notApplicable, 2);
    const malformed = { ...sample.manifest, cases: sample.manifest.cases.map((row) => ({ ...row, dependencies: 'omitted' })) };
    assert.equal(CoverageManifestValidator.validate(malformed, source, sample.reader).ok, false);
});

test('missing fixture and mismatched fixture digest fail even with successful native results', () => {
    const sample = proof();
    for (const fixture of [null, { reference: 'fixtures/missing.txt', sha256: fixtureHash },
        { reference: 'fixtures/text.txt', sha256: 'd'.repeat(64) }]) {
        const manifest = { ...sample.manifest, cases: sample.manifest.cases.map((row) => ({ ...row, fixture })) };
        assert.equal(CoverageManifestValidator.validate(manifest, sample.source, sample.reader).ok, false);
    }
});

test('fixture dependency closure cannot be omitted and every dependency must resolve', () => {
    const sample = proof();
    const dependency = { reference: 'fixtures/dependency.txt', sha256: 'd'.repeat(64) };
    const reader: ICoverageEvidenceReader = { ...sample.reader,
        fixture: (reference) => reference === 'fixtures/text.txt' ? { sha256: fixtureHash, valid: true, dependencies: [dependency] }
            : reference === dependency.reference ? { sha256: dependency.sha256, valid: true, dependencies: [] } : null,
    };
    assert.equal(CoverageManifestValidator.validate(sample.manifest, sample.source, reader).ok, false);
    const complete = { ...sample.manifest, cases: sample.manifest.cases.map((row) => ({ ...row, dependencies: [dependency] })) };
    assert.equal(CoverageManifestValidator.validate(complete, sample.source, reader).ok, true);
    const duplicated = { ...complete, cases: complete.cases.map((row) => ({ ...row, dependencies: [dependency, dependency] })) };
    assert.equal(CoverageManifestValidator.validate(duplicated, sample.source, reader).ok, false);
    assert.equal(CoverageManifestValidator.validate(complete, sample.source, sample.reader).ok, false);
});

for (const change of [
    { creatorVersion: '3.8.3' }, { caseId: 'other' }, { sha256: 'd'.repeat(64) },
    { nativeVerified: false }, { rawLogsVerified: false }, { readbackVerified: false },
    { warnings: 1 }, { errors: 1 }, { readback: 'unrelated_rule' }, { outcome: 'not_applicable' as const },
]) {
    test(`independent result mismatch fails: ${Object.keys(change).join(',')}`, () => {
        const sample = proof();
        for (const [reference, result] of sample.results) {
            sample.results.set(reference, { ...result, ...change });
        }
        assert.equal(CoverageManifestValidator.validate(sample.manifest, sample.source, sample.reader).ok, false);
    });
}

test('evidence exceptions and malformed JSON shapes fail closed', () => {
    const sample = proof();
    const throwing: ICoverageEvidenceReader = { fixture: () => { throw new Error('unavailable'); }, result: sample.reader.result };
    assert.equal(CoverageManifestValidator.validate(sample.manifest, sample.source, throwing).ok, false);
    for (const invalid of [null, [], { ...sample.manifest, extra: true }, { ...sample.manifest, cases: [{ id: 'unknown' }] }]) {
        assert.equal(CoverageManifestValidator.validate(invalid, sample.source, sample.reader).ok, false);
    }
});

test('evidence paths reject traversal, absolute paths, protocols and control characters', () => {
    for (const reference of ['../secret', '/absolute', 'file:asset', 'a\\b', 'a//b', './a', 'a/../b', 'a\nb', 'a\0b']) {
        assert.equal(CoverageManifestGenerator.relativeReference(reference), false);
    }
    assert.equal(CoverageManifestGenerator.relativeReference('fixtures/中文 文本.txt'), true);
});

test('inventory duplicates, impossible class classification and non-JSON digest input are rejected', () => {
    const source = inventory();
    assert.throws(() => CoverageManifestGenerator.createDraft({ ...source, targets: [...source.targets, ...source.targets] }));
    assert.throws(() => CoverageManifestGenerator.createDraft({ ...source, nativeAbstractComponentDeclarations: ['cc.Unknown'] }));
    assert.throws(() => CoverageManifestGenerator.createDraft({ ...source, nativeImporterModules: ['importer/importers/known.ccc'] }), /reconciliation_missing/u);
    assert.throws(() => CoverageManifestGenerator.createDraft({ ...source,
        nativeUnresolvedRegistrations: [{ sourcePath: 'dynamic.ts', line: 2, className: 'Dynamic', componentDeclaration: false }],
    }), /reconciliation_missing/u);
    assert.throws(() => CoverageManifestGenerator.digest(new Date()));
    let nested: unknown = 1;
    for (let index = 0; index < 70; index += 1) {
        nested = [nested];
    }
    assert.throws(() => CoverageManifestGenerator.digest(nested), /budget_exceeded/u);
});

test('issue text is bounded while total gaps and required denominator remain complete', () => {
    const source = { ...inventory(), targets: Array.from({ length: 120 }, (_, index) => ({
        id: `asset:${index}`, domain: 'asset' as const, subject: `${index}`, actions: ['read'], fieldKind: null,
        availability: 'unverified' as const, availabilitySourceId: null,
    })) };
    const result = CoverageManifestValidator.validate(CoverageManifestGenerator.createDraft(source), source, proof().reader);
    assert.equal(result.requiredCases, 120);
    assert.equal(result.issueCount, 120);
    assert.equal(result.issues.length, 100);
});
