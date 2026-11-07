import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ push: vi.fn(), ask: vi.fn(async () => undefined), baby: null as any, alerts: [] as { title: string; message?: string; buttons: { text: string; style?: string; onPress?: () => void }[] }[], share: vi.fn(async () => ({})), copy: vi.fn(async () => true), paste: vi.fn(async () => ""), toast: vi.fn(), exportFile: vi.fn(), back: vi.fn() }));
vi.mock("react-native", () => ({ Alert: { alert: (title: string, message: string, buttons: any[]) => f.alerts.push({ title, message, buttons }) }, Share: { share: f.share }, View: "View", Platform: { OS: "ios" } }));
vi.mock("expo-clipboard", () => ({ setStringAsync: f.copy, getStringAsync: f.paste }));
vi.mock("@/lib/context", () => ({ useBaby: () => f.baby }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("expo-router", () => ({ router: { back: f.back, push: f.push } }));
vi.mock("@/lib/share-session-state", () => ({ askForShareSession: f.ask }));
vi.mock("@/lib/files", () => ({ exportFile: f.exportFile }));
vi.mock("@/modules/hafa-baby-share/src", () => ({ nativeSharingAvailable: true, installationId: async () => "this-phone" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Card: "Card", Choice: "Choice", Copy: "Copy", Empty: "Empty", Field: "Field", Grouped: "Grouped", Loading: "Loading", Notice: "Notice", Row: "Row", Screen: "Screen", Section: "Section", useToast: () => f.toast }));
import Family from "../app/family";
import { ApiError, PhonesNotReady } from "./api";
import { emptyState, optimisticRecord } from "./models";
import { disclosureVersion, forgetInvite } from "./family";
import { leftFamilyNotice } from "./outbox";
import { hasJoinLink, holdJoinLink, takeJoinLink } from "./join-link";

const personal = "p", family = "f";
const own = { id: personal, kind: "personal", role: "parent", generation: 1, access_version: 1 }, shared = { id: family, kind: "family", role: "parent", generation: 1, access_version: 1 };
const ready = { ready: true, phones: [], older_client_at: null };
const code = "hfbi_v1.abcdefghijklmnopqrstuvwxyz012345";
const source = (id: string, data = {}) => ({ ...optimisticRecord({ id, kind: "source", title: id, body: "", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data }), revision: 1, space_id: personal, generation: 1 });
function setup(spaces: object[] | null = [own], api: object = {}) {
  f.baby = { owner: "me", online: true, state: { ...emptyState(), bootstrap: { generation: 1, children: [{ id: "c", name: "Mia", revision: 1, space_id: personal }], profile: { display_name: "Me", timezone: "UTC", ai_consent: false }, ai_available: false, personal_space_id: spaces ? personal : undefined, spaces: spaces ?? undefined } }, records: [], refresh: vi.fn(async () => {}), sync: vi.fn(async () => {}), current: () => true, commit: vi.fn(),
    api: { readiness: vi.fn(async () => ready), records: vi.fn(async () => ({ items: [], total: 0, has_more: false })), createInvite: vi.fn(async () => ({ id: "i", code, role: "parent", expires_at: "2026-11-12T00:00:00Z", space_id: family, generation: 1 })),
      save: vi.fn(async (row: object) => row), previewInvite: vi.fn(async () => ({ role: "parent", expires_at: "2026-11-12T00:00:00Z", disclosure: "Shared family entries are available to every parent and to each parent's Ask when AI is enabled.", disclosure_version: 1 })),
      acceptInvite: vi.fn(async () => ({ space_id: family, generation: 1, role: "parent", access_version: 1 })), familyMembers: vi.fn(async () => ({ items: [{ app_user_id: "me", role: "parent", status: "active", access_version: 1, display_name: "Me" }, { app_user_id: "them", role: "parent", status: "active", access_version: 1, display_name: "Them" }] })),
      familyInvites: vi.fn(async () => ({ items: [] })), confirmPhones: vi.fn(async () => ({ confirmed: true })), leaveFamily: vi.fn(async () => ({ left: true })), deleteFamily: vi.fn(async () => ({ deleted: true })), removeMember: vi.fn(async () => ({ removed: true })), revokeInvite: vi.fn(async () => ({ revoked: true })), export: vi.fn(async () => ({})), ...api } };
  return f.baby;
}
let view: ReactTestRenderer | undefined;
const open = async () => { await act(async () => { view = create(<Family />); }); await act(async () => {}); };
const all = (type: string) => view!.root.findAll((n) => String(n.type) === type);
const button = (title: string) => all("Button").find((n) => n.props.title === title);
const press = async (title: string) => { const found = button(title); expect(found, title).toBeDefined(); await act(async () => { await found!.props.onPress(); }); await act(async () => {}); };
const text = () => JSON.stringify(view!.toJSON());
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React); vi.spyOn(console, "error").mockImplementation(() => {}); f.alerts = []; vi.clearAllMocks(); forgetInvite(); });
afterEach(async () => { await act(async () => view?.unmount()); view = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("a name for Logged by", () => {
  it("asks only someone without one, and saves it", async () => {
    const profile = vi.fn(async () => ({})), b = setup([own, shared], { profile });
    b.state.bootstrap.profile.display_name = "";
    await open();
    await act(async () => all("Field").find((n) => n.props.label === "Your name")!.props.onChange("Kami"));
    await press("Save name");
    expect(profile).toHaveBeenCalledWith({ display_name: "Kami" }, 1);
    expect(all("Field").find((n) => n.props.label === "Your name")).toBeUndefined();
  });
  it("doesn't ask someone who has one", async () => {
    setup();
    await open();
    expect(all("Field")).toEqual([]);
  });
});

describe("before there's a family", () => {
  it("says family sharing isn't on yet, with the flag off, and offers nothing", async () => {
    setup(null);
    await open();
    expect(button("Invite someone")).toBeUndefined();
    expect(text()).toMatch(/isn’t open yet/);
  });
  it("says what it's for, and nothing about leaving, to someone who's never been in one", async () => {
    setup();
    await open();
    expect(text()).toMatch(/Share with your family/);
    expect(text()).toMatch(/Log feeds and appointments together, and each keep your own journal\./);
    expect(text()).not.toMatch(/no longer/);
  });
  it("mentions leaving only once it's true", async () => {
    const b = setup();
    b.state.feedNotices = [leftFamilyNotice];
    await open();
    expect(text()).toMatch(/no longer in a family/);
    expect(button("I have a code")).toBeDefined();
  });
  it("hides the way in while the rehearsal's list leaves this account out", async () => {
    const b = setup();
    b.state.bootstrap.family_available = false;
    await open();
    expect(button("Invite someone")).toBeUndefined();
    expect(text()).toMatch(/isn’t open yet/);
  });
  it("keeps someone's own family whatever the list says", async () => {
    const b = setup([own, shared]);
    b.state.bootstrap.family_available = false;
    await open();
    expect(text()).toMatch(/Who’s here/);
  });
  it("offers one choice each way", async () => {
    setup();
    await open();
    expect(button("Invite someone")).toBeDefined();
    expect(button("I have a code")).toBeDefined();
  });
  it("won't create a family if it couldn't read what would be shared, and offers Try again", async () => {
    const records = vi.fn().mockRejectedValueOnce(new ApiError("Offline", 0)).mockResolvedValue({ items: [source("Tip")], total: 1, has_more: false });
    const b = setup([own], { records });
    await open();
    await press("Invite someone");
    expect(button("Share and get a code")).toBeUndefined();
    expect(text()).toMatch(/couldn’t read/i);
    expect(b.api.createInvite).not.toHaveBeenCalled();
    await press("Try again");
    expect(text()).toMatch(/1 saved post/);
    expect(button("Share and get a code")).toBeDefined();
  });
  it("doesn't take a failure part way through the pages as the whole list", async () => {
    const records = vi.fn().mockResolvedValueOnce({ items: [source("First")], total: 2, has_more: true }).mockRejectedValue(new ApiError("Offline", 0));
    setup([own], { records });
    await open();
    await press("Invite someone");
    expect(button("Share and get a code")).toBeUndefined();
  });
  it("says what becomes shared and what stays private before anything happens", async () => {
    const b = setup([own], { records: vi.fn(async () => ({ items: [source("Tip")], total: 1, has_more: false })) });
    await open();
    await press("Invite someone");
    expect(text()).toMatch(/Mia’s profile/);
    expect(text()).toMatch(/1 saved post/);
    expect(text()).toMatch(/journal/i);
    expect(b.api.createInvite).not.toHaveBeenCalled();
  });
  it("creates it once she's agreed, shows the code once and can send it", async () => {
    const b = setup();
    await open();
    await press("Invite someone");
    await press("Share and get a code");
    expect(b.api.createInvite).toHaveBeenCalledWith("parent", true, 1);
    expect(text()).toContain(code);
    expect(b.refresh).toHaveBeenCalled();
    await press("Send the code");
    expect(f.share).toHaveBeenCalledWith({ message: expect.stringContaining(code) });
  });
  it("keeps the code on screen through the remount a new family causes", async () => {
    const b = setup();
    await open();
    await press("Invite someone");
    await press("Share and get a code");
    await act(async () => view!.unmount());
    b.state.bootstrap.spaces = [own, shared];
    await open();
    expect(text()).toContain(code);
    await press("Done");
    expect(text()).not.toContain(code);
  });
  it("names an unprocessed post by its words, so she can tell which one to untick", async () => {
    const row = { ...source("Saved source"), body: "Swaddle tip from the nurse." };
    setup([own], { records: vi.fn(async () => ({ items: [row], total: 1, has_more: false })) });
    await open();
    await press("Invite someone");
    expect(all("Choice").map((n) => n.props.label)).toContain("Swaddle tip from the nurse.");
    expect(all("Choice").map((n) => n.props.label)).not.toContain("Saved source");
  });
  it("saves a post she unticks as Just me first, so it stays behind", async () => {
    const row = source("Private tip"), order: string[] = [];
    const b = setup([own], { records: vi.fn(async () => ({ items: [row], total: 1, has_more: false })), save: vi.fn(async (value: object) => { order.push("save"); return value; }), createInvite: vi.fn(async () => { order.push("create"); return { id: "i", code, role: "parent", expires_at: "2026-11-12T00:00:00Z", space_id: family, generation: 1 }; }) });
    await open();
    await press("Invite someone");
    const choice = all("Choice").find((n) => n.props.label === "Private tip");
    await act(async () => choice!.props.onPress());
    await press("Share and get a code");
    expect(order).toEqual(["save", "create"]);
    expect(b.api.save.mock.calls[0][0]).toMatchObject({ id: "Private tip", data: { just_me: true } });
  });
});

describe("the update gate", () => {
  const behind = { ready: false, phones: [{ id: "old", state: "outdated", last_seen: "2026-10-30T00:00:00Z", this_phone: false }], older_client_at: null };
  it("won't start while another phone needs the update, and says which", async () => {
    const b = setup([own], { readiness: vi.fn(async () => behind) });
    await open();
    await press("Invite someone");
    expect(button("Share and get a code")).toBeUndefined();
    expect(text()).toMatch(/Check your phones first/);
    expect(text()).toMatch(/needs the update/i);
    expect(text()).toMatch(/Update that phone, or tell us it’s gone\./);
    // No older client was seen here, only a phone that hasn't updated, so it doesn't claim one was.
    expect(text()).not.toMatch(/in the last 14 days/);
    expect(b.api.createInvite).not.toHaveBeenCalled();
  });
  it("treats not knowing as not ready", async () => {
    setup([own], { readiness: vi.fn(async () => { throw new ApiError("Offline", 0); }) });
    await open();
    await press("Invite someone");
    expect(button("Share and get a code")).toBeUndefined();
    expect(text()).toMatch(/connect/i);
  });
  it("checks again when asked", async () => {
    const readiness = vi.fn().mockResolvedValueOnce(behind).mockResolvedValue(ready);
    setup([own], { readiness });
    await open();
    await press("Invite someone");
    await press("Check again");
    expect(button("Share and get a code")).toBeDefined();
    expect(f.ask).toHaveBeenCalledTimes(2);
  });
  it("lets her say that phone is updated or gone, after a warning", async () => {
    const readiness = vi.fn().mockResolvedValueOnce(behind).mockResolvedValue(ready);
    const b = setup([own], { readiness });
    await open();
    await press("Invite someone");
    await press("That phone is updated or gone");
    expect(b.api.confirmPhones).not.toHaveBeenCalled();
    await act(async () => { await f.alerts.at(-1)!.buttons.find((x) => x.text === "Yes, it’s updated or gone")!.onPress!(); });
    expect(b.api.confirmPhones).toHaveBeenCalledWith("this-phone");
    expect(button("Share and get a code")).toBeDefined();
  });
  it("says invites aren't open yet if her answer comes back 404, not that an item is gone", async () => {
    setup([own], { readiness: vi.fn(async () => behind), confirmPhones: vi.fn(async () => { throw new ApiError("x", 404); }) });
    await open();
    await press("Invite someone");
    await press("That phone is updated or gone");
    await act(async () => { await f.alerts.at(-1)!.buttons.find((x) => x.text === "Yes, it’s updated or gone")!.onPress!(); });
    await act(async () => {});
    expect(text()).toMatch(/aren’t open yet/);
    expect(text()).not.toMatch(/no longer available/);
  });
  it("says when an older version was used, with no phone to name, and asks the same way", async () => {
    setup([own], { readiness: vi.fn(async () => ({ ready: false, phones: [], older_client_at: "2026-11-01T00:00:00Z" })) });
    await open();
    await press("Invite someone");
    expect(text()).toMatch(/Check your phones first/);
    expect(text()).toMatch(/This account was used on an older version of Håfa Baby in the last 14 days\. Update that phone, or tell us it’s gone\./);
    expect(button("That phone is updated or gone")).toBeDefined();
    expect(button("Share and get a code")).toBeUndefined();
  });
  it("gets a fresh credential before asking, so this phone can answer for itself", async () => {
    setup();
    await open();
    await press("Invite someone");
    expect(f.ask).toHaveBeenCalled();
  });
  it("waits for this phone's answer before reading the check, so it doesn't report itself as still connecting", async () => {
    let answer = () => {};
    f.ask.mockImplementationOnce(() => new Promise<undefined>((done) => { answer = () => done(undefined); }));
    const b = setup();
    await open();
    await act(async () => { void press("Invite someone"); });
    expect(b.api.readiness).not.toHaveBeenCalled();
    await act(async () => { answer(); });
    await act(async () => {});
    expect(b.api.readiness).toHaveBeenCalled();
  });
  it("trying again after a lost connection checks the phones too, not just the list", async () => {
    const readiness = vi.fn().mockRejectedValueOnce(new ApiError("Offline", 0)).mockResolvedValue(ready),
      records = vi.fn().mockRejectedValueOnce(new ApiError("Offline", 0)).mockResolvedValue({ items: [], total: 0, has_more: false });
    setup([own], { readiness, records });
    await open();
    await press("Invite someone");
    expect(text()).toMatch(/Connect to check your phones/);
    await press("Try again");
    expect(text()).not.toMatch(/Connect to check your phones/);
    expect(button("Share and get a code")).toBeDefined();
  });
  it("shows the API's answer if a phone appears between the check and the tap", async () => {
    setup([own], { createInvite: vi.fn(async () => { throw new PhonesNotReady(behind as never); }) });
    await open();
    await press("Invite someone");
    await press("Share and get a code");
    expect(text()).toMatch(/needs the update/i);
    expect(button("Share and get a code")).toBeUndefined();
  });
});

describe("a personal baby in a family", () => {
  const withOwn = (api: object = {}) => {
    const b = setup([own, shared], api);
    b.state.bootstrap.children = [{ id: "fam", name: "Mia", revision: 1, space_id: family }, { id: "mine", name: "Mia", revision: 1, space_id: personal }];
    return b;
  };
  it("says plainly what it means, and deletes nothing", async () => {
    const b = withOwn();
    await open();
    expect(text()).toMatch(/your own profile/i);
    expect(text()).toMatch(/Mia · Personal/);
    expect(b.api.deleteChild).toBeUndefined();
    await press("Keep it separate");
    expect(b.commit).toHaveBeenCalled();
    expect(b.commit.mock.calls[0][0](b.state).personalBabiesKept).toEqual(["mine"]);
  });
  it("opens the profile if she'd rather remove it herself", async () => {
    withOwn();
    await open();
    await press("Open its profile");
    expect(f.push).toHaveBeenCalledWith({ pathname: "/child", params: { id: "mine" } });
  });
  it("doesn't ask again once she's kept it", async () => {
    const b = withOwn();
    b.state.personalBabiesKept = ["mine"];
    await open();
    expect(button("Keep it separate")).toBeUndefined();
  });
  it("has nothing to say with only the family's baby", async () => {
    const b = setup([own, shared]);
    b.state.bootstrap.children = [{ id: "fam", name: "Mia", revision: 1, space_id: family }];
    await open();
    expect(button("Keep it separate")).toBeUndefined();
  });
});

describe("joining with a code", () => {
  it("says who invited them, above what joining shares, and answers with the current version", async () => {
    const preview = { role: "parent", expires_at: "2026-11-12T00:00:00Z", disclosure_version: 2, invitation: "Kami invited you to their family.", disclosure: "Your own journal and anything marked Just me stay private." };
    setup([own], { previewInvite: vi.fn(async () => preview) });
    await open();
    await press("I have a code");
    await act(async () => all("Field")[0].props.onChange(code));
    await press("Check the code");
    const said = all("Copy").map((n) => n.props.children);
    expect(said.indexOf(preview.invitation)).toBeGreaterThanOrEqual(0);
    expect(said.indexOf(preview.invitation)).toBeLessThan(said.indexOf(preview.disclosure));
    expect(disclosureVersion).toBe(2);
  });
  it("takes a pasted message, shows what it means, and joins only on the second tap", async () => {
    const b = setup();
    f.paste.mockResolvedValue(`Join us: ${code}`);
    await open();
    await press("I have a code");
    await press("Paste");
    expect(b.api.acceptInvite).not.toHaveBeenCalled();
    expect(b.api.previewInvite).toHaveBeenCalledWith(code);
    expect(text()).toMatch(/every parent/);
    await press("Join this family");
    expect(b.api.acceptInvite).toHaveBeenCalledWith(code, 1);
    expect(b.refresh).toHaveBeenCalled();
  });
  it("says something that isn't a code isn't one, without asking the API", async () => {
    const b = setup();
    f.paste.mockResolvedValue("the grocery list");
    await open();
    await press("I have a code");
    await press("Paste");
    expect(b.api.previewInvite).not.toHaveBeenCalled();
    expect(text()).toMatch(/doesn’t look like/);
    expect(text()).not.toMatch(/expired/);
  });
  it.each([[409, /expired or been used/], [404, /aren’t open yet/], [422, /doesn’t look like/]])("explains a %i", async (status, message) => {
    setup([own], { previewInvite: vi.fn(async () => { throw new ApiError("x", status as number); }) });
    await open();
    await press("I have a code");
    await act(async () => all("Field")[0].props.onChange(code));
    await press("Check the code");
    expect(text()).toMatch(message);
  });
});

describe("opened from a family link", () => {
  const preview = { role: "parent", expires_at: "2026-11-12T00:00:00Z", disclosure_version: 2, invitation: "Kami invited you to their family.", disclosure: "Your own journal stays yours." };
  afterEach(() => { takeJoinLink(); });
  const failing = (status: number) => vi.fn(async () => { throw new ApiError("no", status); });
  it("fills the code in and checks it, and still joins only on a tap", async () => {
    const b = setup([own], { previewInvite: vi.fn(async () => preview) });
    holdJoinLink(code);
    await open();
    expect(b.api.previewInvite).toHaveBeenCalledWith(code);
    expect(text()).toContain(preview.invitation);
    expect(b.api.acceptInvite).not.toHaveBeenCalled();
    await press("Join this family");
    expect(b.api.acceptInvite).toHaveBeenCalledWith(code, 1);
  });
  it("uses the code once, so a later visit to Family is ordinary", async () => {
    setup([own], { previewInvite: vi.fn(async () => preview) });
    holdJoinLink(code);
    await open();
    expect(hasJoinLink()).toBe(false);
    await act(async () => view!.unmount());
    await open();
    expect(button("I have a code")).toBeDefined();
  });
  it("leaves the code in the entry when it can't be checked, so they can try again", async () => {
    setup([own], { previewInvite: vi.fn(async () => { throw new ApiError("Connect and try again.", 0, true); }) });
    holdJoinLink(code);
    await open();
    expect(all("Field").find((n) => n.props.label === "Code")!.props.value).toBe(code);
    expect(button("Check the code")).toBeDefined();
  });
  it("says plainly when a used or expired code comes back", async () => {
    setup([own], { previewInvite: failing(409) });
    holdJoinLink(code);
    await open();
    expect(text()).toMatch(/expired or been used/);
    expect(button("Join this family")).toBeUndefined();
  });
  it("says plainly when invites aren't open for this account", async () => {
    setup([own], { previewInvite: failing(404) });
    holdJoinLink(code);
    await open();
    expect(text()).toMatch(/aren’t open yet/);
  });
  it("says plainly when the link has no real code in it, and doesn't ask the API", async () => {
    const b = setup();
    holdJoinLink("");
    await open();
    expect(b.api.previewInvite).not.toHaveBeenCalled();
    expect(text()).toMatch(/doesn’t have a working family code/);
    expect(all("Field").find((n) => n.props.label === "Code")!.props.value).toBe("");
  });
  it("still lets them paste a code after a bad link", async () => {
    const b = setup([own], { previewInvite: vi.fn(async () => preview) });
    holdJoinLink("");
    await open();
    await act(async () => all("Field").find((n) => n.props.label === "Code")!.props.onChange(code));
    await press("Check the code");
    expect(b.api.previewInvite).toHaveBeenCalledWith(code);
  });
  it("says plainly that the invitation wasn't used with the family flag off, and forgets it", async () => {
    const b = setup(null);
    holdJoinLink(code);
    await open();
    expect(text()).toMatch(/invitation wasn’t used/);
    expect(hasJoinLink()).toBe(false);
    expect(b.api.previewInvite).not.toHaveBeenCalled();
  });
  it("says the same when the rehearsal's family_available: false hides the Family row", async () => {
    const b = setup([own]);
    b.state.bootstrap.family_available = false;
    holdJoinLink(code);
    await open();
    expect(text()).toMatch(/invitation wasn’t used/);
    expect(b.api.previewInvite).not.toHaveBeenCalled();
  });
  it("says so to someone already in a family, and doesn't try the code", async () => {
    const b = setup([own, shared]);
    holdJoinLink(code);
    await open();
    expect(text()).toMatch(/already in a family/);
    expect(text()).not.toContain(code);
    expect(b.api.previewInvite).not.toHaveBeenCalled();
    expect(b.api.acceptInvite).not.toHaveBeenCalled();
  });
  it("doesn't say any of that without a link", async () => {
    setup([own, shared]);
    await open();
    expect(text()).not.toMatch(/already in a family/);
    await act(async () => view!.unmount());
    setup(null);
    await open();
    expect(text()).not.toMatch(/invitation/);
  });
});

describe("in a family", () => {
  const inFamily = (api: object = {}) => setup([own, shared], api);
  it("keeps polling the new family and ignores a late old-family response", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const me = { app_user_id: "me", role: "parent", status: "active", access_version: 1, display_name: "Me" }, c = { ...me, app_user_id: "c", display_name: "C" };
      let oldReply!: (value: { items: typeof me[] }) => void, left = false;
      const familyMembers = vi.fn((id: string) => id === family
        ? new Promise<{ items: typeof me[] }>((resolve) => { oldReply = resolve; })
        : Promise.resolve({ items: left ? [me] : [me, c] }));
      const b = inFamily({ familyMembers });
      await open();
      b.state.bootstrap.spaces = [own, { ...shared, id: "second" }];
      await act(async () => { view!.update(<Family />); });
      expect(button("Remove C")).toBeDefined();
      await act(async () => { oldReply({ items: [me] }); });
      expect(button("Remove C")).toBeDefined();
      expect(button("Delete this family")).toBeUndefined();
      left = true;
      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(familyMembers).toHaveBeenLastCalledWith("second");
      expect(button("Remove C")).toBeUndefined();
      expect(button("Leave this family")).toBeUndefined();
      expect(button("Delete this family")).toBeDefined();
    } finally { vi.useRealTimers(); }
  });
  it("accepts member reads after StrictMode replays the effect", async () => {
    inFamily({ familyMembers: vi.fn(async () => ({ items: [{ app_user_id: "me", role: "parent", status: "active", access_version: 1, display_name: "Me" }] })) });
    await act(async () => { view = create(<React.StrictMode><Family /></React.StrictMode>); });
    expect(button("Delete this family")).toBeDefined();
  });

  it("lists who's in it and offers another invite", async () => {
    inFamily();
    await open();
    expect(text()).toMatch(/Them/);
    expect(button("Invite someone")).toBeDefined();
    expect(button("I have a code")).toBeUndefined();
  });
  it("won't remove you from your own list, and asks before removing someone", async () => {
    const b = inFamily();
    await open();
    expect(all("Row").filter((n) => n.props.title === "Me")[0].props.onPress).toBeDefined();
    await press("Remove Them");
    expect(b.api.removeMember).not.toHaveBeenCalled();
    await act(async () => { await f.alerts.at(-1)!.buttons.find((x) => x.style === "destructive")!.onPress!(); });
    expect(b.api.removeMember).toHaveBeenCalledWith(family, "them", { generation: 1, space_id: family });
    expect(button("Remove Me")).toBeUndefined();
  });
  it("leaves after saying what happens, including to a phone that's offline", async () => {
    const b = inFamily();
    await open();
    await press("Leave this family");
    expect(f.alerts.at(-1)!.message).toMatch(/offline/i);
    await act(async () => { await f.alerts.at(-1)!.buttons.find((x) => x.style === "destructive")!.onPress!(); });
    expect(b.api.leaveFamily).toHaveBeenCalledWith(family, { generation: 1, space_id: family });
    expect(b.refresh).toHaveBeenCalled();
  });
  it("says what removing a parent costs them, and doesn't say it about a caregiver", async () => {
    inFamily({ familyMembers: vi.fn(async () => ({ items: [
      { app_user_id: "me", role: "parent", status: "active", access_version: 1, display_name: "Me" },
      { app_user_id: "them", role: "parent", status: "active", access_version: 1, display_name: "Them" },
      { app_user_id: "helper", role: "caregiver", status: "active", access_version: 1, display_name: "Helper" }] })) });
    await open();
    await press("Remove Them");
    expect(f.alerts.at(-1)!.message).toMatch(/They’re a parent here.*only an invite from a parent here brings them back/);
    expect(f.alerts.at(-1)!.message).toMatch(/Ask chats that used family entries are deleted.*reminders.*personal journal.*Codes nobody has used yet stop working/);
    await press("Remove Helper");
    expect(f.alerts.at(-1)!.message).not.toMatch(/parent here/);
    expect(f.alerts.at(-1)!.message).toMatch(/Codes nobody has used yet stop working/);
  });
  it("doesn't let an older read bring back someone just removed", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const me = { app_user_id: "me", role: "parent", status: "active", access_version: 1, display_name: "Me" },
        them = { ...me, app_user_id: "them", display_name: "Them" };
      let finishOld = (_: object) => {};
      const familyMembers = vi.fn().mockResolvedValueOnce({ items: [me, them] })
        .mockImplementationOnce(() => new Promise((done) => { finishOld = done; })).mockResolvedValue({ items: [me] });
      const b = inFamily({ familyMembers });
      await open();
      await act(async () => { vi.advanceTimersByTime(30_000); });
      await press("Remove Them");
      await act(async () => { await f.alerts.at(-1)!.buttons.find((x) => x.style === "destructive")!.onPress!(); });
      expect(b.api.removeMember).toHaveBeenCalled();
      expect(button("Remove Them")).toBeUndefined();
      await act(async () => { finishOld({ items: [me, them] }); });
      await act(async () => {});
      expect(button("Remove Them")).toBeUndefined();
      expect(button("Delete this family")).toBeDefined();
    } finally { vi.useRealTimers(); }
  });
  it("says something changed when the API refuses a leave, remove or delete, and rereads the account and the list", async () => {
    const lastParent = { items: [{ app_user_id: "me", role: "parent", status: "active", access_version: 1, display_name: "Me" }] },
      both = { items: [...lastParent.items, { app_user_id: "them", role: "parent", status: "active", access_version: 1, display_name: "Them" }] },
      familyMembers = vi.fn().mockResolvedValueOnce(lastParent).mockResolvedValue(both);
    inFamily({ familyMembers, deleteFamily: vi.fn(async () => { throw new ApiError("Only the last parent can delete the family", 409); }) });
    await open();
    await press("Delete this family");
    await act(async () => { await f.alerts.at(-1)!.buttons.find((x) => x.style === "destructive")!.onPress!(); });
    await act(async () => {});
    expect(text()).toMatch(/Something here just changed/);
    expect(text()).not.toMatch(/expired or been used/);
    expect(f.baby.refresh).toHaveBeenCalled();
    expect(button("Delete this family")).toBeUndefined();
    expect(button("Leave this family")).toBeDefined();
  });
  it("notices someone joining while the screen stays open, without an error if that check fails", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const lastParent = { items: [{ app_user_id: "me", role: "parent", status: "active", access_version: 1, display_name: "Me" }] },
        both = { items: [...lastParent.items, { app_user_id: "them", role: "parent", status: "active", access_version: 1, display_name: "Them" }] },
        familyMembers = vi.fn().mockResolvedValueOnce(lastParent).mockRejectedValueOnce(new ApiError("Offline", 0)).mockResolvedValue(both);
      inFamily({ familyMembers });
      await open();
      expect(button("Delete this family")).toBeDefined();
      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(text()).not.toMatch(/Offline/);
      expect(button("Delete this family")).toBeDefined();
      await act(async () => { vi.advanceTimersByTime(30_000); });
      await act(async () => {});
      expect(button("Delete this family")).toBeUndefined();
      expect(button("Leave this family")).toBeDefined();
    } finally { vi.useRealTimers(); }
  });
  it("offers the last parent Delete family with an export, not Leave", async () => {
    const b = inFamily({ familyMembers: vi.fn(async () => ({ items: [{ app_user_id: "me", role: "parent", status: "active", access_version: 1, display_name: "Me" }] })) });
    await open();
    expect(button("Leave this family")).toBeUndefined();
    await press("Export my Baby data");
    expect(f.exportFile).toHaveBeenCalled();
    await press("Delete this family");
    await act(async () => { await f.alerts.at(-1)!.buttons.find((x) => x.style === "destructive")!.onPress!(); });
    expect(b.api.deleteFamily).toHaveBeenCalledWith(family, { generation: 1, space_id: family });
  });
  it("never calls someone the last parent because the list didn't load", async () => {
    const familyMembers = vi.fn().mockRejectedValueOnce(new ApiError("Offline", 0)).mockResolvedValue({ items: [{ app_user_id: "me", role: "parent", status: "active", access_version: 1, display_name: "Me" }, { app_user_id: "them", role: "parent", status: "active", access_version: 1, display_name: "Them" }] });
    inFamily({ familyMembers });
    await open();
    expect(button("Delete this family")).toBeUndefined();
    expect(button("Leave this family")).toBeUndefined();
    expect(button("Invite someone")).toBeUndefined();
    await press("Try again");
    expect(button("Leave this family")).toBeDefined();
    expect(button("Try again")).toBeUndefined();
  });
  it("shows no parent actions on a list it couldn't refresh after removing someone", async () => {
    const both = { items: [{ app_user_id: "me", role: "parent", status: "active", access_version: 1, display_name: "Me" }, { app_user_id: "them", role: "parent", status: "active", access_version: 1, display_name: "Them" }] };
    const familyMembers = vi.fn().mockResolvedValueOnce(both).mockRejectedValueOnce(new ApiError("Offline", 0)).mockResolvedValue({ items: [both.items[0]] });
    inFamily({ familyMembers });
    await open();
    await press("Remove Them");
    await act(async () => { await f.alerts.at(-1)!.buttons.find((x) => x.style === "destructive")!.onPress!(); });
    await act(async () => {});
    for (const title of ["Leave this family", "Remove Them", "Delete this family", "Invite someone"]) expect(button(title), title).toBeUndefined();
    expect(text()).not.toMatch(/Them/);
    await press("Try again");
    expect(button("Leave this family")).toBeUndefined();
    expect(button("Delete this family")).toBeDefined();
  });
  it("counts a parent who has left as gone", async () => {
    inFamily({ familyMembers: vi.fn(async () => ({ items: [{ app_user_id: "me", role: "parent", status: "active", access_version: 1, display_name: "Me" }, { app_user_id: "them", role: "parent", status: "left", access_version: 2, display_name: "Them" }] })) });
    await open();
    expect(button("Delete this family")).toBeDefined();
    expect(text()).not.toMatch(/Remove Them/);
  });
});

