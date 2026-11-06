import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ section: undefined as string | undefined, reminders: undefined as { push: boolean } | undefined, bootstrap: {} as object, ask: null as number | null, name: "Parent", outbox: [] as object[], push: vi.fn(), openSettings: vi.fn(), signOut: vi.fn(), sync: vi.fn(), consent: false, auto: false, save: vi.fn(async (change: object) => change), alert: vi.fn() }));
vi.mock("react-native", () => ({ Alert: { alert: f.alert }, Linking: { openSettings: f.openSettings }, ScrollView: "ScrollView", View: "View" }));
vi.mock("expo-router", () => ({ Redirect: "Redirect", router: { push: f.push }, useLocalSearchParams: () => ({ section: f.section }) }));
vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
vi.mock("@/lib/share-session-state", () => ({ revokeShareSession() {} }));
vi.mock("@/lib/account-deletion", () => ({ confirmAccountDeletion() {} }));
vi.mock("@/lib/files", () => ({ exportFile() {} }));
vi.mock("@/lib/ai-consent", () => ({ ASK_CONSENT_BODY: "NEW ASK WORDS", ASK_UPDATE_TITLE: "", acknowledgeAsk: vi.fn(), needsAskAcknowledgment: () => false }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ online: true, signOut: f.signOut, sync: f.sync, api: { profile: f.save }, commit: async () => undefined, state: { outbox: f.outbox, bootstrap: { generation: 1, ask_consent_version: f.ask, profile: { display_name: f.name, timezone: "Pacific/Guam", ai_consent: f.consent, auto_process_shares: f.auto }, children: [], reminders: f.reminders, ...f.bootstrap } } }) }));
vi.mock("@/components/ui", () => ({
  Button: "Button", Card: "Card", Choice: "Choice", Copy: "Copy", Field: "Field", Grouped: "Grouped", Notice: "Notice", Row: "Row", Screen: "Screen", Section: "Section", useColors: () => ({}), useToast: () => () => {},
}));
vi.mock("@/components/settings-group", () => ({ SettingsGroup: "SettingsGroup" }));
vi.mock("@/components/tab-stack", () => ({ initials: (name: string) => name.slice(0, 1) }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/child-setup", () => ({ babyDetailLine() {} }));
import Settings from "../app/settings";
import PrivacyData from "../app/privacy-data";
let view: ReactTestRenderer;
const rows = () => view.root.findAll((node) => String(node.type) === "Row");
const titles = () => rows().map((node) => node.props.title);
const buttons = () => view.root.findAll((node) => String(node.type) === "Button").map((node) => node.props.title);
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); Object.assign(f, { section: undefined, bootstrap: {}, ask: null, name: "Parent", outbox: [], reminders: undefined, consent: false, auto: false }); f.push.mockClear(); f.save.mockClear(); f.alert.mockClear(); });
afterEach(() => { act(() => view.unmount()); vi.unstubAllGlobals(); });
const open = async (screen: React.ReactElement = <Settings />) => { await act(async () => { view = create(screen); }); };
it.each([[undefined, false], ["ai", true]])("sends AI deep links to Privacy & data (%s)", async (section, sent) => {
  f.section = section;
  await open();
  const redirects = view.root.findAll((n) => String(n.type) === "Redirect");
  expect(redirects.length).toBe(sent ? 1 : 0);
  if (sent) expect(redirects[0].props.href).toBe("/privacy-data");
});

