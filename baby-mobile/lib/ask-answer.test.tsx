import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ opened: [] as string[], alerts: [] as { title: string; buttons: { text: string; onPress?: () => void }[] }[], fail: false, toasts: [] as string[] }));
vi.mock("react-native", () => ({
  Text: "Text", View: "View",
  Linking: { openURL: async (url: string) => { if (scope.fail) throw Error("no"); scope.opened.push(url); } },
  Alert: { alert: (title: string, _body: unknown, buttons: { text: string; onPress?: () => void }[]) => { scope.alerts.push({ title, buttons }); } },
}));
vi.mock("@/lib/ask-sources", async () => await import("./ask-sources"));
vi.mock("@/components/ui", () => ({}));
vi.mock("../components/ui", () => ({
  Button: "Button", Copy: "Copy", Field: "Field", Grouped: "Grouped", Icon: "Icon", PressTarget: "PressTarget", Row: "Row", Section: "Section",
  fonts: { semibold: "semibold" }, useColors: () => ({ accentText: "clay", surface: "surface", muted: "muted" }),
  useToast: () => (message: string) => scope.toasts.push(message),
}));
import { AnswerText, WebSources } from "../components/ask-answer";
import { AskHistory } from "../components/ask-history";
import { answerParts, askV2Active, openableSources, openableUrl } from "./ask-sources";
import type { WebSource } from "./models";

const cdc: WebSource = { url: "https://www.cdc.gov/sleep", title: "Safe sleep", domain: "www.cdc.gov", ref: "S1" };
const aap: WebSource = { url: "https://www.aap.org/x", title: "Sleep", domain: "www.aap.org", ref: "S2" };
let renderer: ReactTestRenderer | undefined;
const mount = async (element: React.ReactElement) => { await act(async () => { renderer = create(element); }); };
const labels = () => renderer!.root.findAll((n) => (n.type as unknown) === "Copy").map((n) => n.props.children);
const rows = () => renderer!.root.findAll((n) => (n.type as unknown) === "Row");
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); scope.opened = []; scope.alerts = []; scope.fail = false; scope.toasts = []; });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("only opens real web links", () => {
  expect(openableUrl("https://www.cdc.gov/x")).toBe(true);
  expect(openableUrl("javascript:alert(1)")).toBe(false);
  expect(openableUrl("tel:911")).toBe(false);
  expect(openableUrl("https://evil.example\\@cdc.gov/x")).toBe(false);
  expect(openableUrl("https://www.cdc.gov/a\u0000b")).toBe(false);
  expect(openableUrl("https://www.cdc.gov/a\tb")).toBe(false);
  expect(openableSources([{ ...cdc, url: "javascript:alert(1)" }])).toEqual([]);
});

it("numbers references by the sources shown and drops any it can't link", () => {
  expect(answerParts("Back to sleep [S1] and [S9].", [cdc])).toEqual([
    { text: "Back to sleep " }, { text: "[1]", url: cdc.url }, { text: " and " }, { text: "." },
  ]);
  expect(answerParts("See https://www.cdc.gov/x today", [])).toEqual([{ text: "See " }, { text: "https://www.cdc.gov/x", url: "https://www.cdc.gov/x" }, { text: " today" }]);
  expect(answerParts("No links here")).toEqual([{ text: "No links here" }]);
});

it("uses the new Ask only once this version is accepted", () => {
  const bootstrap = (version: number | null, acknowledged?: number, consent = true) => ({ generation: 1, children: [], ai_available: true, ask_consent_version: version,
    profile: { display_name: "", timezone: "UTC", ai_consent: consent, ai_consent_version: acknowledged } });
  expect(askV2Active(bootstrap(1, 1))).toBe(true);
  expect(askV2Active(bootstrap(2, 1))).toBe(false);
  expect(askV2Active(bootstrap(null, 1))).toBe(false);
  expect(askV2Active(bootstrap(1, 1, false))).toBe(false);
});

it("tapping a reference in the answer opens its page", async () => {
  await mount(<AnswerText text="Back to sleep [S1]." sources={[cdc]} />);
  const link = renderer!.root.findAll((n) => n.props.accessibilityRole === "link")[0];
  expect(link.props.children).toBe("[1]");
  await act(async () => link.props.onPress());
  expect(scope.opened).toEqual([cdc.url]);
});

