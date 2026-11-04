import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { answer, day } from "./care-stats-fixtures";
import { emptyState, optimisticRecord, type BabyRecord } from "./models";

const mock = vi.hoisted(() => ({ baby: null as any, params: {} as Record<string, string>, stats: undefined as any, shared: [] as string[], result: { level: 0, fits: true } }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => mock.params }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/lib/care-stats", () => import("./care-stats"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/doctor-summary", () => import("./doctor-summary"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/use-care-stats", () => ({ useCareStats: (choice: unknown) => ({ stats: choice ? mock.stats : undefined, loading: false, refresh: vi.fn() }) }));
vi.mock("@/lib/files", () => ({ exportOnePagePdf: async (html: (level: number) => string) => { mock.shared.push(html(0)); return mock.result; } }));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Chips: "Chips", Choice: "Choice", Copy: "Copy", Grouped: "Grouped", Notice: "Notice", Section: "Section",
  Screen: ({ children, footer }: { children: unknown; footer: unknown }) => [children, footer] }));
import DoctorSummary from "../app/doctor-summary";

const row = (id: string, kind: BabyRecord["kind"], body: string, title = "") => ({ ...optimisticRecord({ id, kind, title, body, child_id: "baby", occurred_at: new Date(Date.now() - 3_600_000).toISOString(), data: {} }), revision: 1 });
const secret = row("private", "journal", "So tired and scared tonight", "Tuesday night"), question = row("q", "question", "Is this rash fine?", "Rash"), note = row("n", "feeding", "Spit up after");
let renderer: ReactTestRenderer | undefined;
const choices = () => renderer!.root.findAll((n) => String(n.type) === "Choice");

const footerButton = () => renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === "Share PDF")!;
const notices = () => renderer!.root.findAll((n) => String(n.type) === "Notice").map((n) => n.props.children);
async function mount() { await act(async () => { renderer = create(<DoctorSummary />); await new Promise((resolve) => setTimeout(resolve, 5)); }); }
const share = () => act(async () => { await footerButton().props.onPress(); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => undefined);
  mock.params = {}; mock.shared = []; mock.result = { level: 0, fits: true }; mock.stats = answer([day("2026-11-04")]);
  mock.baby = { owner: "owner", state: { ...emptyState(), bootstrap: { generation: 1, active: true, ai_available: false, children: [{ id: "baby", name: "Mia", revision: 1, birth_date: "2026-10-10" }], profile: { display_name: "", timezone: "Pacific/Guam", ai_consent: false } } },
    api: { records: vi.fn(async (filters: any) => { const items = [secret, question, note].filter((item) => filters.kinds.includes(item.kind)); return { items, total: items.length, has_more: false }; }) } };
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
  expect(notices().join()).toContain("runs past a page");
});
