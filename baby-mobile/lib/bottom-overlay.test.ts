import { describe, expect, it } from "vitest";
import { OVERLAY_GAP, isTabRoute, overlayBottom, getDockedFooterHeight, reportDockedFooter, reportTabBarHeight } from "./bottom-overlay";

describe("bottom overlay placement", () => {
  it("treats only the tab group as showing the tab bar", () => {
    expect(isTabRoute(["(tabs)", "journal"])).toBe(true);
    expect(isTabRoute(["record", "[id]"])).toBe(false);
    expect(isTabRoute([])).toBe(false);
  });

  it("floats toasts above the measured tab bar, home indicator included", () => {
    expect(overlayBottom({ inTabs: true, tabInset: 83, windowInset: 34, clearance: 88 })).toBe(83 + OVERLAY_GAP);
    expect(overlayBottom({ inTabs: true, tabInset: 118, windowInset: 34, clearance: 88 })).toBe(118 + OVERLAY_GAP);
  });

  it("keeps the old clearance outside tabs and before any tab inset is known", () => {
    expect(overlayBottom({ inTabs: false, tabInset: 83, windowInset: 34, clearance: 88 })).toBe(122);
    expect(overlayBottom({ inTabs: true, tabInset: 0, windowInset: 34, clearance: 88 })).toBe(122);
  });

  it("lifts toasts above a docked footer such as the Ask composer", () => {
    // Tab screens end at the top of the bar, so the composer stacks on it.
    expect(overlayBottom({ inTabs: true, tabInset: 90, windowInset: 34, clearance: 88, footer: 66 })).toBe(90 + 66 + OVERLAY_GAP);
    expect(overlayBottom({ inTabs: false, tabInset: 0, windowInset: 34, clearance: 88, footer: 60 })).toBe(122);
  });

  it("uses the tallest focused docked footer and forgets footers that leave", () => {
    const ask = {}, edit = {};
    reportDockedFooter(ask, 142);
    reportDockedFooter(edit, 90);
    expect(getDockedFooterHeight()).toBe(142);
    reportDockedFooter(ask, 0);
    expect(getDockedFooterHeight()).toBe(90);
    reportDockedFooter(edit, 0);
    expect(getDockedFooterHeight()).toBe(0);
  });

  it("ignores empty tab bar height reports", () => {
    expect(() => reportTabBarHeight(0)).not.toThrow();
    expect(() => reportTabBarHeight(Number.NaN)).not.toThrow();
  });
});
