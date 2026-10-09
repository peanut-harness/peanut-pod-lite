'use strict';

const { AccountSessionStore } = require('./account-session-store');
const { createPodAccountClient } = require('./pod-account-client');
const { listPremiumOffer, POD_PRO_PACKAGE_ID, POD_PRO_PRODUCT_CODE } = require('./premium-offer-catalog');

function createSignedOutAccount() {
    return Object.freeze({
        state: 'signed_out',
        error: null,
        tenantId: null,
        subjectId: null,
        deviceId: null,
        subscription: null,
        recommendedAction: 'sign-in',
        offer: listPremiumOffer(),
    });
}

class LiteAccountController {
    constructor({ projectPath, safeStorageProvider, transport, timeoutMs }) {
        this.store = new AccountSessionStore(projectPath, safeStorageProvider);
        this.transport = transport;
        this.timeoutMs = timeoutMs;
        this.account = createSignedOutAccount();
    }

    status() {
        return this.account;
    }

    offer() {
        return listPremiumOffer();
    }

    async restore(pro) {
        const session = this.store.read();
        if (session.endpoint == null || session.accessToken == null) {
            this.account = createSignedOutAccount();
            return this.withPro(pro);
        }
        return this.refresh(pro);
    }

    setEndpoint(endpoint) {
        this.store.writeEndpoint(endpoint);
        return this.status();
    }

    async setAccessToken(token, pro) {
        this.store.writeAccessToken(token);
        return this.refresh(pro);
    }

    clear(pro) {
        this.store.clear();
        this.account = createSignedOutAccount();
        return this.withPro(pro);
    }

    async refresh(pro) {
        try {
            const session = this.store.read();
            const client = createPodAccountClient({
                endpoint: session.endpoint,
                accessToken: session.accessToken,
                transport: this.transport,
                timeoutMs: this.timeoutMs,
            });
            const snapshot = await client.subscription();
            this.account = Object.freeze({
                state: 'signed_in',
                error: null,
                tenantId: snapshot.tenantId ?? null,
                subjectId: snapshot.subjectId ?? null,
                deviceId: snapshot.deviceId ?? null,
                subscription: Object.freeze({
                    status: snapshot.status,
                    entitlements: Object.freeze([...(snapshot.entitlements ?? [])]),
                    activeUntil: snapshot.activeUntil ?? null,
                    productCode: snapshot.productCode ?? POD_PRO_PRODUCT_CODE,
                    packageId: snapshot.packageId ?? listPremiumOffer().packageId,
                }),
                recommendedAction: recommend(snapshot.status, pro),
                offer: snapshot.offer ?? listPremiumOffer(),
            });
            return this.account;
        } catch (error) {
            this.account = Object.freeze({
                ...createSignedOutAccount(),
                state: 'error',
                error: error instanceof Error ? error.message : String(error),
                recommendedAction: 'sign-in',
            });
            return this.account;
        }
    }

    /**
     * Fetches a fresh server snapshot and requires the complete Pro entitlement set.
     */
    async requireProEntitlement() {
        const session = this.store.read();
        const client = createPodAccountClient({
            endpoint: session.endpoint,
            accessToken: session.accessToken,
            transport: this.transport,
            timeoutMs: this.timeoutMs,
        });
        const snapshot = await client.subscription();
        const offer = listPremiumOffer();
        const entitlements = new Set(Array.isArray(snapshot.entitlements) ? snapshot.entitlements : []);
        const activeUntil = snapshot.activeUntil ?? null;
        const expiresAt = activeUntil == null ? null : Date.parse(activeUntil);
        if (snapshot.status !== 'active'
            || snapshot.productCode !== POD_PRO_PRODUCT_CODE
            || snapshot.packageId !== POD_PRO_PACKAGE_ID
            || (activeUntil != null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now()))
            || !offer.entitlements.every((entitlement) => entitlements.has(entitlement))) {
            throw new Error('peanut_pro_entitlement_required');
        }
        return true;
    }

    async startCheckout(pro) {
        const session = this.store.read();
        const client = createPodAccountClient({
            endpoint: session.endpoint,
            accessToken: session.accessToken,
            transport: this.transport,
            timeoutMs: this.timeoutMs,
        });
        const checkout = await client.checkout(POD_PRO_PRODUCT_CODE);
        await this.refresh(pro);
        return Object.freeze({
            ...checkout,
            recommendedAction: this.account.recommendedAction,
        });
    }

    withPro(pro) {
        if (this.account.state !== 'signed_in') {
            return this.account;
        }
        this.account = Object.freeze({
            ...this.account,
            recommendedAction: recommend(this.account.subscription?.status, pro),
        });
        return this.account;
    }
}

function recommend(subscriptionStatus, pro) {
    if (subscriptionStatus !== 'active') {
        return 'upgrade';
    }
    if (pro?.state === 'active') {
        return 'ready';
    }
    if (pro?.state === 'failed') {
        return 'repair-pro';
    }
    return 'install-pro';
}

module.exports = { LiteAccountController, createSignedOutAccount };
