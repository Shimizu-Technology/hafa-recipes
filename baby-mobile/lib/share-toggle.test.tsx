import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ baby: null as any, alerts: [] as { message: string; buttons: { text: string; style?: string; onPress?: () => void }[] }[], toast: vi.fn() }));
vi.mock("react-native", () => ({ Alert: { alert: (_t: string, message: string, buttons: any[]) => f.alerts.push({ message, buttons }) } }));
vi.mock("@/lib/context", () => ({ useBaby: () => f.baby }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/components/ui", () => ({ Choice: "Choice", Copy: "Copy", Notice: "Notice", Section: "Section", useToast: () => f.toast }));
import { ShareToggle } from "../components/share-toggle";
import { emptyState, optimisticRecord, type BabyRecord } from "./models";

const row = (over: object = {}): BabyRecord => ({ ...optimisticRecord({ id: "a", kind: "source", title: "Tip", body: "", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data: {} }), revision: 2, space_id: "f", generation: 1, ...over });
function setup(role = "parent", outbox: object[] = []) {
  const moved = { ...row(), space_id: "p", revision: 3 };
  f.baby = { online: true, state: { ...emptyState(), outbox, bootstrap: { generation: 1, personal_space_id: "p", children: [], spaces: [{ id: "p", kind: "personal", role: "parent", generation: 1, access_version: 1 }, { id: "f", kind: "family", role, generation: 1, access_version: 1 }] } },
    api: { moveRecord: vi.fn(async () => moved) }, commit: vi.fn(async (change: (s: any) => any) => { f.baby.state = change(f.baby.state); }) };
  return f.baby;
}
let view: ReactTestRenderer | undefined;
const open = async (record: BabyRecord) => { await act(async () => { view = create(<ShareToggle record={record} />); }); };
const choice = (label: string) => view!.root.findAll((n) => String(n.type) === "Choice").find((n) => n.props.label === label);
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React); vi.spyOn(console, "error").mockImplementation(() => {}); f.alerts = []; });
afterEach(async () => { await act(async () => view?.unmount()); view = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("shows where a post lives, and warns about Ask before making it private", async () => {
  const b = setup(), shared = row();
  await open(shared);
  expect(choice("Shared with family")!.props.selected).toBe(true);
  await act(async () => choice("Just me")!.props.onPress());
  expect(f.alerts[0].message).toMatch(/Answers Ask already gave in other chats may still mention this/);
  expect(b.api.moveRecord).not.toHaveBeenCalled();
  await act(async () => { await f.alerts[0].buttons.find((x) => x.style !== "cancel")!.onPress!(); });
  expect(b.api.moveRecord).toHaveBeenCalledWith(shared, "p", { generation: 1, space_id: "f" });
  expect(b.state.records[0]).toMatchObject({ id: "a", space_id: "p" });
});
it("shares a private entry on one tap, with the fence of where it lives", async () => {
  const b = setup();
  const mine = row({ kind: "journal", space_id: "p" });
  await open(mine);
  expect(choice("Just me")!.props.selected).toBe(true);
  await act(async () => { await choice("Shared with family")!.props.onPress(); });
  expect(b.api.moveRecord).toHaveBeenCalledWith(mine, "f", { generation: 1, space_id: "p" });
});
it("isn't offered with no family, for a caregiver, or for what can't move", async () => {
  setup("caregiver");
  await open(row());
  expect(choice("Just me")).toBeUndefined();
  await act(async () => view!.unmount());
  setup();
  await open(row({ kind: "diaper" }));
  expect(choice("Just me")).toBeUndefined();
});
it("waits for a queued edit, rather than moving an older copy", async () => {
  const b = setup("parent", [{ id: "m", generation: 1, type: "save", record: { id: "a" }, files: [] }]);
  await open(row());
  await act(async () => choice("Just me")!.props.onPress());
  expect(f.alerts).toEqual([]);
  expect(b.api.moveRecord).not.toHaveBeenCalled();
  expect(JSON.stringify(view!.toJSON())).toMatch(/still syncing/);
});
it("tells the other parent it's the writer's to change, rather than offering what the API refuses", async () => {
  const b = setup();
  Object.assign(b, { owner: "me" });
  b.state.bootstrap.people = { kami: "Kami" };
  await open(row({ kind: "journal", created_by: "kami" }));
  expect(choice("Just me")).toBeUndefined();
  const said = view!.root.findAll((n) => String(n.type) === "Copy").map((n) => [n.props.children].flat().join("")).join(" ");
  expect(said).toBe("Shared with your family by Kami. Only they can change who sees it.");
});
it("still offers the writer both, and says who reads what's shared", async () => {
  const b = setup();
  Object.assign(b, { owner: "me" });
  await open(row({ kind: "journal", created_by: "me" }));
  expect(choice("Just me")).toBeDefined();
  expect(choice("Shared with family")!.props.detail).toBe("The parents in your family can read it.");
});
it("says a visit link comes off before it does, each way, and moves nothing until she agrees", async () => {
  const b = setup();
  await open(row({ kind: "journal", data: { event_id: "visit" } }));
  await act(async () => choice("Just me")!.props.onPress());
  expect(f.alerts[0].message).toMatch(/It comes off its visit, which stays shared/);
  await act(async () => view!.unmount());
  f.alerts = [];
  const mine = row({ kind: "journal", space_id: "p", data: { event_id: "visit" } });
  await open(mine);
  await act(async () => { await choice("Shared with family")!.props.onPress(); });
  expect(f.alerts[0].message).toBe("It comes off its visit, which is just for you.");
  expect(b.api.moveRecord).not.toHaveBeenCalled();
  await act(async () => { await f.alerts[0].buttons.find((x) => x.style !== "cancel")!.onPress!(); });
  expect(b.api.moveRecord).toHaveBeenCalledWith(mine, "f", { generation: 1, space_id: "p" });
});

it("explains that making a linked journal private removes its visit link", async () => {
  const b = setup(); b.owner = "writer";
  await open(row({ kind: "journal", created_by: "writer", data: { event_id: "visit" } }));
  await act(async () => choice("Just me")!.props.onPress());
  expect(f.alerts[0].message).toMatch(/comes off its visit|visit link will be removed/);
});
it("does not offer another parent controls over the writer's shared journal", async () => {
  const b = setup(); b.owner = "other";
  await open(row({ kind: "journal", created_by: "writer" }));
  expect(choice("Just me")).toBeUndefined();
});

it("warns before sharing removes the link to a personal visit", async () => {
  const b = setup(), mine = row({ kind: "journal", space_id: "p", data: { event_id: "personal-visit" } });
  await open(mine);
  await act(async () => choice("Shared with family")!.props.onPress());
  expect(b.api.moveRecord).not.toHaveBeenCalled(); expect(f.alerts[0].message).toContain("comes off its visit");
  await act(async () => { await f.alerts[0].buttons.find((b) => b.text === "Share")!.onPress!(); });
  expect(b.api.moveRecord).toHaveBeenCalled();
});
