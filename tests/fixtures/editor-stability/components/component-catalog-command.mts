import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentCatalogAudit } from './component-catalog-audit.mts';

const args = process.argv.slice(2);
const argument = (name: string): string => {
    const index = args.indexOf(name);
    const value = index < 0 ? undefined : args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`component_argument_missing:${name}`);
    return value;
};
const version = argument('--creator-version');
if (version !== '3.8.3' && version !== '3.8.7') throw new Error('component_creator_version_invalid');
const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(fixtureRoot, '../../../..');
const engineRoot = resolve(argument('--creator-resources-root'), 'resources/3d/engine');
const expected = ComponentCatalogAudit.create(repositoryRoot, engineRoot, version);
const file = resolve(fixtureRoot, version, 'component-assembly-audit.json');
if (args.includes('--check')) ComponentCatalogAudit.validate(JSON.parse(readFileSync(file, 'utf8')), expected);
else writeFileSync(file, JSON.stringify(expected, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ version, check: args.includes('--check'),
    curatedComponents: expected.curatedComponentCount, fields: expected.fieldCount,
    dependencyReady: expected.dependencyReadyComponents, curatedWithoutSource: expected.curatedWithoutSource,
    nativeRegisteredClasses: expected.nativeRegisteredClassCount, nativeComponentDeclarations: expected.nativeComponentDeclarationCount,
    task51Complete: expected.task51Complete, nativePassedRows: expected.nativePassedRows }) + '\n');
