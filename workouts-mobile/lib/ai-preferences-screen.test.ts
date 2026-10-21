import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ params: {} as Record<string, string>, accepted: false, current: true,
  save: vi.fn(), dismissTo: vi.fn() }));
vi.mock("expo-router", () => ({ router: { dismissTo: f.dismissTo }, useLocalSearchParams: () => f.params }));
vi.mock("@/components/ui", () => Object.fromEntries(["Screen", "Copy", "Notice", "Button"].map(name => [name, name])));
vi.mock("@/lib/native-share-session", () => ({ updateNativeSharingConsent: (change: () => Promise<unknown>) => change() }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({ owner: "owner", enrollment: { enrolled: true, generation: 3 },
  isCurrentAccount: () => f.current, api: { aiConsent: async () => ({ accepted: f.accepted }), setAiConsent: f.save } }) }));
import AiPreferences from "../app/ai-preferences";
let view: ReactTestRenderer, cache: QueryClient;
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
const button = () => view.root.findByType("Button" as never);
async function mount() {
  await act(async () => { view = create(createElement(QueryClientProvider, { client: cache }, createElement(AiPreferences))); });
  await settle();
}
async function save() { await act(async () => { button().props.onPress(); }); await settle(); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.params = { return_to: "coach", workout_id: "legs", revision: "2" }; f.accepted = false; f.current = true;
  f.save.mockReset().mockImplementation(async (accepted: boolean) => { f.accepted = accepted; return { accepted }; });
  f.dismissTo.mockReset(); cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => { if (view) await act(async () => view.unmount()); cache.clear(); });
it("keeps the disclosure and returns to Coach with refreshed consent and the original focus", async () => {
  await mount();
  expect(view.root.findAllByType("Copy" as never)[0].children.join("")).toContain("AI extraction and coaching use OpenAI.");
  expect(button().props.title).toBe("Accept AI sharing disclosure"); await save();
  expect(f.save).toHaveBeenCalledWith(true, 3);
  expect(cache.getQueryData(["owner", "ai-consent", 3])).toEqual({ accepted: true });
  expect(f.dismissTo).toHaveBeenCalledWith({ pathname: "/coach", params: { workout_id: "legs", revision: "2" } });
});
it("stays on preferences and allows retry when saving consent fails", async () => {
  f.save.mockRejectedValueOnce(Error("Could not save")); await mount(); await save();
  expect(f.dismissTo).not.toHaveBeenCalled();
  expect(view.root.findAllByType("Notice" as never).some(node => node.children.join("") === "Could not save")).toBe(true);
  await save(); expect(f.dismissTo).toHaveBeenCalledTimes(1);
  expect(view.root.findAllByType("Notice" as never).some(node => node.children.join("") === "Could not save")).toBe(false);
});
it.each(["settings", "revoke", "account changed", "not accepted"])("does not return for %s", async scenario => {
  if (scenario === "settings") f.params = {};
  if (scenario === "revoke") f.accepted = true;
  if (scenario === "account changed") f.current = false;
  if (scenario === "not accepted") f.save.mockResolvedValue({ accepted: false });
  await mount(); await save(); expect(f.dismissTo).not.toHaveBeenCalled();
});
