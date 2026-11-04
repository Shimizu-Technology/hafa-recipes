import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answer, day } from "./care-stats-fixtures";
import { emptyState, optimisticRecord, type BabyRecord } from "./models";

const mock = vi.hoisted(() => ({ baby: null as any, params: {} as Record<string, string>, stats: undefined as any, error: undefined as string | undefined, refresh: vi.fn(), shared: [] as string[], result: { level: 0, fits: true } }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => mock.params }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/lib/care-stats", () => import("./care-stats"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/doctor-summary", () => import("./doctor-summary"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/use-care-stats", () => ({ useCareStats: (choice: unknown, child: string | null) => ({ stats: !choice ? undefined : typeof mock.stats === "function" ? mock.stats(child) : mock.stats, error: mock.error, loading: false, refresh: mock.refresh }) }));
vi.mock("@/lib/files", () => ({ exportOnePagePdf: async (html: (level: number) => string) => { mock.shared.push(html(0)); return mock.result; } }));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/sync-status", () => ({ SyncStatus: "SyncStatus" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Chips: "Chips", Choice: "Choice", Copy: "Copy", Grouped: "Grouped", Notice: "Notice", Section: "Section",
  Screen: ({ children, footer }: { children: unknown; footer: unknown }) => [children, footer] }));
import DoctorSummary from "../app/doctor-summary";

const row = (id: string, kind: BabyRecord["kind"], body: string, title = "") => ({ ...optimisticRecord({ id, kind, title, body, child_id: "baby", occurred_at: new Date(Date.now() - 3_600_000).toISOString(), data: {} }), revision: 1 });
const secret = row("private", "journal", "So tired and scared tonight", "Tuesday night"), question = row("q", "question", "Is this rash fine?", "Rash"), note = row("n", "feeding", "Spit up after");
let renderer: ReactTestRenderer | undefined;
const choices = () => renderer!.root.findAll((n) => String(n.type) === "Choice");

