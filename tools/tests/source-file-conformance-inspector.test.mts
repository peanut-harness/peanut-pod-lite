import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { SourceFileConformanceInspector } from '../source-file-conformance-inspector.mjs';

test('source conformance inspector includes source directories and ignores comment text', (): void => {
    const repositoryRoot = resolve('virtual-repository');
    const inspector = new SourceFileConformanceInspector(repositoryRoot);
    const inspection = inspector.inspect(
        join(repositoryRoot, 'packages', 'engine', 'modules', 'lumen', 'source', 'sample.ts'),
        `
            // class CommentOnly {}
            const text = 'class StringOnly {}';
            export function legacyFreeFunction(): void {}
            export class FirstClass {}
            class SecondClass {}
        `,
    );

    assert.equal(inspection.exportedFreeFunctions, 1);
    assert.equal(inspection.hasMultipleClasses, true);
    assert.equal(inspection.productionLineCount > 0, true);
});

test('source conformance inspector excludes declaration and test files from structure metrics', (): void => {
    const repositoryRoot = resolve('virtual-repository');
    const inspector = new SourceFileConformanceInspector(repositoryRoot);
    const declarationInspection = inspector.inspect(
        join(repositoryRoot, 'packages', 'engine', 'src', 'types', 'node-fs.d.ts'),
        'export declare function readFile(): void; export declare class First {} export declare class Second {}',
    );
    const testInspection = inspector.inspect(
        join(repositoryRoot, 'packages', 'engine', 'src', 'tests', 'sample.test.ts'),
        'export function helper(): void {} class First {} class Second {}',
    );

    assert.equal(declarationInspection.exportedFreeFunctions, 0);
    assert.equal(declarationInspection.hasMultipleClasses, false);
    assert.equal(declarationInspection.productionLineCount, 0);
    assert.equal(testInspection.exportedFreeFunctions, 0);
    assert.equal(testInspection.hasMultipleClasses, false);
    assert.equal(testInspection.productionLineCount, 0);
});

test('source conformance inspector keeps single-line JSDoc and legacy script accounting independent', (): void => {
    const repositoryRoot = resolve('virtual-repository');
    const inspector = new SourceFileConformanceInspector(repositoryRoot);
    const singleLineJSDoc = `/${'*'}* @description historical single-line comment. ${'*'}/`;
    const inspection = inspector.inspect(
        join(repositoryRoot, 'tools', 'sample.mjs'),
        `${singleLineJSDoc}\nexport function toolHelper() {}`,
    );

    assert.equal(inspection.singleLineJSDoc, 1);
    assert.equal(inspection.exportedFreeFunctions, 0);
    assert.equal(inspector.isLegacyScript('sample.mjs'), true);
    assert.equal(inspector.isLegacyScript('sample.ts'), false);
});
