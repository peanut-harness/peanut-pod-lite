/**
 * @description 覆盖分母的来源摘要，引用均为规范化相对标识，不保存本机安装路径或原始源码。
 */
export interface ICoverageSource {
    /**
     * @description 来源的相对标识。
     */
    readonly id: string;
    /**
     * @description 来源内容或规范目录的 SHA-256。
     */
    readonly sha256: string;
    /**
     * @description 声明、模块布局与运行时观察的证据强度。
     */
    readonly kind: 'product_catalog' | 'source_declaration' | 'module_layout' | 'runtime_catalog';
    /**
     * @description 原生来源的精确版本；跨版本共享的产品目录为空。
     */
    readonly creatorVersion: string | null;
}

/**
 * @description 必须保留在当前版本分母中的目标；未核实的原生能力不得自动转成不适用。
 */
export interface ICoverageTarget {
    /**
     * @description 版本内唯一目标标识。
     */
    readonly id: string;
    /**
     * @description 目标所属资源、importer 对照、组件、字段、代码或公开操作域。
     */
    readonly domain: 'asset' | 'importer' | 'component' | 'field' | 'code' | 'operation';
    /**
     * @description 资源种类、组件类型、字段选择器或稳定操作标识。
     */
    readonly subject: string;
    /**
     * @description 必须逐项验收的操作。
     */
    readonly actions: readonly string[];
    /**
     * @description 字段数据种类；非字段目标为空。
     */
    readonly fieldKind: string | null;
    /**
     * @description 当前版本原生可用性；源码存在本身只能产生 unverified。
     */
    readonly availability: 'unverified' | 'supported' | 'unsupported';
    /**
     * @description 将可用性绑定到当前版本运行时目录的来源标识；未核实时为空。
     */
    readonly availabilitySourceId: string | null;
}

/**
 * @description 不同源码分支声明的同名注册类；保留全部来源，待运行时确认实际启用分支。
 */
export interface ICoverageRegistrationAlternative {
    /**
     * @description 同名注册声明的名称。
     */
    readonly name: string;
    /**
     * @description 相对于当前 cocos 源码根目录的全部声明路径。
     */
    readonly paths: readonly string[];
}

/**
 * @description 无法安全静态求值的注册名称声明，保留定位供运行时对照，不执行表达式。
 */
export interface ICoverageUnresolvedRegistration {
    /**
     * @description 相对于当前 cocos 源码根目录的声明文件。
     */
    readonly sourcePath: string;
    /**
     * @description 装饰器在源码中的一基行号。
     */
    readonly line: number;
    /**
     * @description 声明的类名；匿名类明确为空。
     */
    readonly className: string;
    /**
     * @description 是否已从类型继承链确认属于 Component 声明。
     */
    readonly componentDeclaration: boolean;
}

/**
 * @description 独立于用例结果的权威分母快照；验收时必须从当前产品和原生证据重新取得。
 */
export interface ICoverageInventory {
    /**
     * @description 当前精确 Creator 版本。
     */
    readonly creatorVersion: string;
    /**
     * @description 产品、引擎声明与原生目录的绑定摘要。
     */
    readonly sources: readonly ICoverageSource[];
    /**
     * @description 当前安装包可见的 importer 模块布局；不等同于运行时注册。
     */
    readonly nativeImporterModules: readonly string[];
    /**
     * @description 原生源码内的注册类声明；包含非组件类，不能直接作为可挂载组件数。
     */
    readonly nativeRegisteredClasses: readonly string[];
    /**
     * @description 同名声明的原生源码分支，不能被集合去重隐去。
     */
    readonly nativeRegistrationAlternatives: readonly ICoverageRegistrationAlternative[];
    /**
     * @description 名称无法静态解析的注册声明，仍需逐项运行时对照。
     */
    readonly nativeUnresolvedRegistrations: readonly ICoverageUnresolvedRegistration[];
    /**
     * @description 已沿继承链确认的原生组件声明。
     */
    readonly nativeComponentDeclarations: readonly string[];
    /**
     * @description 源码声明的抽象组件基类；保留分母，待运行时按版本确认适用性。
     */
    readonly nativeAbstractComponentDeclarations: readonly string[];
    /**
     * @description 在当前源码声明中未找到的策展组件，仍保留在目标分母中。
     */
    readonly curatedComponentsWithoutDeclaration: readonly string[];
    /**
     * @description 全部目标及其必须执行的动作。
     */
    readonly targets: readonly ICoverageTarget[];
}

/**
 * @description 一项用例需要的夹具描述，实际存在性、摘要和有效性由独立解析器复核。
 */
export interface ICoverageFixture {
    /**
     * @description 仓库内规范相对引用。
     */
    readonly reference: string;
    /**
     * @description 完整夹具内容摘要。
     */
    readonly sha256: string;
}

/**
 * @description 用例的结果引用，原始正文不进入共享清单。
 */
