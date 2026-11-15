import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NotBornYet } from "./api";
import { birthParts, birthWrite, gramsFrom, welcome } from "./birth";
import { defaultRecipients, deliveredWords, newsAvailable, partnersFor, queueNews, readyToSend, recipientWords, sendPending, skippedWords, tellable, type FamilyNow } from "./family-news";
import { newsAskFor } from "./news-ask";
import { birthExtrasPending, withPendingBirths } from "./outbox";
import { emptyState, type Child, type DeviceState } from "./models";
import type { FamilyMember } from "./family";

const m = vi.hoisted(() => ({ baby: null as any, toast: vi.fn(), back: vi.fn(), params: {} as Record<string, string>, reader: false }));
vi.mock("react-native", () => ({ View: "View", AccessibilityInfo: { isScreenReaderEnabled: async () => m.reader } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `id-${Math.random().toString(36).slice(2)}` }));
vi.mock("expo-router", () => ({ router: { back: m.back }, useLocalSearchParams: () => m.params }));
vi.mock("@/lib/context", () => ({ useBaby: () => m.baby }));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/time-field", () => ({ TimeField: "TimeField" }));
vi.mock("@/components/expecting-ask", () => ({ ExpectingAsk: "ExpectingAsk" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Choice: "Choice", Copy: "Copy", Field: "Field", Notice: "Notice",
  Screen: "Screen", Section: "Section", tap: vi.fn(), useToast: () => m.toast }));
import Birth from "../app/birth";

const member = (id: string, role: "parent" | "caregiver", name = id, status: FamilyMember["status"] = "active"): FamilyMember =>
  ({ app_user_id: id, role, status, access_version: 1, display_name: name });
