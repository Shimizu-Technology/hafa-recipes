import { fileURLToPath } from "node:url";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { isClassPage } from "./class-import";
const script = readFileSync(new URL("../modules/hafa-workouts-share/ios/ClassPagePreprocessor.js", import.meta.url), "utf8");
it("reads only bounded visible WodUp text and strips query/fragment without network or metadata", () => {
  let result: any;
  const context = { URL, document: { URL: "https://wodup.com/gym?token=private#results", body: { innerText: "A. AMRAP\n".repeat(5000) } } };
  const sandbox: any = { ...context };
  runInNewContext(script, sandbox);
  sandbox.ExtensionPreprocessingJS.run({ completionFunction: (value: any) => { result = value; } });
  expect(result).toEqual({ baseURI: "https://wodup.com/gym", meta: "", contentType: "", classText: context.document.body.innerText.slice(0, 30000) });
  context.document.body.innerText = readFileSync(new URL("../../api/tests/fixtures/wodup_nov17_page.txt", import.meta.url), "utf8");
  sandbox.ExtensionPreprocessingJS.run({ completionFunction: (value: any) => { result = value; } });
  expect(result.classText).toBe(context.document.body.innerText.slice(0, 30000));
  context.document.URL = "https://youtube.com/watch?v=video";
  sandbox.ExtensionPreprocessingJS.run({ completionFunction: (value: any) => { result = value; } });
  expect(result.classText).toBeUndefined();
  expect(result.baseURI).toBe("https://youtube.com/watch?v=video");
});
it("classifies hosts rather than captions, credentials or lookalike domains", () => {
  expect(isClassPage("https://wodup.com/a?q=1")).toBe(true);
  expect(isClassPage("https://gym.wodup.com/a")).toBe(true);
  for (const source of [null, "invalid", "https://wodup.com.evil.test", "https://notwodup.com", "https://user:secret@wodup.com", "file:///wodup.com"]) expect(isClassPage(source)).toBe(false);
});
it.skipIf(process.platform !== "darwin")("executes Swift Safari bridge sanitation, bounds and empty-page rejection", () => {
  const directory = mkdtempSync(join(tmpdir(), "hafa-class-bridge-"));
  try {
    const main = join(directory, "main.swift"), binary = join(directory, "test");
    writeFileSync(main, `import Foundation
let source = URL(string: "https://wodup.com/gym?token=private#leaderboard")!
let page = WorkoutsShareStore.classPage(source, text: String(repeating: "A", count: 40000))!
assert(page.url == "https://wodup.com/gym")
assert(page.text.count == 30000)
assert(WorkoutsShareStore.classPage(source, text: "  \\n ") == nil)
assert(WorkoutsShareStore.classPage(source, text: nil) == nil)
assert(WorkoutsShareStore.classPage(URL(string: "https://user:secret@wodup.com")!, text: "A") == nil)
assert(WorkoutsShareStore.classPage(URL(string: "https://wodup.com.evil.test")!, text: "A") == nil)
print("Safari bridge passed")`);
    execFileSync("xcrun", ["swiftc", fileURLToPath(new URL("../modules/hafa-workouts-share/ios/HafaWorkoutsShareStore.swift", import.meta.url)), main, "-o", binary], { timeout: 60000 });
    expect(execFileSync(binary, { encoding: "utf8" })).toContain("Safari bridge passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
it("removes WodUp URL-only text and tracking parameters without changing instructions or other source links", async () => {
  const { classText, classDate } = await import("./class-import");
  expect(classText("https://wodup.com/gym?token=secret#scores")).toBe("");
  expect(classText("A. 10 squats\nhttps://wodup.com/gym?token=secret#scores\nhttps://youtube.com/watch?v=abc")).toBe("A. 10 squats\n\nhttps://youtube.com/watch?v=abc");
  expect(classDate("Pacific/Guam")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it("reports Safari PDF content type even for a local document and keeps HTML preprocessing", () => {
  const sandbox: any = { URL, document: { URL: "file:///private/class.pdf", contentType: "application/pdf", body: { innerText: "" } } };
  runInNewContext(script, sandbox);
  let result: any;
  sandbox.ExtensionPreprocessingJS.run({ completionFunction: (value: any) => { result = value; } });
  expect(result.contentType).toBe("application/pdf"); expect(result.classText).toBeUndefined();
  sandbox.document = { URL: "https://wodup.com/class", contentType: "text/html", body: { innerText: "A. 8 squats" } };
  sandbox.ExtensionPreprocessingJS.run({ completionFunction: (value: any) => { result = value; } });
  expect(result).toMatchObject({ contentType: "text/html", classText: "A. 8 squats" });
});
