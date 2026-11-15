import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { birthParts, birthWrite, gramsFrom, welcome } from "./birth";
import { defaultRecipients, newsAvailable, queueNews, readyToSend, recipientWords, sendPending, tellable } from "./family-news";
import { birthExtrasPending, withPendingBirths } from "./outbox";
import { emptyState, type Child, type DeviceState } from "./models";
import type { FamilyMember } from "./family";

const m = vi.hoisted(() => ({ baby: null as any, toast: vi.fn(), back: vi.fn(), params: {} as Record<string, string> }));
vi.mock("react-native", () => ({ View: "View" }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `id-${Math.random().toString(36).slice(2)}` }));
vi.mock("expo-router", () => ({ router: { back: m.back }, useLocalSearchParams: () => m.params }));
vi.mock("@/lib/context", () => ({ useBaby: () => m.baby }));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Chips: "Chips", Choice: "Choice", Copy: "Copy", Field: "Field", Notice: "Notice",
  Screen: "Screen", Section: "Section", tap: vi.fn(), useToast: () => m.toast }));
import Birth from "../app/birth";

const member = (id: string, role: "parent" | "caregiver", name = id, status: FamilyMember["status"] = "active"): FamilyMember =>
  ({ app_user_id: id, role, status, access_version: 1, display_name: name });
const people = [member("kami", "parent", "Kami"), member("leon", "parent", "Leon"), member("nana", "caregiver", "Grandma"), member("old", "parent", "Old", "left")];
const baby = { id: "c", name: "Baby", due_date: "2026-12-10", birth_date: null, details: { sex: "girl" }, revision: 3, space_id: "fam" } as unknown as Child;

describe("the birth's own answers", () => {
  it("are on her profile's clock: 11:40 PM in Guam is that day", () => {
    // 13:40 UTC is 11:40 PM in Guam.
    expect(birthParts("2026-12-08T13:40:00.000Z", "Pacific/Guam", true)).toEqual({ birth_date: "2026-12-08", birth_time: "23:40" });
    expect(birthParts("2026-12-08T14:10:00.000Z", "Pacific/Guam", true)).toEqual({ birth_date: "2026-12-09", birth_time: "00:10" });
    expect(birthParts("2026-12-08T13:40:00.000Z", "Pacific/Guam", false).birth_time).toBeNull();
  });
  it("read pounds and ounces, blank as nothing", () => {
    expect(gramsFrom("", "")).toBeNull();
    expect(gramsFrom("7", "8")).toBe(3402);
    expect(gramsFrom("7", "")).toBe(3175);
    expect(gramsFrom("7", "16")).toBe("invalid");
    expect(gramsFrom("seven", "")).toBe("invalid");
    expect(gramsFrom("40", "")).toBe("invalid");
  });
  it("send only what she gave", () => {
    expect(birthWrite(baby, "Baby", null, null)).toEqual({});
    expect(birthWrite(baby, "  Mia ", "23:40", 3402)).toEqual({ name: "Mia", details: { birth_time: "23:40", weight_at_birth_g: 3402 } });
    expect(welcome("")).toBe("Welcome, little one.");
  });
  it("show on this phone at once and keep going until the API has them", () => {
    const state = { ...emptyState(), bootstrap: { generation: 1, children: [baby] } as unknown as DeviceState["bootstrap"],
      outbox: [{ id: "b", generation: 1, type: "child_birth", child_id: "c", birth_date: "2026-12-08", previous: null, name: "Mia", details: { birth_time: "23:40" } }] } as DeviceState;
    const shown = withPendingBirths(state).bootstrap!.children[0];
    expect(shown).toMatchObject({ name: "Mia", birth_date: "2026-12-08", details: { sex: "girl", birth_time: "23:40" } });
    const mutation = state.outbox[0] as Extract<DeviceState["outbox"][number], { type: "child_birth" }>;
    // The other phone set the same date first: her name and time still go.
    expect(birthExtrasPending({ ...baby, birth_date: "2026-12-08" } as Child, mutation)).toBe(true);
    expect(birthExtrasPending({ ...baby, name: "Mia", details: { birth_time: "23:40" } } as Child, mutation)).toBe(false);
  });
});

