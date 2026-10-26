import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ComponentTaskOwnership } from './component-task-ownership.mts';

const owner = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const workspace = '/unit-workspace';
const path = '.worktrees/peanut-pod-lite/stabilize-editor-operations-and-bulk-file-io';
const repository = join(workspace, path);
const entry = { repo: 'peanut-pod-lite', change: 'stabilize-editor-operations-and-bulk-file-io', path,
    branch: 'change/stabilize-editor-operations-and-bulk-file-io', state: 'active', deliveryMode: 'self-delivery',
    owner, checkpointOwner: owner, integrationOwner: owner };

test('task ownership follows the registered handoff and refuses the previous actor', () => {
    assert.equal(ComponentTaskOwnership.fromRegistry(repository, workspace, owner, { version: 1, entries: [entry] }), owner);
    assert.equal(ComponentTaskOwnership.fromRegistry(repository, workspace, owner,
        { version: 1, entries: [{ ...entry, deliveryMode: 'coordinated' }] }), owner);
    assert.throws(() => ComponentTaskOwnership.fromRegistry(repository, workspace, owner,
        { version: 1, entries: [{ ...entry, deliveryMode: 'coordinated', integrationOwner: 'other' }] }), /owner_mismatch/);
    const next = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const transferred = { version: 1, entries: [{ ...entry, owner: next, checkpointOwner: next, integrationOwner: next }] };
    assert.equal(ComponentTaskOwnership.fromRegistry(repository, workspace, next, transferred), next);
    assert.throws(() => ComponentTaskOwnership.fromRegistry(repository, workspace, owner, transferred), /owner_mismatch/);
});

test('task ownership rejects incomplete handoffs, stale paths, inactive entries and absent actor identity', () => {
    for (const patch of [{ owner: 'other' }, { checkpointOwner: 'other' }, { integrationOwner: 'other' },
        { path: '.worktrees/peanut-pod-lite/other' }, { branch: 'main' }, { state: 'retained' }, { deliveryMode: 'unknown' }]) {
        assert.throws(() => ComponentTaskOwnership.fromRegistry(repository, workspace, owner,
            { version: 1, entries: [{ ...entry, ...patch }] }), /owner_mismatch/);
    }
    for (const actor of [undefined, null, '', ` ${owner}`]) {
        assert.throws(() => ComponentTaskOwnership.fromRegistry(repository, workspace, actor,
            { version: 1, entries: [entry] }), /actor_missing/);
    }
    for (const entries of [[], [entry, entry]]) {
        assert.throws(() => ComponentTaskOwnership.fromRegistry(repository, workspace, owner,
            { version: 1, entries }), /registry_ambiguous/);
    }
    assert.throws(() => ComponentTaskOwnership.fromRegistry('/another-worktree', workspace, owner,
        { version: 1, entries: [entry] }), /owner_mismatch/);
    for (const registry of [null, [], { version: 2, entries: [entry] }, { version: 1, entries: [null] }]) {
        assert.throws(() => ComponentTaskOwnership.fromRegistry(repository, workspace, owner, registry), /registry_invalid/);
    }
});

test('task ownership reads the device registry and refuses linked registration files', () => {
    const root = mkdtempSync(join(tmpdir(), 'component-task-ownership-'));
    try {
        const worktree = join(root, path); mkdirSync(worktree, { recursive: true });
        const state = join(root, '.peanut-ai'); mkdirSync(state);
        const registry = join(state, 'worktree-registry.json');
        writeFileSync(registry, JSON.stringify({ version: 1, entries: [entry] }));
        assert.equal(ComponentTaskOwnership.current(worktree, owner), owner);
        rmSync(registry); const target = join(root, 'registry.json');
        writeFileSync(target, JSON.stringify({ version: 1, entries: [entry] })); symlinkSync(target, registry);
        assert.throws(() => ComponentTaskOwnership.current(worktree, owner), /registry_link/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