describe("as a caregiver", () => {
  const helper = () => setup([own, { ...shared, role: "caregiver" }], { familyMembers: vi.fn(async () => { throw new ApiError("Parents only", 403); }), familyInvites: vi.fn(async () => { throw new ApiError("Parents only", 403); }) });
  it("says what it means, with no invites or members, and can still leave", async () => {
    const b = helper();
    await open();
    expect(b.api.familyMembers).not.toHaveBeenCalled();
    expect(button("Invite someone")).toBeUndefined();
    expect(button("Delete this family")).toBeUndefined();
    expect(text()).toMatch(/caregiver/i);
    expect(button("Leave this family")).toBeDefined();
  });
  it("tells her before she joins that Ask goes and her chats stay", async () => {
    setup([own], { previewInvite: vi.fn(async () => ({ role: "caregiver", expires_at: "2026-11-12T00:00:00Z", disclosure: "Caregivers log care." })) });
    await open();
    await press("I have a code");
    await act(async () => all("Field").find((n) => n.props.label === "Code")!.props.onChange(code));
    await press("Check the code");
    expect(text()).toMatch(/Ask isn’t part of helping/);
  });
  it("says Ask is off while helping, and that her own chats are kept", async () => {
    helper();
    await open();
    expect(text()).not.toMatch(/Ask doesn’t use/);
    expect(text()).toMatch(/Ask isn’t part of helping/);
    expect(text()).toMatch(/your own chats are kept/i);
  });
});
describe("joining with an older phone on the account", () => {
  const stuck = { ready: false, phones: [], older_client_at: "2026-11-01T00:00:00Z" };
  const toPreview = async () => { await open(); await press("I have a code"); await act(async () => all("Field").find((n) => n.props.label === "Code")!.props.onChange(code)); await press("Check the code"); };
  it("shows the same check as creating a family, and no way to join until it's answered", async () => {
    const b = setup([own], { readiness: vi.fn(async () => stuck) });
    await toPreview();
    expect(text()).toMatch(/older version of Håfa Baby in the last 14 days/);
    expect(button("Join this family")).toBeUndefined();
    expect(button("That phone is updated or gone")).toBeDefined();
    expect(b.api.acceptInvite).not.toHaveBeenCalled();
  });
  it("doesn't talk about her baby's profile moving, since joining moves nothing", async () => {
    setup([own], { readiness: vi.fn(async () => stuck) });
    await toPreview();
    expect(text()).not.toMatch(/profile moves/);
  });
  it("lets her answer it, then join", async () => {
    const readiness = vi.fn(async () => stuck), b = setup([own], { readiness });
    await toPreview();
    readiness.mockResolvedValue({ ready: true, phones: [], older_client_at: null } as never);
    await press("That phone is updated or gone");
    await act(async () => { await f.alerts.at(-1)!.buttons.find((x) => x.text === "Yes, it’s updated or gone")!.onPress!(); });
    await act(async () => {});
    expect(b.api.confirmPhones).toHaveBeenCalled();
    await press("Join this family");
    expect(b.api.acceptInvite).toHaveBeenCalled();
  });
  it("won't join if it couldn't check, and offers to try again", async () => {
    setup([own], { readiness: vi.fn(async () => { throw new ApiError("x", 0); }) });
    await toPreview();
    expect(button("Join this family")).toBeUndefined();
    expect(button("Check again")).toBeDefined();
  });
  it("shows the same thing if the API refuses the join itself", async () => {
    const accept = vi.fn(async () => { throw new PhonesNotReady(stuck as never); });
    setup([own], { acceptInvite: accept });
    await toPreview();
    await press("Join this family");
    expect(text()).toMatch(/older version of Håfa Baby in the last 14 days/);
    expect(text()).not.toMatch(/expired or been used/);
    expect(button("Join this family")).toBeUndefined();
  });
});
describe("choosing who they'll be", () => {
  it("invites a parent unless she says caregiver, and says what a caregiver can't do", async () => {
    const b = setup();
    await open();
    await press("Invite someone");
    const caregiver = all("Choice").find((n) => n.props.label === "Caregiver");
    expect(caregiver!.props.detail).toMatch(/can’t see/i);
    expect(caregiver!.props.detail).toMatch(/can’t use Ask/i);
    await act(async () => caregiver!.props.onPress());
    await press("Share and get a code");
    expect(b.api.createInvite).toHaveBeenCalledWith("caregiver", true, 1);
  });
  it("offers the same for a later invite", async () => {
    const b = setup([own, shared]);
    await open();
    await act(async () => all("Choice").find((n) => n.props.label === "Caregiver")!.props.onPress());
    await press("Invite someone");
    expect(b.api.createInvite).toHaveBeenCalledWith("caregiver", false, { generation: 1, space_id: family });
  });
});