const button = (title: string) => renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === title);
const footerButton = () => button("Share PDF")!;
const notices = () => renderer!.root.findAll((n) => String(n.type) === "Notice").map((n) => n.props.children);
async function mount() { await act(async () => { renderer = create(<DoctorSummary />); await new Promise((resolve) => setTimeout(resolve, 5)); }); }
const share = () => act(async () => { await footerButton().props.onPress(); });
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
const later = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const child = (id: string, name: string) => ({ id, name, revision: 1, birth_date: "2026-10-10" });
const queued = (id: string, kind: BabyRecord["kind"], body: string, title = "") => ({ id: `m${id}`, generation: 1, type: "save", files: [], record: row(id, kind, body, title) });
const update = () => act(async () => { renderer!.update(<DoctorSummary />); await new Promise((resolve) => setTimeout(resolve, 5)); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => undefined);
  mock.params = {}; mock.shared = []; mock.result = { level: 0, fits: true }; mock.stats = answer([day("2026-11-04")]); mock.error = undefined; mock.refresh = vi.fn(async () => undefined);
  mock.baby = { owner: "owner", sync: vi.fn(async () => undefined), state: { ...emptyState(), bootstrap: { generation: 1, active: true, ai_available: false, children: [{ id: "baby", name: "Mia", revision: 1, birth_date: "2026-10-10" }], profile: { display_name: "", timezone: "Pacific/Guam", ai_consent: false } } },
    api: { records: vi.fn(async (filters: any) => { const items = [secret, question, note].filter((item) => filters.kinds.includes(item.kind)); return { items, total: items.length, has_more: false }; }),
      careStats: vi.fn(async () => (typeof mock.stats === "function" ? mock.stats() : mock.stats)) } };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("leaves a private journal entry off the page unless she ticks it", async () => {
  await mount();
  const journal = () => choices().find((n) => n.props.label === "Tuesday night")!;
  expect(journal().props.selected).toBe(false);
  await share();
  expect(mock.shared[0]).not.toContain("So tired and scared tonight");
  await act(async () => journal().props.onPress());
  await share();
  expect(mock.shared[1]).toContain("So tired and scared tonight");
});
it("puts what she ticked ahead of log notes, so a full page never drops it first", async () => {
  await mount();
  await act(async () => choices().find((n) => n.props.label === "Tuesday night")!.props.onPress());
  await share();
  expect(mock.shared[0].indexOf("So tired and scared tonight")).toBeLessThan(mock.shared[0].indexOf("Spit up after"));
});
it("starts questions and log notes ticked, and an untick takes them off", async () => {
  await mount();
  await share();
  expect(mock.shared[0]).toContain("Is this rash fine?");
  expect(mock.shared[0]).toContain("Spit up after");
  await act(async () => choices().find((n) => n.props.label === "Rash")!.props.onPress());
  await share();
  expect(mock.shared[1]).not.toContain("Is this rash fine?");
});
it("opens on the dates and baby an appointment links with", async () => {
  mock.params = { child: "baby", from: "2026-10-01", to: "2026-10-15" };
  await mount();
  const fields = renderer!.root.findAll((n) => String(n.type) === "DateField");
  expect(fields.map((n) => n.props.value)).toEqual(["2026-10-01", "2026-10-15"]);
  expect(mock.baby.api.records.mock.calls.every(([filters]: any[]) => filters.child_id === "baby")).toBe(true);
});
it("won't make a page for more than a month, and says so", async () => {
  mock.params = { from: "2026-08-01", to: "2026-10-15" };
  await mount();
  expect(notices()).toContain("Choose 31 days or fewer");
  expect(footerButton().props.disabled).toBe(true);
});
it("tells her when notes had to go to keep to one page, and when it still doesn't fit", async () => {
  mock.result = { level: 2, fits: true };
  await mount();
  await share();
  expect(notices().join()).toContain("shortened or left out");
  mock.result = { level: 3, fits: false };
  await share();
  expect(notices().join()).toMatch(/wasn’t shared.*fewer days/);
});

describe("switching babies", () => {
  const twoBabies = () => {
    mock.baby.state.bootstrap.children = [child("baby", "Mia"), child("noa", "Noa")];
    const hers = later<any>(), rows: Record<string, any[]> = { baby: [secret, question, note] };
    mock.baby.api.records = vi.fn((filters: any) => {
      if (filters.child_id === "noa") return hers.promise.then((items: any[]) => { const list = items.filter((item) => filters.kinds.includes(item.kind)); return { items: list, total: list.length, has_more: false }; });
      const items = rows.baby.filter((item) => filters.kinds.includes(item.kind));
      return Promise.resolve({ items, total: items.length, has_more: false });
    });
    return hers;
  };
  const pick = (id: string) => act(async () => { renderer!.root.findAll((n) => String(n.type) === "Chips").find((n) => n.props.label === "Baby")!.props.onChange(id); await new Promise((resolve) => setTimeout(resolve, 5)); });
  it("won't share until the new baby's entries are in, and never carries the last one's words", async () => {
    const hers = twoBabies();
    await mount();
    await act(async () => choices().find((n) => n.props.label === "Tuesday night")!.props.onPress());
    await pick("noa");
    expect(footerButton().props.disabled).toBe(true);
    expect(choices().map((n) => n.props.label)).not.toContain("Rash");
    expect(choices().map((n) => n.props.label)).not.toContain("Tuesday night");
    await act(async () => { hers.resolve([]); await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(footerButton().props.disabled).toBe(false);
    await share();
    expect(mock.shared[0]).toContain("Noa: care summary");
    for (const words of ["Is this rash fine?", "So tired and scared tonight", "Spit up after"]) expect(mock.shared[0]).not.toContain(words);
  });
  it("won't share a read that arrives for the last baby after she has switched", async () => {
    const hers = twoBabies(), read = later<any>();
    await mount();
    mock.baby.api.careStats = vi.fn(() => read.promise);
    const pressed = footerButton().props.onPress();
    await pick("noa");
    await act(async () => { read.resolve(answer([day("2026-11-04")])); await pressed; });
    expect(mock.shared).toEqual([]);
    hers.resolve([]);
  });
  it("forgets her ticks, so a general entry ticked for one baby isn't private-ticked for the next", async () => {
    const general = { ...row("general", "journal", "For both", "General note"), child_id: null };
    mock.baby.state.bootstrap.children = [child("baby", "Mia"), child("noa", "Noa")];
    mock.baby.api.records = vi.fn(async (filters: any) => { const items = [general].filter((item) => filters.kinds.includes(item.kind)); return { items, total: items.length, has_more: false }; });
    await mount();
    await act(async () => choices().find((n) => n.props.label === "General note")!.props.onPress());
    expect(choices().find((n) => n.props.label === "General note")!.props.selected).toBe(true);
    await pick("noa");
    expect(choices().find((n) => n.props.label === "General note")!.props.selected).toBe(false);
  });
  it.each([["a new generation", (state: any) => { state.bootstrap = { ...state.bootstrap, generation: 2 }; }], ["a new time zone", (state: any) => { state.bootstrap = { ...state.bootstrap, profile: { ...state.bootstrap.profile, timezone: "Asia/Tokyo" } }; }]])("doesn't reuse entries after %s", async (_name, change) => {
    await mount();
    expect(footerButton().props.disabled).toBe(false);
    const read = later<any>();
    mock.baby.api.records = vi.fn(() => read.promise);
    change(mock.baby.state);
    mock.baby = { ...mock.baby, state: { ...mock.baby.state } };
    await update();
    expect(footerButton().props.disabled).toBe(true);
    read.resolve({ items: [], total: 0, has_more: false });
  });
});

describe("when the full page can't be right", () => {
  /** The real days around now, since a queued row here is an hour old. Guam is ten hours ahead. */
  const thisWeek = () => { const stats = answer([day(new Date(Date.now() + 36_000_000).toISOString().slice(0, 10), true)]); stats.range.start = new Date(Date.now() - 7 * 86_400_000).toISOString(); return stats; };
  const blocked = (reason: RegExp) => {
    expect(notices().join()).toMatch(reason);
    expect(footerButton().props.disabled).toBe(true);
    expect(button("Try again")).toBeTruthy();
  };
  it("says why when Håfa can't be reached", async () => {
    mock.error = "You're offline.";
    await mount();
    blocked(/can’t be reached/);
  });
  it("won't use numbers kept from an earlier read when the latest failed", async () => {
    mock.stats = answer([day("2026-11-04")]); mock.error = "You're offline.";
    await mount();
    expect(footerButton().props.disabled).toBe(true);
  });
  it("says why when the API couldn't add up every log", async () => {
    mock.stats = { ...answer([day("2026-11-04")]), complete: false };
    await mount();
    blocked(/more logs in these days.*fewer days/);
  });
  it("says why when entries in these days are still waiting, and lets her see them", async () => {
    mock.stats = thisWeek();
    mock.baby.state.outbox = [queued("f", "feeding", "")];
    await mount();
    blocked(/1 entry is still waiting to sync.*leave it out/);
    expect(renderer!.root.findAll((n) => String(n.type) === "SyncStatus")).toHaveLength(1);
  });
  it("isn't held up by a queued question, which goes on the page from this phone", async () => {
    mock.stats = thisWeek();
    mock.baby.state.outbox = [queued("q2", "question", "Still queued", "New one")];
    await mount();
    expect(footerButton().props.disabled).toBe(false);
    await share();
    expect(mock.shared[0]).toContain("Still queued");
  });
  it("Try again syncs and reads again", async () => {
    mock.error = "You're offline.";
    await mount();
    const reads = mock.baby.api.records.mock.calls.length;
    await act(async () => { await button("Try again")!.props.onPress(); });
    expect(mock.baby.sync).toHaveBeenCalled();
    expect(mock.refresh).toHaveBeenCalled();
    expect(mock.baby.api.records.mock.calls.length).toBeGreaterThan(reads);
  });
  it("adds up afresh at the moment she shares, and puts those numbers on the page", async () => {
    await mount();
    const days = [day("2026-11-04", true, { feeding: { ...day("x").feeding, count: 12 } })];
    mock.baby.api.careStats = vi.fn(async () => answer(days));
    await share();
    expect(mock.baby.api.careStats).toHaveBeenCalledWith({ range: "custom", from: expect.any(String), to: expect.any(String) }, "baby");
    expect(mock.shared[0]).toContain("12 feeds");
  });
  it.each([["can't be read", () => Promise.reject(Error("You're offline."))], ["comes back short", async () => ({ ...answer([day("2026-11-04")]), complete: false })]])("shares nothing if that last read %s", async (_name, read) => {
    await mount();
    mock.baby.api.careStats = vi.fn(read);
    await share();
    expect(mock.shared).toEqual([]);
    expect(mock.refresh).toHaveBeenCalled();
    expect(notices().join()).toContain("Nothing was shared");
  });
});

describe("questions and notes with no network", () => {
  const offline = () => { mock.error = "You're offline."; mock.stats = undefined; mock.baby.api.careStats = vi.fn(() => Promise.reject(Error("You're offline."))); mock.baby.api.records = vi.fn(() => Promise.reject(Error("You're offline."))); };
  const outgoing = () => button("Share questions and notes")!;
  const send = () => act(async () => { await outgoing().props.onPress(); });
  it("lists what's on this phone and what's queued, and shares the ones ticked, asking Håfa for nothing", async () => {
    offline();
    mock.baby.state.records = [question, secret];
    mock.baby.state.outbox = [queued("q2", "question", "Still queued", "New one")];
    await mount();
    expect(footerButton().props.disabled).toBe(true);
    expect(outgoing().props.disabled).toBe(false);
    mock.baby.api.records.mockClear();
    await send();
    expect(mock.baby.api.records).not.toHaveBeenCalled();
    expect(mock.baby.api.careStats).not.toHaveBeenCalled();
    expect(mock.shared[0]).toContain("Mia: questions and notes");
    expect(mock.shared[0]).toContain("Is this rash fine?");
    expect(mock.shared[0]).toContain("Still queued");
    expect(mock.shared[0]).not.toContain("So tired and scared tonight");
    expect(mock.shared[0]).not.toContain("<h2>Totals</h2>");
  });
  it("shows them before the network has answered at all", async () => {
    mock.stats = undefined; mock.baby.api.records = vi.fn(() => new Promise(() => undefined));
    mock.baby.state.records = [question];
    await mount();
    expect(choices().map((n) => n.props.label)).toContain("Rash");
    expect(outgoing().props.disabled).toBe(false);
  });
  it("has nothing to send when nothing is ticked", async () => {
    offline();
    mock.baby.state.records = [question];
    await mount();
    await act(async () => choices().find((n) => n.props.label === "Rash")!.props.onPress());
    expect(outgoing().props.disabled).toBe(true);
  });
  it("tells her what to do when it runs over a page", async () => {
    offline();
    mock.baby.state.records = [question];
    mock.result = { level: 4, fits: false };
    await mount();
    await send();
    expect(notices().join()).toMatch(/wasn’t shared/);
  });
});
