import { CoverageManifestGenerator } from '../../../../../tools/editor-stability/coverage-manifest-generator.mts';
import type { ICoverageInventory } from '../../../../../tools/editor-stability/coverage-contracts.mts';
import { ResourceStabilityRunner } from './resource-stability-runner.mts';
import type { IResourceCampaignExpectation, IResourceCampaignPlan, IResourceCasePlan,
    IResourceSessionIdentity } from './resource-stability-contracts.mts';

/**
 * @description 从本轮独立重算的完整 inventory 绑定资源 scope；不读取旧 manifest 的 passed。
 */
export class ResourceStabilityPlanFactory {
    /**
     * @description 自动展开全部资源及其递归字段动作，新增条目不能靠缩小手写 ID 列表隐藏。
     * importer 注册对照、组件与代码仍留在全局分母，不由本资源计划宣称通过。
     * @param inventory 由当前产品树和精确版本安装包独立读取的完整分母。
     * @param session 从已登记工程和当前候选独立核实的身份。
     * @param namespace 当前运行独占的 assets 子目录。
     * @param fixtureSources 已审查完整源闭包的实际摘要。
     * @param cases 为每个当前资源行装配的命令、引用与原生语义读回。
     * @returns 成对的完整计划与可信预期；缺行直接拒绝。
     */
    public static create(inventory: ICoverageInventory, session: IResourceSessionIdentity,
        namespace: string, fixtureSources: Readonly<Record<string, string>>,
        cases: readonly IResourceCasePlan[]): { readonly plan: IResourceCampaignPlan; readonly expected: IResourceCampaignExpectation } {
        const manifest = CoverageManifestGenerator.createDraft(inventory);
        if ((inventory.creatorVersion !== '3.8.3' && inventory.creatorVersion !== '3.8.7')
            || inventory.creatorVersion !== session.creatorVersion) {
            throw new Error('resource_campaign_inventory_session_mismatch');
        }
        const targetIds = new Set(inventory.targets.filter((target) => target.domain === 'asset'
            || target.domain === 'field' && target.id.startsWith('field:asset:')).map((target) => target.id));
        const requiredCaseIds = manifest.cases.filter((row) => targetIds.has(row.targetId)).map((row) => row.id);
        const expected: IResourceCampaignExpectation = { ...session, namespace, fixtureSources,
            inventorySha256: manifest.inventorySha256, requiredCaseIds };
        const plan: IResourceCampaignPlan = { creatorVersion: inventory.creatorVersion,
            namespace, inventorySha256: manifest.inventorySha256, cases };
        ResourceStabilityRunner.validatePlan(plan, expected);
        return { plan, expected };
    }
}
