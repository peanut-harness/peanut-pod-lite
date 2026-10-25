'use strict';

const { readFileSync } = require('fs');
const { join } = require('path');

exports.template = readFileSync(join(__dirname, 'index.html'), 'utf8');
exports.style = readFileSync(join(__dirname, 'index.css'), 'utf8');
exports.$ = {
    endpoint: '#endpoint',
    token: '#token',
    saveEndpoint: '#saveEndpoint',
    signIn: '#signIn',
    signOut: '#signOut',
    refresh: '#refresh',
    upgrade: '#upgrade',
    refreshPro: '#refreshPro',
    status: '#status',
};

exports.ready = function ready() {
    const render = async () => {
        const status = await Editor.Message.request('peanut-pod-lite-host', 'query-status');
        this.$.status.innerText = JSON.stringify(
            {
                ready: status.ready,
                pro: status.pro,
                account: status.account,
            },
            null,
            2,
        );
    };
    const perform = async (action) => {
        try {
            await action();
            await render();
        } catch {
            this.$.status.innerText = '账户操作失败，请检查服务配置后重试。';
        }
    };
    this.$.saveEndpoint.addEventListener('click', () => perform(async () => {
        await Editor.Message.request('peanut-pod-lite-host', 'set-pod-endpoint', this.$.endpoint.value.trim());
    }));
    this.$.signIn.addEventListener('click', () => perform(async () => {
        const token = this.$.token.value;
        this.$.token.value = '';
        await Editor.Message.request('peanut-pod-lite-host', 'set-access-token', token);
    }));
    this.$.signOut.addEventListener('click', () => perform(async () => {
        this.$.token.value = '';
        await Editor.Message.request('peanut-pod-lite-host', 'clear-account');
    }));
    this.$.refresh.addEventListener('click', () => perform(async () => {
        await Editor.Message.request('peanut-pod-lite-host', 'query-subscription');
    }));
    this.$.upgrade.addEventListener('click', () => perform(async () => {
        const checkout = await Editor.Message.request('peanut-pod-lite-host', 'start-checkout');
        if (typeof checkout?.checkoutUrl === 'string') {
            await Editor.shell?.openExternal?.(checkout.checkoutUrl);
        }
    }));
    this.$.refreshPro.addEventListener('click', () => perform(async () => {
        await Editor.Message.request('peanut-pod-lite-host', 'refresh-pro');
    }));
    void perform(async () => {});
};
