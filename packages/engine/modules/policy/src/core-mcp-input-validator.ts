import type { ICoreMcpJsonSchema } from './core-cocos-mcp-read-tool-schema-catalog.js';

/**
 * @description 在执行前验证 Lite 目录声明的 JSON Schema 子集，限制输入深度和节点数。
 */
export class CoreMcpInputValidator {
    /**
     * @description 检查输入是否满足对象、必填字段、数组元素及枚举约束。
     * @param schema 已随产品发布的输入契约。
     * @param input 未受信的调用参数。
     * @returns 输入是否符合契约。
     */
    public validate(schema: ICoreMcpJsonSchema, input: unknown): boolean {
        return this.matches(schema, input, 0, { remaining: 100_000 });
    }

    /**
     * @description 递归检查输入，并以每次调用独立的预算拒绝过深或过大的对象。
     * @param schema 当前节点契约。
     * @param value 当前节点值。
     * @param depth 已遍历深度。
     * @param budget 本次调用剩余节点预算。
     * @returns 当前节点是否有效。
     */
    private matches(schema: ICoreMcpJsonSchema, value: unknown, depth: number, budget: { remaining: number }): boolean {
        if (depth > 64 || --budget.remaining < 0) {
            return false;
        }
        switch (schema.type) {
            case 'object':
                if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                    return false;
                }
                if (schema.required?.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
                    return false;
                }
                return Object.entries(value).every(([key, child]) => {
                    const property = schema.properties != null && Object.prototype.hasOwnProperty.call(schema.properties, key) ? schema.properties[key] : null;
                    return property == null
                        ? schema.additionalProperties !== false && this.isJson(child, depth + 1, budget)
                        : this.matches(property, child, depth + 1, budget);
                });
            case 'array':
                return (
                    Array.isArray(value) &&
                    value.every((child) =>
                        schema.items == null ? this.isJson(child, depth + 1, budget) : this.matches(schema.items, child, depth + 1, budget),
                    )
                );
            case 'string':
                return typeof value === 'string' && (schema.enum == null || schema.enum.includes(value));
            case 'number':
                return typeof value === 'number' && Number.isFinite(value);
            case 'integer':
                return typeof value === 'number' && Number.isSafeInteger(value);
            case 'boolean':
                return typeof value === 'boolean';
            default:
                return false;
        }
    }

    /**
     * @description 对允许附加字段的开放对象仍限制为有限深度的 JSON 数据。
     * @param value 未声明字段的值。
     * @param depth 当前深度。
     * @param budget 剩余节点预算。
     * @returns 是否为可接受的 JSON 数据。
     */
    private isJson(value: unknown, depth: number, budget: { remaining: number }): boolean {
        if (depth > 64 || --budget.remaining < 0) {
            return false;
        }
        if (value === null || typeof value === 'string' || typeof value === 'boolean') {
            return true;
        }
        if (typeof value === 'number') {
            return Number.isFinite(value);
        }
        if (typeof value !== 'object') {
            return false;
        }
        return Object.values(value).every((child) => this.isJson(child, depth + 1, budget));
    }
}
