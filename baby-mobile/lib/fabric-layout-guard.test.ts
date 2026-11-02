import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

// LayoutAnimation schedules the next Fabric commit, which can unmount navigation
// views and crash. Inspect syntax rather than comments so the reason can be documented.
function forbiddenReferences(source: string, file: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && node.text === "LayoutAnimation") {
      hits.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return hits;
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ["node_modules", "dist", "coverage", "ios", "android"].includes(entry.name)
      || entry.name.startsWith(".") ? [] : files(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

it("rejects direct and aliased LayoutAnimation references, but not comments", () => {
  expect(forbiddenReferences('// LayoutAnimation is unsafe\nconst okay = 1;', "example.ts")).toEqual([]);
  expect(forbiddenReferences('import { LayoutAnimation as animation } from "react-native";', "example.ts")).toHaveLength(1);
  expect(forbiddenReferences('ReactNative["LayoutAnimation"].configureNext(config);', "example.ts")).toHaveLength(1);
});

it("keeps Baby application code free of LayoutAnimation", () => {
  const root = process.cwd();
  const matches = files(root)
    .flatMap(file => forbiddenReferences(readFileSync(file, "utf8"), relative(root, file)));
  expect(matches).toEqual([]);
});
