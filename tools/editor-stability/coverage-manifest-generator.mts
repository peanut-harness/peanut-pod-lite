import { createHash } from 'node:crypto';

import type { ICoverageInventory, ICoverageManifest } from './coverage-contracts.mjs';

/**
 * @description 从独立权威分母生成可重复的待验收清单；不自动建立夹具或声明运行时通过。
 */
export class CoverageManifestGenerator {
    /**
     * @description 为所有目标的全部动作生成唯一 pending 用例。
     * @param inventory 当前版本独立取得的权威分母。
     * @returns 绑定完整分母的覆盖草稿。
     */
    public static createDraft(inventory: ICoverageInventory): ICoverageManifest {
        this.assertInventory(inventory);
        return {
            schemaVersion: 1,
            creatorVersion: inventory.creatorVersion,
            inventorySha256: this.digest(inventory),
            cases: [...inventory.targets].sort((a, b) => this.compare(a.id, b.id)).flatMap((target) =>
                [...target.actions].sort(this.compare).map((action) => ({
                    id: this.caseId(inventory.creatorVersion, target.id, action),
                    targetId: target.id,
                    action,
                    fixture: null,
                    dependencies: [],
                    readback: null,
                    status: 'pending',
                    result: null,
                })),
            ),
        };
    }

    /**
     * @description 对有限纯 JSON 数据生成排序稳定的摘要，绑定新增条目和来源变化。
     * @param value 待绑定的数据。
     * @returns 小写 SHA-256。
     */
    public static digest(value: unknown): string {
        return createHash('sha256').update(this.canonical(value, 0, { remaining: 200_000 })).digest('hex');
    }

    /**
     * @description 构造不可跨版本复用的用例标识。
     * @param version 当前精确版本。
     * @param targetId 权威目标标识。
     * @param action 对应动作。
     * @returns 完整用例标识。
     */
    public static caseId(version: string, targetId: string, action: string): string {
        return `${version}|${targetId}|${action}`;
    }

