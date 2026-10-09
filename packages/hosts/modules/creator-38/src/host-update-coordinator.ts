'use strict';

const {
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    writeFileSync,
} = require('fs');
const { basename, dirname, isAbsolute, join, relative, resolve, sep } = require('path');
const { CpmPackageStore } = require('./cpm-package-store');

const HOST_PACKAGE_ID = 'peanut-pod-lite-host';
const PRODUCT_ID = 'peanut.pod-lite';
const STATE_SCHEMA_VERSION = 1;

class HostUpdateCoordinator {
    constructor({ extensionRoot, projectPath }) {
        if (typeof extensionRoot !== 'string' || typeof projectPath !== 'string') {
            throw new Error('peanut_host_update_paths_invalid');
        }
        this.extensionRoot = realpathSync(resolve(extensionRoot));
        this.projectPath = realpathSync(resolve(projectPath));
        this.versionRoot = join(dirname(this.extensionRoot), `.${basename(this.extensionRoot)}-versions`);
        this.stateDirectory = join(this.projectPath, '.peanut-ai', 'lite-host-update');
        this.statePath = join(this.stateDirectory, 'state.json');
    }

    status() {
        const state = this.readState();
        if (state == null) return Object.freeze({ state: 'idle', version: null, error: null });
        return Object.freeze({
            state: state.state,
            version: state.version ?? null,
            previousVersion: state.previousVersion ?? null,
            error: state.error ?? null,
            message: state.message ?? null,
        });
    }

    stage(candidatePath, descriptor) {
        const sourceRoot = resolve(candidatePath);
        this._validateCandidate(sourceRoot, descriptor);
        const currentManifest = this._readManifest(this.extensionRoot);
        const previousState = this.readState();
        const previousEntry = previousState?.state === 'active'
            ? previousState.runtimeEntry
            : previousState?.state === 'rolled_back'
                ? previousState.previousRuntimeEntry
                : this._currentRuntimeEntry(currentManifest);
        if (compareVersions(descriptor.version, previousState?.state === 'active' ? previousState.version : currentManifest.version) <= 0) {
            throw new Error('peanut_host_update_version_not_newer');
        }

        mkdirSync(dirname(this.versionRoot), { recursive: true });
        if (existsSync(this.versionRoot) && (!lstatSync(this.versionRoot).isDirectory() || lstatSync(this.versionRoot).isSymbolicLink())) {
            throw new Error('peanut_host_update_version_store_invalid');
        }
        mkdirSync(this.versionRoot, { recursive: true });
        const stagedRoot = join(this.versionRoot, `.staging-${descriptor.version}-${process.pid}`);
        rmSync(stagedRoot, { recursive: true, force: true });
        copyDirectory(sourceRoot, stagedRoot);
        const copied = this._validateCandidate(stagedRoot, descriptor);
        const state = {
            schemaVersion: STATE_SCHEMA_VERSION,
            state: 'staged',
            version: descriptor.version,
            packageDigest: copied.packageDigest,
            stagedRoot,
            previousVersion: previousState?.state === 'active' ? previousState.version : currentManifest.version,
            previousRuntimeEntry: previousEntry,
            previousManifest: readFileSync(join(this.extensionRoot, 'package.json'), 'utf8'),
            nextManifest: this._manifestForCandidate(this._readManifest(stagedRoot), stagedRoot),
            error: null,
            message: 'Restart Creator to apply the staged Lite Host update.',
        };
        this.writeState(state);
        return this.status();
    }

    /** Called only after Creator has finished closing its windows and extension services. */
    applyStagedAtExit() {
        const state = this.readState();
        if (state?.state !== 'staged') return this.status();
        if (!isContained(this.versionRoot, state.stagedRoot) || !basename(state.stagedRoot).startsWith('.staging-')) {
            throw new Error('peanut_host_update_staging_path_invalid');
        }
        const verified = this._validateCandidate(state.stagedRoot, {
            schemaVersion: 1,
            productId: PRODUCT_ID,
            version: state.version,
            host: { kind: 'host', packageDigest: state.packageDigest },
        });
        const finalRoot = join(this.versionRoot, state.version);
        rmSync(finalRoot, { recursive: true, force: true });
        renameSync(state.stagedRoot, finalRoot);
        state.runtimeEntry = join(finalRoot, 'dist', 'main.js');
        state.packageDigest = verified.packageDigest;
        state.state = 'switching';
        state.nextManifest = this._manifestForCandidate(this._readManifest(finalRoot), finalRoot);
        this.writeState(state);
        this._writeManifestAtomic(state.nextManifest);
        state.state = 'pending-health-check';
        state.message = 'Lite Host update selected. The new Host will be checked on startup.';
        this.writeState(state);
        return this.status();
    }

    runtimeEntry() {
        const state = this.readState();
        if ((state?.state === 'switching' || state?.state === 'pending-health-check' || state?.state === 'active')
            && typeof state.runtimeEntry === 'string'
            && isContained(this.versionRoot, state.runtimeEntry)
            && existsSync(state.runtimeEntry)) {
            return state.runtimeEntry;
        }
        if (state?.state === 'rolled_back'
            && typeof state.previousRuntimeEntry === 'string'
            && (isContained(this.extensionRoot, state.previousRuntimeEntry) || isContained(this.versionRoot, state.previousRuntimeEntry))
            && existsSync(state.previousRuntimeEntry)) return state.previousRuntimeEntry;
        const manifest = this._readManifest(this.extensionRoot);
        return this._currentRuntimeEntry(manifest);
    }

