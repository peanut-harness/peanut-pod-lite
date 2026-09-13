import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

import { SilentAssetCreateFolder } from '@peanut/pod-engine/assets';
import { LumenDeepClone } from './deep-clone';
import { LumenPrefabIdTools } from './prefab-id-tools';
import { LumenSceneScaffold } from './scene-scaffold';
import type { PrefabEntry } from '../types';

/**
 * @description 为 Prefab 文档提供空白脚手架、磁盘读取、模板克隆与原样复制。
 */
export class LumenPrefabDocumentSource {
    /**
     * @description 创建仅含根节点与 UITransform 的空壳 Prefab 条目。
     * @param rootName 根节点名
     * @returns Prefab 条目
     */
    public createEmptyPrefabEntries(rootName: string): PrefabEntry[] {
        const fileId = (): string => LumenPrefabIdTools.createFileId();
        return [
            {
                __type__: 'cc.Prefab',
                _name: rootName,
                _objFlags: 0,
                _native: '',
                data: { __id__: 1 },
                optimizationPolicy: 0,
                asyncLoadAssets: false,
                persistent: false,
            },
            {
                __type__: 'cc.Node',
                _name: rootName,
                _objFlags: 0,
                _parent: null,
                _children: [],
                _active: true,
                _components: [{ __id__: 2 }],
                _prefab: { __id__: 4 },
                _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
                _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
                _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
                _layer: 33554432,
                _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
                _id: '',
            },
            {
                __type__: 'cc.UITransform',
                _name: '',
                _objFlags: 0,
                node: { __id__: 1 },
                _enabled: true,
                __prefab: { __id__: 3 },
                _contentSize: { __type__: 'cc.Size', width: 100, height: 100 },
                _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
                _id: '',
            },
            { __type__: 'cc.CompPrefabInfo', fileId: fileId() },
            {
                __type__: 'cc.PrefabInfo',
                root: { __id__: 1 },
                asset: { __id__: 0 },
                fileId: fileId(),
            },
        ];
    }

    /**
     * @description 创建仅含场景根与默认 SceneGlobals 的空场景条目。
     * @param rootName 根节点名
     * @returns Scene 条目
     */
    public createEmptySceneEntries(rootName: string): PrefabEntry[] {
        return LumenSceneScaffold.createEntries(rootName);
    }

    /**
     * @description 从磁盘模板克隆并刷新本地文件标识。
     * @param templateAbsolutePath 模板绝对路径
     * @param rootName 可选根节点名
     * @returns 独立的 Prefab 条目
     */
    public cloneTemplateEntries(templateAbsolutePath: string, rootName?: string): PrefabEntry[] {
        const entries = this.readTemplateEntries(templateAbsolutePath).map((entry) => LumenDeepClone.clone(entry));
        LumenPrefabIdTools.regenerateLocalFileIds(entries);
        if (rootName != null && rootName.length > 0) {
            const prefabHeader = entries[0];
            const rootNode = entries[1];
            if (prefabHeader != null) {
                prefabHeader._name = rootName;
            }
            if (rootNode != null && rootNode.__type__ === 'cc.Node') {
                rootNode._name = rootName;
            }
        }
        return entries;
    }

    /**
     * @description 从绝对路径读取未经 ID 重写的模板条目。
     * @param templateAbsolutePath 模板绝对路径
     * @returns 已校验模板条目
     */
    public readTemplateEntries(templateAbsolutePath: string): PrefabEntry[] {
        return this._readPrefabEntries(this._parseJsonFile(templateAbsolutePath), templateAbsolutePath);
    }

    /**
     * @description 从项目磁盘读取 Prefab 或 Scene 条目。
     * @param projectRoot 项目根
     * @param relativePath 相对路径
     * @returns 已校验条目
     */
    public readEntries(projectRoot: string, relativePath: string): PrefabEntry[] {
        const absolutePath = join(projectRoot, relativePath);
        if (!existsSync(absolutePath)) {
            throw new Error(`lumen_prefab_missing:${relativePath}`);
        }
        return this._readPrefabEntries(this._parseJsonFile(absolutePath), relativePath);
    }

    /**
     * @description 将模板文件原样复制到目标路径。
     * @param projectRoot 项目根
     * @param relativePath 目标相对路径
     * @param templateAbsolutePath 模板绝对路径
     */
    public copyTemplateFile(projectRoot: string, relativePath: string, templateAbsolutePath: string): void {
        const absolutePath = join(projectRoot, relativePath);
        this._ensureParentDirectory(projectRoot, relativePath, absolutePath);
        copyFileSync(templateAbsolutePath, absolutePath);
    }

    /**
     * @description 为目标资源建立受 AssetDB 管理的父目录。
     * @param projectRoot 项目根
     * @param relativePath 目标相对路径
     * @param absolutePath 目标绝对路径
     */
    private _ensureParentDirectory(projectRoot: string, relativePath: string, absolutePath: string): void {
        const parentRelative = dirname(relativePath).replace(/\\/g, '/');
        if (parentRelative.length > 0 && parentRelative !== '.' && parentRelative.startsWith('assets')) {
            new SilentAssetCreateFolder().ensureDirectoryMetas({
                projectRoot,
                relativePath: parentRelative,
            });
            return;
        }
        mkdirSync(dirname(absolutePath), { recursive: true });
    }

    /**
     * @description 读取并解析 Prefab JSON，语法错误映射为稳定错误码。
     * @param absolutePath 文件绝对路径
     * @returns 解析后的 JSON 值
     */
    private _parseJsonFile(absolutePath: string): unknown {
        try {
            return JSON.parse(readFileSync(absolutePath, 'utf8'));
        } catch {
            throw new Error(`lumen_prefab_json_corrupt:${absolutePath}`);
        }
    }

    /**
     * @description 将未受信 JSON 校验为 Prefab 条目数组。
     * @param value JSON 解析结果
     * @param label 错误信息中的路径
     * @returns 条目数组
     */
    private _readPrefabEntries(value: unknown, label: string): PrefabEntry[] {
        if (!Array.isArray(value) || value.length < 2) {
            throw new Error(`lumen_prefab_json_corrupt:${label}`);
        }
        const entries: PrefabEntry[] = [];
        for (const item of value) {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_prefab_json_corrupt:${label}`);
            }
            const record: PrefabEntry = {};
            for (const [key, fieldValue] of Object.entries(item)) {
                record[key] = fieldValue;
            }
            entries.push(record);
        }
        const header = entries[0];
        if (header == null || (header.__type__ !== 'cc.Prefab' && header.__type__ !== 'cc.SceneAsset')) {
            throw new Error(`lumen_prefab_json_corrupt:${label}`);
        }
        return entries;
    }
}
