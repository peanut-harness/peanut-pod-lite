'use strict';

const { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('fs');
const { isAbsolute, join, relative, resolve, sep } = require('path');
const { normalizePodEndpoint } = require('./pod-account-client');

const TOKEN_MAX_LENGTH = 8_192;

/**
 * Persists the Pod endpoint in plain config and the access token via Electron safeStorage.
 */
class AccountSessionStore {
    constructor(projectPath, safeStorageProvider) {
        if (typeof safeStorageProvider !== 'function') {
            throw new Error('peanut_account_store_input_invalid');
        }
        this.projectPath = realpathSync(resolve(projectPath));
        this.directoryPath = resolve(this.projectPath, 'peanut-plugins', 'account');
        this.configPath = join(this.directoryPath, 'config.json');
        this.tokenPath = join(this.directoryPath, 'access.token');
        this.safeStorageProvider = safeStorageProvider;
    }

    read() {
        return Object.freeze({
            endpoint: this.readEndpoint(),
            accessToken: this.readAccessToken(),
        });
    }

    writeEndpoint(endpoint) {
        const normalized = normalizePodEndpoint(endpoint);
        const changed = this.readEndpoint() !== normalized;
        if (!changed) {
            return false;
        }
        this.ensureDirectory();
        this.clear();
        writeFileSync(this.configPath, `${JSON.stringify({ endpoint: normalized }, null, 2)}\n`, { mode: 0o600 });
        return true;
    }

    writeAccessToken(token) {
        if (typeof token !== 'string' || token.trim().length === 0 || token.length > TOKEN_MAX_LENGTH || /[\r\n]/u.test(token)) {
            throw new Error('peanut_account_token_invalid');
        }
        const safeStorage = this.requireSafeStorage();
        this.ensureDirectory();
        const encrypted = safeStorage.encryptString(token.trim());
        if (!Buffer.isBuffer(encrypted) || encrypted.length === 0 || encrypted.length > 32_768) {
            throw new Error('peanut_account_token_encrypt_failed');
        }
        writeFileSync(this.tokenPath, encrypted, { mode: 0o600 });
    }

    clear() {
        if (existsSync(this.tokenPath)) {
            rmSync(this.tokenPath);
        }
    }

    readEndpoint() {
        if (!existsSync(this.configPath) || lstatSync(this.configPath).isSymbolicLink()) {
            return null;
        }
        try {
            const parsed = JSON.parse(readFileSync(this.configPath, 'utf8'));
            return normalizePodEndpoint(parsed?.endpoint);
        } catch {
            return null;
        }
    }

    readAccessToken() {
        if (!existsSync(this.tokenPath) || lstatSync(this.tokenPath).isSymbolicLink()) {
            return null;
        }
        const safeStorage = this.requireSafeStorage();
        const decrypted = safeStorage.decryptString(readFileSync(this.tokenPath));
        return typeof decrypted === 'string' && decrypted.length > 0 && decrypted.length <= TOKEN_MAX_LENGTH ? decrypted : null;
    }

    ensureDirectory() {
        mkdirSync(this.directoryPath, { recursive: true, mode: 0o700 });
        const realDirectoryPath = realpathSync(this.directoryPath);
        const directoryChild = relative(this.projectPath, realDirectoryPath);
        if (
            lstatSync(this.directoryPath).isSymbolicLink() ||
            directoryChild.length === 0 ||
            isAbsolute(directoryChild) ||
            directoryChild === '..' ||
            directoryChild.startsWith(`..${sep}`)
        ) {
            throw new Error('peanut_account_directory_invalid');
        }
    }

    requireSafeStorage() {
        const safeStorage = this.safeStorageProvider();
        if (
            safeStorage == null ||
            typeof safeStorage.encryptString !== 'function' ||
            typeof safeStorage.decryptString !== 'function' ||
            safeStorage.isEncryptionAvailable?.() === false ||
            safeStorage.getSelectedStorageBackend?.() === 'basic_text'
        ) {
            throw new Error('peanut_account_storage_insecure');
        }
        return safeStorage;
    }
}

module.exports = { AccountSessionStore };