export interface ICoverageResultReference {
    /**
     * @description 版本内证据的规范相对引用。
     */
    readonly reference: string;
    /**
     * @description 原始证据文件的摘要。
     */
    readonly sha256: string;
}

/**
 * @description 唯一用例记录；初次生成时显式 pending，不借默认值宣称覆盖通过。
 */
export interface ICoverageCase {
    /**
     * @description 绑定版本、目标及动作的稳定用例标识。
     */
    readonly id: string;
    /**
     * @description 被测试目标的标识。
     */
    readonly targetId: string;
    /**
     * @description 被测试动作。
     */
    readonly action: string;
    /**
     * @description 实际夹具；未建立时为空。
     */
    readonly fixture: ICoverageFixture | null;
    /**
     * @description 夹具的完整依赖引用。
     */
    readonly dependencies: readonly ICoverageFixture[];
    /**
     * @description 验收语义读回规则；未定义时为空。
     */
    readonly readback: string | null;
    /**
     * @description 当前用例状态；跳过和未执行均不能计为通过。
     */
    readonly status: 'pending' | 'passed' | 'failed' | 'skipped' | 'not_applicable';
    /**
     * @description 当前版本真实结果引用；未执行时为空。
     */
    readonly result: ICoverageResultReference | null;
}

/**
 * @description 与权威分母摘要绑定的版本化覆盖清单。
 */
export interface ICoverageManifest {
    /**
     * @description 清单协议版本。
     */
    readonly schemaVersion: 1;
    /**
     * @description 精确 Creator 版本。
     */
    readonly creatorVersion: string;
    /**
     * @description 完整权威 inventory 的规范摘要。
     */
    readonly inventorySha256: string;
    /**
     * @description 每个目标和动作对应的唯一用例。
     */
    readonly cases: readonly ICoverageCase[];
}

/**
 * @description 独立结果解析器回读的原生验收记录，不能直接信任清单中的 passed 字段。
 */
export interface ICoverageResolvedResult {
    /**
     * @description 原始结果文件摘要。
     */
    readonly sha256: string;
    /**
     * @description 原生结果的精确版本。
     */
    readonly creatorVersion: string;
    /**
     * @description 实际执行的稳定用例标识。
     */
    readonly caseId: string;
    /**
     * @description 原始结果的通过或经证据确认的不适用状态。
     */
    readonly outcome: 'passed' | 'not_applicable';
    /**
     * @description 完整语义和身份读回是否通过。
     */
    readonly readbackVerified: boolean;
    /**
     * @description 实际验收的语义读回规则，必须与清单声明一致。
     */
    readonly readback: string | null;
    /**
     * @description 真实 Creator 加载或运行检查是否完成。
     */
    readonly nativeVerified: boolean;
    /**
     * @description 原始日志阶段与延迟观察是否验收通过。
     */
    readonly rawLogsVerified: boolean;
    /**
     * @description 该用例的新警告数量。
     */
    readonly warnings: number;
    /**
     * @description 该用例的新错误数量。
     */
    readonly errors: number;
}

/**
 * @description 保留完整分母的验收摘要；问题正文最多保留一百项，问题总数不截断。
 */
export interface ICoverageValidation {
    /**
     * @description 所有必需用例均有可核验结果且没有缺口。
     */
    readonly ok: boolean;
    /**
     * @description 不因跳过、不适用或缺夹具而减少的完整用例分母。
     */
    readonly requiredCases: number;
    /**
     * @description 真正通过的用例数量。
     */
    readonly passed: number;
    /**
     * @description 有当前版本运行时证据的不适用用例数量。
     */
    readonly notApplicable: number;
    /**
     * @description 全部问题数量。
     */
    readonly issueCount: number;
    /**
     * @description 有界的稳定问题标识。
     */
    readonly issues: readonly string[];
}

/**
 * @description 解析器确认的夹具结果；只有真实存在、完整摘要和语义有效三项均满足才有效。
 */
export interface ICoverageResolvedFixture {
    /**
     * @description 实际夹具内容摘要。
     */
    readonly sha256: string;
    /**
     * @description 夹具及其格式是否已验收有效。
     */
    readonly valid: boolean;
    /**
     * @description 夹具解析器确认的完整依赖闭包，清单不得省略或替换依赖。
     */
    readonly dependencies: readonly ICoverageFixture[];
}

/**
 * @description 验收读取端口；调用方负责从原始文件及已验证 native evidence 解析，不能从 manifest 复制状态。
 */
export interface ICoverageEvidenceReader {
    /**
     * @description 独立查找真实夹具。
     * @param reference 清单中的相对夹具引用。
     * @returns 回读结果；不存在时为空。
     */
    fixture(reference: string): ICoverageResolvedFixture | null;
    /**
     * @description 独立查找真实原生结果。
     * @param reference 清单中的相对结果引用。
     * @returns 已复核结果；不存在时为空。
     */
    result(reference: string): ICoverageResolvedResult | null;
}