it("shows who she is at the top, then Help, each opening its own page", async () => {
  await open();
  expect(titles().slice(0, 2)).toEqual(["Parent", "Help"]);
  await act(async () => rows()[0].props.onPress());
  expect(f.push).toHaveBeenLastCalledWith("/profile");
  await act(async () => rows()[1].props.onPress());
  expect(f.push).toHaveBeenLastCalledWith("/help");
  expect(view.root.findAll((n) => String(n.type) === "Field")).toHaveLength(0);
});
it.each([
  ["with family off", {}, /initials/],
  ["with family on", { spaces: [{ id: "p", kind: "personal" }] }, /who logged what/],
])("asks gently for a missing name %s", async (_, bootstrap, why) => {
  f.name = "  "; f.bootstrap = bootstrap;
  await open();
  expect(rows()[0].props.title).toBe("Add your name");
  expect(rows()[0].props.detail).toMatch(why);
  await act(async () => rows()[0].props.onPress());
  expect(f.push).toHaveBeenLastCalledWith("/profile");
});
it.each([
  ["an API without contacts", {}, "Your details"],
  ["a parent", { contacts: {} }, "Your details and numbers"],
  ["a caregiver", { contacts: {}, spaces: [{ id: "p", kind: "personal" }, { id: "f", kind: "family", role: "caregiver" }] }, "Your details"],
])("says what's behind the name for %s", async (_, bootstrap, detail) => {
  f.bootstrap = bootstrap;
  await open();
  expect(rows()[0].props.detail).toBe(detail);
});
it("keeps everything that used to be here within reach", async () => {
  f.reminders = { push: true };
  await open();
  expect(titles()).toEqual(expect.arrayContaining(["Reminders", "Notifications", "Privacy & data", "Add a baby profile"]));
  expect(buttons()).toEqual(["Sign out"]);
  await open(<PrivacyData />);
  expect(titles()).toEqual(["Saved changes & recovery"]);
  expect(buttons()).toEqual(expect.arrayContaining(["Read privacy details", "Export my Baby data", "Delete my Baby data", "Delete my entire Håfa account"]));
});
it("brings waiting changes up to Settings, and only then", async () => {
  await open();
  expect(titles()).not.toContain("Saved changes & recovery");
  f.outbox = [{ id: "1" }];
  await open();
  expect(titles()).toContain("Saved changes & recovery");
});
it("offers Reminders only with the API's flag on", async () => {
  await open();
  expect(titles()).not.toContain("Reminders");
  f.reminders = { push: true };
  await act(async () => { view.update(<Settings />); });
  expect(titles()).toContain("Reminders");
});

it.each([
  ["the flag off", {}, false],
  ["the flag on", { spaces: [{ id: "p", kind: "personal" }] }, true],
  ["this account off the rehearsal's list", { spaces: [{ id: "p", kind: "personal" }], family_available: false }, false],
  ["a family, whatever the list says", { spaces: [{ id: "p", kind: "personal" }, { id: "f", kind: "family", role: "parent" }], family_available: false }, true],
])("offers the Family row rightly with %s", async (_, bootstrap, shown) => {
  f.bootstrap = bootstrap;
  await open();
  expect(titles().includes("Family")).toBe(shown);
});
it.each([
  ["a parent with no baby yet", [{ id: "p", kind: "personal" }, { id: "f", kind: "family", role: "parent" }], [], true],
  ["a caregiver who has nothing to change", [{ id: "p", kind: "personal" }, { id: "f", kind: "family", role: "caregiver" }], [{ id: "b", name: "Noa", space_id: "f" }], false],
  ["a caregiver with a baby of their own", [{ id: "p", kind: "personal" }, { id: "f", kind: "family", role: "caregiver" }], [{ id: "m", name: "Mine", space_id: "p" }], true],
])("Your little ones for %s", async (_, spaces, children, shown) => {
  f.bootstrap = { spaces, children };
  await open();
  expect(view.root.findAll((n) => String(n.type) === "SettingsGroup" && n.props.title === "Your little ones").length).toBe(shown ? 1 : 0);
});
it.each([[null, false], [1, true]])("with the new Ask at version %s, Privacy & data shows its disclosure: %s", async (version, shown) => {
  f.ask = version;
  await open(<PrivacyData />);
  const words = view.root.findAll((n) => (n.type as unknown) === "Copy").map((n) => [n.props.children].flat().join(" ")).join(" ");
  expect(words.includes("NEW ASK WORDS")).toBe(shown);
  expect(words.includes("relevant authorized Baby records")).toBe(!shown);
});
describe("a permission change sends only itself", () => {
  const choose = async (label: RegExp) => act(async () => { view.root.findAll((n) => String(n.type) === "Choice").find((n) => label.test(n.props.label))!.props.onPress(); });
  const allow = async () => act(async () => { f.alert.mock.calls.at(-1)![2].at(-1).onPress(); });
  it("withdrawing", async () => {
    f.consent = true; f.auto = true;
    await open(<PrivacyData />);
    await choose(/^Allow my selected/);
    expect(f.save).toHaveBeenCalledWith({ ai_consent: false, auto_process_shares: false }, 1);
  });
  it("allowing, with the version she read", async () => {
    f.ask = 2;
    await open(<PrivacyData />);
    await choose(/^Allow my selected/);
    await allow();
    expect(f.save).toHaveBeenCalledWith({ ai_consent: true, acknowledge_ai_consent_version: 2 }, 1);
  });
  it.each([[false, true], [true, false]])("automatic posts from %s", async (auto, enabled) => {
    f.consent = true; f.auto = auto;
    await open(<PrivacyData />);
    await choose(/^Automatically organize/);
    if (enabled) await allow();
    expect(f.save).toHaveBeenCalledWith({ auto_process_shares: enabled }, 1);
  });
});
