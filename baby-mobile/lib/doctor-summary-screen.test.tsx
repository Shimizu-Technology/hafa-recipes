import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answer, day } from "./care-stats-fixtures";
import { emptyState, optimisticRecord, type BabyRecord } from "./models";

const mock = vi.hoisted(() => ({ baby: null as any, push: vi.fn(), params: {} as Record<string, string>, stats: undefined as any, error: undefined as string | undefined, refresh: vi.fn(), shared: [] as string[], result: { level: 0, fits: true } }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", Switch: "Switch", useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("expo-router", () => ({ router: { push: mock.push }, useLocalSearchParams: () => mock.params }));
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
vi.mock("@/components/ui", () => ({ Button: "Button", Chips: "Chips", Choice: "Choice", Copy: "Copy", Grouped: "Grouped", Notice: "Notice", Row: "Row", Section: "Section",
  useColors: () => ({ action: "action" }),
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
describe("naming the doctor", () => {
  const offer = () => choices().find((n) => /at the top of the page/.test(n.props.label));
  it("isn't offered against an API without contacts", async () => {
    await mount();
    expect(offer()).toBeUndefined();
  });
  it("goes on the page only if she ticks it", async () => {
    mock.baby.state.bootstrap.contacts = {};
    mock.baby.state.bootstrap.children = [{ ...mock.baby.state.bootstrap.children[0], birth_date: "2026-10-10", details: { doctor: { name: "Dr. Lee", phone: "671-555-0102" } } }];
    await mount();
    expect(offer()!.props.label).toBe("Put Dr. Lee · 671-555-0102 at the top of the page");
    expect(offer()!.props.selected).toBe(false);
    await share();
    expect(mock.shared[0]).not.toContain("Dr. Lee");
    await act(async () => offer()!.props.onPress());
    await share();
    expect(mock.shared[1]).toContain("<p>For Dr. Lee · 671-555-0102</p>");
  });
});
describe("her own logs", () => {
  const pressure = { ...optimisticRecord({ id: "bp", kind: "custom", title: "118/76", body: "", child_id: null, occurred_at: new Date(Date.now() - 3_600_000).toISOString(), data: { label: "Blood pressure" } }), revision: 1 };
  const include = () => renderer!.root.findAll((n) => String(n.type) === "Switch").find((n) => n.props.accessibilityLabel === "Include my own logs");
  const sections = () => renderer!.root.findAll((n) => String(n.type) === "Section").map((n) => n.props.title);
  beforeEach(() => {
    const read = mock.baby.api.records;
    mock.baby.api.records = vi.fn(async (filters: any) => { const answer = await read(filters); return filters.kinds.includes("custom") ? { ...answer, items: [...answer.items, pressure], total: answer.total + 1 } : answer; });
  });
  it("stay off a born baby's page until she switches them on, then go in their own Mom section", async () => {
    await mount();
    expect(include()!.props.value).toBe(false);
    expect(sections()).not.toContain("Mom");
    await share();
    expect(mock.shared[0]).not.toContain("118/76");
    await act(async () => include()!.props.onValueChange(true));
    expect(sections()).toContain("Mom");
    await share();
    expect(mock.shared[1]).toContain("<h2>Mom</h2>");
    expect(mock.shared[1]).toContain("Blood pressure: 118/76");
    await act(async () => include()!.props.onValueChange(false));
    await share();
    expect(mock.shared[2]).not.toContain("118/76");
  });
  it("can still leave one off with its tick", async () => {
    await mount();
    await act(async () => include()!.props.onValueChange(true));
    await act(async () => choices().find((n) => n.props.label === "Blood pressure")!.props.onPress());
    await share();
    expect(mock.shared[0]).not.toContain("118/76");
  });
  it("go back off for another baby, so a pediatrician's page doesn't get them unasked", async () => {
    mock.baby.state.bootstrap.children = [child("baby", "Mia"), child("sister", "Noa")];
    await mount();
    await act(async () => include()!.props.onValueChange(true));
    await act(async () => renderer!.root.findAll((n) => String(n.type) === "Chips")[0].props.onChange("sister"));
    await settle();
    expect(include()!.props.value).toBe(false);
    expect(sections()).not.toContain("Mom");
  });
  it("stay as they are before the birth: no switch, ticked, and under her own heading", async () => {
    mock.baby.state.bootstrap.children = [{ id: "baby", name: "Mia", revision: 1, due_date: "2026-12-10" }];
    await mount();
    expect(include()).toBeUndefined();
    expect(sections()).toContain("Your own logs");
    await share();
    expect(mock.shared[0]).toContain("<h2>Her own logs</h2>");
    expect(mock.shared[0]).toContain("Blood pressure: 118/76");
  });
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

describe("the extra logs on the screen", () => {
  const at = "2026-11-03T02:00:00.000Z";
  const log = (id: string, kind: BabyRecord["kind"], title: string, data: object, body = "", child: string | null = "baby") => ({ ...optimisticRecord({ id, kind, title, body, child_id: child, occurred_at: at, data: data as never }), revision: 1 });
  const dose = log("dose", "medicine", "Tylenol", { name: "Tylenol" }), pressure = log("bp", "custom", "118/76", { label: "Blood pressure" }, "", null);
  function setupWith(child: object, items: BabyRecord[]) {
    mock.stats = answer([day("2026-11-03")]);
    mock.params = { child: "baby", from: "2026-11-03", to: "2026-11-03" };
    mock.baby = { owner: "o", state: { ...emptyState(), records: items, bootstrap: { generation: 1, children: [{ id: "baby", name: "Noa", revision: 1, ...child }], profile: { timezone: "Pacific/Guam" } } },
      api: { records: vi.fn(async ({ kinds }: { kinds: string[] }) => ({ items: items.filter((row) => kinds.includes(row.kind)), total: items.length, has_more: false })), careStats: vi.fn(async () => mock.stats) }, sync: vi.fn() };
  }
  it("lets her untick her own logs on an expecting summary, and puts what's ticked on the page", async () => {
    setupWith({ due_date: "2026-12-10" }, [dose, pressure]);
    await mount();
    expect(choices().find((n) => n.props.label === "Blood pressure")!.props.selected).toBe(true);
    await share();
    expect(mock.shared.at(-1)).toContain("Blood pressure: 118/76");
    await act(async () => choices().find((n) => n.props.label === "Blood pressure")!.props.onPress());
    await share();
    expect(mock.shared.at(-1)).not.toContain("118/76");
  });
  it("doesn't offer her logs for a baby who's here, and says the logs are on the page", async () => {
    setupWith({ birth_date: "2026-10-10" }, [dose, pressure]);
    await mount();
    expect(choices().some((n) => n.props.label === "Blood pressure")).toBe(false);
    expect(JSON.stringify(renderer!.toJSON())).toContain("1 medicine");
    await share();
    expect(mock.shared.at(-1)).toContain("Tylenol");
    expect(mock.shared.at(-1)).not.toContain("118/76");
  });
  it("leaves logs off a page of just questions and notes, since this phone may not hold them all", async () => {
    setupWith({ birth_date: "2026-10-10" }, [dose, log("q", "question", "Rash", {}, "Is this fine?")]);
    await mount();
    await act(async () => { await button("Share questions and notes")!.props.onPress(); });
    expect(mock.shared.at(-1)).toContain("Rash");
    expect(mock.shared.at(-1)).not.toContain("Tylenol");
  });
});


it("scopes appointment questions, names the visit and lets her read before ticking", async () => {
  mock.params = { visit: "visit-a", visitTitle: "Mia’s check", at: new Date().toISOString(), child: "baby" };
  const linked = { ...question, data: { event_id: "visit-a" } }, other = { ...question, id: "other", title: "Another visit", data: { event_id: "visit-b" } };
  mock.baby.api.records = vi.fn(async (filters: any) => ({ items: filters.kinds.includes("question") ? [linked, other] : [secret], has_more: false }));
  await mount();
  expect(mock.baby.api.records).toHaveBeenCalledWith(expect.objectContaining({ event_id: "visit-a", kinds: ["question"] }));
  expect(choices().some((n) => n.props.label === "Another visit")).toBe(false);
  expect(JSON.stringify(renderer!.toJSON())).toContain("For Mia’s check");
  const reader = renderer!.root.findAll((n) => String(n.type) === "Row").find((n) => n.props.detail === "Tuesday night")!;
  await act(async () => reader.props.onPress());
  expect(mock.push).toHaveBeenCalledWith({ pathname: "/record/[id]", params: { id: "private", fromVisit: "visit-a", visitAt: mock.params.at } });
  expect(choices().find((n) => n.props.label === "Tuesday night")!.props.selected).toBe(false);
  await act(async () => choices().find((n) => n.props.label === "Show other saved questions")!.props.onPress());
  await settle();
  expect(choices().find((n) => n.props.label === "Another visit")!.props.selected).toBe(false);
});
it("does not request future totals for a future appointment", async () => {
  mock.params = { visit: "visit", visitTitle: "Next check", at: "2099-11-01T00:00:00Z" };
  await mount();
  const to = renderer!.root.findAll((n) => String(n.type) === "DateField").find((n) => n.props.label === "To")!;
  expect(to.props.value).toBe(new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Guam" }));
});

it("forgets a journal tick when the visit changes on the same mounted summary", async () => {
  mock.params = { visit: "v1", at: new Date().toISOString() };
  await mount();
  await act(async () => choices().find((n) => n.props.label === "Tuesday night")!.props.onPress());
  expect(choices().find((n) => n.props.label === "Tuesday night")!.props.selected).toBe(true);
  mock.params = { visit: "v2", at: new Date().toISOString() }; await update();
  expect(choices().find((n) => n.props.label === "Tuesday night")!.props.selected).toBe(false);
});
it("labels every question's baby and leaves another baby's question off this baby's PDF", async () => {
  mock.params = { visit: "visit", child: "baby", at: new Date().toISOString() };
  mock.baby.state.bootstrap.children.push({ id: "noa", name: "Noa", revision: 1 });
  const mia = { ...question, title: "Mia question", body: "Mia only words", data: { event_id: "visit" } }, noa = { ...question, id: "q-noa", child_id: "noa", title: "Noa question", body: "Noa only words", data: { event_id: "visit" } };
  mock.baby.api.records = vi.fn(async (f: any) => ({ items: f.kinds.includes("question") ? [mia, noa] : [], total: 2, has_more: false }));
  await mount();
  const other = choices().find((n) => n.props.label === "Noa question")!;
  expect(other.props.selected).toBe(false); expect(other.props.detail).toContain("For Noa");
  await act(async () => button("Share questions and notes")!.props.onPress());
  expect(mock.shared[0]).not.toContain("For Mia:"); expect(mock.shared[0]).not.toContain("Noa only words");
  await act(async () => other.props.onPress());
  await act(async () => button("Share questions and notes")!.props.onPress());
  expect(mock.shared[1]).toContain("For Noa");
});

it.each([
  { visit: "visit", at: "2026-11-14T14:00:00Z", visitAt: "2026-11-07T14:00:00Z" },
  { visit: "visit", at: "2026-11-14T14:00:00Z" },
  {},
] as Record<string, string>[])("keeps the occurrence return hint while opening a full entry, and leaves Stats unscoped (%j)", async (params) => {
  mock.params = params;
  const linked = { ...question, title: "Visit question", body: "Question marker", data: { event_id: "visit" } };
  mock.baby.api.records = vi.fn(async (filters: any) => ({ items: filters.kinds.includes("question") ? [linked] : [], has_more: false }));
  await mount();
  const reader = renderer!.root.findAll((n) => String(n.type) === "Row").find((n) => n.props.title === "Read full entry" && n.props.detail === "Visit question")!;
  await act(async () => reader.props.onPress());
  expect(mock.push).toHaveBeenCalledWith({ pathname: "/record/[id]", params: { id: linked.id, ...(params.visit ? { fromVisit: params.visit, visitAt: params.visitAt ?? params.at } : {}) } });
});


it("keeps another baby's visit question and its tick when showing other saved questions", async () => {
  const other = { ...question, id: "other-baby", child_id: "noa", title: "Noa question", data: { event_id: "visit" } };
  mock.params = { visit: "visit", child: "baby" };
  mock.baby.state.bootstrap.children.push(child("noa", "Noa"));
  mock.baby.api.records = vi.fn(async (f: any) => ({ items: f.kinds.includes("question") && (f.event_id === "visit" || !f.child_id) ? [other] : [], has_more: false }));
  await mount();
  await act(async () => choices().find((n) => n.props.label === "Noa question")!.props.onPress());
  await act(async () => choices().find((n) => n.props.label === "Show other saved questions")!.props.onPress());
  expect(choices().find((n) => n.props.label === "Noa question")?.props.selected).toBe(true);
  await act(async () => { await button("Share questions and notes")!.props.onPress(); });
  expect(mock.shared.at(-1)).toContain("For Noa:");
});
it("offers an unlinked private question on the upcoming visit day unticked and prints it as a question without a future time", async () => {
  const at = new Date(Date.now() + 3 * 86400000).toISOString(), kept = { ...question, id: "kept", child_id: null, title: "Question for Mia", body: "Private future question", occurred_at: at, data: { just_me: true } };
  mock.params = { visit: "future", child: "baby", at };
  mock.baby.api.records = vi.fn(async (f: any) => ({ items: f.kinds.includes("question") && !f.event_id ? [kept] : [], has_more: false }));
  await mount();
  const entry = () => choices().find((n) => n.props.label === "Question for Mia");
  expect(entry()).toBeDefined();expect(entry()!.props.selected).toBe(false);
  await act(async () => entry()!.props.onPress());
  await act(async () => { await button("Share questions and notes")!.props.onPress(); });
  const html = mock.shared.at(-1)!;
  expect(html).toContain("<h2>Questions for the doctor</h2>"); expect(html).toContain("Private future question");
  expect(html).not.toContain("<h2>Notes</h2>");
});
it("leaves private questions unticked on the general summary too", async () => {
  mock.baby.api.records = vi.fn(async (f: any) => ({ items: f.kinds.includes("question") ? [{ ...question, data: { just_me: true } }] : [], has_more: false }));
  await mount(); expect(choices().find((n) => n.props.label === "Rash")!.props.selected).toBe(false);
});
