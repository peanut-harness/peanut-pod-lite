import type { IComponentNativeDeclaration } from './component-native-source-reader.mts';

/**
 * @description 组件夹具在添加被测组件之前必须完成的原生依赖装配。
 */
export interface IComponentDependencyPlan {
    /**
     * @description 目标组件。
     */
    readonly componentType: string;
    /**
     * @description 已核实的依赖添加顺序，目标组件总在最后。
     */
    readonly attachOrder: readonly string[];
    /**
     * @description 每条原生依赖边的声明来源。
     */
    readonly edges: readonly { readonly from: string; readonly to: string; readonly sourceReferences: readonly string[] }[];
    /**
     * @description 未解析或缺少声明时阻止执行，不猜测组件不存在。
     */
    readonly blockers: readonly string[];
    /**
     * @description 始终需要后续原生加载核对。
     */
    readonly nativeAcceptance: false;
}

/**
 * @description 按实际原生继承和 requireComponent 构造闭包；不允许用空组件代替依赖。
 */
export class ComponentDependencyPlanner {
    /**
     * @description 严格拓扑排序，缺失声明、动态依赖、同名分支或环均阻止添加。
     * @param componentType 被测策展组件名称。
     * @param declarations 精确版本的独立源码证明。
     * @returns 有序装配与全部阻塞；有阻塞时 attachOrder 为空。
     */
    public static create(componentType: string, declarations: readonly IComponentNativeDeclaration[],
        providers: Readonly<Record<string, string>> = {}): IComponentDependencyPlan {
        const byType = new Map(declarations.map((row) => [row.type, row]));
        if (byType.size !== declarations.length) throw new Error('component_native_declaration_duplicate');
        const done = new Set<string>();
        const active = new Set<string>();
        const order: string[] = [];
        const blockers = new Set<string>();
        const edges: { from: string; to: string; sourceReferences: string[] }[] = [];
        const visit = (type: string, depth: number): void => {
            if (depth > 64 || done.size > 256) throw new Error('component_dependency_budget_exceeded');
            if (active.has(type)) { blockers.add(`component_dependency_cycle:${type}`); return; }
            if (done.has(type)) return;
            const row = byType.get(type);
            if (!row) { blockers.add(`component_source_declaration_absent:${type}`); return; }
            if (row.classification !== 'source-declared-runtime-unverified' || row.sources.length === 0) {
                blockers.add(`component_source_proof_missing:${type}`);
            }
            if (row.sources.length > 1) blockers.add(`component_native_branch_requires_runtime:${type}`);
            for (const unresolved of row.unresolvedDependencies) {
                blockers.add(`component_dependency_unresolved:${type}:${unresolved.reference}:${unresolved.line}`);
            }
            active.add(type);
            for (const dependency of row.requiredComponents) {
                const proofs = row.dependencyProofs.filter((proof) => proof.componentType === dependency);
                if (proofs.length === 0) blockers.add(`component_dependency_proof_missing:${type}:${dependency}`);
                edges.push({ from: type, to: dependency, sourceReferences: [...new Set(proofs.map((proof) => `${proof.reference}:${proof.line}`))] });
                const provider = providers[dependency];
                if (provider !== undefined) {
                    const provided = byType.get(provider);
                    if (!provided || !provided.baseTypes.includes(dependency)) {
                        blockers.add(`component_dependency_provider_type_mismatch:${type}:${dependency}:${provider}`);
                    } else visit(provider, depth + 1);
                } else visit(dependency, depth + 1);
            }
            active.delete(type); done.add(type); order.push(type);
        };
        visit(componentType, 0);
        return { componentType, attachOrder: blockers.size ? [] : order, edges, blockers: [...blockers].sort(), nativeAcceptance: false };
    }
}
