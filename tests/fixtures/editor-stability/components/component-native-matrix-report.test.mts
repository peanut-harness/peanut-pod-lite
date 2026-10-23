import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ComponentNativeMatrixReport } from './component-native-matrix-report.mts';

for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' interrupted native campaign retains all 99 components and 795 field statuses without promoting evidence', () => {
        const contract = JSON.parse(readFileSync(new URL(`./${version}/component-field-fixtures.json`, import.meta.url), 'utf8')) as {
            components: { componentType: string; cases: { id: string }[] }[];
        };
        const first = contract.components[0]; assert(first);
        const failed = { componentType: first.componentType, status: 'failed', reason: 'native-log-failed',
            fields: first.cases.map(field => ({ id: field.id, status: 'component-execution-failed' })) };
        const original = JSON.stringify(failed);
        const rows = ComponentNativeMatrixReport.complete(contract.components, [failed]);
        assert.equal(rows.length, 99); assert.equal(rows[0], failed);
        let count = 0;
        for (const row of rows) {
            assert(Array.isArray(row.fields)); count += row.fields.length;
            if (row === failed) continue;
            assert.equal(row.status, 'not-executed');
            assert(row.fields.every(field => field.status === 'pending' && field.reason === 'campaign-not-completed'));
        }
        assert.equal(count, 795); assert.equal(JSON.stringify(failed), original);
        assert.throws(() => ComponentNativeMatrixReport.complete(contract.components, [failed, failed]), /unknown_or_duplicate/);
        assert.throws(() => ComponentNativeMatrixReport.complete(contract.components, [{ componentType: 'cc.Unknown' }]), /unknown_or_duplicate/);
    });
}
