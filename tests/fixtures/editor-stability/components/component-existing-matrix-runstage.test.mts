import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentExistingMatrixRunstage } from './component-existing-matrix-runstage.mts';

const project = '/registered/project';
const record = { schemaVersion: 1, projectPath: project, owner: 'previous-owner', capabilities: [],
    resourceRoots: ['assets/components', 'assets/fixtures'] };

test('empty attachment handoff only changes owner and preserves the caller snapshot', () => {
    const before = Buffer.from(JSON.stringify(record)); const saved = Buffer.from(before);
    const plan = ComponentExistingMatrixRunstage.attachmentHandoff(project, 'current-owner', before);
    assert.equal(plan.required, true); assert.equal(plan.previousOwner, 'previous-owner');
    assert.deepEqual(JSON.parse(plan.afterBytes.toString()), { ...record, owner: 'current-owner' });
    assert.deepEqual(before, saved);
});

test('already-owned attachments retain their exact bytes including formatting', () => {
    const before = Buffer.from(JSON.stringify({ ...record, owner: 'current-owner' }, null, 3) + '\n\n');
    const plan = ComponentExistingMatrixRunstage.attachmentHandoff(project, 'current-owner', before);
    assert.equal(plan.required, false); assert.deepEqual(plan.afterBytes, before);
});

test('a different owner with live grants cannot be silently replaced or revoked', () => {
    const before = Buffer.from(JSON.stringify({ ...record, capabilities: ['peanut.editor-mcp.lumen-comp-set'] }));
    const saved = Buffer.from(before);
    assert.throws(() => ComponentExistingMatrixRunstage.attachmentHandoff(project, 'current-owner', before), /live_grants_require_revocation/u);
    assert.deepEqual(before, saved);
});

test('foreign project, broader roots, extra fields, invalid owner and malformed records fail closed', () => {
    for (const changed of [null, [], { ...record, projectPath: '/foreign' }, { ...record, resourceRoots: ['assets'] },
        { ...record, capabilities: [null] }, { ...record, owner: '' }, { ...record, extra: true }]) {
        assert.throws(() => ComponentExistingMatrixRunstage.attachmentHandoff(project, 'current-owner', Buffer.from(JSON.stringify(changed))), /attachment_(?:record|scope)_invalid/u);
    }
    assert.throws(() => ComponentExistingMatrixRunstage.attachmentHandoff(project, ' ', Buffer.from(JSON.stringify(record))), /scope_invalid/u);
});
