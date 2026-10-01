import ts from 'typescript';

/**
 * @description 安全求值注册名中的字符串字面量、只读常量和模板组合；其它表达式保持未解析。
 */
export class CreatorRegistrationNameReader {
    /**
     * @description 只读 AST 常量分析，不调用代码或求值动态表达式。
     * @param expression 注册名称表达式。
     * @param checker 当前源码的符号检查器。
     * @returns 可证明的名称；不能静态确认时为空。
     */
    public static read(expression: ts.Expression, checker: ts.TypeChecker): string | null {
        const value = this.resolve(expression, checker, new Set(), 0, { remaining: 4096 });
        return value != null && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value) ? value : null;
    }

    /**
     * @description 递归分析有限静态字符串结构，拒绝调用、可变声明、循环与超深链。
     * @param expression 当前表达式。
     * @param checker 符号检查器。
     * @param seen 当前链访问的常量符号。
     * @param depth 当前递归深度。
     * @param budget 剩余静态表达式节点数。
     * @returns 静态字符串；未解析时为空。
     */
    private static resolve(expression: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Symbol>, depth: number,
        budget: { remaining: number }): string | null {
        if (depth > 32 || --budget.remaining < 0) {
            return null;
        }
        if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
            return expression.text;
        }
        if (ts.isParenthesizedExpression(expression)) {
            return this.resolve(expression.expression, checker, seen, depth + 1, budget);
        }
        if (ts.isTemplateExpression(expression)) {
            let value = expression.head.text;
            for (const span of expression.templateSpans) {
                const part = this.resolve(span.expression, checker, seen, depth + 1, budget);
                if (part == null || value.length + part.length + span.literal.text.length > 256) {
                    return null;
                }
                value += part + span.literal.text;
            }
            return value;
        }
        if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            const left = this.resolve(expression.left, checker, seen, depth + 1, budget);
            if (left == null) {
                return null;
            }
            const right = this.resolve(expression.right, checker, seen, depth + 1, budget);
            return left != null && right != null && left.length + right.length <= 256 ? left + right : null;
        }
        if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
            let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
            if (symbol != null && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
                symbol = checker.getAliasedSymbol(symbol);
            }
            if (symbol == null || seen.has(symbol)) {
                return null;
            }
            const declaration = symbol.valueDeclaration;
            if (declaration == null || !ts.isVariableDeclaration(declaration) || declaration.initializer == null
                || !ts.isVariableDeclarationList(declaration.parent) || (declaration.parent.flags & ts.NodeFlags.Const) === 0) {
                return null;
            }
            const chain = new Set(seen);
            chain.add(symbol);
            return this.resolve(declaration.initializer, checker, chain, depth + 1, budget);
        }
        return null;
    }
}
