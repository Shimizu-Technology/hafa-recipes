import { describe, expect, it } from "vitest";
import { pendingChanges } from "./models";

describe("pendingChanges", () => {
  it("uses the singular for one change", () => {
    expect(pendingChanges(1)).toBe("1 pending change");
    expect(pendingChanges(0)).toBe("0 pending changes");
    expect(pendingChanges(3)).toBe("3 pending changes");
  });
});