describe("family news", () => {
  it("goes to the other parents by default, never her or someone who left", () => {
    expect(tellable(people, "kami").map((p) => p.app_user_id)).toEqual(["leon", "nana"]);
    expect(defaultRecipients(people, "kami")).toEqual(["leon"]);
    expect(recipientWords(people, ["leon"])).toBe("Leon");
    expect(recipientWords(people, ["leon", "nana"])).toBe("Leon and Grandma");
  });
  it("needs the API's word and a family she's a parent in", () => {
    expect(newsAvailable({ reminders: { push: true }, spaces: [{ kind: "family", role: "parent" }] } as never)).toBe(false);
    expect(newsAvailable({ reminders: { family_news: true }, spaces: [{ kind: "family", role: "caregiver" }] } as never)).toBe(false);
    expect(newsAvailable({ reminders: { family_news: true }, spaces: [{ kind: "family", role: "parent" }] } as never)).toBe(true);
    // A parent in another family, but a caregiver in this baby's, can't tell this one.
    const two = { reminders: { family_news: true }, spaces: [{ id: "mine", kind: "family", role: "parent" }, { id: "theirs", kind: "family", role: "caregiver" }] } as never;
    expect(newsAvailable(two, "mine")).toBe(true);
    expect(newsAvailable(two, "theirs")).toBe(false);
  });
  it("waits for the birth date to land, keeps going through no signal, and drops what's refused", async () => {
    const at = new Date().toISOString();
    let state = queueNews(queueNews(emptyState(), { id: "n1", news: "birth", child_id: "c", to: ["leon"], queued_at: at }),
      { id: "n2", news: "labor", child_id: "c", to: ["leon"], queued_at: at });
    expect(queueNews(state, { id: "n3", news: "labor", child_id: "c", to: [], queued_at: at })).toBe(state);
    const commit = async (change: (s: DeviceState) => DeviceState) => { state = change(state); };
    const withBirth = { ...state, outbox: [{ id: "b", type: "child_birth", child_id: "c" }] } as unknown as DeviceState;
    expect(readyToSend(withBirth, state.pendingNews![0])).toBe(false);
    const send = vi.fn(async () => { throw new ApiError("offline", 0, true); });
    await sendPending({ ...state, outbox: withBirth.outbox }, send, commit);
    expect(send).toHaveBeenCalledTimes(1); // Only the labor news was ready, and it waits.
    expect(state.pendingNews).toHaveLength(2);
    const refused = vi.fn(async () => { throw new ApiError("no", 422); });
    await sendPending(state, refused, commit);
    expect(state.pendingNews).toHaveLength(0);
    state = queueNews(state, { id: "old", news: "labor", child_id: "c", to: ["leon"], queued_at: "2026-11-01T00:00:00.000Z" });
    const ok = vi.fn(async () => ({}));
    await sendPending(state, ok, commit);
    expect(ok).not.toHaveBeenCalled();
    expect(state.pendingNews).toHaveLength(0);
  });
});

describe("held, and told with no signal", () => {
  it("waits out the Undo window, then looks up the other parents as it goes", async () => {
    let state = queueNews(emptyState(), { id: "n", news: "labor", child_id: "c", to: [], parents: true, queued_at: new Date().toISOString(),
      hold_until: new Date(Date.now() + 5000).toISOString() });
    const commit = async (change: (s: DeviceState) => DeviceState) => { state = change(state); };
    const send = vi.fn(async () => ({})), parents = vi.fn(async () => ["leon"]);
    await sendPending(state, send, commit, parents);
    expect(send).not.toHaveBeenCalled();
    await sendPending(state, send, commit, parents, Date.now() + 6000);
    expect(send).toHaveBeenCalledWith({ id: "n", news: "labor", child_id: "c", to: ["leon"] });
    expect(state.pendingNews).toEqual([]);
  });
  it("keeps it when the family can't be read yet", async () => {
    let state = queueNews(emptyState(), { id: "n", news: "labor", child_id: "c", to: [], parents: true, queued_at: new Date().toISOString() });
    const commit = async (change: (s: DeviceState) => DeviceState) => { state = change(state); };
    await sendPending(state, vi.fn(), commit, async () => { throw new ApiError("offline", 0, true); });
    expect(state.pendingNews).toHaveLength(1);
  });
});

