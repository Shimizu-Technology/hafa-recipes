import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Spaces between two JSX tags on one line become a text node, which React
// Native rejects outside <Text> ("Text strings must be rendered within a <Text>").
// Arrow functions (`=>`) are not tag ends.
const root = new URL("..", import.meta.url).pathname;
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

it("keeps stray whitespace out from between same-line JSX tags", () => {
  const offenders = ["app", "components"].flatMap((dir) => sources(join(root, dir))).flatMap((file) =>
    readFileSync(file, "utf8").split("\n").flatMap((line, index) =>
      /(<>|<\/?[A-Za-z][^<>]*[^=<>]>)[ \t]+<[A-Za-z]/.test(line) ? [`${file.slice(root.length)}:${index + 1}`] : []));
  expect(offenders).toEqual([]);
});
