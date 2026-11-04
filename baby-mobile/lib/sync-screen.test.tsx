import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type DeviceState, type Mutation } from "./models";

const scope = vi.hoisted(() => ({ account: null as any, alerts: [] as { buttons: { text: string; onPress?: () => void }[] }[], toast: vi.fn() }));
vi.mock("react-native", () => ({ Alert: { alert: (_t: string, _m: string, buttons: { text: string; onPress?: () => void }[]) => scope.alerts.push({ buttons }) } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/lib/api", () => import("./api"));
vi.mock("@/lib/care-format", () => import("./care-format"));
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
