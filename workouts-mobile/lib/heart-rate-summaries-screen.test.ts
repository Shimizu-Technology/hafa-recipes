import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ alert: vi.fn(), toast: vi.fn(), measure: vi.fn(), api: {
  heartRateSummaries: vi.fn(), setHeartRateSummaries: vi.fn(), deleteHeartRateSummaries: vi.fn() } }));
vi.mock("@/lib/readable-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./readable-layout")>();
  return { ...actual, footerLabelScale: (title: string, width: number, scale: number) => {
    fixture.measure(title, width, scale);
    return actual.footerLabelScale(title, width, scale);
  } };
});
vi.mock("react-native", () => ({ Alert: { alert: fixture.alert }, useWindowDimensions: () => ({ width: 390, fontScale: 3.1 }) }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({ api: fixture.api, owner: "owner", enrollment: { enrolled: true, generation: 1 } }) }));
vi.mock("@/components/ui", () => ({ Screen: "Screen", Copy: "Copy", Notice: "Notice", Button: "Button", useToast: () => fixture.toast }));
vi.mock("@/components/query-state", () => ({ QueryState: ({ children }: { children: unknown }) => children }));
import HeartRateSummaries from "../app/heart-rate-summaries";

let renderer: ReactTestRenderer | undefined;
async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client }, createElement(HeartRateSummaries))); });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const button = (title: string) => renderer!.root.findAll((n) => (n.type as unknown) === "Button" && n.props.title === title)[0];
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.values(fixture.api).forEach((f) => f.mockReset()); fixture.alert.mockReset(); fixture.toast.mockReset(); fixture.measure.mockReset(); });
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });

it("is off until turned on, then can be turned off and every saved summary deleted after a confirmation", async () => {
  fixture.api.heartRateSummaries.mockResolvedValue({ available: true, enabled: false });
  fixture.api.setHeartRateSummaries.mockResolvedValue({ available: true, enabled: true });
  fixture.api.deleteHeartRateSummaries.mockResolvedValue({ enabled: false, deleted_sessions: 3 });
  await render();
  expect(button("Turn off, keep saved summaries")).toBeUndefined();
  await act(async () => button("Turn on heart-rate summaries").props.onPress());
  expect(fixture.api.setHeartRateSummaries).toHaveBeenCalledWith(true);
  expect(fixture.toast).toHaveBeenCalledWith("Heart-rate summaries are on.");
  expect(button("Turn off, keep saved summaries")).toBeDefined();
  button("Turn off and delete saved heart-rate summaries").props.onPress();
  expect(fixture.api.deleteHeartRateSummaries).not.toHaveBeenCalled();
  const [title, , choices] = fixture.alert.mock.calls[0];
  expect(title).toBe("Turn off and delete saved heart-rate summaries?");
  await act(async () => { choices[1].onPress(); await Promise.resolve(); });
  expect(fixture.api.deleteHeartRateSummaries).toHaveBeenCalled();
  expect(fixture.toast).toHaveBeenLastCalledWith("Turned off. Deleted from 3 sessions.");
  expect(button("Turn on heart-rate summaries")).toBeDefined();
});
it("says when the server can't store summaries yet, and offers no switch on", async () => {
  fixture.api.heartRateSummaries.mockResolvedValue({ available: false, enabled: false });
  await render();
  expect(button("Turn on heart-rate summaries")).toBeUndefined();
  expect(renderer!.root.findAll((n) => (n.type as unknown) === "Notice").map((n) => n.props.children)).toContain("Heart-rate summaries aren’t available yet. Check back after the next update.");
});

it("uses delete-only wording while off and caps the XL label so summaries stays whole", async () => {
  fixture.api.heartRateSummaries.mockResolvedValue({ available: true, enabled: false });
  await render();
  const remove = button("Delete saved heart-rate summaries");
  expect(remove).toBeDefined();
  expect(remove.props.maxScale).toBeLessThan(3.1);
  const longest = Math.max(...remove.props.title.split(/\s+/).map((word: string) => word.length));
  expect(remove.props.maxScale * 17 * 0.6 * longest).toBeLessThanOrEqual(390 - 32 - 29 - 44);
  remove.props.onPress();
  expect(fixture.alert.mock.calls[0][0]).toBe("Delete saved heart-rate summaries?");
});

it.each([false, true])("fits the complete HR button title at XL when enabled=%s", async (enabled) => {
  fixture.api.heartRateSummaries.mockResolvedValue({ available: true, enabled });
  await render();
  const title = enabled ? "Turn off and delete saved heart-rate summaries" : "Delete saved heart-rate summaries";
  expect(fixture.measure).toHaveBeenCalledWith(title, 390 - 32 - 29, 3.1);
  expect(button(title).props.maxScale).toBeLessThan(3.1);
  if (enabled) expect(fixture.measure).toHaveBeenCalledWith("Turn off, keep saved summaries", 390 - 32, 3.1);
  else expect(fixture.measure).toHaveBeenCalledWith("Turn on heart-rate summaries", 390 - 32 - 29, 3.1);
});
