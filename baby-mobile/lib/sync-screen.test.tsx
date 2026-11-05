import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type DeviceState, type Mutation } from "./models";

const scope = vi.hoisted(() => ({ account: null as any, alerts: [] as { message: string; buttons: { text: string; onPress?: () => void }[] }[], toast: vi.fn() }));
vi.mock("react-native", () => ({ Alert: { alert: (_t: string, message: string, buttons: { text: string; onPress?: () => void }[]) => scope.alerts.push({ message, buttons }) } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/lib/api", () => import("./api"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/files", () => ({ exportFile: vi.fn() }));
vi.mock("@/components/ui", () => ({ Button: "Button", Card: "Card", Copy: "Copy", Empty: "Empty", Notice: "Notice", Screen: "Screen", Section: "Section", useToast: () => scope.toast }));
import Sync from "../app/sync";
import { ApiError } from "./api";

let renderer: ReactTestRenderer | undefined;
const action = (over: object = {}): Mutation => ({ id: "end", generation: 1, type: "feed_action", record_id: "feed", action: { id: "end", action: "finish", at: "2026-11-05T02:00:00.000Z" }, error: "Needs review", ...over });
function setup(outbox: Mutation[]) {
  scope.account = { online: true, syncing: false, error: "", state: { ...emptyState(), outbox, bootstrap: { generation: 1, children: [] } } as unknown as DeviceState,
    discardQueued: vi.fn(async () => undefined), commit: vi.fn(), sync: vi.fn(),
    api: { record: vi.fn(async () => ({ id: "feed", data: { state: "finished" } }) as unknown as BabyRecord), bootstrap: vi.fn() } };
  return scope.account;
}
const discard = async () => {
  await act(async () => { renderer = create(<Sync />); });
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === "Discard this queued change")!.props.onPress());
  await act(async () => { await scope.alerts.at(-1)!.buttons.find((b) => b.text === "Discard change")!.onPress!(); });
};
const notices = () => renderer!.root.findAll((n) => String(n.type) === "Notice").map((n) => [n.props.children].flat().join(""));
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React); scope.alerts = []; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("reads the record before discarding a sent tap, so a finished feed can't reappear as running", async () => {
  const b = setup([action({ sent: true })]);
  await discard();
  expect(b.api.record).toHaveBeenCalledWith("feed");
  expect(b.discardQueued).toHaveBeenCalledWith("end", expect.objectContaining({ data: { state: "finished" } }));
});

it("does the same for a kick tap or contraction stop", async () => {
  const b = setup([{ id: "t", generation: 1, type: "session_action", record_id: "feed", action: { id: "t", action: "tap", at: "2026-11-05T02:00:00.000Z" }, error: "Needs review", sent: true }]);
  await discard();
  expect(b.api.record).toHaveBeenCalledWith("feed");
});

const save = (id: string, recordId = "feed", over: object = {}): Mutation => ({ id, generation: 1, type: "save", files: [], record: { id: recordId, kind: "feeding", title: id, body: "", child_id: null, occurred_at: "2026-11-05T02:00:00.000Z", data: {}, revision: 1 }, ...over });
const ask = async (title: string, at = 0) => {
  await act(async () => { renderer = create(<Sync />); });
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "Button" && n.props.title === title)[at].props.onPress());
  return scope.alerts.at(-1)!.message;
};

it("says nothing extra when the change is alone on its entry", async () => {
  setup([save("edit"), save("other", "elsewhere")]);
  expect(await ask("Discard this queued change")).toBe("This removes this unsynced change. You can export a text backup first.");
});

it("says how many later changes to that entry go with it, feed actions included", async () => {
  setup([save("first"), save("other", "elsewhere"), action({ id: "swap" }), save("note")]);
  expect(await ask("Discard this queued change")).toBe("This also removes 2 later changes to this entry. You can export a text backup first.");
});

it("counts only what's after the change she chose", async () => {
  setup([save("first"), save("second"), save("third")]);
  expect(await ask("Discard this queued change", 1)).toBe("This also removes 1 later change to this entry. You can export a text backup first.");
});

