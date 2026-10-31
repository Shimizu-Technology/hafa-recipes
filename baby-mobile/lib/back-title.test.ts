import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

function stackOptions(path: string) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const options: ts.ObjectLiteralExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "screenOptions" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isObjectLiteralExpression(node.initializer.expression)) options.push(node.initializer.expression);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return options.map(option => Object.fromEntries(option.properties.filter(ts.isPropertyAssignment).map(property => [property.name.getText(source), property.initializer.getText(source)])));
}
it.each(["../app/_layout.tsx", "../components/tab-stack.tsx"])("names native Back controls in %s", path => {
  expect(stackOptions(path)).toHaveLength(1);
  expect(stackOptions(path)[0].headerBackTitle).toBe('"Back"');
});