    confirmHealthy(health) {
        const state = this.readState();
        if (state?.state !== 'pending-health-check') return this.status();
        if (health?.ready !== true
            || health?.artifacts?.host?.version !== state.version
            || health?.artifacts?.host?.packageDigest !== state.packageDigest) {
            throw new Error('peanut_host_update_health_check_failed');
        }
        state.state = 'active';
        state.error = null;
        state.message = 'Lite Host update passed its startup health check.';
        this.writeState(state);
        return this.status();
    }

    rollback(reason) {
        const state = this.readState();
        if (state?.state !== 'pending-health-check' && state?.state !== 'switching') return this.status();
        if (typeof state.previousManifest === 'string') this._writeManifestAtomic(JSON.parse(state.previousManifest));
        state.state = 'rolled_back';
        state.error = normalizeError(reason);
        state.message = 'Lite Host update failed its startup health check; the previous Host runtime was restored.';
        this.writeState(state);
        return this.status();
    }

    readState() {
        if (!existsSync(this.statePath)) return null;
        try {
            const stats = lstatSync(this.statePath);
            if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 64 * 1024) return null;
            const state = JSON.parse(readFileSync(this.statePath, 'utf8'));
            if (state?.schemaVersion !== STATE_SCHEMA_VERSION || typeof state.state !== 'string') return null;
            return state;
        } catch {
            return null;
        }
    }

    writeState(state) {
        const aiDirectory = dirname(this.stateDirectory);
        if (existsSync(aiDirectory) && (!lstatSync(aiDirectory).isDirectory() || lstatSync(aiDirectory).isSymbolicLink())) {
            throw new Error('peanut_host_update_state_path_invalid');
        }
        mkdirSync(aiDirectory, { recursive: true, mode: 0o700 });
        if (existsSync(this.stateDirectory) && (!lstatSync(this.stateDirectory).isDirectory() || lstatSync(this.stateDirectory).isSymbolicLink())) {
            throw new Error('peanut_host_update_state_path_invalid');
        }
        mkdirSync(this.stateDirectory, { recursive: true, mode: 0o700 });
        const temporaryPath = `${this.statePath}.tmp-${process.pid}`;
        writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporaryPath, this.statePath);
    }

    _validateCandidate(rootValue, descriptor) {
        const root = resolve(rootValue);
        const rootStats = lstatSync(root);
        if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error('peanut_host_update_package_invalid');
        const manifest = this._readManifest(root);
        if (descriptor?.schemaVersion !== 1
            || descriptor.productId !== PRODUCT_ID
            || descriptor.version !== manifest.version
            || descriptor.host?.kind !== 'host'
            || manifest.name !== HOST_PACKAGE_ID
            || manifest.main !== './dist/bootstrap.js'
            || !existsSync(join(root, 'dist', 'bootstrap.js'))
            || !existsSync(join(root, 'dist', 'main.js'))) {
            throw new Error('peanut_host_update_identity_invalid');
        }
        const packageDigest = CpmPackageStore.hostPackageDigest(root);
        if (packageDigest == null || packageDigest !== descriptor.host.packageDigest) {
            throw new Error('peanut_host_update_digest_mismatch');
        }
        return Object.freeze({ root, manifest, packageDigest });
    }

    _readManifest(root) {
        const manifestPath = join(root, 'package.json');
        const stats = lstatSync(manifestPath);
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 256 * 1024) throw new Error('peanut_host_update_manifest_invalid');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(manifest.version)) {
            throw new Error('peanut_host_update_manifest_invalid');
        }
        return manifest;
    }

    _currentRuntimeEntry(manifest) {
        if (manifest.main === './dist/bootstrap.js') return join(this.extensionRoot, 'dist', 'main.js');
        return join(this.extensionRoot, manifest.main.replace(/^\.\//u, ''));
    }

    _manifestForCandidate(manifest, candidateRoot) {
        const nextManifest = { ...manifest, main: './dist/bootstrap.js' };
        if (manifest.panels != null && typeof manifest.panels === 'object') {
            nextManifest.panels = Object.fromEntries(Object.entries(manifest.panels).map(([panelId, panel]) => {
                const panelMain = panel?.main;
                if (typeof panelMain !== 'string') return [panelId, panel];
                const candidatePanelMain = resolve(candidateRoot, panelMain);
                if (!isContained(candidateRoot, candidatePanelMain)) throw new Error('peanut_host_update_panel_path_invalid');
                const pathFromExtension = relative(this.extensionRoot, candidatePanelMain).split(sep).join('/');
                return [panelId, { ...panel, main: pathFromExtension }];
            }));
        }
        return nextManifest;
    }

    _writeManifestAtomic(manifest) {
        const target = join(this.extensionRoot, 'package.json');
        const temporary = `${target}.tmp-${process.pid}`;
        writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, target);
    }
}

function copyDirectory(source, destination) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
        const sourcePath = join(source, entry.name);
        const destinationPath = join(destination, entry.name);
        if (entry.isDirectory()) copyDirectory(sourcePath, destinationPath);
        else if (entry.isFile()) copyFileSync(sourcePath, destinationPath);
        else throw new Error('peanut_host_update_package_invalid');
    }
}

function compareVersions(left, right) {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
    }
    return 0;
}

function isContained(root, target) {
    const path = relative(resolve(root), resolve(target));
    return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

function normalizeError(error) {
    const value = error instanceof Error ? error.message : String(error);
    return value.slice(0, 200);
}

module.exports = { HostUpdateCoordinator };
