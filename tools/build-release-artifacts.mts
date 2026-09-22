import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

import {
    createLiteReleaseDescriptor,
    synchronizeReleaseIdentity,
} from './release-identity.mts';

const execFileAsync = promisify(execFile);
const TAR_BLOCK_SIZE = 512;

function comparePaths(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

async function listFiles(directoryPath, prefix = '') {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((left, right) => comparePaths(left.name, right.name))) {
        const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        const absolutePath = resolve(directoryPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFiles(absolutePath, relativePath));
            continue;
        }
        if (!entry.isFile()) {
            throw new Error(`lite_release_unsupported_entry:${relativePath}`);
        }
        files.push(relativePath);
    }
    return files;
}

async function createDirectoryRecords(directoryPath, excludedPaths = new Set()) {
    const records = [];
    for (const path of await listFiles(directoryPath)) {
        if (excludedPaths.has(path)) {
            continue;
        }
        const content = await readFile(resolve(directoryPath, path));
        records.push({
            path,
            digest: createHash('sha256').update(content).digest('hex'),
        });
    }
    records.sort((left, right) => comparePaths(left.path, right.path));
    return records;
}

function digestRecords(records) {
    return createHash('sha256')
        .update(records.map((record) => `${record.path}:${record.digest}`).join('\n'))
        .digest('hex');
}

function writeString(header, value, offset, length) {
    const encoded = Buffer.from(value, 'utf8');
    if (encoded.length > length) {
        throw new Error(`lite_release_tar_field_too_long:${value}`);
    }
    encoded.copy(header, offset);
}

function writeOctal(header, value, offset, length) {
    const encoded = value.toString(8).padStart(length - 1, '0');
    if (encoded.length >= length) {
        throw new Error('lite_release_tar_numeric_overflow');
    }
    writeString(header, `${encoded}\0`, offset, length);
}

function splitTarPath(path) {
    if (Buffer.byteLength(path) <= 100) {
        return { name: path, prefix: '' };
    }
    for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
        const prefix = path.slice(0, index);
        const name = path.slice(index + 1);
        if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) {
            return { name, prefix };
        }
    }
    throw new Error(`lite_release_tar_path_too_long:${path}`);
}

function createTarHeader(path, size) {
    const header = Buffer.alloc(TAR_BLOCK_SIZE);
    const split = splitTarPath(path);
    writeString(header, split.name, 0, 100);
    writeOctal(header, 0o644, 100, 8);
    writeOctal(header, 0, 108, 8);
    writeOctal(header, 0, 116, 8);
    writeOctal(header, size, 124, 12);
    writeOctal(header, 0, 136, 12);
    header.fill(0x20, 148, 156);
    writeString(header, '0', 156, 1);
    writeString(header, 'ustar\0', 257, 6);
    writeString(header, '00', 263, 2);
    writeString(header, split.prefix, 345, 155);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    const checksumText = checksum.toString(8).padStart(6, '0');
    writeString(header, `${checksumText}\0 `, 148, 8);
    return header;
}

async function createDeterministicArchive(directoryPath, archivePath) {
    const rootName = basename(directoryPath);
    const blocks = [];
    const files = await listFiles(directoryPath);
    for (const path of files) {
        const content = await readFile(resolve(directoryPath, path));
        blocks.push(createTarHeader(`${rootName}/${path}`, content.length), content);
        const padding = (TAR_BLOCK_SIZE - content.length % TAR_BLOCK_SIZE) % TAR_BLOCK_SIZE;
        if (padding > 0) {
            blocks.push(Buffer.alloc(padding));
        }
    }
    blocks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2));
    const archive = gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 });
    archive.fill(0, 4, 8);
    archive[9] = 255;
    await writeFile(archivePath, archive);
    return Object.freeze({
        files: Object.freeze(files.map((path) => `${rootName}/${path}`)),
        sha256: createHash('sha256').update(archive).digest('hex'),
    });
}

async function validateCorePackage(coreDirectory, manifestName) {
    const manifest = JSON.parse(await readFile(resolve(coreDirectory, manifestName), 'utf8'));
    const records = await createDirectoryRecords(coreDirectory, new Set([manifestName]));
    if (manifest?.package?.digest !== digestRecords(records)) {
        throw new Error('lite_release_core_package_digest_mismatch');
    }
    if (JSON.stringify(manifest.package.files) !== JSON.stringify(records)) {
        throw new Error('lite_release_core_package_files_mismatch');
    }
    return manifest.package.digest;
}

/**
 * @description 从已打包目录生成可重复的 Host/Core archive 与发行描述。
 */
export async function buildReleaseArtifacts(options) {
    const {
        identity,
        sourceCommit,
        hostDirectory,
        coreDirectory,
        outputDirectory,
        coreManifestName = 'peanut.pod-lite.manifest.json',
    } = options;
    const hostArchiveName = `peanut-pod-lite-host-${identity.version}.tar.gz`;
    const coreArchiveName = `peanut-pod-lite-core-${identity.version}.tar.gz`;

    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(outputDirectory, { recursive: true });

    const hostPackageDigest = digestRecords(await createDirectoryRecords(hostDirectory));
    const corePackageDigest = await validateCorePackage(coreDirectory, coreManifestName);
    const hostArchive = await createDeterministicArchive(hostDirectory, resolve(outputDirectory, hostArchiveName));
    const coreArchive = await createDeterministicArchive(coreDirectory, resolve(outputDirectory, coreArchiveName));
    const descriptor = createLiteReleaseDescriptor(
        identity,
        sourceCommit,
        {
            kind: 'host',
            archive: hostArchiveName,
            sha256: hostArchive.sha256,
            packageDigest: hostPackageDigest,
        },
        {
            kind: 'core',
            archive: coreArchiveName,
            sha256: coreArchive.sha256,
            packageDigest: corePackageDigest,
        },
    );
    const descriptorPath = resolve(outputDirectory, 'lite-release-descriptor.json');
    await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 4)}\n`, 'utf8');
    return Object.freeze({
        outputDirectory,
        descriptorPath,
        descriptor,
        archiveFiles: Object.freeze({
            host: hostArchive.files,
            core: coreArchive.files,
        }),
    });
}

/**
 * @description 使用仓库根发行身份和当前 Git source commit 构建 Lite 发行物。
 */
export async function buildLiteReleaseArtifacts(repositoryRoot) {
    const identity = synchronizeReleaseIdentity(repositoryRoot, true);
    const hostDirectory = resolve(
        repositoryRoot,
        'packages/hosts/modules/creator-38/release',
        `peanut-pod-lite-host-${identity.version}`,
    );
    const coreDirectory = resolve(
        repositoryRoot,
        'packages/engine/modules/creator-plugin/release',
        `peanut.pod-lite-${identity.version}`,
    );
    if (!existsSync(coreDirectory)) {
        return Object.freeze({
            skipped: true,
            reason: 'lite_release_core_package_missing',
        });
    }
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=no'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });
    if (status.trim().length > 0) {
        throw new Error('lite_release_source_dirty');
    }
    const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });
    const sourceCommit = stdout.trim();
    return buildReleaseArtifacts({
        identity,
        sourceCommit,
        hostDirectory,
        coreDirectory,
        outputDirectory: resolve(repositoryRoot, 'release', `peanut.pod-lite-${identity.version}`),
    });
}