const people = [member("kami", "parent", "Kami"), member("leon", "parent", "Leon"), member("nana", "caregiver", "Grandma"), member("old", "parent", "Old", "left")];
const baby = { id: "c", name: "Baby", due_date: "2026-12-10", birth_date: null, revision: 3, space_id: "fam",
  details: { sex: "girl", expecting_member: "kami", expecting_confirmed: true } } as unknown as Child;

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
    expect(defaultRecipients(people, "kami", "kami")).toEqual(["leon"]);
    expect(recipientWords(people, ["leon"])).toBe("Leon");
    expect(recipientWords(people, ["leon", "nana"])).toBe("Leon and Grandma");
  });
  it("lists parents first, and never ticks the person it's about, without hiding her", () => {
    const grandmaFirst = [member("nana", "caregiver", "Grandma"), member("kami", "parent", "Kami"), member("leon", "parent", "Leon"), member("tita", "caregiver", "Tita")];
    expect(tellable(grandmaFirst, "kami").map((p) => p.app_user_id)).toEqual(["leon", "nana", "tita"]);
    // On Leon's phone: Kami is listed (if the profile's creator isn't her, she's one tick away), but not his default.
    expect(tellable(grandmaFirst, "leon").map((p) => p.app_user_id)).toEqual(["kami", "nana", "tita"]);
    expect(defaultRecipients(grandmaFirst, "leon", "kami")).toEqual([]);
    // Her own phone: "about" is her, which changes nothing.
    expect(defaultRecipients(grandmaFirst, "kami", "kami")).toEqual(["leon"]);
  });
  it("says who'll get a notification only when their phone will show it", () => {
    const name = (id: string) => ({ leon: "Leon", nana: "Grandma", tita: "Tita" })[id]!;
    expect(deliveredWords(["leon"], { leon: true }, name)).toBe("Leon will get a notification.");
    expect(deliveredWords(["leon"], { leon: false }, name)).toBe("Leon hasn’t turned on notifications yet, so it’ll be waiting in Håfa Baby.");
    expect(deliveredWords(["leon", "nana", "tita"], { leon: true, nana: false, tita: false }, name))
      .toBe("Leon will get a notification. Grandma and Tita haven’t turned on notifications yet, so it’ll be waiting in Håfa Baby.");
    expect(deliveredWords(["leon", "nana", "tita"], { leon: true, nana: true, tita: true }, name)).toBe("Leon, Grandma and Tita will get a notification.");
    // An API that doesn't say promises nothing.
    expect(deliveredWords(["leon"], undefined, name)).toBe("Sent to Leon.");
    // In Leon's quiet hours, with family news set to wait for them: when it'll come.
    expect(deliveredWords(["leon"], { leon: "after_quiet_hours" }, name, { at: { leon: "2026-12-08T21:00:00Z" }, clock: () => "7:00 AM" }))
      .toBe("Leon will get it at 7:00 AM, after their quiet hours.");
    expect(skippedWords(["nana"], name)).toBe("Grandma is no longer in your family, so the news didn’t go to them.");
  });
  it("hands back what the API said about each person's phone", async () => {
    let state = queueNews(emptyState(), { id: "n", news: "labor", child_id: "c", to: ["leon"], queued_at: new Date().toISOString(), names: { leon: "Leon" } });
    const commit = async (change: (s: DeviceState) => DeviceState) => { state = change(state); };
    const { sent } = await sendPending(state, async () => ({ id: "n", sent_to: ["leon"], push: { leon: false } }), commit);
    expect(sent).toMatchObject([{ item: { id: "n", names: { leon: "Leon" } }, to: ["leon"], push: { leon: false } }]);
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
    // The baby gone from this family: it can't go, and she's told rather than left thinking it went.
    const refused = vi.fn(async () => { throw new ApiError("no", 404); });
    const { dropped } = await sendPending(state, refused, commit);
    expect(state.pendingNews).toHaveLength(0);
    // These were queued without names: it doesn't guess one.
    expect(dropped.map((one) => one.message)).toEqual(["Your news couldn’t be sent to the people you picked. Tell them another way if it can’t wait.",
      "Your news couldn’t be sent to the people you picked. Tell them another way if it can’t wait."]);
    state = queueNews(state, { id: "old", news: "labor", child_id: "c", to: ["leon"], queued_at: "2026-11-01T00:00:00.000Z", names: { leon: "Leon" } });
    const ok = vi.fn(async () => ({}));
    const late = await sendPending(state, ok, commit);
    expect(ok).not.toHaveBeenCalled();
    expect(state.pendingNews).toHaveLength(0);
    expect(late.dropped[0].message).toBe("Your news to Leon couldn’t be sent within a day, so it wasn’t. Tell them another way.");
  });
  it("too many this hour, or the birth not on the API yet: kept, and tried again later", async () => {
    const at = new Date().toISOString(), now = Date.now();
    let state = queueNews(queueNews(emptyState(), { id: "busy", news: "labor", child_id: "c", to: ["leon"], queued_at: at }),
      { id: "early", news: "birth", child_id: "c", to: ["leon"], queued_at: at });
    const commit = async (change: (s: DeviceState) => DeviceState) => { state = change(state); };
    const send = vi.fn(async (body: { id: string }) => { throw body.id === "busy" ? new ApiError("Please wait", 429) : new NotBornYet(); });
    const { sent, dropped } = await sendPending(state, send, commit, undefined, now);
    expect([sent, dropped]).toEqual([[], []]);
    expect(state.pendingNews!.map((one) => [one.id, new Date(one.hold_until!).getTime() - now])).toEqual([["busy", 300_000], ["early", 60_000]]);
    // Not before then.
    await sendPending(state, send, commit, undefined, now + 1000);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("someone who left since she picked them: the rest are told, and she's told who wasn't", async () => {
    let state = queueNews(emptyState(), { id: "n", news: "labor", child_id: "c", to: ["leon", "nana"], queued_at: new Date().toISOString(),
      names: { leon: "Leon", nana: "Grandma" } });
    const commit = async (change: (s: DeviceState) => DeviceState) => { state = change(state); };
    const family = async (): Promise<FamilyNow> => ({ active: ["kami", "leon"], parents: ["leon"], names: { leon: "Leon" } });
    // Today's API refuses the whole message for her: it's read again and sent to Leon alone.
    const send = vi.fn(async (body: { to: string[] }) => {
      if (body.to.includes("nana")) throw new ApiError("Choose people in this family", 422);
      return { sent_to: body.to, push: { leon: true } };
    });
    const { sent } = await sendPending(state, send, commit, family);
    expect(send).toHaveBeenLastCalledWith({ id: "n", news: "labor", child_id: "c", to: ["leon"] });
    expect(sent).toMatchObject([{ to: ["leon"], skipped: ["nana"], push: { leon: true } }]);
    expect(state.pendingNews).toEqual([]);
    // The next API sends to who's still here and names the rest.
    state = queueNews(state, { id: "m", news: "labor", child_id: "c", to: ["leon", "nana"], queued_at: new Date().toISOString() });
    const next = await sendPending(state, async () => ({ sent_to: ["leon"], skipped: ["nana"], push: { leon: true } }), commit, family);
    expect(next.sent).toMatchObject([{ to: ["leon"], skipped: ["nana"] }]);
    // Everyone she picked has left: nothing goes, and she's told.
    state = queueNews(state, { id: "o", news: "labor", child_id: "c", to: ["nana"], queued_at: new Date().toISOString(), names: { nana: "Grandma" } });
    const none = await sendPending(state, async () => ({ sent_to: [], skipped: ["nana"] }), commit, family);
    expect(none.dropped[0].message).toBe("Grandma is no longer in your family, so the news didn’t go to them.");
  });
  it("says so when there's no one else in the family to tell", async () => {
    let state = queueNews(emptyState(), { id: "n", news: "labor", child_id: "c", to: [], parents: true, queued_at: new Date().toISOString() });
    const commit = async (change: (s: DeviceState) => DeviceState) => { state = change(state); };
    const { dropped } = await sendPending(state, vi.fn(), commit, async () => ({ active: ["kami"], parents: [], names: {} }));
    expect(dropped[0].message).toBe("No one else is in your family yet, so no one was told.");
  });
});

