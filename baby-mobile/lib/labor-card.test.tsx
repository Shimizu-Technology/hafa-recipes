import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type Child, type DeviceState } from "./models";
import type { FamilyMember } from "./family";

const m = vi.hoisted(() => ({ baby: null as any, toast: vi.fn(), push: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", useWindowDimensions: () => ({ fontScale: 1 }), Linking: { openURL: vi.fn() } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `id-${Math.random().toString(36).slice(2)}` }));
vi.mock("expo-router", () => ({ router: { push: m.push } }));
vi.mock("@/lib/context", () => ({ useBaby: () => m.baby }));
vi.mock("@/components/call-contact", () => ({ CallContact: "CallContact" }));
vi.mock("../components/medical-source", () => ({ MedicalSource: "MedicalSource" }));
vi.mock("../components/ui", () => ({ Button: "Button", Choice: "Choice", Copy: "Copy", QuietRow: "QuietRow", Row: "Row", Section: "Section",
  tap: vi.fn(), useToast: () => m.toast }));
import { LaborCard } from "../components/labor-card";

const member = (id: string, role: "parent" | "caregiver", name: string): FamilyMember => ({ app_user_id: id, role, status: "active", access_version: 1, display_name: name });
const expecting = { id: "c", name: "Baby", due_date: "2026-12-10", birth_date: null, revision: 1, space_id: "fam" } as unknown as Child;
function setup({ family = true, news = true, contacts = {} as Record<string, unknown> } = {}) {
  let state = { ...emptyState(), bootstrap: { generation: 1, profile: { timezone: "Pacific/Guam" }, children: [expecting], contacts,
    reminders: news ? { push: true, family_news: true } : { push: true }, spaces: family ? [{ id: "fam", kind: "family", role: "parent", generation: 1 }] : [] } } as unknown as DeviceState;
  m.baby = { owner: "kami", records: [], get state() { return state; },
    api: { familyMembers: vi.fn(async () => ({ items: [member("kami", "parent", "Kami"), member("leon", "parent", "Leon"), member("nana", "caregiver", "Grandma")] })) },
    commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { state = change(state); }) };
}
let renderer: ReactTestRenderer | undefined;
const all = (type: string) => renderer!.root.findAll((node) => String(node.type) === type);
const button = (title: string) => all("Button").find((node) => node.props.title === title);
const words = () => all("Copy").map((node) => node.props.children).join(" | ");
const mount = (child: Child = expecting, week = 36, running = false) =>
  act(async () => { renderer = create(<LaborCard child={child} today={new Date(2026, 10, 15)} running={running} week={week} />); });
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); m.toast.mockClear(); m.push.mockClear(); setup(); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("tells Leon in one tap, with Undo, and only Leon", async () => {
  await mount();
  await act(async () => { await button("Tell Leon")!.props.onPress(); });
  expect(m.baby.state.pendingNews).toMatchObject([{ news: "labor", child_id: "c", to: ["leon"] }]);
  // Held while Undo is on screen, so Undo really takes it back.
  expect(new Date(m.baby.state.pendingNews[0].hold_until).getTime()).toBeGreaterThan(Date.now());
  // Nothing promised yet: whether Leon's phone shows it is the API's answer, said once it's gone.
  expect(m.toast.mock.calls[0][0]).toBe("Telling Leon.");
  expect(m.baby.state.pendingNews[0].names).toMatchObject({ leon: "Leon", nana: "Grandma" });
  expect(button("Told Leon. Tell again")).toBeTruthy();
  await act(async () => { m.toast.mock.calls[0][1].onPress(); });
  expect(m.baby.state.pendingNews).toEqual([]);
});
it("with no signal, still tells her partner once she's back online", async () => {
  m.baby.api.familyMembers = vi.fn(async () => { throw new Error("offline"); });
  await mount();
  await act(async () => { await button("Tell your partner")!.props.onPress(); });
  expect(m.baby.state.pendingNews).toMatchObject([{ news: "labor", to: [], parents: true }]);
  expect(m.toast.mock.calls[0][0]).toBe("Your partner will be told once you’re back online.");
});
it("doesn't offer it to a caregiver in this family who's a parent somewhere else", async () => {
  setup();
  m.baby.state.bootstrap.spaces = [{ id: "fam", kind: "family", role: "caregiver", generation: 1 }, { id: "other", kind: "family", role: "parent", generation: 1 }];
  await mount();
  expect(all("Button")).toHaveLength(0);
});
it("adds Grandma when she chooses to", async () => {
  await mount();
  await act(async () => { button("Tell someone else too")!.props.onPress(); });
  await act(async () => { all("Choice")[0].props.onPress(); });
  await act(async () => { await button("Tell Grandma")!.props.onPress(); });
  expect(m.baby.state.pendingNews[0].to).toEqual(["nana"]);
  // The partner button still says what it does: it tells Leon, and Leon hasn't been told.
  expect(button("Tell Leon")).toBeTruthy();
  expect(button("Told Grandma. Tell again")).toBeUndefined();
});
it("names 5-1-1 only from 37 weeks, as a source's guidance with her provider first", async () => {
  await mount(expecting, 36);
  expect(words()).not.toContain("5-1-1");
  expect(words()).toContain("Your provider’s instructions come first.");
  await act(async () => renderer!.unmount());
  await mount(expecting, 38);
  expect(words()).toContain("Many hospitals use “5-1-1”");
  expect(all("MedicalSource").map((node) => node.props.source)).toContain("Cleveland Clinic");
  await act(async () => renderer!.unmount());
  await mount(expecting, undefined as unknown as number);
  expect(words()).not.toContain("5-1-1");
});
it("without a family, offers to invite her partner, but not mid-contraction", async () => {
  setup({ family: false });
  await mount();
  expect(button("Tell Leon")).toBeUndefined();
  expect(all("QuietRow").map((node) => node.props.title)).toContain("Invite your partner to tell them from here");
  await act(async () => renderer!.unmount());
  await mount(expecting, 36, true);
  expect(all("QuietRow")).toHaveLength(0);
});
it("has the delivery number and the bag one tap away", async () => {
  setup({ contacts: { delivery: { name: "GMH", phone: "671-555-0103" }, doctor: { name: "Dr. Cruz", phone: "671-555-0101" } } });
  await mount();
  expect(all("CallContact").map((node) => node.props.line.key)).toEqual(["doctor", "delivery"]);
  await act(async () => { all("Row")[0].props.onPress(); });
  expect(m.push).toHaveBeenCalledWith("/hospital-bag");
});
describe("on Leon's phone, where Kami is the one in labor", () => {
  const hers = { ...expecting, created_by: "kami" } as Child;
  beforeEach(() => { m.baby.owner = "leon"; m.baby.state.bootstrap.people = { kami: "Kami", leon: "Leon", nana: "Grandma" }; });
  it("never offers to tell Kami, and lists only the rest of the family", async () => {
    await mount(hers);
    expect(all("Button").map((node) => node.props.title)).toEqual(["Tell your family"]);
    await act(async () => { button("Tell your family")!.props.onPress(); });
    expect(all("Choice").map((node) => node.props.label)).toEqual(["Grandma"]);
    await act(async () => { all("Choice")[0].props.onPress(); });
    await act(async () => { await button("Tell Grandma")!.props.onPress(); });
    expect(m.baby.state.pendingNews[0].to).toEqual(["nana"]);
  });
  it("with just the two of them, there's no one to tell and nothing says there is", async () => {
    m.baby.api.familyMembers = vi.fn(async () => ({ items: [member("kami", "parent", "Kami"), member("leon", "parent", "Leon")] }));
    await mount(hers);
    expect(all("Button")).toHaveLength(0);
    expect(words()).not.toContain("Nothing is sent outside your family");
  });
  it("reads when to call about Kami, by name", async () => {
    await mount(hers, 38);
    expect(words()).toContain("Kami’s provider’s instructions come first.");
    expect(words()).toContain("Call Kami’s doctor or midwife right away");
    expect(words()).not.toContain("you’re in labor");
  });
  it("with no signal, doesn't offer \"Tell your partner\", which would mean Kami", async () => {
    m.baby.api.familyMembers = vi.fn(async () => { throw new Error("offline"); });
    await mount(hers);
    expect(button("Tell your partner")).toBeUndefined();
  });
});
it("says nothing about telling anyone once the baby is born", async () => {
  await mount({ ...expecting, birth_date: "2026-12-08" } as Child);
  expect(all("Button")).toHaveLength(0);
});
