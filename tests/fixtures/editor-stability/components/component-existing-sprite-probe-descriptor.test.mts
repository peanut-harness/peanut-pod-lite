import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
    readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { ComponentExistingSpriteProbeDescriptorOwner as Owner,
    type ComponentSpriteProbeDescriptor } from './component-existing-sprite-probe-descriptor.ts';

function fixture() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'component-sprite-descriptor-')));
    const project = join(root, 'synthetic-project');
    mkdirSync(join(project, '.peanut-ai'), { recursive: true });
    const target = join(project, '.peanut-ai/component-sprite-probe.json');
    const identity: ComponentSpriteProbeDescriptor = {
        schemaVersion: 1, projectPath: project, creatorVersion: '3.8.3',
        owner: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', runId: 'sprite-canary', pid: 12345,
        candidateSourceCommit: 'a'.repeat(40), hostSha256: 'b'.repeat(64),
        coreSha256: 'c'.repeat(64), probeSourceCommit: 'd'.repeat(40),
        probeBundleSha256: 'e'.repeat(64), port: 1234, token: 'f'.repeat(64),
        generation: '1'.repeat(32),
    };
    return { root, project, target, identity,
        close: () => rmSync(root, { recursive: true, force: true }) };
}

test('compiled descriptor treats only ENOENT as absent when legacy lstat ignores options', () => {
    const f = fixture();
    try {
        const output = buildSync({ entryPoints: [join(import.meta.dirname,
            'component-existing-sprite-probe-descriptor.ts')], bundle: true,
            platform: 'node', format: 'cjs', target: 'node12', write: false }).outputFiles[0].text;
        const module = { exports: {} as { ComponentExistingSpriteProbeDescriptorOwner: typeof Owner } };
        let fault: string | null = null;
        const context = createContext({ module, exports: module.exports, Buffer, process,
            identityJson: JSON.stringify(f.identity),
            require: (name: string) => name === 'node:fs' || name === 'fs'
                ? { ...fs, lstatSync: (path: string) => {
                    if (path === f.target && fault) throw Object.assign(new Error(fault), { code: fault });
                    return fs.lstatSync(path);
                } }
                : createRequire(import.meta.url)(name),
        });
        runInContext(output, context, { filename: 'legacy-descriptor.cjs', timeout: 1000 });
        const identity = runInContext('JSON.parse(identityJson)', context) as ComponentSpriteProbeDescriptor;
        const LegacyOwner = module.exports.ComponentExistingSpriteProbeDescriptorOwner;
        for (const code of ['EACCES', 'ENOTDIR', 'ELOOP', 'EIO']) {
            fault = code;
            assert.throws(() => new LegacyOwner(f.project).publish(identity), { code });
            assert.equal(existsSync(f.target), false);
        }
        fault = null;
        const owner = new LegacyOwner(f.project);
        owner.publish(identity);
        assert.deepEqual(JSON.parse(readFileSync(f.target, 'utf8')), f.identity);
        owner.clear(f.identity.generation);
        assert.equal(existsSync(f.target), false);
    } finally { f.close(); }
});

test('exclusive temporary inode publishes complete mode 0600 descriptor and clears only its generation', () => {
    const f = fixture();
    try {
        const owner = new Owner(f.project); owner.publish(f.identity);
        const stat = lstatSync(f.target);
        assert.equal(stat.isFile(), true);
        assert.equal(stat.nlink, 1);
        assert.equal(stat.mode & 0o777, 0o600);
        assert.deepEqual(JSON.parse(readFileSync(f.target, 'utf8')), f.identity);
        assert.equal(existsSync(join(f.project, `.peanut-ai/component-sprite-probe.${f.identity.generation}.tmp`)), false);
        assert.throws(() => owner.publish(f.identity), /occupied/);
        assert.throws(() => owner.clear('2'.repeat(32)), /generation_mismatch/);
        assert.equal(existsSync(f.target), true);
        owner.clear(f.identity.generation); owner.clear(f.identity.generation);
        assert.equal(existsSync(f.target), false);
    } finally { f.close(); }
});