describe("asking her partner's phone, once", () => {
  const kids = (expecting_member?: string, birth_date: string | null = null) => [{ ...baby, birth_date, details: { expecting_member, expecting_confirmed: false } }];
  const state = (over: Record<string, unknown> = {}) => ({ ...emptyState(), bootstrap: { generation: 1, children: kids("kami"), people: { kami: "Kami", leon: "Leon" },
    reminders: { push: true, family_news: true }, spaces: [{ id: "fam", kind: "family", role: "parent" }] }, ...over }) as unknown as DeviceState;
  it("names who'll tell them, on Leon's phone before the birth, once the family has said it's Kami", () => {
    const said = state();
    said.bootstrap!.children = [{ ...baby, details: { expecting_member: "kami", expecting_confirmed: true } }];
    expect(newsAskFor(said, "leon")).toEqual({ name: "Kami", reason: "So Kami can tell you the moment labor starts, even with Håfa Baby closed." });
    // A guess isn't enough to name her: "So Leon can tell you…" on Kami's phone must never happen.
    expect(newsAskFor(state(), "leon")).toBeNull();
    const leonGuessed = state();
    leonGuessed.bootstrap!.children = kids("leon");
    expect(newsAskFor(leonGuessed, "kami")).toBeNull();
  });
  it("isn't asked of her, after the birth, twice, or with family news off", () => {
    const said = (over: Record<string, unknown> = {}, birth_date: string | null = null) => {
      const one = state(over);
      one.bootstrap!.children = [{ ...baby, birth_date, details: { expecting_member: "kami", expecting_confirmed: true } }];
      return one;
    };
    expect(newsAskFor(said(), "kami")).toBeNull();
    expect(newsAskFor(said({ newsAskSeen: true }), "leon")).toBeNull();
    expect(newsAskFor(said({}, "2026-12-08"), "leon")).toBeNull();
    expect(newsAskFor(said({ reminderPrefs: { quiet_hours: null, kinds: { family_news: { enabled: false } } } }), "leon")).toBeNull();
    // Nobody has said who's expecting: that's asked on the labor and birth screens first.
    const unknown = state();
    unknown.bootstrap!.children = kids(undefined);
    expect(newsAskFor(unknown, "leon")).toBeNull();
  });
});

