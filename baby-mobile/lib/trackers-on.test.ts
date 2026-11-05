import { describe, expect, it } from "vitest";
import { trackerById, trackerOn, trackers, trackersFor } from "./trackers";

const on = (id: string, stage: "expecting" | "born", details?: Parameters<typeof trackerOn>[2]) => trackerOn(trackerById(id)!, stage, details);

describe("which trackers are on", () => {
  it("starts from the stage, as section 16 says", () => {
    expect(trackersFor("born").filter((tracker) => on(tracker.id, "born")).map((tracker) => tracker.id)).toEqual(["breast", "bottle", "diaper", "sleep"]);
    expect(trackersFor("expecting").filter((tracker) => on(tracker.id, "expecting")).map((tracker) => tracker.id)).toEqual(["kicks", "contractions", "feeling", "my_weight", "blood_pressure", "vitamins"]);
  });
  it("lets how she's feeding set breast and bottle, only once the baby's here", () => {
    expect([on("breast", "born", { feeding: "bottle" }), on("bottle", "born", { feeding: "bottle" })]).toEqual([false, true]);
    expect([on("breast", "born", { feeding: "nursing" }), on("bottle", "born", { feeding: "nursing" })]).toEqual([true, false]);
    expect([on("breast", "born", { feeding: "both" }), on("bottle", "born", { feeding: "both" })]).toEqual([true, true]);
    expect([on("breast", "born", { feeding: null }), on("bottle", "born", {})]).toEqual([true, true]);
    expect(on("breast", "expecting", { feeding: "nursing" })).toBe(false);
    expect(on("diaper", "born", { feeding: "bottle" })).toBe(true);
  });
  it("puts what she chose above every default", () => {
    expect(on("diaper", "born", { tracking: { diaper: false } })).toBe(false);
    expect(on("pumping", "born", { tracking: { pumping: true } })).toBe(true);
    expect(on("breast", "born", { feeding: "bottle", tracking: { breast: true } })).toBe(true);
    expect(on("kicks", "born", { tracking: { kicks: true } })).toBe(true);
  });
  it("ignores a key no tracker uses, and details that aren't there", () => {
    expect(on("diaper", "born", { tracking: { something_else: false } })).toBe(true);
    expect(on("diaper", "born", null)).toBe(true);
    expect(on("diaper", "born", { tracking: null })).toBe(true);
  });
  it("gives every tracker a key the API accepts", () => {
    for (const tracker of trackers) expect(tracker.id).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });
});
