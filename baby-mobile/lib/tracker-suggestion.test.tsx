import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type Child, type DeviceState, type Mutation } from "./models";
import { withPendingTracking } from "./outbox";
import { suggestionFor, suggestionsOpen } from "./tracker-suggestion";

const scope = vi.hoisted(() => ({ account: null as any, care: {} as Record<string, any>, requests: [] as any[], toast: vi.fn(), push: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("expo-router", () => ({ router: { push: scope.push } }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `id-${++id}` }; });
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/today-care", () => ({ useTodayCare: (options: any) => { scope.requests.push(options); return scope.care[options.kinds[0]] ?? { all: [], read: true, error: "" }; } }));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/tracker-suggestion", () => import("./tracker-suggestion"));
vi.mock("@/lib/quick-care", () => import("./quick-care"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/lib/api", () => ({ sendsCareDetails: true }));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/care-glance", () => import("./care-glance"));
vi.mock("@/lib/feed-reducer", () => import("./feed-reducer"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/feed-timer", () => import("./feed-timer"));
vi.mock("../components/ui", () => ({ Button: "Button", Card: "Card", Copy: "Copy", tap: () => undefined, useColors: () => ({}), useToast: () => scope.toast }));
import { TrackerSuggestion } from "../components/tracker-suggestion";

const now = new Date("2026-11-05T02:00:00.000Z");
const log = (kind: "diaper" | "feeding", at: string) => ({ id: `${kind}:${at}`, kind, title: kind, body: "", child_id: "baby", occurred_at: at, data: {}, revision: 1, created_at: at, updated_at: at }) as BabyRecord;
const days = (count: number) => new Date(now.getTime() - count * 86_400_000).toISOString();
const toddler: Child = { id: "baby", name: "Mia", revision: 1, birth_date: "2025-10-01" };
const today = new Date(2026, 10, 5);

describe("when there's anything to ask", () => {
  const open = (child: Child, day = today) => suggestionsOpen(child, day);
  it("is never before 12 months, down to the day", () => {
    expect(open({ ...toddler, birth_date: "2026-01-01" })).toEqual([]);
    expect(open({ ...toddler, birth_date: "2025-11-05" })).toEqual([]);
    expect(open({ ...toddler, birth_date: "2025-11-04" })).toEqual(["diaper", "feed"]);
  });
  it("has nothing to ask with no birth date, or a due date", () => {
    expect(open({ id: "b", name: "N", revision: 1 })).toEqual([]);
    expect(open({ id: "b", name: "N", revision: 1, due_date: "2024-01-01" })).toEqual([]);
  });
  it("asks once per baby per tracker, remembered on the baby", () => {
    expect(open({ ...toddler, details: { tracking: { asked_diaper: true } } })).toEqual(["feed"]);
    expect(open({ ...toddler, details: { tracking: { asked_diaper: true, asked_feed: true } } })).toEqual([]);
  });
  it("doesn't ask about what's already off", () => {
    expect(open({ ...toddler, details: { tracking: { diaper: false } } })).toEqual(["feed"]);
    expect(open({ ...toddler, details: { tracking: { breast: false, bottle: false } } })).toEqual(["diaper"]);
    expect(open({ ...toddler, details: { feeding: "bottle" } })).toEqual(["diaper", "feed"]);
  });
});

describe("what the logs say", () => {
  const ask = (diaper?: string, feeding?: string) => suggestionFor(["diaper", "feed"], { diaper: diaper ? [log("diaper", diaper)] : [], feed: feeding ? [log("feeding", feeding)] : [] }, now);
  it("asks after 30 days with no diaper", () => {
    expect(ask(days(31), days(1))?.id).toBe("diaper");
    expect(ask(days(29), days(1))).toBeNull();
    expect(ask(days(30), days(1))?.id).toBe("diaper");
  });
  it("asks after 14 days with no feed", () => {
    expect(ask(days(1), days(15))?.id).toBe("feed");
    expect(ask(days(1), days(13))).toBeNull();
  });
  it("is one card, however much it could say", () => {
    expect(ask(days(40), days(40))?.id).toBe("diaper");
  });
  it("won't go on what was never logged, because that says nothing", () => {
    expect(ask(undefined, undefined)).toBeNull();
    expect(ask(undefined, days(1))).toBeNull();
  });
  it("goes by the newest log", () => {
    expect(suggestionFor(["diaper"], { diaper: [log("diaper", days(60)), log("diaper", days(2))], feed: [] }, now)).toBeNull();
  });
});

let renderer: ReactTestRenderer | undefined;
function setup(child: Child = toddler) {
  const b = {
    state: { ...emptyState(), bootstrap: { generation: 2, active: true, ai_available: false, children: [child], profile: { display_name: "K", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState,
    commit: vi.fn(async (change: (state: DeviceState) => DeviceState) => { b.state = withPendingTracking(change(b.state)); }),
    queue: vi.fn(async (m: Mutation) => { b.state = withPendingTracking({ ...b.state, outbox: [...b.state.outbox, m] }); }),
    sync: vi.fn(async () => undefined),
  };
  scope.account = b;
  return b;
}
const view = () => <TrackerSuggestion child={scope.account.state.bootstrap.children[0]} today={today} now={now} />;
async function mount() { await act(async () => { renderer = create(view()); }); }
const buttons = () => renderer!.root.findAll((n) => String(n.type) === "Button");
const words = () => renderer!.root.findAll((n) => String(n.type) === "Copy").map((n) => [n.props.children].flat().join("")).join(" ");
const press = async (title: string) => { await act(async () => buttons().find((n) => n.props.title === title)!.props.onPress()); await act(async () => renderer!.update(view())); };
const queued = () => scope.account.state.outbox.filter((m: Mutation) => m.type === "child_tracking");

describe("the card", () => {
  beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); scope.care = {}; scope.requests = []; scope.toast.mockClear();
    scope.care.diaper = { all: [log("diaper", days(40))], read: true, error: "" }; scope.care.feeding = { all: [log("feeding", days(1))], read: true, error: "" }; });
  afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
  it("says what's logged and asks, with Keep and Turn off the same size", async () => {
    setup();
    await mount();
    expect(words()).toContain("No diapers logged in 30 days");
    expect(buttons().map((n) => n.props.title)).toEqual(["Keep", "Turn off"]);
    expect(new Set(buttons().map((n) => n.props.secondary))).toEqual(new Set([true]));
    expect(new Set(buttons().map((n) => n.props.size))).toHaveLength(1);
  });
  it("carries no judgement about what's normal", async () => {
    setup();
    await mount();
    expect(words()).not.toMatch(/normal|should|ready|outgrow|most babies|old enough|age|potty/i);
  });
  it("Keep is remembered on the baby, leaves the tracker on, and doesn't ask again", async () => {
    setup();
    await mount();
    await press("Keep");
    expect(queued()[0].tracking).toEqual({ asked_diaper: true });
    expect(buttons()).toHaveLength(0);
    expect(suggestionsOpen(scope.account.state.bootstrap.children[0], today)).toEqual(["feed"]);
  });
  it("Turn off hides the button, says logs stay, and doesn't ask again", async () => {
    setup();
    await mount();
    await press("Turn off");
    expect(queued()[0].tracking).toEqual({ diaper: false, asked_diaper: true });
    expect(scope.toast.mock.calls[0][0]).toContain("stays");
    expect(buttons()).toHaveLength(0);
  });
  it("turns off both feeds, and says which", async () => {
    scope.care.diaper = { all: [log("diaper", days(1))], read: true, error: "" };
    scope.care.feeding = { all: [log("feeding", days(20))], read: true, error: "" };
    setup();
    await mount();
    expect(words()).toContain("No feeds logged in 14 days");
    await press("Turn off");
    expect(queued()[0].tracking).toEqual({ breast: false, bottle: false, asked_feed: true });
  });
  it("shows one card at a time, and not the next one straight after", async () => {
    scope.care.feeding = { all: [log("feeding", days(40))], read: true, error: "" };
    setup();
    await mount();
    await press("Keep");
    expect(buttons()).toHaveLength(0);
  });
  it("waits for the API: a cached log could be behind what another phone logged", async () => {
    scope.care.diaper = { all: [log("diaper", days(40))], read: false, error: "" };
    setup();
    await mount();
    expect(buttons()).toHaveLength(0);
    scope.care.diaper = { all: [log("diaper", days(40))], read: true, error: "" };
    await act(async () => renderer!.update(view()));
    expect(buttons()).toHaveLength(2);
  });
  it("won't ask when either read failed, or with recent logs", async () => {
    scope.care.feeding = { all: [], read: false, error: "Offline" };
    setup();
    await mount();
    expect(buttons()).toHaveLength(0);
    act(() => renderer!.unmount());
    scope.care.feeding = { all: [log("feeding", days(1))], read: true, error: "" };
    scope.care.diaper = { all: [log("diaper", days(2))], read: true, error: "" };
    await mount();
    expect(buttons()).toHaveLength(0);
  });
  it("doesn't even look before 12 months", async () => {
    setup({ ...toddler, birth_date: "2026-06-01" });
    await mount();
    expect(buttons()).toHaveLength(0);
    expect(scope.requests).toEqual([]);
  });
  it("reads only this baby's logs", async () => {
    setup();
    await mount();
    expect(scope.requests.every((one) => one.child === "baby" && one.poll === false)).toBe(true);
  });
});
