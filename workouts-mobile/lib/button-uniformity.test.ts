import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/** Every `<Button …/>` tag in the app, with its source location. */
function buttonTags() {
  const tags: Array<{ where: string; tag: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== "design" && name !== "node_modules") walk(path); continue; }
      if (!path.endsWith(".tsx")) continue;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/<Button\b/g)) {
        let depth = 0, end = match.index! + match[0].length;
        for (; end < source.length; end++) {
          const ch = source[end];
          if (ch === "{") depth++; else if (ch === "}") depth--;
          else if (depth === 0 && source.startsWith("/>", end)) break;
        }
        tags.push({ where: `${path}:${source.slice(0, match.index).split("\n").length}`, tag: source.slice(match.index, end) });
      }
    }
  };
  walk(join(__dirname, "..", "app"));
  walk(join(__dirname, "..", "components"));
  return tags;
}
it("finds the buttons it checks", () => { expect(buttonTags().length).toBeGreaterThan(300); });
it("never sets a button size: every button is one height", () => {
  expect(buttonTags().filter(({ tag }) => /\bsize=/.test(tag)).map(({ where }) => where)).toEqual([]);
});
/** True when the tag turns `inline` on: bare `inline`, `inline={true}`, or any expression other than `inline={false}`. */
const isInline = (tag: string) => /\binline\b(?!\s*=)/.test(tag) || /\binline\s*=\s*\{(?!\s*false\s*\})/.test(tag);
const isGhostLiteral = (tag: string) => /\bvariant\s*=\s*(?:"ghost"|\{\s*"ghost"\s*\})/.test(tag);
it("recognises every way of writing a filled inline button", () => {
  for (const tag of ['<Button title="Save" variant="secondary" inline', '<Button title="Save" variant="secondary" inline={true}', '<Button title="Save" inline={wide}',
    '<Button title="Save" variant={kind} inline']) expect(isInline(tag) && !isGhostLiteral(tag)).toBe(true);
  for (const tag of ['<Button title="Save" variant="secondary" inline={false}', '<Button title="Save" variant="secondary"']) expect(isInline(tag)).toBe(false);
  for (const tag of ['<Button title="Undo" variant="ghost" inline', '<Button title="Undo" variant="ghost" inline={true}']) expect(isInline(tag) && !isGhostLiteral(tag)).toBe(false);
});
it("sizes to its label only for a ghost text button, never a filled one", () => {
  expect(buttonTags().filter(({ tag }) => isInline(tag) && !isGhostLiteral(tag)).map(({ where }) => where)).toEqual([]);
});
