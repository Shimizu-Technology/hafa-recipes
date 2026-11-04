import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type Mutation } from "./models";
import { pendingRecords } from "./outbox";
import { kickDetail, openSession, ownSessions, sessionLimit, sessionSeconds } from "./kicks";

const scope = vi.hoisted(() => ({ account: null as any, toast: vi.fn(), open: vi.fn(async () => undefined), push: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", useWindowDimensions: () => ({ fontScale: 1 }), Linking: { openURL: scope.open },
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } }));
vi.mock("expo-router", () => ({ router: { push: scope.push }, useFocusEffect: () => undefined }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `id-${++id}` }; });
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/kicks", () => import("./kicks"));
vi.mock("@/lib/contractions", () => import("./contractions"));
vi.mock("@/lib/medical-wording", () => import("./medical-wording"));
vi.mock("@/lib/quick-care", () => import("./quick-care"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/today-care", () => ({ useTodayCare: () => ({ all: pendingRecords(scope.account.state), rows: [], loading: false, error: "", refresh: vi.fn() }) }));
const ui = vi.hoisted(() => ({ Button: "Button", Card: "Card", Copy: "Copy", Empty: "Empty", Grouped: "Grouped", Icon: "Icon", Notice: "Notice", PressTarget: "Pressable", Row: "Row", Screen: "Screen", Section: "Section",
  fonts: {}, radii: {}, tap: () => undefined, useColors: () => ({}), useToast: () => scope.toast }));
vi.mock("@/components/ui", () => ui);
vi.mock("../components/ui", () => ui);
vi.mock("@/components/care-glance", () => ({ useMinuteClock: () => new Date() }));
vi.mock("@/components/feed-timer", () => ({ useSecondClock: () => new Date() }));
vi.mock("@/components/medical-source", () => import("../components/medical-source"));
vi.mock("@/components/sync-status", () => ({ SyncStatus: "SyncStatus" }));
import Kicks from "../app/kicks";

const start = new Date("2026-11-05T02:00:00.000Z");
let renderer: ReactTestRenderer | undefined;
function setup() {
  const b = {
    get records() { return pendingRecords(b.state); },
    state: { ...emptyState(), bootstrap: { generation: 2, active: true, ai_available: false, children: [{ id: "baby", name: "Mia", revision: 1, due_date: "2026-12-10" }],
      profile: { display_name: "K", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState,
    commit: vi.fn(async (change: (state: DeviceState) => DeviceState) => { b.state = change(b.state); }),
    queue: vi.fn(async (m: Mutation) => { b.state = { ...b.state, outbox: [...b.state.outbox, m] }; }),
    sync: vi.fn(async () => undefined),
  };
  scope.account = b;
  return b;
}
const mount = () => act(async () => { renderer = create(<Kicks />); });
const refresh = () => act(async () => renderer!.update(<Kicks />));
const movement = async () => { await act(async () => { renderer!.root.findAll((n) => String(n.type) === "Pressable").find((n) => String(n.props.accessibilityLabel).startsWith("Movement"))!.props.onPress(); }); await refresh(); };
const button = (title: string) => renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === title);
const session = () => pendingRecords(scope.account.state).find((row: BabyRecord) => row.kind === "kick_session");
const words = () => renderer!.root.findAll((n) => ["Copy", "Text", "Notice", "Empty"].includes(String(n.type))).map((n) => [n.props.children].flat().join("") + (n.props.body ?? "")).join(" | ");

beforeEach(() => {
  vi.useFakeTimers({ now: start });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  scope.toast.mockClear(); scope.open.mockClear();
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("starts a session on the first tap and counts each one after, all saved", async () => {
  setup();
  await mount();
  await movement();
  expect(session()).toMatchObject({ kind: "kick_session", child_id: "baby", title: "Kick count", occurred_at: start.toISOString(), data: { count: 1 } });
  await movement(); await movement();
  expect(session()?.data.count).toBe(3);
  expect(pendingRecords(scope.account.state).filter((row: BabyRecord) => row.kind === "kick_session")).toHaveLength(1);
});

it("counts two taps in the same moment, from one render", async () => {
  setup();
  await mount();
  await movement();
  const press = renderer!.root.findAll((n) => String(n.type) === "Pressable").find((n) => String(n.props.accessibilityLabel).startsWith("Movement"))!.props.onPress;
  await act(async () => { press(); press(); });
  expect(session()?.data.count).toBe(3);
});

it("makes one session of two taps before the first has saved", async () => {
  setup();
  await mount();
  const press = renderer!.root.findAll((n) => String(n.type) === "Pressable").find((n) => String(n.props.accessibilityLabel).startsWith("Movement"))!.props.onPress;
  await act(async () => { press(); press(); });
  expect(pendingRecords(scope.account.state).filter((row: BabyRecord) => row.kind === "kick_session")).toHaveLength(1);
});

it("takes one back, and the session with its only movement", async () => {
  setup();
  await mount();
  await movement(); await movement();
  await act(async () => { button("Take one back")!.props.onPress(); }); await refresh();
  expect(session()?.data.count).toBe(1);
  await act(async () => { button("Take one back")!.props.onPress(); }); await refresh();
  expect(session()).toBeUndefined();
  expect(button("Finish")).toBeUndefined();
});

it("finishes with the time, and the next tap starts a new session in the history", async () => {
  setup();
  await mount();
  await movement();
  await act(async () => { vi.advanceTimersByTime(600_000); });
  await act(async () => { button("Finish")!.props.onPress(); }); await refresh();
  expect(session()?.data.end_at).toBe(new Date(start.getTime() + 600_000).toISOString());
  await movement();
  expect(ownSessions(pendingRecords(scope.account.state), "baby").map((row) => row.data.count)).toEqual([1, 1]);
  const rows = renderer!.root.findAll((n) => String(n.type) === "Row").map((n) => n.props.detail);
  expect(rows).toEqual(["1 movement so far", "1 movement in 10 min"]);
});

it("has no target and no result, at any count", async () => {
  setup();
  await mount();
  for (let i = 0; i < 11; i++) await movement();
  const all = words();
  expect(all).not.toMatch(/\b10 (kicks|movements)|target|goal|reached|well done|good|2 hours|healthy|too few/i);
});

it("shows CDC's words unchanged, with who said them and a link, and none of ours", async () => {
  setup();
  await mount();
  const all = words();
  expect(all).toContain("Seek medical care immediately if you experience any signs or symptoms that are listed below.");
  expect(all).toContain("Baby's movement stopping or slowing during pregnancy");
  expect(all).toContain("You feel that your baby has stopped moving or your baby is moving less than before. There is no specific number of movements that is considered normal. A change in your baby's movement is what is important.");
  expect(all).toContain("CDC, Hear Her: Urgent Maternal Warning Signs");
  // E1 and the end of E3 are our own sentences, awaiting review.
  expect(all).not.toMatch(/don.t wait|keeps a record you can share|isn.t a test/i);
  await act(async () => { renderer!.root.findAll((n) => String(n.type) === "Pressable").find((n) => String(n.props.accessibilityLabel).startsWith("Source: CDC"))!.props.onPress(); });
  expect(scope.open).toHaveBeenCalledWith("https://www.cdc.gov/hearher/maternal-warning-signs/index.html");
});

describe("sessions", () => {
  const row = (id: string, at: string, data: BabyRecord["data"], child = "baby") => optimisticRecord({ id, kind: "kick_session", title: "Kick count", body: "", child_id: child, occurred_at: at, data });
  it("is open only while the newest has no end, and not forever", () => {
    expect(openSession([row("a", start.toISOString(), { count: 2 })], "baby", start)?.id).toBe("a");
    expect(openSession([row("a", start.toISOString(), { count: 2, end_at: start.toISOString() })], "baby", start)).toBeUndefined();
    expect(openSession([row("a", start.toISOString(), { count: 2 })], "baby", new Date(start.getTime() + sessionLimit))).toBeUndefined();
    expect(openSession([row("a", start.toISOString(), { count: 2 }, "other")], "baby", start)).toBeUndefined();
  });
  it("says count and time, and one nobody finished says so", () => {
    const finished = row("a", start.toISOString(), { count: 12, end_at: new Date(start.getTime() + 1_080_000).toISOString() });
    expect(kickDetail(finished)).toBe("12 movements in 18 min");
    expect(sessionSeconds(finished)).toBe(1080);
    expect(kickDetail(row("b", start.toISOString(), { count: 1 }), new Date(start.getTime() + 60_000))).toBe("1 movement so far");
    expect(kickDetail(row("b", start.toISOString(), { count: 1 }), new Date(start.getTime() + sessionLimit))).toBe("1 movement, not finished");
  });
});
