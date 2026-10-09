import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LiteAccountController } = require('../src/account-controller.js');
const offer = require('../src/premium-offer-catalog.js').listPremiumOffer();

test('Pro authorization requires a fresh matching product and complete entitlement response', async () => {
    const temporaryRoot = resolve(import.meta.dirname, '..', '.test-temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const root = mkdtempSync(join(temporaryRoot, 'pro-entitlement-'));
    let response = validSnapshot();
    let requests = 0;
    const controller = new LiteAccountController({
        projectPath: root,
        safeStorageProvider: () => ({ encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() }),
        transport: async (url, init) => {
            requests += 1;
            assert.equal(init.redirect, 'error');
            assert.equal(init.headers.authorization, 'Bearer test-token');
            assert.equal(url.search, '');
            assert.equal(url.href.includes('test-token'), false);
            return new Response(JSON.stringify(response), { status: 200 });
        },
    });

    try {
        controller.setEndpoint('https://pod.example/');
        controller.store.writeAccessToken('test-token');
        await controller.requireProEntitlement();
        assert.equal(requests, 1);

        response = { ...validSnapshot(), entitlements: ['premium.snowb'] };
        await assert.rejects(controller.requireProEntitlement(), /peanut_pro_entitlement_required/u);
        assert.equal(requests, 2);

        response = { ...validSnapshot(), status: 'expired' };
        await assert.rejects(controller.requireProEntitlement(), /peanut_pro_entitlement_required/u);
        assert.equal(requests, 3);

        response = { ...validSnapshot(), productCode: 'peanut.other-product' };
        await assert.rejects(controller.requireProEntitlement(), /peanut_pro_entitlement_required/u);
        response = { ...validSnapshot(), packageId: 'peanut.other-package' };
        await assert.rejects(controller.requireProEntitlement(), /peanut_pro_entitlement_required/u);
        response = { ...validSnapshot(), activeUntil: '2020-01-01T00:00:00.000Z' };
        await assert.rejects(controller.requireProEntitlement(), /peanut_pro_entitlement_required/u);
        response = { ...validSnapshot(), activeUntil: 'not-a-timestamp' };
        await assert.rejects(controller.requireProEntitlement(), /peanut_pro_entitlement_required/u);
        assert.equal(requests, 7);

        const timedOutController = new LiteAccountController({
            projectPath: root,
            safeStorageProvider: () => ({ encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() }),
            timeoutMs: 5,
            transport: async (_url, init) => new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            }),
        });
        await assert.rejects(timedOutController.requireProEntitlement(), /peanut_account_request_failed/u);

        controller.clear();
        await assert.rejects(controller.requireProEntitlement(), /peanut_account_token_missing/u);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

function validSnapshot() {
    return {
        status: 'active',
        productCode: 'peanut.cocos-mcp-pro',
        packageId: 'peanut.cocos-mcp-pro',
        entitlements: [...offer.entitlements],
    };
}