describe("held, and told with no signal", () => {
  it("waits out the Undo window, then looks up the other parents as it goes", async () => {
    let state = queueNews(emptyState(), { id: "n", news: "labor", child_id: "c", to: [], parents: true, queued_at: new Date().toISOString(),
      hold_until: new Date(Date.now() + 5000).toISOString() });
    const commit = async (change: (s: DeviceState) => DeviceState) => { state = change(state); };
    const send = vi.fn(async () => ({})), parents = vi.fn(async () => ({ active: ["kami", "leon"], parents: ["leon"], names: { leon: "Leon" } }));
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
  beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); m.toast.mockClear(); m.back.mockClear(); m.params = { id: "c" }; m.reader = false; setup(); });
  afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
  const mount = async () => { await act(async () => { renderer = create(<Birth />); }); };
  const save = () => act(async () => { await all("Screen")[0].props.footer.props.onPress(); });

  it("saves the day, time, name and weight in one change, and tells Leon by default", async () => {
    await mount();
    expect(all("Choice").map((c) => [c.props.label, c.props.selected])).toEqual([["Leon", true], ["Grandma", false]]);
    await act(async () => { all("Field")[0].props.onChange("Mia"); all("Field")[1].props.onChange("7"); all("Field")[2].props.onChange("8"); });
    expect(all("TimeField")[0].props).toMatchObject({ value: null, placeholder: "Add the time of birth" });
    await act(async () => { all("DateField")[0].props.onChange("2026-12-08"); });
    await act(async () => { all("TimeField")[0].props.onChange("23:40"); });
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
  it("keeps the names she saw, so the result can say who'll get a notification", async () => {
    await mount();
    await save();
    expect(m.baby.state.pendingNews[0].names).toEqual({ leon: "Leon", nana: "Grandma" });
  });
  it("on Leon's phone, lists Kami unticked (she gave birth) rather than hiding her", async () => {
    m.baby.owner = "leon";
    m.baby.state.bootstrap.children = [baby];
    await mount();
    expect(all("Choice").map((c) => [c.props.label, c.props.selected])).toEqual([["Kami", false], ["Grandma", false]]);
  });
  it("starts with no time, and sends one only if she chose it", async () => {
    await mount();
    await act(async () => { all("DateField")[0].props.onChange("2026-12-07"); });
    await save();
    expect(m.baby.state.outbox[0]).toMatchObject({ birth_date: "2026-12-07" });
    expect(m.baby.state.outbox[0].details).toBeUndefined();
  });
  it("a time she set can be taken back off", async () => {
    await mount();
    await act(async () => { all("TimeField")[0].props.onChange("04:10"); });
    await act(async () => { all("Button").find((n) => n.props.title === "Remove the time")!.props.onPress(); });
    expect(all("TimeField")[0].props.value).toBeNull();
  });
  it("won't take a time today that hasn't come yet", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-08T00:00:00.000Z")); // 10:00 AM, Dec 8, in Guam.
    await mount();
    await act(async () => { all("TimeField")[0].props.onChange("23:40"); });
    await save();
    expect(all("Notice")[0].props.children).toContain("That time hasn’t come yet today");
    expect(m.baby.state.outbox).toHaveLength(0);
    vi.useRealTimers();
  });
  it("with VoiceOver on, holds the news as long as Undo is really on screen", async () => {
    m.reader = true;
    await mount();
    const before = Date.now();
    await save();
    const hold = new Date(m.baby.state.pendingNews[0].hold_until).getTime() - before, until = m.toast.mock.calls[0][1].until - before;
    expect(hold).toBeGreaterThanOrEqual(20_500);
    expect(hold).toBeLessThan(21_500);
    // Undo goes from the toast before the news leaves the phone, never after.
    expect(until).toBeGreaterThanOrEqual(20_000);
    expect(until).toBeLessThan(hold);
    // Worked out once: the news leaves exactly half a second after Undo goes, however long the save took.
    expect(hold - until).toBe(500);
  });
  it("until the family says who's expecting, asks, and ticks nobody", async () => {
    // Kami added the pregnancy, so the API guessed her, but nobody has said so: on her own phone that's not settled.
    m.baby.state.bootstrap.children = [{ ...baby, details: { expecting_member: "kami", expecting_confirmed: false } }];
    await mount();
    expect(all("ExpectingAsk")).toHaveLength(1);
    expect(all("Choice").map((c) => [c.props.label, c.props.selected])).toEqual([["Leon", false], ["Grandma", false]]);
    // She answers Me (the profile updates): Leon is ticked, as her partner.
    m.baby.state.bootstrap.children = [baby];
    await act(async () => { renderer!.update(<Birth />); });
    expect(all("ExpectingAsk")).toHaveLength(0);
    expect(all("Choice").map((c) => [c.props.label, c.props.selected])).toEqual([["Leon", true], ["Grandma", false]]);
  });
  it("on Leon's phone, an unconfirmed guess of Kami is still a guess: he's asked too, and nobody is ticked", async () => {
    m.baby.owner = "leon";
    m.baby.state.bootstrap.children = [{ ...baby, details: { expecting_member: "kami", expecting_confirmed: false } }];
    await mount();
    expect(all("ExpectingAsk")).toHaveLength(1);
    expect(all("Choice").map((c) => [c.props.label, c.props.selected])).toEqual([["Kami", false], ["Grandma", false]]);
  });
  it("Leon added the pregnancy (the API guessed him): on Kami's phone she's asked, and Leon isn't treated as expecting", async () => {
    m.baby.state.bootstrap.children = [{ ...baby, details: { expecting_member: "leon", expecting_confirmed: false } }];
    await mount();
    expect(all("ExpectingAsk")).toHaveLength(1);
    // Leon listed, not ticked until she says, and not hidden as "the one in labor".
    expect(all("Choice").map((c) => [c.props.label, c.props.selected])).toEqual([["Leon", false], ["Grandma", false]]);
  });
  it("the same, with no signal: \"Your partner\" is offered, and goes to Leon when it's sent", async () => {
    const leonGuessed = { ...baby, details: { expecting_member: "leon", expecting_confirmed: false } } as Child;
    m.baby.state.bootstrap.children = [leonGuessed];
    m.baby.api.familyMembers = vi.fn(async () => { throw new ApiError("offline", 0, true); });
    await mount();
    expect(all("Choice").map((c) => [c.props.label, c.props.selected])).toEqual([["Your partner", true]]);
    await save();
    expect(m.baby.state.pendingNews).toMatchObject([{ news: "birth", parents: true }]);
    // What the runner resolves "your partner" to once it can read the family: Leon, not "No one else is in your family".
    expect(partnersFor(people, "kami", leonGuessed)).toEqual(["leon"]);
  });
  it("lists Leon above Grandma whatever order the family comes in", async () => {
    m.baby.api.familyMembers = vi.fn(async () => ({ items: [people[2], people[0], people[1]] }));
    await mount();
    expect(all("Choice").map((c) => c.props.label)).toEqual(["Leon", "Grandma"]);
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
    await act(async () => { all("Field")[0].props.onChange("Mia"); all("Field")[1].props.onChange("7"); all("DateField")[0].props.onChange("2026-11-14"); all("TimeField")[0].props.onChange("04:10"); });
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