describe("the screen", () => {
  let renderer: ReactTestRenderer | undefined;
  const all = (type: string) => renderer!.root.findAll((node) => String(node.type) === type);
  function setup() {
    let state = { ...emptyState(), bootstrap: { generation: 4, profile: { timezone: "Pacific/Guam" }, children: [baby],
      reminders: { push: true, family_news: true }, spaces: [{ id: "fam", kind: "family", role: "parent", generation: 1 }] } } as unknown as DeviceState;
    m.baby = { owner: "kami", get state() { return state; }, sync: vi.fn(), api: { familyMembers: vi.fn(async () => ({ items: people })) },
      commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { state = change(state); }) };
  }
  beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); m.toast.mockClear(); m.back.mockClear(); m.params = { id: "c" }; setup(); });
  afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
  const mount = async () => { await act(async () => { renderer = create(<Birth />); }); };
  const save = () => act(async () => { await all("Screen")[0].props.footer.props.onPress(); });

  it("saves the day, time, name and weight in one change, and tells Leon by default", async () => {
    await mount();
    expect(all("Choice").map((c) => [c.props.label, c.props.selected])).toEqual([["Leon", true], ["Grandma", false]]);
    await act(async () => { all("Field")[0].props.onChange("Mia"); all("Field")[1].props.onChange("7"); all("Field")[2].props.onChange("8"); });
    await act(async () => { all("DateField")[0].props.onChange("2026-12-08T13:40:00.000Z"); });
    await save();
    const [change] = m.baby.state.outbox;
    expect(change).toMatchObject({ type: "child_birth", child_id: "c", birth_date: "2026-12-08", previous: null, name: "Mia",
      details: { birth_time: "23:40", weight_at_birth_g: 3402 } });
    expect(m.baby.state.pendingNews).toMatchObject([{ news: "birth", child_id: "c", to: ["leon"] }]);
    expect(m.toast.mock.calls[0][0]).toBe("Welcome, Mia. Telling Leon.");
    expect(m.back).toHaveBeenCalled();
    expect(m.baby.state.pendingNews[0].hold_until).toBeTruthy();
    // Undo before it's sent: nothing happened, name, time and weight included.
    await act(async () => { await m.toast.mock.calls[0][1].onPress(); });
    expect(m.baby.state.outbox).toHaveLength(0);
    expect(m.baby.state.pendingNews).toHaveLength(0);
  });
  it("with no signal, still tells her partner once she's back online", async () => {
    m.baby.api.familyMembers = vi.fn(async () => { throw new ApiError("offline", 0, true); });
    await mount();
    expect(all("Choice").map((c) => [c.props.label, c.props.selected])).toEqual([["Your partner", true]]);
    await save();
    expect(m.baby.state.pendingNews).toMatchObject([{ news: "birth", to: [], parents: true }]);
    expect(m.toast.mock.calls[0][0]).toBe("Welcome, Baby. Telling your partner.");
  });
  it("undoes before it's sent, leaving the profile as it was", async () => {
    await mount();
    await act(async () => { all("Field")[0].props.onChange("Mia"); });
    await save();
    m.baby.state.bootstrap.children = withPendingBirths(m.baby.state).bootstrap!.children;
    await act(async () => { await m.toast.mock.calls[0][1].onPress(); });
    expect(m.baby.state.bootstrap.children[0]).toMatchObject({ name: "Baby", birth_date: null, details: { sex: "girl" } });
    expect(m.baby.state.bootstrap.children[0].details.birth_time).toBeUndefined();
  });
  it("adds Grandma in one tap, or tells no one", async () => {
    await mount();
    await act(async () => { all("Choice")[1].props.onPress(); });
    await act(async () => { all("Choice")[0].props.onPress(); });
    await save();
    expect(m.baby.state.pendingNews[0].to).toEqual(["nana"]);
  });
  it("just the day, with nothing else, still works", async () => {
    await mount();
    await act(async () => { all("Chips")[0].props.onChange("day"); });
    await act(async () => { all("DateField")[0].props.onChange("2026-12-07"); });
    await act(async () => { all("Choice")[0].props.onPress(); });
    await save();
    expect(m.baby.state.outbox[0]).toMatchObject({ birth_date: "2026-12-07" });
    expect(m.baby.state.outbox[0].details).toBeUndefined();
    expect(m.baby.state.pendingNews ?? []).toHaveLength(0);
  });
  it("undoes by going back the same way once the request has begun, because the API may have it", async () => {
    await mount();
    await save();
    m.baby.state.outbox[0].sent = true;
    await act(async () => { await m.toast.mock.calls[0][1].onPress(); });
    expect(m.baby.state.outbox.map((c: any) => [c.birth_date, c.previous])).toEqual([[expect.any(String), null], [null, m.baby.state.outbox[0].birth_date]]);
  });
  it("undoes the name, time and weight too, sent or not", async () => {
    await mount();
    await act(async () => { all("Field")[0].props.onChange("Mia"); all("Field")[1].props.onChange("7"); });
    await save();
    // As the provider shows it while it waits.
    const shown = withPendingBirths(m.baby.state).bootstrap!.children[0];
    expect(shown).toMatchObject({ name: "Mia", details: { birth_time: expect.any(String), weight_at_birth_g: 3175 } });
    m.baby.state.bootstrap.children = [shown];
    m.baby.state.outbox[0].sent = true;
    await act(async () => { await m.toast.mock.calls[0][1].onPress(); });
    expect(m.baby.state.outbox[1]).toMatchObject({ birth_date: null, name: "Baby", details: { birth_time: null, weight_at_birth_g: null } });
  });
  it("starts on the family's day, not the phone's", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-08T14:30:00.000Z")); // Dec 9, 12:30 AM in Guam.
    await mount();
    await act(async () => { all("Chips")[0].props.onChange("day"); });
    await save();
    expect(m.baby.state.outbox[0]).toMatchObject({ birth_date: "2026-12-09" });
    vi.useRealTimers();
  });
  it("says why when this phone can't keep it, and stays open", async () => {
    await mount();
    m.baby.commit = vi.fn(async () => { throw Error("Restore your private device data before saving."); });
    await save();
    expect(all("Notice")[0].props.children).toBe("Restore your private device data before saving.");
    expect(m.back).not.toHaveBeenCalled();
  });
  it("says when the weight can't be read, and saves nothing", async () => {
    await mount();
    await act(async () => { all("Field")[2].props.onChange("17"); });
    await save();
    expect(all("Notice")[0].props.children).toContain("Check the weight");
    expect(m.baby.state.outbox).toHaveLength(0);
  });
});
