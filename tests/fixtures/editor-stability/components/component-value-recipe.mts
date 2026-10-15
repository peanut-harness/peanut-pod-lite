import type { ILumenPropertyFieldSpec } from '../../../../packages/engine/modules/lumen/source/schema/component-property-contracts.ts';
import type { IComponentNativeDeclaration } from './component-native-source-reader.mts';

/**
 * @description 真实源资产导入后才解析的资源绑定；不写入猜测的 AssetDB UUID。
 */
export interface IComponentResourceBinding {
    /**
     * @description 将被导入的真实夹具及所需类型。
     */
    readonly fixtureReference: string;
    /**
     * @description 所选根或子资源的原生注册类型。
     */
    readonly nativeType: string;
    /**
     * @description 实际输入文件闭包与原始摘要。
     */
    readonly sources: readonly { readonly path: string; readonly sha256: string }[];
    /**
     * @description 类型和子资源数据都必须读回的选择规则。
     */
    readonly selector: string;
}

/**
 * @description 公开字段输入配方；资源身份由后续原生导入解析，不是序列化通过证据。
 */
export interface IComponentValueRecipe {
    /**
     * @description 递归值或真实绑定种类。
     */
    readonly form: 'literal' | 'resource' | 'node-reference' | 'component-reference' | 'object' | 'list' | 'project-file-url';
    /**
     * @description 直接公开值或具体节点/组件路径。
     */
    readonly value?: unknown;
    /**
     * @description 真实输入闭包；只有原生导入后取得的 UUID 才能送入公共 API。
     */
    readonly resource?: IComponentResourceBinding;
    /**
     * @description 内嵌对象字段。
     */
    readonly properties?: Readonly<Record<string, IComponentValueRecipe>>;
    /**
     * @description 非空数组的实际条目。
     */
    readonly items?: readonly IComponentValueRecipe[];
    /**
     * @description 由已核实工程的实际预览服务生成 URL 的本地文件，禁止猜端口或外部网络地址。
     */
    readonly projectFile?: { readonly path: string; readonly sha256: string };
    /**
     * @description componentRef 的实际装配类型；公开值保持现有 API 接受的路径字符串。
     */
    readonly componentType?: string;
}

/**
 * @description 按现有公开字段规格构造有效输入与类型拒绝输入，引用均有真实装配来源。
 */