it("keeps the saved version with the same warning, once she has compared them", async () => {
  const b = setup([save("edit", "feed", { conflict: true, error: "Changed" }), save("note")]);
  await act(async () => { renderer = create(<Sync />); });
  await act(async () => { await renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === "Load saved version to compare")!.props.onPress(); });
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === "Keep the server version")!.props.onPress());
  expect(scope.alerts.at(-1)!.message).toBe("The reviewed server version will be kept. This removes the local change shown above. This also removes 1 later change to this entry.");
  await act(async () => { await scope.alerts.at(-1)!.buttons.find((x) => x.text === "Discard local change")!.onPress!(); });
  expect(b.discardQueued).toHaveBeenCalledWith("edit", expect.objectContaining({ id: "feed" }));
});

it("doesn't read anything to discard an ordinary unsent change, since nothing behind it survives", async () => {
  const b = setup([save("edit", "feed", { conflict: true, error: "Changed" })]);
  await discard();
  expect(b.api.record).not.toHaveBeenCalled();
  expect(b.discardQueued).toHaveBeenCalledWith("edit", undefined);
});

it("keeps a sent tap when the record can't be read, and says why", async () => {
  const b = setup([action({ sent: true })]);
  b.api.record = vi.fn(async () => { throw new ApiError("Offline", 0); });
  await discard();
  expect(b.discardQueued).not.toHaveBeenCalled();
  expect(notices().join()).toContain("Reconnect to check it");
});

it("forgets the row when the read says the record is gone", async () => {
  const b = setup([action({ sent: true })]);
  b.api.record = vi.fn(async () => { throw new ApiError("Gone", 404); });
  await discard();
  expect(b.discardQueued).toHaveBeenCalledWith("end", null);
});

it("needs no read for a tap that never left this phone, offline included", async () => {
  const b = setup([action()]);
  await discard();
  expect(b.api.record).not.toHaveBeenCalled();
  expect(b.discardQueued).toHaveBeenCalledWith("end", undefined);
});

it("asks the API about a sent birth date too, and names it", async () => {
  const child = { id: "baby", name: "Mia", revision: 4, birth_date: "2026-11-05" }, born: Mutation = { id: "b", generation: 1, type: "child_birth", child_id: "baby", birth_date: "2026-11-05", previous: null, sent: true, error: "Review" };
  const b = setup([born]);
  b.api.bootstrap = vi.fn(async () => ({ children: [child] }));
  await discard();
  expect(b.discardQueued).toHaveBeenCalledWith("b", undefined, child);
  expect(renderer!.root.findAll((n) => String(n.type) === "Copy").map((n) => [n.props.children].flat().join("")).join()).toContain("Birth date");
});

it("names a waiting switch, and asks the API about a sent one before showing the old copy", async () => {
  const child = { id: "baby", name: "Mia", revision: 4, birth_date: "2026-11-01" }, off: Mutation = { id: "t", generation: 1, type: "child_tracking", child_id: "baby", tracking: { diaper: false, expecting_breast: false }, previous: { diaper: null, expecting_breast: null }, sent: true };
  const b = setup([off]);
  b.api.bootstrap = vi.fn(async () => ({ children: [child] }));
  await discard();
  expect(b.discardQueued).toHaveBeenCalledWith("t", undefined, child);
  const words = renderer!.root.findAll((n) => String(n.type) === "Copy").map((n) => [n.props.children].flat().join("")).join();
  expect(words).toContain("What shows");
  expect(words).toContain("Diaper off, Breastfeed off.");
});

it("names a refused split in plain words, and says what discarding it takes along", async () => {
  const event = (id: string, title: string) => ({ id, kind: "event" as const, title, body: "", child_id: null, occurred_at: "2026-11-16T00:00:00.000Z", data: { timezone: "Pacific/Guam" } }),
    split: Mutation = { id: "next", generation: 1, type: "event_split", series: { ...event("class", "Class"), revision: 4 }, event: event("next", "New class"), from_start: "2026-11-16T00:00:00.000Z", files: [], conflict: true, error: "This event changed somewhere else" },
    b = setup([split, { id: "edit", generation: 1, type: "save", files: [], record: { ...event("next", "Newer class"), revision: 0 } }]);
  expect(await ask("Discard this queued change")).toContain("This also removes 1 later change");
  const words = renderer!.root.findAll((n) => String(n.type) === "Copy").map((n) => [n.props.children].flat().join(""));
  expect(words).toContain("New class");
  expect(words.join(" ")).toMatch(/Changes Class from November 16, 2026 on\. Discarding this keeps every date as it was\./);
  await act(async () => { await scope.alerts.at(-1)!.buttons.find((button) => button.text === "Discard change")!.onPress!(); });
  expect(b.discardQueued).toHaveBeenCalledWith("next", undefined);
});