it("says plainly when a link can't open", async () => {
  scope.fail = true;
  await mount(<AnswerText text="[S1]" sources={[cdc]} />);
  await act(async () => { renderer!.root.findAll((n) => n.props.accessibilityRole === "link")[0].props.onPress(); await Promise.resolve(); });
  expect(scope.toasts[0]).toMatch(/couldn’t open/);
});

it("shows one heading for sources, with tappable rows", async () => {
  await mount(<WebSources sources={[cdc, aap]} />);
  expect(labels()).toEqual(["From trusted sources"]);
  expect(rows().map((row) => [row.props.title, row.props.detail])).toEqual([["Safe sleep", "www.cdc.gov"], ["Sleep", "www.aap.org"]]);
  await act(async () => rows()[1].props.onPress());
  expect(scope.opened).toEqual([aap.url]);
});

it("shows no heading with nothing under it", async () => {
  await mount(<WebSources sources={[]} />);
  expect(labels()).toEqual([]);
});

const history = [{ id: "c1", scope: "all" as const, record_id: null, child_id: null, title: "Breastfeeding tips" }];
const press = (label: string) => scope.alerts.at(-1)!.buttons.find((button) => button.text === label)!.onPress!();

it("offers rename and delete only with the new Ask on", async () => {
  await mount(<AskHistory items={history} manageable={false} onOpen={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />);
  expect(renderer!.root.findAll((n) => n.props.accessibilityLabel?.startsWith("Rename or delete"))).toEqual([]);
});

it("deletes only after a second, clear confirmation", async () => {
  const onDelete = vi.fn(async () => true);
  await mount(<AskHistory items={history} manageable onOpen={vi.fn()} onRename={vi.fn()} onDelete={onDelete} />);
  await act(async () => renderer!.root.findAll((n) => n.props.accessibilityLabel === "Rename or delete: Breastfeeding tips")[0].props.onPress());
  await act(async () => press("Delete"));
  expect(scope.alerts.at(-1)!.title).toBe("Delete this conversation?");
  expect(onDelete).not.toHaveBeenCalled();
  await act(async () => press("Delete"));
  expect(onDelete).toHaveBeenCalledWith("c1");
});

it("renames in place, and keeps the editor open if saving fails", async () => {
  const onRename = vi.fn(async () => false);
  await mount(<AskHistory items={history} manageable onOpen={vi.fn()} onRename={onRename} onDelete={vi.fn()} />);
  await act(async () => renderer!.root.findAll((n) => n.props.accessibilityLabel === "Rename or delete: Breastfeeding tips")[0].props.onPress());
  await act(async () => press("Rename"));
  const field = () => renderer!.root.findAll((n) => (n.type as unknown) === "Field")[0];
  await act(async () => field().props.onChange("  Latch help  "));
  const save = () => renderer!.root.findAll((n) => n.props.title === "Save name")[0];
  await act(async () => save().props.onPress());
  expect(onRename).toHaveBeenCalledWith("c1", "Latch help");
  expect(field()).toBeDefined();
  onRename.mockResolvedValueOnce(true);
  await act(async () => save().props.onPress());
  expect(renderer!.root.findAll((n) => (n.type as unknown) === "Field")).toEqual([]);
});

it("won't save an empty name", async () => {
  const onRename = vi.fn(async () => true);
  await mount(<AskHistory items={history} manageable onOpen={vi.fn()} onRename={onRename} onDelete={vi.fn()} />);
  await act(async () => renderer!.root.findAll((n) => n.props.accessibilityLabel === "Rename or delete: Breastfeeding tips")[0].props.onPress());
  await act(async () => press("Rename"));
  await act(async () => renderer!.root.findAll((n) => (n.type as unknown) === "Field")[0].props.onChange("   "));
  const save = renderer!.root.findAll((n) => n.props.title === "Save name")[0];
  expect(save.props.disabled).toBe(true);
  await act(async () => save.props.onPress());
  expect(onRename).not.toHaveBeenCalled();
});
