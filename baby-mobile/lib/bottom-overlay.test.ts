import { describe, expect, it } from "vitest";
import { OVERLAY_GAP, isTabRoute, overlayBottom, reportTabScreenBottomInset } from "./bottom-overlay";

describe("bottom overlay placement", () => {
  it("treats only the tab group as showing the native tab bar", () => {
    expect(isTabRoute(["(tabs)", "journal"])).toBe(true);
    expect(isTabRoute(["record", "[id]"])).toBe(false);
    expect(isTabRoute([])).toBe(false);
  });

  it("floats toasts above the measured tab bar rather than a fixed JS tab bar height", () => {
    expect(overlayBottom({ inTabs: true, tabInset: 83, windowInset: 34, clearance: 88 })).toBe(83 + OVERLAY_GAP);
    expect(overlayBottom({ inTabs: true, tabInset: 118, windowInset: 34, clearance: 88 })).toBe(118 + OVERLAY_GAP);
  });

  it("keeps the old clearance outside tabs and before any tab inset is known", () => {
    expect(overlayBottom({ inTabs: false, tabInset: 83, windowInset: 34, clearance: 88 })).toBe(122);
    expect(overlayBottom({ inTabs: true, tabInset: 0, windowInset: 34, clearance: 88 })).toBe(122);
  });

  it("ignores empty reports from tab screens that are off screen", () => {
    expect(() => reportTabScreenBottomInset(0)).not.toThrow();
    expect(() => reportTabScreenBottomInset(Number.NaN)).not.toThrow();
  });
});
