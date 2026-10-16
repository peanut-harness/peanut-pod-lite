import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @description 使用3.8.3自身公开场景配置指定已有控制场景，避免把默认未保存场景用作矩阵启动输入。
 */
export class ComponentStartupScene {
    /**
     * @description 仅在全新3.8.3矩阵工程暂存公开current-scene；未知SDK契约在写入前拒绝。
     */
    public static stage(root: string, project: string, resources: string, version: string,
        readContract: (resources: string) => unknown = path => this.contract(path)): void {
        if (version !== '3.8.3') throw new Error('component_startup_scene_version_unverified');
        if (['temp', 'library', '.peanut-ai/component-probe.json'].some(path => existsSync(join(project, path))))
            throw new Error('component_startup_scene_project_started');
        const proof = this.record(JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/components/3.8.3/startup-scene-profile-provenance.json'), 'utf8')));
        const actual = this.record(readContract(resources));
        if (proof.creatorVersion !== version || proof.source !== 'app.asar/builtin/scene/package.json'
            || proof.profilePackage !== 'scene' || proof.profileKey !== 'current-scene' || actual.sha256 !== proof.sha256
            || JSON.stringify(actual.projectCurrentScene) !== JSON.stringify(proof.projectCurrentScene)) throw new Error('component_startup_scene_sdk_contract_mismatch');
        const scene = 'assets/components/cc.Label.scene';
        if (!existsSync(join(project, scene))) throw new Error('component_startup_scene_control_missing');
        const meta = this.record(JSON.parse(readFileSync(join(project, scene + '.meta'), 'utf8')));
        if (meta.importer !== 'scene' || typeof meta.uuid !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(meta.uuid))
            throw new Error('component_startup_scene_control_identity_invalid');
        const path = join(project, 'settings/v2/packages/scene.json');
        const present = existsSync(path); const settings = present ? this.record(JSON.parse(readFileSync(path, 'utf8'))) : { __version__: '1.0.0' };
        if (settings['current-scene'] !== undefined && settings['current-scene'] !== '') throw new Error('component_startup_scene_existing_value_refused');
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ ...settings, 'current-scene': meta.uuid }, null, 2) + '\n', { flag: present ? 'w' : 'wx' });
        writeFileSync(join(dirname(project), 'startup-scene-staging.json'), JSON.stringify({ creatorVersion: version, scene, uuid: meta.uuid,
            relativeProfile: 'settings/v2/packages/scene.json', publicPackage: 'scene', publicKey: 'current-scene',
            sdkContractSha256: actual.sha256, nativeAcceptance: false, scope: '输入暂存，必须原生Profile和实际启动场景读回验证' }, null, 2) + '\n', { flag: 'wx' });
    }

    /**
     * @description 只读取SDK归档内固定公开JSON，不载入或执行ccc模块。
     */
    private static contract(resources: string): unknown {
        const fd = openSync(join(resources, 'app.asar'), 'r');
        try {
            const first = this.bytes(fd, 8, 0); const length = first.readUInt32LE(4);
            if (first.readUInt32LE(0) !== 4 || length < 8 || length > 32 * 1024 * 1024) throw new Error('component_startup_scene_asar_header_invalid');
            const header = this.bytes(fd, length, 8); const jsonLength = header.readUInt32LE(4);
            if (jsonLength < 2 || jsonLength > header.length - 8) throw new Error('component_startup_scene_asar_json_invalid');
            let entry = this.record(JSON.parse(header.subarray(8, 8 + jsonLength).toString('utf8')));
            for (const part of ['builtin', 'scene', 'package.json']) entry = this.record(this.record(entry.files)[part]);
            if (entry.unpacked || entry.link || typeof entry.offset !== 'string' || !/^\d+$/u.test(entry.offset)
                || typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 2 || entry.size > 1024 * 1024)
                throw new Error('component_startup_scene_asar_entry_invalid');
            const offset = 8 + length + Number(entry.offset);
            if (!Number.isSafeInteger(offset) || offset < 8 + length || offset + entry.size > fstatSync(fd).size)
                throw new Error('component_startup_scene_asar_offset_invalid');
            const data = this.bytes(fd, entry.size, offset); const manifest = this.record(JSON.parse(data.toString('utf8')));
            const project = this.record(this.record(this.record(manifest.contributions).profile).project);
            return { sha256: createHash('sha256').update(data).digest('hex'), projectCurrentScene: project['current-scene'] };
        } finally { closeSync(fd); }
    }

    /**
     * @description 固定偏移读满有界归档片段，截断即拒绝，不读取外部链接。
     */
    private static bytes(fd: number, length: number, offset: number): Buffer {
        const bytes = Buffer.alloc(length); let read = 0;
        while (read < length) { const count = readSync(fd, bytes, read, length - read, offset + read);
            if (!count) throw new Error('component_startup_scene_asar_truncated'); read += count; }
        return bytes;
    }

    /**
     * @description 所有外部JSON均显式拒绝非记录值。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_startup_scene_record_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
