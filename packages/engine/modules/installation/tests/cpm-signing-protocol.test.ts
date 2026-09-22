import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CpmSigningProtocol, type CpmSigningKind } from '../src/index.js';

interface ISigningVector {
    readonly kind: CpmSigningKind;
    readonly fields: Readonly<Record<string, unknown>>;
    readonly canonicalPayload: string;
    readonly signature: string;
}

interface ISigningFixtures {
    readonly publicKey: { readonly value: string };
    readonly vectors: readonly ISigningVector[];
}

const fixtures = JSON.parse(await readFile(new URL('./fixtures/signing-vectors.json', import.meta.url), 'utf8')) as ISigningFixtures;

for (const vector of fixtures.vectors) {
    test(`${vector.kind} matches the shared canonical signing vector`, () => {
        assert.equal(CpmSigningProtocol.canonicalize(vector.kind, vector.fields), vector.canonicalPayload);
        assert.equal(CpmSigningProtocol.verify(vector.kind, vector.fields, vector.signature, fixtures.publicKey.value), true);
    });

    test(`${vector.kind} rejects every signed-field mutation`, () => {
        for (const [field, value] of Object.entries(vector.fields)) {
            const mutated = {
                ...vector.fields,
                [field]: Array.isArray(value) ? [...value, '9.9.9'] : `${String(value)}-tampered`,
            };
            assert.equal(CpmSigningProtocol.verify(vector.kind, mutated, vector.signature, fixtures.publicKey.value), false, field);
        }
    });
}
