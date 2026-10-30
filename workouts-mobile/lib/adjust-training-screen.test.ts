import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Program, ScheduledSession } from "./models";
const f = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn(), readiness: vi.fn(), owner: "owner", generation: 1, map: new Map<string,string>(), writeError: false }));
vi.mock("expo-router", () => ({ router: { push() {} } }));
vi.mock("@/components/ui", () => ({ Button: "Button", Card: "Card", Choice: "Choice", Copy: "Copy", Field: "Field", Notice: "Notice", Sheet: "Sheet" }));
vi.mock("@/components/readiness-picker", () => ({ ReadinessPicker: "Readiness" }));
vi.mock("@/components/program-preview", () => ({ PrescriptionPreview: "Prescription" }));
vi.mock("@/lib/context", () => {
  const api = { profileSnapshot: async () => ({ profile: { adult_confirmed: true }, revision: 3 }), previewDay: f.preview, applyDay: f.apply, setReadiness: f.readiness };
  const storage = { isCurrent: () => true, getItem: async (key: string) => f.map.get(key) ?? null, setItem: async (key: string, value: string) => { if (f.writeError) throw Error("Disk unavailable"); f.map.set(key,value); }, removeItem: async (key: string) => { f.map.delete(key); } };
  return { useTraining: () => ({ api, storage, isCurrentAccount: () => true, owner: f.owner, enrollment: { generation: f.generation } }) };
});
import { AdjustTraining } from "../components/adjust-training";
const session = { id: "today", date: "2026-10-31", workout: { title: "Today", estimated_minutes: 40, blocks: [] } } as unknown as ScheduledSession;
const program = { id: "program", title: "Saved plan", revision: 2 } as Program;
let view: ReactTestRenderer | undefined, cache: QueryClient;
async function settle() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(done => setTimeout(done, 5)); }); }
async function mount(missed = false) { await act(async () => { view = create(createElement(QueryClientProvider, { client: cache }, createElement(AdjustTraining, { visible: true, onClose() {}, program, session: missed ? undefined : session }))); }); await settle(); }
const nodes = (type: string) => view!.root.findAll(n => String(n.type) === type);
const button = (title: string) => nodes("Button").find(n => n.props.title === title)!;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; f.map.clear(); f.writeError = false; f.owner = "owner"; f.generation = 1; f.preview.mockReset(); f.apply.mockReset(); f.readiness.mockReset();
  f.preview.mockResolvedValue({ id: "proposal", proposal: { status: "ready", state: "proposed", questions: [], session_ids: ["today"], before: { proposal: { sessions: [session] } }, program: { proposal: { sessions: [{ ...session, date: "2026-11-01", workout: { ...session.workout, estimated_minutes: 15 } }] } } } });
  f.apply.mockImplementation(async (_id, action) => ({ state: action === "accept" ? "accepted" : "undone" }));
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(async () => { await act(async () => view?.unmount()); view = undefined; cache.clear(); });
it("previews an exact today session, then applies and undoes only on explicit presses", async () => {
  await mount();
  await act(async () => nodes("Readiness")[0].props.onChange("ready"));
  await act(async () => button("Preview changes").props.onPress()); await settle();
  expect(f.preview).toHaveBeenCalledWith({ program_id: "program", program_revision: 2, profile_revision: 3, session_id: "today", minutes: 15 }, 1);
  expect(f.apply).not.toHaveBeenCalled();
  expect(nodes("Prescription")).toHaveLength(2);
  await act(async () => button("Apply").props.onPress()); await settle();
  await act(async () => button("Undo").props.onPress()); await settle();
  expect(f.apply.mock.calls).toEqual([["proposal", "accept", 1], ["proposal", "undo", 1]]);
});
it("offers easier minutes and keeps missed-session acceptance explicit", async () => {
  await mount();
  await act(async () => nodes("Readiness")[0].props.onChange("ready"));
  await act(async () => nodes("Choice").find(n => n.props.label === "Take it easier")!.props.onPress());
  await act(async () => button("Preview changes").props.onPress()); await settle();
  expect(f.preview.mock.calls[0][0].minutes).toBe(15);
  await act(async () => view!.unmount()); view = undefined; await mount(true);
  await act(async () => nodes("Readiness")[0].props.onChange("ready"));
  await act(async () => button("Preview changes").props.onPress()); await settle();
  expect(f.preview.mock.calls[1][0]).toEqual({ program_id: "program", program_revision: 2, profile_revision: 3 });
  expect(f.apply).not.toHaveBeenCalled();
});