    /**
     * @description 检查分母自身的重复项、版本来源和无依据的可用性声明。
     * @param inventory 独立目录快照。
     * @returns 无返回值；不合法时抛出稳定错误。
     */
    public static assertInventory(inventory: ICoverageInventory): void {
        if (!['3.8.3', '3.8.7'].includes(inventory.creatorVersion) || inventory.targets.length === 0) {
            throw new Error('coverage_inventory_version_or_targets_invalid');
        }
        const sources = new Map(inventory.sources.map((source) => [source.id, source]));
        if (sources.size !== inventory.sources.length || sources.size === 0) {
            throw new Error('coverage_inventory_source_duplicate_or_missing');
        }
        for (const source of sources.values()) {
            if (!/^[0-9a-f]{64}(?![\s\S])/u.test(source.sha256) || !this.relativeReference(source.id)) {
                throw new Error('coverage_inventory_source_invalid');
            }
            if (source.kind !== 'product_catalog' && source.creatorVersion !== inventory.creatorVersion) {
                throw new Error('coverage_inventory_source_version_mismatch');
            }
        }
        const ids = new Set<string>();
        for (const target of inventory.targets) {
            if (ids.has(target.id) || target.id.length === 0 || target.id.length > 400 || target.id.includes('|') || target.actions.length === 0
                || new Set(target.actions).size !== target.actions.length
                || target.actions.some((action) => action.length === 0 || action.length > 64 || action.includes('|'))) {
                throw new Error('coverage_inventory_target_or_action_invalid');
            }
            ids.add(target.id);
            if (target.availability !== 'unverified') {
                const source = target.availabilitySourceId == null ? null : sources.get(target.availabilitySourceId);
                if (source == null || source.kind !== 'runtime_catalog' || source.creatorVersion !== inventory.creatorVersion) {
                    throw new Error('coverage_inventory_availability_unsubstantiated');
                }
            }
        }
        for (const entries of [inventory.nativeImporterModules, inventory.nativeRegisteredClasses,
            inventory.nativeComponentDeclarations, inventory.nativeAbstractComponentDeclarations, inventory.curatedComponentsWithoutDeclaration]) {
            if (new Set(entries).size !== entries.length) {
                throw new Error('coverage_inventory_native_duplicate');
            }
        }
        if (inventory.nativeAbstractComponentDeclarations.some((name) => !inventory.nativeComponentDeclarations.includes(name))
            || inventory.nativeComponentDeclarations.some((name) => !inventory.nativeRegisteredClasses.includes(name))) {
            throw new Error('coverage_inventory_native_classification_invalid');
        }
        const alternatives = inventory.nativeRegistrationAlternatives;
        if (new Set(alternatives.map((entry) => entry.name)).size !== alternatives.length
            || alternatives.some((entry) => !inventory.nativeRegisteredClasses.includes(entry.name) || entry.paths.length < 2
                || new Set(entry.paths).size !== entry.paths.length || entry.paths.some((path) => !this.relativeReference(path)))) {
            throw new Error('coverage_inventory_registration_alternative_invalid');
        }
        const unresolved = inventory.nativeUnresolvedRegistrations;
        if (new Set(unresolved.map((entry) => `${entry.sourcePath}#${entry.line}`)).size !== unresolved.length
            || unresolved.some((entry) => !this.relativeReference(entry.sourcePath) || !Number.isSafeInteger(entry.line) || entry.line < 1)) {
            throw new Error('coverage_inventory_unresolved_registration_invalid');
        }
        if (inventory.nativeImporterModules.some((module) => !inventory.targets.some((target) => target.domain === 'importer'
            && target.subject === module && target.actions.includes('reconcile_runtime_registration')))
            || inventory.nativeComponentDeclarations.some((name) => !inventory.targets.some((target) => target.domain === 'component' && target.subject === name))
            || alternatives.some((entry) => !inventory.targets.some((target) => target.id === `registration:${entry.name}`
                && target.actions.includes('reconcile_registration_alternatives')))
            || unresolved.some((entry) => !inventory.targets.some((target) => target.id === `registration:unresolved:${entry.sourcePath}#${entry.line}`
                && target.actions.includes('reconcile_dynamic_registration')))) {
            throw new Error('coverage_inventory_native_reconciliation_missing');
        }
    }

    /**
     * @description 检查引用只使用非空规范相对路径，拒绝本机路径、协议和穿越。
     * @param value 不受信的引用。
     * @returns 是否可以作为可移植引用。
     */
    public static relativeReference(value: unknown): value is string {
        return typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f\u007f]/u.test(value)
            && !value.startsWith('/') && !value.includes('\\')
            && !value.includes(':') && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
    }

    /**
     * @description 采用固定码元顺序，避免设备区域设置改变清单。
     * @param left 左侧标识。
     * @param right 右侧标识。
     * @returns 排序结果。
     */
    private static compare(left: string, right: string): number {
        return left < right ? -1 : left > right ? 1 : 0;
    }

    /**
     * @description 递归编码纯 JSON 数据；拒绝非有限数值和非 JSON 类型。
     * @param value 当前节点。
     * @param depth 当前结构深度。
     * @param budget 剩余 JSON 节点数。
     * @returns 当前节点的规范 JSON。
     */
    private static canonical(value: unknown, depth: number, budget: { remaining: number }): string {
        if (depth > 64 || --budget.remaining < 0) {
            throw new Error('coverage_inventory_json_budget_exceeded');
        }
        if (value === null || typeof value === 'string' || typeof value === 'boolean') {
            return JSON.stringify(value);
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
            return `[${value.map((item: unknown) => this.canonical(item, depth + 1, budget)).join(',')}]`;
        }
        if (typeof value === 'object' && value != null) {
            if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
                throw new Error('coverage_inventory_not_json');
            }
            return `{${Object.entries(value).sort(([a], [b]) => this.compare(a, b))
                .map(([key, child]: [string, unknown]) => `${JSON.stringify(key)}:${this.canonical(child, depth + 1, budget)}`).join(',')}}`;
        }
        throw new Error('coverage_inventory_not_json');
    }
}