export class ComponentValueRecipeFactory {
    /**
     * @description 选择明确枚举值、有效非空列表和真实引用，未知引用类型不猜测。
     * @param field 实际策展目录展开字段。
     * @param owner 当前原生类型；嵌套字段递归切换到实际 embeddedType。
     * @param declarations 精确版本源码证明。
     * @param resources 已审计真实资源闭包，键为实际 nativeType。
     * @returns 原生身份解析后的公开输入配方。
     */
    public static create(field: ILumenPropertyFieldSpec, owner: string,
        declarations: readonly IComponentNativeDeclaration[], resources: Readonly<Record<string, IComponentResourceBinding>>,
        contextualValues: Readonly<Record<string, IComponentValueRecipe>> = {}): IComponentValueRecipe {
        const contextual = contextualValues[`${owner}.${field.apiName}`];
        if (contextual) return contextual;
        const literal = (value: unknown): IComponentValueRecipe => ({ form: 'literal', value });
        const list = (items: readonly IComponentValueRecipe[]): IComponentValueRecipe => ({ form: 'list', items });
        // 图片载体与Mask模式必须相容；避免把完整配方装配成Graphics与Sprite冲突的场景。
        if (owner === 'cc.Mask' && field.apiName === 'type') { return literal(3); }
        if (owner === 'cc.Mask' && field.apiName === 'segments') { return literal(32); }
        // SDK的custom=false会从plist覆盖粒子参数；独立字段测试必须使用自定义参数上下文。
        if (owner === 'cc.ParticleSystem2D' && field.apiName === 'custom') { return literal(true); }
        // SDK内置default排序层ID为0；通用数值1不是已登记的排序层。
        if (owner === 'cc.Sorting' && field.apiName === 'sortingLayer') { return literal(0); }
        const native = declarations.find((row) => row.type === owner);
        const properties = native?.properties.filter((property) => property.name === field.apiName || property.name === field.serializedName) ?? [];
        if (field.kind === 'boolean') return literal(false);
        if (field.kind === 'number') return literal(field.example ?? (/fontSize/iu.test(field.apiName) ? 24
            : /lineHeight/iu.test(field.apiName) ? 28 : field.apiName === 'lightmapSize' ? 128 : 1));
        if (field.kind === 'string') {
            if (['cc.VideoPlayer', 'cc.WebView', 'cc.TiledLayer', 'cc.TiledObjectGroup', 'sp.Skeleton', 'dragonBones.ArmatureDisplay'].includes(owner)) {
                throw new Error(`component_contextual_string_source_missing:${owner}.${field.apiName}`);
            }
            return literal(field.example ?? (/fontFamily/iu.test(field.apiName) ? 'Arial' : 'A'));
        }
        if (field.kind === 'enum') {
            const value = field.enumHints?.[0]?.value ?? properties.flatMap((property) => property.numericEnumValues)[0]
                ?? (field.nativeBooleanEnum ? 0 : undefined);
            if (typeof value !== 'number') throw new Error(`component_enum_value_source_missing:${owner}.${field.apiName}`);
            return literal(value);
        }
        if (field.kind === 'size') return literal(field.example ?? { width: 100, height: 80 });
        if (field.kind === 'vec2') return literal(field.example ?? { x: 0.5, y: 0.5 });
        if (field.kind === 'vec3') return literal(field.example ?? (field.apiName === 'secondaryAxis' ? { x: 0, y: 1, z: 0 }
            : /scale|linearFactor|angularFactor/iu.test(field.apiName) ? { x: 1, y: 1, z: 1 } : { x: 1, y: 0, z: 0 }));
        if (field.kind === 'color') return literal(field.example ?? { r: 128, g: 160, b: 192, a: 255 });
        if (field.kind === 'rect') return literal(field.example ?? { x: 0, y: 0, width: 1, height: 1 });
        if (field.kind === 'curveRange') return literal(field.example ?? { mode: 0, constant: 1 });
        if (field.kind === 'gradientRange') return literal(field.example ?? { mode: 0, color: { r: 128, g: 160, b: 192, a: 255 } });
        if (field.kind === 'uuid' || field.kind === 'uuidList') {
            const types = [...new Set(properties.flatMap((property) => property.registeredTypes))];
            const binding = Object.values(resources).find((resource) => types.includes(resource.nativeType)
                || declarations.find((row) => row.type === resource.nativeType)?.baseTypes.some((base) => types.includes(base)));
            if (!binding) throw new Error(`component_resource_type_or_fixture_missing:${owner}.${field.apiName}:${types.join(',')}`);
            const value: IComponentValueRecipe = { form: 'resource', resource: binding };
            return field.kind === 'uuidList' ? list([value]) : value;
        }
        if (field.kind === 'nodeRef' || field.kind === 'nodeRefList') {
            const value: IComponentValueRecipe = { form: 'node-reference',
                value: owner === 'cc.Widget' && field.apiName === 'target' ? '/Root/Canvas' : '/Root/References/Node' };
            return field.kind === 'nodeRefList' ? list([value]) : value;
        }
        if (field.kind === 'componentRef' || field.kind === 'componentRefList') {
            if (!field.refComponentType) throw new Error(`component_reference_type_missing:${owner}.${field.apiName}`);
            const value: IComponentValueRecipe = { form: 'component-reference',
                value: `/Root/References/${field.refComponentType.replace(/\./gu, '_')}`, componentType: field.refComponentType };
            return field.kind === 'componentRefList' ? list([value]) : value;
        }
        if (field.kind === 'vec2List') return list([literal({ x: -1, y: -1 }), literal({ x: 1, y: -1 }), literal({ x: 0, y: 1 })]);
        if (field.kind === 'vec3List') return list([literal({ x: -1, y: 0, z: 0 }), literal({ x: 1, y: 0, z: 0 }), literal({ x: 0, y: 1, z: 0 })]);
        if (field.kind === 'stringList') return list([literal('Task51')]);
        if (field.kind === 'numberList') return list([literal(1), literal(2)]);
        if (field.kind === 'eventHandlerList') return literal([{ target: '/Root/Controller', component: 'cc.Animation', handler: 'play', customEventData: 'Task51' }]);
        if (field.kind === 'objectPatch' || field.kind === 'objectList') {
            if (!field.embeddedType || !field.nestedFields?.length) throw new Error(`component_nested_value_schema_missing:${owner}.${field.apiName}`);
            const properties = Object.fromEntries(field.nestedFields.map((nested) => [nested.apiName,
                this.create(nested, field.embeddedType ?? '', declarations, resources, contextualValues)]));
            const value: IComponentValueRecipe = { form: 'object', properties };
            return field.kind === 'objectList' ? list([value]) : value;
        }
        throw new Error(`component_value_kind_unknown:${owner}.${field.apiName}:${field.kind}`);
    }

    /**
     * @description 所有字段都保留明确错误类型，不能将权限错误当字段边界拒绝。
     * @param field 当前字段。
     * @returns 不会混入有效资源身份的错误输入。
     */
    public static invalid(field: ILumenPropertyFieldSpec): unknown {
        return field.kind === 'string' ? 1 : ['number', 'boolean', 'enum', 'uuid', 'uuidList',
            'nodeRef', 'nodeRefList', 'componentRef', 'componentRefList'].includes(field.kind)
            ? { invalidType: true } : 'invalid-type';
    }
}
