import ts from "typescript";

/** A value read from the program, or why it could not be read. */
export type Evaluated = { ok: true; value: Literal } | { ok: false; line: number; text: string };

/** What a manual block may hold: the literals the compiler can read without running anything. */
export type Literal = string | number | boolean | readonly Literal[] | { readonly [key: string]: Literal } | SchemaRef;

/** An expression kept as the compiler sees it (an action's `input`), for its type rather than its value. */
export class SchemaRef {
  constructor(readonly node: ts.Expression) {}
}

/** The property whose expression is kept for its type: an action's `input` schema. */
const TYPED_KEYS = new Set(["input"]);

const refused = (node: ts.Node): Evaluated => ({
  ok: false,
  line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
  text: node.getText().slice(0, 80),
});

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isParenthesizedExpression(node) ||
  ts.isTypeAssertionExpression(node)
    ? unwrap(node.expression)
    : node;

/** The initializer of the `const` an identifier names, when it is one. */
function constInitializer(node: ts.Identifier, checker: ts.TypeChecker): ts.Expression | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.valueDeclaration;
  if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer) return undefined;
  const list = declaration.parent;
  return ts.isVariableDeclarationList(list) && list.flags & ts.NodeFlags.Const ? declaration.initializer : undefined;
}

/** A value whose type the compiler knows to be one literal (`CODE.tooLarge` of an `as const` object, a `const` string). */
function literalOfType(node: ts.Expression, checker: ts.TypeChecker): Literal | undefined {
  const type = checker.getTypeAtLocation(node);
  if (type.isStringLiteral() || type.isNumberLiteral()) return type.value;
  if (type.flags & ts.TypeFlags.BooleanLiteral) return checker.typeToString(type) === "true";
  return undefined;
}

function evaluateObject(node: ts.ObjectLiteralExpression, checker: ts.TypeChecker): Evaluated {
  const out: Record<string, Literal> = {};
  for (const property of node.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      const value = evaluate(property.name, checker);
      if (!value.ok) return value;
      out[property.name.text] = value.value;
      continue;
    }
    if (!ts.isPropertyAssignment(property)) return refused(property);
    const name = property.name;
    if (!(ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))) return refused(name);
    if (TYPED_KEYS.has(name.text)) {
      out[name.text] = new SchemaRef(property.initializer);
      continue;
    }
    const value = evaluate(property.initializer, checker);
    if (!value.ok) return value;
    out[name.text] = value.value;
  }
  return { ok: true, value: out };
}

function evaluateArray(node: ts.ArrayLiteralExpression, checker: ts.TypeChecker): Evaluated {
  const out: Literal[] = [];
  for (const element of node.elements) {
    if (ts.isSpreadElement(element)) return refused(element);
    const value = evaluate(element, checker);
    if (!value.ok) return value;
    out.push(value.value);
  }
  return { ok: true, value: out };
}

/**
 * Reads a manual block from the program without running it: literals, arrays, objects, `const` names and anything whose type is a
 * single literal. A call is read through only when it is the block's builder (`screen({ … })`, one argument). Anything else (a
 * template with a value, a spread, a function) is refused with its line, never guessed.
 */
export function evaluate(input: ts.Expression, checker: ts.TypeChecker): Evaluated {
  const node = unwrap(input);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { ok: true, value: node.text };
  if (ts.isNumericLiteral(node)) return { ok: true, value: Number(node.text) };
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (ts.isObjectLiteralExpression(node)) return evaluateObject(node, checker);
  if (ts.isArrayLiteralExpression(node)) return evaluateArray(node, checker);
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments.length === 1) {
    const [argument] = node.arguments;
    if (argument && node.expression.text === "screen") return evaluate(argument, checker);
  }
  if (ts.isIdentifier(node)) {
    const initializer = constInitializer(node, checker);
    if (initializer) return evaluate(initializer, checker);
  }
  const literal = literalOfType(node, checker);
  return literal === undefined ? refused(node) : { ok: true, value: literal };
}
