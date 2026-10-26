import { createHash } from 'node:crypto';
import { closeSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync,
    realpathSync, unlinkSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Version = '3.8.3' | '3.8.7';
export type ComponentSpriteProbeDescriptor = {
    schemaVersion: 1; projectPath: string; creatorVersion: Version; owner: string;
    runId: string; pid: number; candidateSourceCommit: string;
    hostSha256: string; coreSha256: string; probeSourceCommit: string;
    probeBundleSha256: string; port: number; token: string; generation: string;
};

const HEX64 = /^[a-f0-9]{64}$/u;
const HEX40 = /^[a-f0-9]{40}$/u;
const HEX32 = /^[a-f0-9]{32}$/u;
const OWNER = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const RUN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

function present(path: string): boolean { return lstatSync(path, { throwIfNoEntry: false }) !== undefined; }
function directory(path: string): void {
    if (!present(path) || !lstatSync(path).isDirectory() || realpathSync(path) !== path)
        throw new Error('component_sprite_descriptor_directory_invalid');
}
function regular(path: string): void {
    if (!present(path) || !lstatSync(path).isFile() || lstatSync(path).nlink !== 1
        || (lstatSync(path).mode & 0o777) !== 0o600
        || realpathSync(path) !== path)
        throw new Error('component_sprite_descriptor_file_invalid');
}
function validate(value: ComponentSpriteProbeDescriptor, project: string): void {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype
        || Object.keys(value).length !== 14
        || value.schemaVersion !== 1 || value.projectPath !== project
        || !['3.8.3', '3.8.7'].includes(value.creatorVersion)
        || !OWNER.test(value.owner) || !RUN.test(value.runId)
        || !Number.isSafeInteger(value.pid) || value.pid <= 0
        || !HEX40.test(value.candidateSourceCommit) || !HEX64.test(value.hostSha256)
        || !HEX64.test(value.coreSha256) || !HEX40.test(value.probeSourceCommit)
        || !HEX64.test(value.probeBundleSha256)
        || !Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535
        || !HEX64.test(value.token) || !HEX32.test(value.generation))
        throw new Error('component_sprite_descriptor_identity_invalid');
}

/**
 * Exclusive publication through a same-directory temporary inode and hard link.
 * The project write set must be separately registered before use outside synthetic tests.
 */
export class ComponentExistingSpriteProbeDescriptorOwner {
    private readonly project: string;
    private readonly directoryPath: string;
    private readonly target: string;
    private active: { generation: string; digest: string; dev: number; ino: number } | null = null;

    public constructor(projectPath: string) {
        const project = realpathSync(projectPath);
        if (project !== resolve(projectPath) || projectPath !== resolve(projectPath))
            throw new Error('component_sprite_descriptor_project_alias');
        this.project = project;
        this.directoryPath = join(project, '.peanut-ai');
        this.target = join(this.directoryPath, 'component-sprite-probe.json');
        directory(this.directoryPath);
    }

    public publish(value: ComponentSpriteProbeDescriptor): void {
        directory(this.directoryPath);
        validate(value, this.project);
        if (this.active || present(this.target)) throw new Error('component_sprite_descriptor_occupied');
        const temporary = join(this.directoryPath, `component-sprite-probe.${value.generation}.tmp`);
        if (present(temporary)) throw new Error('component_sprite_descriptor_temporary_occupied');
        const bytes = Buffer.from(JSON.stringify(value) + '\n');
        const digest = createHash('sha256').update(bytes).digest('hex');
        let fd: number | null = null;
        let ownTemp = false;
        let linked = false;
        let ownDev = -1; let ownIno = -1;
        try {
            fd = openSync(temporary, 'wx', 0o600); ownTemp = true;
            let offset = 0;
            while (offset < bytes.length) {
                const written = writeSync(fd, bytes, offset, bytes.length - offset, offset);
                if (written <= 0) throw new Error('component_sprite_descriptor_write_failed');
                offset += written;
            }
            fsyncSync(fd);
            const stat = fstatSync(fd);
            if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600)
                throw new Error('component_sprite_descriptor_temporary_invalid');
            ownDev = stat.dev; ownIno = stat.ino;
            closeSync(fd); fd = null;
            linkSync(temporary, this.target); linked = true;
            unlinkSync(temporary); ownTemp = false;
            regular(this.target);
            const final = lstatSync(this.target);
            if (final.dev !== stat.dev || final.ino !== stat.ino
                || createHash('sha256').update(readFileSync(this.target)).digest('hex') !== digest)
                throw new Error('component_sprite_descriptor_publish_mismatch');
            this.active = { generation: value.generation, digest, dev: stat.dev, ino: stat.ino };
        } catch (error) {
            if (fd !== null) closeSync(fd);
            if (linked && present(this.target)) {
                const current = lstatSync(this.target);
                if (current.dev === ownDev && current.ino === ownIno) unlinkSync(this.target);
            }
            if (ownTemp && present(temporary)) {
                const current = lstatSync(temporary);
                if (current.dev === ownDev && current.ino === ownIno) unlinkSync(temporary);
            }
            throw error;
        }
    }

    public clear(generation: string): void {
        if (!this.active) return;
        if (generation !== this.active.generation) throw new Error('component_sprite_descriptor_generation_mismatch');
        directory(this.directoryPath);
        regular(this.target);
        const stat = lstatSync(this.target);
        const digest = createHash('sha256').update(readFileSync(this.target)).digest('hex');
        if (stat.dev !== this.active.dev || stat.ino !== this.active.ino || digest !== this.active.digest)
            throw new Error('component_sprite_descriptor_ownership_mismatch');
        unlinkSync(this.target);
        this.active = null;
    }
}
