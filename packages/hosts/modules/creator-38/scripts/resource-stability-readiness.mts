import type { IResourceCampaignExpectation, IResourceCampaignPlan } from './resource-stability-contracts.mts';
import { ResourceStabilityRunner } from './resource-stability-runner.mts';

/**
 * @description 本次实时目录、状态和精确附件的未受信回读；不含审批凭据。
 */
export interface IResourceReadinessInput {
    readonly catalog: unknown;
    readonly status: unknown;
    readonly attachment: unknown;
}

/**
 * @description 每行包含具体 capability 缺口；ready 仅表示准入，不能证明原生操作通过。
 */
export interface IResourceReadinessResult {
    readonly ready: boolean;
    readonly nativeVerified: false;
    readonly allEnabled: false;
    readonly issues: readonly string[];
    readonly cases: readonly { readonly caseId: string; readonly ready: boolean; readonly issues: readonly string[] }[];
}

/**
 * @description 写前对照完整 manifest 的准入检查；没有 capability、身份或附件时一律停止。
 */
export class ResourceStabilityReadiness {
    /**
     * @description 不改目录或授权，也不启动 Creator；调用方须在每次执行前重新读取 live 输入。
     * @param plan 完整用例计划。
     * @param expected 从 inventory 与登记独立核对的预期。
     * @param live 当前 authenticated Hub 原始回读。
     * @returns 各 case 的精确缺口和全局准入结果。
     */
    public static check(plan: IResourceCampaignPlan, expected: IResourceCampaignExpectation,
        live: IResourceReadinessInput): IResourceReadinessResult {
        ResourceStabilityRunner.validatePlan(plan, expected);
        const issues: string[] = [];
        const catalog = this.record(live.catalog);
        const definitions = new Map<string, boolean>();
        if (!catalog || !Number.isSafeInteger(catalog.revision) || !Array.isArray(catalog.capabilities)) {
            issues.push('resource_readiness_catalog_invalid');
        } else {
            for (const value of catalog.capabilities) {
                const item = this.record(value);
                if (!item || typeof item.name !== 'string' || typeof item.readOnly !== 'boolean'
                    || definitions.has(item.name)) {
                    issues.push('resource_readiness_catalog_invalid');
                } else definitions.set(item.name, item.readOnly);
            }
        }
        const status = this.record(live.status);
        if (!status || !Array.isArray(status.writeEnabledPluginIds) || status.writeEnabledPluginIds.length !== 0) {
            issues.push('resource_readiness_all_or_unknown_exposure');
        }
        const attachment = this.record(live.attachment);
        const attached = new Set<string>();
        if (!attachment || attachment.owner !== expected.owner || attachment.projectPath !== expected.projectPath
            || !Array.isArray(attachment.capabilities) || attachment.capabilities.some((name) => typeof name !== 'string')
            || new Set(attachment.capabilities).size !== attachment.capabilities.length
            || !Array.isArray(attachment.resourceRoots) || attachment.resourceRoots.length !== 1
            || attachment.resourceRoots[0] !== plan.namespace) {
            issues.push('resource_readiness_attachment_identity_or_scope_invalid');
        } else for (const name of attachment.capabilities) attached.add(String(name));
        const cases = plan.cases.map((row) => {
            const rowIssues = [...issues];
            for (const command of [...row.setup, row.command, ...row.afterCommands ?? []]) {
                const readOnly = definitions.get(command.name);
                if (readOnly === undefined) rowIssues.push(`capability_missing:${command.name}`);
                else if (readOnly === command.write) rowIssues.push(`capability_access_mismatch:${command.name}`);
                if (command.write && !attached.has(command.name)) rowIssues.push(`capability_not_attached:${command.name}`);
            }
            const unique = [...new Set(rowIssues)];
            return { caseId: row.caseId, ready: unique.length === 0, issues: unique };
        });
        return { ready: issues.length === 0 && cases.every((row) => row.ready), nativeVerified: false,
            allEnabled: false, issues: [...new Set(issues)], cases };
    }

    /**
     * @description 只缩窄普通对象，不信任传输返回的通过标志。
     */
    private static record(value: unknown): Record<string, unknown> | null {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value)) : null;
    }
}
