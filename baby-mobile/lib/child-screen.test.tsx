import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Child } from "./models";

const f = vi.hoisted(() => ({
  params: {} as { id?: string; stage?: string },
  back: vi.fn(), toast: vi.fn(), child: vi.fn(), request: vi.fn(), refresh: vi.fn(async () => {}), alert: vi.fn(),
  children: [] as unknown[],
  generation: 3, commits: 0,
  drafts: undefined as Record<string, unknown> | undefined,
}));
vi.mock("react-native", () => ({ Alert: { alert: f.alert }, View: "View", useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("expo-router", () => ({ router: { back: f.back }, useLocalSearchParams: () => f.params }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "new-id" }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({
  state: { bootstrap: { generation: f.generation, profile: { timezone: "Pacific/Guam" }, children: f.children }, childDrafts: f.drafts },
  records: [], refresh: f.refresh,
  commit: async (update: (s: any) => any) => { f.commits++; f.drafts = update({ bootstrap: { generation: f.generation, children: f.children }, childDrafts: f.drafts }).childDrafts; },
  api: { child: f.child, request: f.request, deleteChild: async () => undefined },
}) }));
vi.mock("@/components/ui", () => ({
  Button: "Button", Chips: "Chips", Copy: "Copy", Field: "Field", Notice: "Notice", Screen: "Screen", useToast: () => f.toast,
}));
vi.mock("@/components/date-field", () => ({ DateField: "DateField" }));
vi.mock("@/components/stage-options", () => ({ StageOptions: "StageOptions" }));
vi.mock("@/components/disclosure", () => ({ Disclosure: (props: { startOpen?: boolean; children: React.ReactNode }) => props.startOpen ? props.children : null }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/api", () => import("./api"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/child-setup", () => import("./child-setup"));
import ChildEditor from "../app/child";
import { ApiError } from "./api";

let view: ReactTestRenderer;
const open = async () => { await act(async () => { view = create(<ChildEditor />); }); };
const button = (title: string) => view.root.findAll((n) => (n.type as unknown) === "Button" && n.props.title === title);
const field = (label: string) => view.root.find((n) => (n.type as unknown) === "Field" && n.props.label === label);
const stages = () => view.root.find((n) => (n.type as unknown) === "StageOptions").props;
const choose = (stage: string) => act(async () => stages().onChoose(stage));
const type = (label: string, text: string) => act(async () => field(label).props.onChange(text));
const save = () => act(async () => { button("Save profile")[0].props.onPress(); for (let n = 0; n < 40; n++) await Promise.resolve(); });
const shown = (type: string) => view.root.findAll((n) => (n.type as unknown) === type).map((n) => n.props.children);
const saved = (extra: Partial<Child> = {}): Child => ({ id: "kid", name: "Mia", revision: 4, ...extra });

beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ now: new Date("2026-11-05T00:00:00Z"), toFake: ["Date"] });
  f.params = {}; f.children = []; f.drafts = undefined; f.generation = 3; f.commits = 0; vi.clearAllMocks();
  f.child.mockImplementation(async (write: Partial<Child>) => ({ revision: 1, ...write }));
});
afterEach(() => { act(() => view.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("asks the one question first, then shows the fields for that answer", async () => {
  await open();
  expect(view.root.findAll((n) => (n.type as unknown) === "Field")).toHaveLength(0);
  expect(button("Save profile")).toHaveLength(0);
  await choose("expecting");
  expect(field("Name or nickname")).toBeTruthy();
  expect(field("Weeks")).toBeTruthy();
  await choose("here");
  expect(view.root.findAll((n) => (n.type as unknown) === "Field" && n.props.label === "Weeks")).toHaveLength(0);
  expect(view.root.findAll((n) => (n.type as unknown) === "Field" && n.props.label === "Weight, lb")).toHaveLength(0);
});

it("opens on the choice Today made", async () => {
  f.params = { stage: "here" };
  await open();
  expect(stages().value).toBe("here");
  expect(field("Name or nickname")).toBeTruthy();
});

it("saves expecting with only a name and goes back", async () => {
  f.params = { stage: "expecting" };
  await open();
  await save();
  expect(shown("Notice").flat()).toEqual(["Enter a name or nickname. You can change it later."]);
  expect(f.child).not.toHaveBeenCalled();
  await type("Name or nickname", "Mia");
  await save();
  expect(f.child).toHaveBeenCalledWith({ id: "new-id", name: "Mia", birth_date: null, due_date: null }, 3);
  expect(f.back).toHaveBeenCalledOnce();
  expect(f.toast).toHaveBeenCalledWith("Profile saved.");
});

it("clears a problem as soon as she changes something", async () => {
  f.params = { stage: "expecting" };
  await open();
  await save();
  expect(shown("Notice").flat()).toHaveLength(1);
  await type("Name or nickname", "M");
  expect(shown("Notice").flat()).toHaveLength(0);
});

it("says when a saved birth date came from today", async () => {
  f.params = { stage: "here" };
  await open();
  await type("Name or nickname", "Mia");
  await save();
  expect(f.child.mock.calls[0][0].birth_date).toBe("2026-11-05");
  expect(f.toast).toHaveBeenCalledWith("Birth date set to today. You can change it in Settings.");
});

it("shows how far along back as a date, in the profile's day", async () => {
  f.params = { stage: "expecting" };
  await open();
  await type("Weeks", "35");
  expect(shown("Copy").flat()).toContain("Due Thursday, December 10, 2026");
  await type("Name or nickname", "Mia");
  await save();
  expect(f.child.mock.calls[0][0].due_date).toBe("2026-12-10");
});

it("offline: says so, stays on the form, keeps what she typed, and saves on the next try", async () => {
  f.params = { stage: "expecting" };
  f.child.mockRejectedValueOnce(new ApiError("Could not connect. You’re offline. Your work is saved on this phone and can retry when you reconnect.", 0));
  await open();
  await type("Name or nickname", "Mia");
  await type("Weeks", "35");
  await save();
  expect(shown("Notice").flat()).toEqual(["You’re offline, so this isn’t saved yet. What you typed is still here. Try again when you’re connected."]);
  expect(f.back).not.toHaveBeenCalled();
  expect(field("Name or nickname").props.value).toBe("Mia");
  expect(field("Weeks").props.value).toBe("35");
  await save();
  expect(f.child).toHaveBeenLastCalledWith({ id: "new-id", name: "Mia", birth_date: null, due_date: "2026-12-10" }, 3);
  expect(f.back).toHaveBeenCalledOnce();
});

it("a first save that landed with its answer lost becomes an edit of only what she touched since", async () => {
  f.params = { stage: "expecting" };
  f.child.mockRejectedValueOnce(new ApiError("offline", 0));
  await open();
  await type("Name or nickname", "Mia");
  await save();
  await type("Name or nickname", "Mia Rose");
  f.child.mockRejectedValueOnce(new ApiError("x", 409));
  f.request.mockResolvedValue({ items: [saved({ id: "new-id", name: "Mia", revision: 1 })] });
  await save();
  expect(f.request).toHaveBeenCalledWith("/children");
  expect(f.child).toHaveBeenLastCalledWith({ id: "new-id", name: "Mia Rose", revision: 1 }, 3);
  expect(f.back).toHaveBeenCalledOnce();
});

it("edits on the same screen: Baby's here on an expecting profile keeps the due date", async () => {
  const child = saved({ due_date: "2026-12-10", details: { sex: "girl" } });
  f.children = [child]; f.params = { id: "kid" };
  await open();
  expect(stages().value).toBe("expecting");
  expect(field("Name or nickname").props.value).toBe("Mia");
  await choose("here");
  await save();
  expect(f.child).toHaveBeenCalledWith({ id: "kid", birth_date: "2026-11-05", revision: 4 }, 3);
});

it("opens saved details instead of hiding them, and re-reads the profile after a conflict", async () => {
  const child = saved({ birth_date: "2026-11-01", details: { weight_at_birth_g: 3402, feeding: "both", tracking: { diaper: false } } });
  f.children = [child]; f.params = { id: "kid" };
  f.child.mockRejectedValueOnce(new ApiError("x", 409));
  await open();
  expect([field("Weight, lb").props.value, field("and oz").props.value]).toEqual(["7", "8"]);
  await type("Name or nickname", "Mia Rose");
  await save();
  expect(f.child.mock.calls[0][0]).toEqual({ id: "kid", name: "Mia Rose", revision: 4 });
  expect(f.refresh).toHaveBeenCalledOnce();
  expect(shown("Notice").flat()).toEqual(["This profile changed on another phone. Check it, then save again."]);
  expect(field("Name or nickname").props.value).toBe("Mia Rose");
});

describe("when another phone changed the profile", () => {
  const retryAfter = async (before: Child, after: Child, edit: () => Promise<void>) => {
    f.children = [before]; f.params = { id: before.id };
    f.child.mockRejectedValueOnce(new ApiError("x", 409));
    f.refresh.mockImplementationOnce(async () => { f.children = [after]; });
    await open();
    await edit();
    await save();
    await act(async () => { view.update(<ChildEditor />); });
    expect(shown("Notice").flat()).toEqual(["This profile changed on another phone. Check it, then save again."]);
    await save();
    return f.child.mock.lastCall![0];
  };
  it("a rename doesn't resend the sex the other parent just changed", async () => {
    const sent = await retryAfter(saved({ due_date: "2026-12-10", details: { sex: "girl" } }), saved({ revision: 5, due_date: "2026-12-10", details: { sex: "boy" } }),
      () => type("Name or nickname", "Mia Rose"));
    expect(sent).toEqual({ id: "kid", name: "Mia Rose", revision: 5 });
    expect(view.root.findAll((n) => (n.type as unknown) === "Chips")[0].props.value).toBe("boy");
  });
  it("a rename doesn't clear the birth date the other parent just recorded, and the screen follows it", async () => {
    const sent = await retryAfter(saved({ due_date: "2026-12-10" }), saved({ revision: 5, due_date: "2026-12-10", birth_date: "2026-11-05" }),
      () => type("Name or nickname", "Mia Rose"));
    expect(sent).toEqual({ id: "kid", name: "Mia Rose", revision: 5 });
    expect(stages().value).toBe("here");
  });
  it("what she did change is still sent, over the other phone's values for the rest", async () => {
    const sent = await retryAfter(saved({ due_date: "2026-12-10", details: { sex: "girl" } }), saved({ revision: 5, name: "Mia Rose", due_date: "2026-12-20", details: { sex: "girl" } }),
      () => type("Weeks", "30"));
    expect(sent).toEqual({ id: "kid", due_date: "2027-01-14", revision: 5 });
    expect(field("Name or nickname").props.value).toBe("Mia Rose");
  });
  it("an answer she gave wins, and a date that only defaulted to today doesn't beat a real one", async () => {
    await retryAfter(saved({ due_date: "2026-12-10" }), saved({ revision: 5, due_date: "2026-12-10", birth_date: "2026-11-03" }),
      () => choose("here"));
    expect(view.root.findAll((n) => (n.type as unknown) === "DateField")[0].props.value).toBe("2026-11-03");
    // Nothing of hers is left to send, so there's no second write.
    expect(f.child).toHaveBeenCalledOnce();
    expect(f.back).toHaveBeenCalledOnce();
  });
  it("follows a change that arrives while she's on the screen, with no failed save at all", async () => {
    f.children = [saved({ details: { sex: "girl" } })]; f.params = { id: "kid" };
    await open();
    await type("Name or nickname", "Mia Rose");
    f.children = [saved({ revision: 9, details: { sex: "boy" } })];
    await act(async () => { view.update(<ChildEditor />); });
    await save();
    expect(f.child).toHaveBeenLastCalledWith({ id: "kid", name: "Mia Rose", revision: 9 }, 3);
  });
});

describe("the private draft", () => {
  const reopen = async () => { await act(async () => view.unmount()); await open(); };
  it("keeps a failed offline setup when the editor is reopened, with its save identity", async () => {
    f.params = { stage: "expecting" };
    f.child.mockRejectedValueOnce(new ApiError("offline", 0));
    await open();
    await type("Name or nickname", "Mia");
    await type("Weeks", "35");
    await save();
    expect(f.drafts!.new).toMatchObject({ creation_id: "new-id", generation: 3 });
    await reopen();
    expect(field("Name or nickname").props.value).toBe("Mia");
    expect(field("Weeks").props.value).toBe("35");
    expect(shown("Notice").flat()).toContain("Restored what you typed earlier.");
    await save();
    expect(f.child).toHaveBeenLastCalledWith({ id: "new-id", name: "Mia", birth_date: null, due_date: "2026-12-10" }, 3);
    expect(f.drafts?.new).toBeUndefined();
  });
  it("keeps typing she left without saving, and an empty open leaves nothing behind", async () => {
    f.params = { stage: "here" };
    await open();
    await act(async () => view.unmount());
    expect(f.drafts?.new).toBeUndefined();
    await open();
    await type("Name or nickname", "Mia");
    await reopen();
    expect(field("Name or nickname").props.value).toBe("Mia");
  });
  it("keeps a failed save with nothing typed, as the notice promised", async () => {
    const child = saved({ due_date: "2026-12-10" });
    f.children = [child]; f.params = { id: "kid" };
    f.child.mockRejectedValueOnce(new ApiError("offline", 0));
    await open();
    await choose("here");
    await save();
    await reopen();
    expect(stages().value).toBe("here");
    await save();
    expect(f.child).toHaveBeenLastCalledWith({ id: "kid", birth_date: "2026-11-05", revision: 4 }, 3);
  });
  it("stays until it's saved or discarded, even if she opens it and leaves again", async () => {
    const child = saved({ due_date: "2026-12-10" });
    f.children = [child]; f.params = { id: "kid" };
    f.child.mockRejectedValueOnce(new ApiError("offline", 0));
    await open();
    await choose("here");
    await save();
    await reopen();
    await reopen();
    expect(stages().value).toBe("here");
    expect(f.drafts!.kid).toBeTruthy();
  });
  it("is gone after a deliberate discard, with a new save identity", async () => {
    f.params = { stage: "expecting" };
    f.child.mockRejectedValueOnce(new ApiError("offline", 0));
    await open();
    await type("Name or nickname", "Mia");
    await save();
    await reopen();
    await act(async () => button("Discard what you typed")[0].props.onPress());
    await act(async () => f.alert.mock.lastCall![2][1].onPress());
    expect(f.drafts?.new).toBeUndefined();
    expect(field("Name or nickname").props.value).toBe("");
    expect(button("Discard what you typed")).toHaveLength(0);
    await reopen();
    expect(field("Name or nickname").props.value).toBe("");
  });
  it("an edit's draft follows the profile if it changed meanwhile, and stays with that baby", async () => {
    f.children = [saved({ details: { sex: "girl" } })]; f.params = { id: "kid" };
    await open();
    await type("Name or nickname", "Mia Rose");
    f.children = [saved({ revision: 7, details: { sex: "boy" } })];
    await reopen();
    expect(field("Name or nickname").props.value).toBe("Mia Rose");
    expect(view.root.findAll((n) => (n.type as unknown) === "Chips")[0].props.value).toBe("boy");
    await save();
    expect(f.child).toHaveBeenLastCalledWith({ id: "kid", name: "Mia Rose", revision: 7 }, 3);
    expect(f.drafts?.kid).toBeUndefined();
  });
  it("doesn't restore a draft from before this account's data was cleared", async () => {
    f.params = { stage: "expecting" };
    f.drafts = { new: { generation: 2, creation_id: "old", form: { name: "Old" }, opened: {} } };
    await open();
    expect(field("Name or nickname").props.value).toBe("");
  });
});

describe("what she touched stays hers until a save succeeds", () => {
  const update = async () => { for (let n = 0; n < 3; n++) await act(async () => { view.update(<ChildEditor />); await new Promise((r) => setTimeout(r, 0)); }); };
  const chips = (label: string) => view.root.find((n) => (n.type as unknown) === "Chips" && n.props.label === label);
  const sex = (value: string) => act(async () => chips("Girl or boy").props.onChange(value));
  const expecting = (extra: Partial<Child> = {}) => saved({ due_date: "2026-12-10", ...extra });
  it("a deliberate sex choice survives two conflicts, even when the first made the values match", async () => {
    f.children = [expecting({ details: { sex: "girl" } })]; f.params = { id: "kid" };
    f.child.mockRejectedValueOnce(new ApiError("conflict", 409)).mockRejectedValueOnce(new ApiError("conflict", 409));
    await open(); await sex("boy"); await type("Name or nickname", "Mia Rose"); await save();
    f.children = [expecting({ revision: 5, details: { sex: "boy" } })]; await update();
    expect(chips("Girl or boy").props.value).toBe("boy"); await save();
    f.children = [expecting({ revision: 6, details: { sex: "girl" } })]; await update();
    expect(chips("Girl or boy").props.value).toBe("boy");
    await save(); expect(f.child.mock.lastCall![0]).toEqual({ id: "kid", name: "Mia Rose", details: { sex: "boy" }, revision: 6 });
  });
  it("a deliberate clear survives two conflicts while an untouched field follows the profile", async () => {
    f.children = [expecting({ details: { sex: "girl" } })]; f.params = { id: "kid" };
    f.child.mockRejectedValueOnce(new ApiError("conflict", 409)).mockRejectedValueOnce(new ApiError("conflict", 409));
    await open(); await sex("unsure"); await type("Weeks", "30"); await save();
    f.children = [expecting({ revision: 5, details: {} })]; await update(); await save();
    f.children = [expecting({ revision: 6, name: "Remote", details: { sex: "boy" } })]; await update();
    expect(field("Name or nickname").props.value).toBe("Remote");
    expect(chips("Girl or boy").props.value).toBe("unsure");
  });
  it("changing back to empty counts, and untouched details are never resent", async () => {
    f.children = [expecting()]; f.params = { id: "kid" };
    await open(); await sex("girl"); await sex("unsure"); await type("Name or nickname", "Rose");
    f.child.mockRejectedValueOnce(new ApiError("conflict", 409)); await save();
    f.children = [expecting({ revision: 5, details: { sex: "boy", feeding: "bottle" } })]; await update();
    expect(chips("Girl or boy").props.value).toBe("unsure"); await save();
    expect(f.child.mock.lastCall![0]).toEqual({ id: "kid", revision: 5, name: "Rose", details: { sex: null } });
  });
  it("a stage switch stays through two conflicts", async () => {
    f.children = [expecting()]; f.params = { id: "kid" };
    f.child.mockRejectedValueOnce(new ApiError("conflict", 409)).mockRejectedValueOnce(new ApiError("conflict", 409));
    await open(); await choose("here"); await type("Name or nickname", "Rose"); await save();
    f.children = [saved({ revision: 5, due_date: "2026-12-10", birth_date: "2026-11-03" })]; await update(); await save();
    f.children = [expecting({ revision: 6 })]; await update();
    expect(stages().value).toBe("here");
  });
  it("switching back to expecting takes away a birth date recorded meanwhile, because she chose that, and says so", async () => {
    f.children = [saved({ birth_date: "2026-11-01", due_date: "2026-12-10" })]; f.params = { id: "kid" };
    f.child.mockRejectedValueOnce(new ApiError("conflict", 409));
    await open(); await choose("expecting"); await save();
    f.children = [saved({ revision: 5, birth_date: "2026-11-02", due_date: "2026-12-10" })]; await update();
    expect(shown("Notice").flat()).toContain("Saving this removes the birth date.");
    await save();
    expect(f.child.mock.lastCall![0]).toEqual({ id: "kid", birth_date: null, revision: 5 });
  });
  it("saving with nothing touched sends nothing", async () => {
    f.children = [expecting()]; f.params = { id: "kid" };
    await open(); await save();
    expect(f.child).not.toHaveBeenCalled();
    expect(f.toast).toHaveBeenCalledWith("Profile saved.");
    expect(f.back).toHaveBeenCalledOnce();
  });
  it("lost create answer: recovery leaves what another phone added alone, with the draft reopened or not", async () => {
    f.params = { stage: "expecting" }; f.child.mockRejectedValueOnce(new ApiError("offline", 0));
    await open(); await type("Name or nickname", "First"); await save();
    await act(async () => view.unmount()); await open();
    await type("Name or nickname", "Second"); f.child.mockRejectedValueOnce(new ApiError("used", 409));
    f.request.mockResolvedValue({ items: [saved({ id: "new-id", name: "First", revision: 2, details: { sex: "boy" }, birth_date: "2026-11-02" })] });
    await save();
    expect(f.child.mock.calls.map((call) => call[0])).toEqual([
      { id: "new-id", name: "First", birth_date: null, due_date: null },
      { id: "new-id", name: "Second", birth_date: null, due_date: null },
      { id: "new-id", name: "Second", revision: 2 },
    ]);
    expect(f.drafts?.new).toBeUndefined();
  });
  it("switching units with an impossible weight refuses, keeps the text, and says why", async () => {
    f.children = [saved({ birth_date: "2026-11-01", details: { weight_at_birth_g: 3400 } })]; f.params = { id: "kid" };
    await open(); await type("and oz", "16");
    await act(async () => chips("Units").props.onChange("metric"));
    expect(chips("Units").props.value).toBe("imperial");
    expect(field("and oz").props.value).toBe("16");
    expect(shown("Notice").flat()).toEqual(["Check the birth weight. Use up to 22 lb, with ounces under 16."]);
    await save();
    expect(f.child).not.toHaveBeenCalled();
  });
  it("edited and cleared measures survive switches, and an untouched one still can't be resent", async () => {
    f.children = [saved({ birth_date: "2026-11-01", details: { weight_at_birth_g: 3400, length_at_birth_cm: 50.4 } })]; f.params = { id: "kid" };
    await open(); await type("and oz", "8"); await type("Length, in", "");
    await act(async () => chips("Units").props.onChange("metric"));
    await act(async () => chips("Units").props.onChange("imperial"));
    await act(async () => chips("Units").props.onChange("metric"));
    expect(field("Weight, kg").props.value).toBe("3.402");
    expect(field("Length, cm").props.value).toBe("");
    await save();
    expect(f.child.mock.lastCall![0].details).toEqual({ weight_at_birth_g: 3402, length_at_birth_cm: null });
  });
});

describe("an edit whose profile is gone", () => {
  const update = async () => { await act(async () => { view.update(<ChildEditor />); }); };
  it("says so, can't become a new profile, and keeps her draft in its own slot", async () => {
    f.children = [saved({ due_date: "2026-12-10" })]; f.params = { id: "kid" };
    await open(); await type("Name or nickname", "Mia Rose");
    f.children = []; await update();
    expect(button("Save profile")).toHaveLength(0);
    expect(view.root.findAll((n) => (n.type as unknown) === "StageOptions")).toHaveLength(0);
    expect(shown("Notice").flat().join(" ")).toMatch(/removed/);
    expect(view.root.find((n) => (n.type as unknown) === "Screen").props.title).toBe("Baby profile");
    expect(f.child).not.toHaveBeenCalled();
    expect(f.back).not.toHaveBeenCalled();
    await act(async () => view.unmount());
    expect(f.drafts?.kid).toBeTruthy();
    expect(f.drafts?.new).toBeUndefined();
    await open();
    expect(view.root.find((n) => (n.type as unknown) === "Screen").props.title).toBe("Baby profile");
    expect(f.drafts?.kid).toBeTruthy();
  });
  it("a save that finds it gone re-reads the profiles, and ends up here rather than retrying", async () => {
    f.children = [saved({ due_date: "2026-12-10" })]; f.params = { id: "kid" };
    f.child.mockRejectedValueOnce(new ApiError("gone", 404));
    f.refresh.mockImplementationOnce(async () => { f.children = []; });
    await open(); await type("Name or nickname", "Mia Rose"); await save(); await update();
    expect(button("Save profile")).toHaveLength(0);
    expect(shown("Notice").flat().join(" ")).toMatch(/removed/);
    expect(f.child).toHaveBeenCalledOnce();
  });
  it("can discard that draft, and has a way back", async () => {
    f.children = []; f.params = { id: "kid" };
    f.drafts = { kid: { generation: 3, creation_id: "x", form: {}, touched: ["name"], since: [], attempted: false } };
    await open();
    await act(async () => button("Discard what you typed")[0].props.onPress());
    await act(async () => f.alert.mock.lastCall![2][1].onPress());
    expect(f.drafts?.kid).toBeUndefined();
    await act(async () => button("Back")[0].props.onPress());
    expect(f.back).toHaveBeenCalledOnce();
  });
});

describe("the generation fence", () => {
  it("a late failed save can't overwrite a draft from after the reset", async () => {
    let reject!: (e: Error) => void;
    f.params = { stage: "expecting" };
    f.child.mockImplementationOnce(() => new Promise((_resolve, r) => { reject = r; }));
    await open(); await type("Name or nickname", "Old secret");
    await act(async () => { button("Save profile")[0].props.onPress(); });
    await act(async () => view.unmount());
    const fresh = { generation: 4, creation_id: "fresh-id", form: { name: "Fresh draft" }, touched: ["name"], since: [], attempted: false };
    f.generation = 4; f.drafts = { new: fresh };
    await act(async () => { reject(new ApiError("stopped old response", 410, true)); for (let n = 0; n < 40; n++) await Promise.resolve(); });
    expect(f.drafts?.new).toBe(fresh);
  });
  it("a late successful save or a late removal can't touch the new generation either", async () => {
    let resolve!: (row: Child) => void;
    f.params = { stage: "expecting" };
    f.child.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    await open(); await type("Name or nickname", "Old secret");
    await act(async () => { button("Save profile")[0].props.onPress(); });
    const fresh = { generation: 4, creation_id: "fresh-id", form: { name: "Fresh" }, touched: ["name"], since: [], attempted: false };
    f.generation = 4; f.drafts = { new: fresh };
    await act(async () => { resolve(saved({ id: "new-id" })); for (let n = 0; n < 40; n++) await Promise.resolve(); });
    expect(f.drafts?.new).toBe(fresh);
  });
});

describe("drafts by baby", () => {
  it("a stage change on an existing profile comes back when she reopens it", async () => {
    f.children = [saved({ due_date: "2026-12-10" })]; f.params = { id: "kid" };
    await open(); await choose("here"); await act(async () => view.unmount());
    await open();
    expect(stages().value).toBe("here");
  });
  it("a stage from the Today card alone leaves nothing behind, on either kind of profile", async () => {
    f.children = [saved({ due_date: "2026-12-10" })]; f.params = { id: "kid", stage: "here" };
    await open(); await act(async () => view.unmount());
    expect(f.drafts?.kid).toBeUndefined();
  });
  it("a new baby and two existing ones keep separate drafts", async () => {
    f.children = [saved({ due_date: "2026-12-10" }), saved({ id: "second", name: "Other", due_date: "2026-12-10" })];
    f.params = { id: "kid" }; await open(); await type("Name or nickname", "First edit"); await act(async () => view.unmount());
    f.params = { id: "second" }; await open(); await type("Name or nickname", "Second edit"); await act(async () => view.unmount());
    f.params = { stage: "expecting" }; await open(); await type("Name or nickname", "New baby"); await act(async () => view.unmount());
    expect(Object.keys(f.drafts!)).toEqual(["kid", "second", "new"]);
    f.params = { id: "kid" }; await open();
    expect(field("Name or nickname").props.value).toBe("First edit");
  });
});

it("keeps the profile-removal flow, and removing a profile takes its draft with it", async () => {
  f.children = [saved({ due_date: "2026-12-10" })]; f.params = { id: "kid" };
  await open();
  await type("Name or nickname", "Mia Rose");
  await act(async () => button("Remove this profile")[0].props.onPress());
  expect(f.alert.mock.calls[0][0]).toBe("Remove this child profile?");
  await act(async () => f.alert.mock.calls[0][2][1].onPress());
  await act(async () => view.unmount());
  expect(f.drafts?.kid).toBeUndefined();
  await open();
});