test('foreign regular, symlink, dangling link and hardlink targets are never overwritten', () => {
    for (const kind of ['regular', 'link', 'dangling', 'hardlink'] as const) {
        const f = fixture();
        try {
            const outside = join(f.root, 'outside'); writeFileSync(outside, 'foreign');
            if (kind === 'regular') writeFileSync(f.target, 'foreign');
            if (kind === 'link') symlinkSync(outside, f.target);
            if (kind === 'dangling') symlinkSync(join(f.root, 'missing'), f.target);
            if (kind === 'hardlink') linkSync(outside, f.target);
            assert.throws(() => new Owner(f.project).publish(f.identity), /occupied/);
            assert.equal(readFileSync(outside, 'utf8'), 'foreign');
            assert.equal(existsSync(join(f.project, `.peanut-ai/component-sprite-probe.${f.identity.generation}.tmp`)), false);
        } finally { f.close(); }
    }
});

test('occupied or linked temporary path and linked descriptor directory fail closed', () => {
    const f = fixture();
    try {
        const temporary = join(f.project, `.peanut-ai/component-sprite-probe.${f.identity.generation}.tmp`);
        const outside = join(f.root, 'outside'); writeFileSync(outside, 'foreign');
        for (const kind of ['file', 'link', 'dangling'] as const) {
            if (kind === 'file') writeFileSync(temporary, 'foreign');
            if (kind === 'link') symlinkSync(outside, temporary);
            if (kind === 'dangling') symlinkSync(join(f.root, 'missing'), temporary);
            assert.throws(() => new Owner(f.project).publish(f.identity), /temporary_occupied/);
            rmSync(temporary, { force: true });
        }
        assert.equal(existsSync(f.target), false);
        rmSync(join(f.project, '.peanut-ai'), { recursive: true });
        const actual = join(f.root, 'external-directory'); mkdirSync(actual);
        symlinkSync(actual, join(f.project, '.peanut-ai'));
        assert.throws(() => new Owner(f.project), /directory_invalid/);
    } finally { f.close(); }
});

test('stale owner cannot clear a later generation or a changed inode', () => {
    const f = fixture();
    try {
        const previous = new Owner(f.project); previous.publish(f.identity);
        previous.clear(f.identity.generation);
        const next = new Owner(f.project); const second = { ...f.identity,
            token: 'a'.repeat(64), generation: '2'.repeat(32) };
        next.publish(second);
        previous.clear(f.identity.generation);
        assert.deepEqual(JSON.parse(readFileSync(f.target, 'utf8')), second);
        const extra = join(f.root, 'hardlink'); linkSync(f.target, extra);
        assert.throws(() => next.clear(second.generation), /file_invalid/);
        rmSync(extra);
        const foreign = join(f.root, 'foreign'); writeFileSync(foreign, 'foreign');
        rmSync(f.target); linkSync(foreign, f.target); rmSync(foreign);
        assert.throws(() => next.clear(second.generation), /ownership_mismatch|file_invalid/);
        assert.equal(readFileSync(f.target, 'utf8'), 'foreign');
    } finally { f.close(); }
});

test('invalid identity, token, candidate or project path never creates a descriptor', () => {
    const f = fixture();
    try {
        for (const change of [{ token: 'wrong' }, { projectPath: `${f.project}-other` },
            { creatorVersion: '3.9.0' }, { candidateSourceCommit: 'x'.repeat(40) },
            { probeBundleSha256: 'wrong' }, { port: 0 }, { generation: '../escape' },
            { unexpected: true }]) {
            assert.throws(() => new Owner(f.project).publish({ ...f.identity, ...change } as ComponentSpriteProbeDescriptor), /identity_invalid/);
            assert.equal(existsSync(f.target), false);
        }
        assert.throws(() => new Owner(`${f.project}/../synthetic-project`), /project_alias/);
    } finally { f.close(); }
});

test('two owners collide on the same target and preserve the winner without changing mode', () => {
    const f = fixture();
    try {
        const first = new Owner(f.project), second = new Owner(f.project);
        first.publish(f.identity);
        assert.throws(() => second.publish({ ...f.identity, generation: '2'.repeat(32) }), /occupied/);
        assert.equal(lstatSync(f.target).mode & 0o777, 0o600);
        chmodSync(f.target, 0o644);
        assert.throws(() => first.clear(f.identity.generation), /ownership_mismatch|file_invalid/);
        assert.equal(existsSync(f.target), true);
    } finally { f.close(); }
});