it.each([false, true])("restores durable Undo after a fresh mount without previewing again (missed=%s)", async missed => {
 await mount(missed);
 await act(async () => nodes("Readiness")[0].props.onChange("ready"));
 await act(async () => button("Preview changes").props.onPress()); await settle();
 await act(async () => button("Apply").props.onPress()); await settle();
 await act(async () => view!.unmount()); view = undefined; cache.clear(); await mount(missed);
 expect(button("Undo")).toBeDefined(); expect(f.preview).toHaveBeenCalledTimes(1);
 await act(async () => button("Undo").props.onPress()); await settle();
 expect(f.apply.mock.calls).toEqual([["proposal", "accept", 1], ["proposal", "undo", 1]]);
 await act(async () => view!.unmount()); view = undefined; await mount(missed);
 expect(button("Undo")).toBeUndefined();
});
it("persists before Apply and reconciles the same proposal after an uncertain acknowledgement", async () => {
 await mount(); await act(async () => nodes("Readiness")[0].props.onChange("ready"));
 await act(async () => button("Preview changes").props.onPress()); await settle();
 f.apply.mockRejectedValueOnce(Error("Lost response"));
 await act(async () => button("Apply").props.onPress()); await settle();
 expect(JSON.stringify([...f.map.values()])).toContain("proposal");
 await act(async () => view!.unmount()); view = undefined; await mount();
 await act(async () => button("Check Apply").props.onPress()); await settle();
 expect(f.apply.mock.calls).toEqual([["proposal", "accept", 1], ["proposal", "accept", 1]]);
 expect(button("Undo")).toBeDefined();
});
it("does not Apply when the receipt cannot be persisted", async () => {
 await mount(); await act(async () => nodes("Readiness")[0].props.onChange("ready"));
 await act(async () => button("Preview changes").props.onPress()); await settle(); f.writeError = true;
 await act(async () => button("Apply").props.onPress()); await settle(); expect(f.apply).not.toHaveBeenCalled();
});
it.each(["owner", "generation"])("does not restore a receipt into another %s", async field => {
 await mount(); await act(async () => nodes("Readiness")[0].props.onChange("ready"));
 await act(async () => button("Preview changes").props.onPress()); await settle();
 await act(async () => button("Apply").props.onPress()); await settle();
 await act(async () => view!.unmount()); view = undefined;
 if (field === "owner") f.owner = "other"; else f.generation = 2;
 await mount(); expect(button("Undo")).toBeUndefined(); expect(button("Preview changes")).toBeDefined();
});

it("retains an uncertain Undo and explains a later revision conflict before dismissal", async () => {
 await mount(); await act(async () => nodes("Readiness")[0].props.onChange("ready"));
 await act(async () => button("Preview changes").props.onPress()); await settle();
 await act(async () => button("Apply").props.onPress()); await settle();
 f.apply.mockRejectedValueOnce(Error("Lost Undo acknowledgement"));
 await act(async () => button("Undo").props.onPress()); await settle();
 await act(async () => view!.unmount()); view = undefined; await mount();
 expect(button("Check Undo")).toBeDefined();
 f.apply.mockRejectedValueOnce(Object.assign(Error("Plan revision changed"), { status: 409 }));
 await act(async () => button("Check Undo").props.onPress()); await settle();
 expect(nodes("Notice").some(n => String(n.props.children).includes("can no longer"))).toBe(true);
 expect(button("Dismiss unavailable adjustment")).toBeDefined();
 expect(JSON.stringify([...f.map.values()])).toContain("proposal");
 await act(async () => button("Dismiss unavailable adjustment").props.onPress()); await settle();
 expect(button("Preview changes")).toBeDefined();
});
