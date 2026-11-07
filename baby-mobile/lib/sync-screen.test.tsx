import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type DeviceState, type Mutation } from "./models";

const scope = vi.hoisted(() => ({ account: null as any, alerts: [] as { message: string; buttons: { text: string; onPress?: () => void }[] }[], toast: vi.fn() }));
vi.mock("react-native", () => ({ Alert: { alert: (_t: string, message: string, buttons: { text: string; onPress?: () => void }[]) => scope.alerts.push({ message, buttons }) } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/lib/api", () => import("./api"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/files", () => ({ exportFile: vi.fn() }));
vi.mock("@/components/private-attachment", () => ({ PrivateAttachment: "PrivateAttachment" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Card: "Card", Copy: "Copy", Empty: "Empty", Notice: "Notice", Screen: "Screen", Section: "Section", useToast: () => scope.toast }));
import Sync from "../app/sync";
import { ApiError } from "./api";
import { withoutHeldDraft, withoutRefusedRetry } from "./outbox";

let renderer: ReactTestRenderer | undefined;
const action = (over: object = {}): Mutation => ({ id: "end", generation: 1, type: "feed_action", record_id: "feed", action: { id: "end", action: "finish", at: "2026-11-05T02:00:00.000Z" }, error: "Needs review", ...over });
function setup(outbox: Mutation[]) {
  scope.account = { online: true, syncing: false, error: "", state: { ...emptyState(), outbox, bootstrap: { generation: 1, children: [] } } as unknown as DeviceState,
    discardQueued: vi.fn(async () => undefined), commit: vi.fn(), sync: vi.fn(),
    api: { record: vi.fn(async () => ({ id: "feed", data: { state: "finished" } }) as unknown as BabyRecord), bootstrap: vi.fn() } };
  scope.account.discardHeld = vi.fn(async (id: string) => { await scope.account.commit((s: DeviceState) => withoutHeldDraft(s, id)); });
  return scope.account;
}
const discard = async () => {
  await act(async () => { renderer = create(<Sync />); });
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === "Discard this queued change")!.props.onPress());
  await act(async () => { await scope.alerts.at(-1)!.buttons.find((b) => b.text === "Discard change")!.onPress!(); });
};
const notices = () => renderer!.root.findAll((n) => String(n.type) === "Notice").map((n) => [n.props.children].flat().join(""));
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React); scope.alerts = []; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("reads the record before discarding a sent tap, so a finished feed can't reappear as running", async () => {
  const b = setup([action({ sent: true })]);
  await discard();
  expect(b.api.record).toHaveBeenCalledWith("feed");
  expect(b.discardQueued).toHaveBeenCalledWith("end", expect.objectContaining({ data: { state: "finished" } }));
});

it("does the same for a kick tap or contraction stop", async () => {
  const b = setup([{ id: "t", generation: 1, type: "session_action", record_id: "feed", action: { id: "t", action: "tap", at: "2026-11-05T02:00:00.000Z" }, error: "Needs review", sent: true }]);
  await discard();
  expect(b.api.record).toHaveBeenCalledWith("feed");
});


it("offers a private way out for a refused linked visit note", async () => {
  const b = setup([{ ...save("visit-note"), error: "Review link", record: { ...(save("visit-note") as any).record, kind: "journal", data: { event_id: "visit" } } } as Mutation]);
  await act(async () => { renderer = create(<Sync />); });
  expect(renderer!.root.findAll((n) => String(n.type) === "Button").map((n) => n.props.title)).toContain("Save privately in Journal");
  expect(JSON.stringify(renderer!.toJSON())).toContain("without unavailable baby or visit links");
  b.state.bootstrap.personal_space_id = "p";
  await act(async () => { await renderer!.root.findAll((n) => String(n.type) === "Button" && n.props.title === "Save privately in Journal")[0].props.onPress(); });
  const next = b.commit.mock.calls[0][0](b.state);
  expect(next.outbox).toHaveLength(1);
  expect(next.outbox[0]).toMatchObject({ space_id: "p", record: { kind: "journal" } });
  expect(next.outbox[0].record.data.event_id).toBeUndefined();
  expect(b.sync).toHaveBeenCalledOnce();
});

const save = (id: string, recordId = "feed", over: object = {}): Mutation => ({ id, generation: 1, type: "save", files: [], record: { id: recordId, kind: "feeding", title: id, body: "", child_id: null, occurred_at: "2026-11-05T02:00:00.000Z", data: {}, revision: 1 }, ...over });
const ask = async (title: string, at = 0) => {
  await act(async () => { renderer = create(<Sync />); });
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "Button" && n.props.title === title)[at].props.onPress());
  return scope.alerts.at(-1)!.message;
};

it("says nothing extra when the change is alone on its entry", async () => {
  setup([save("edit"), save("other", "elsewhere")]);
  expect(await ask("Discard this queued change")).toBe("This removes this unsynced change. You can export a text backup first.");
});

it("says how many later changes to that entry go with it, feed actions included", async () => {
  setup([save("first"), save("other", "elsewhere"), action({ id: "swap" }), save("note")]);
  expect(await ask("Discard this queued change")).toBe("This also removes 2 later changes to this entry. You can export a text backup first.");
});

it("counts only what's after the change she chose", async () => {
  setup([save("first"), save("second"), save("third")]);
  expect(await ask("Discard this queued change", 1)).toBe("This also removes 1 later change to this entry. You can export a text backup first.");
});

it("keeps the saved version with the same warning, once she has compared them", async () => {
  const b = setup([save("edit", "feed", { conflict: true, error: "Changed" }), save("note")]);
  await act(async () => { renderer = create(<Sync />); });
  await act(async () => { await renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === "Load saved version to compare")!.props.onPress(); });
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === "Keep the server version")!.props.onPress());
  expect(scope.alerts.at(-1)!.message).toBe("The reviewed server version will be kept. This removes the local change shown above. This also removes 1 later change to this entry.");
  await act(async () => { await scope.alerts.at(-1)!.buttons.find((x) => x.text === "Discard local change")!.onPress!(); });
  expect(b.discardQueued).toHaveBeenCalledWith("edit", expect.objectContaining({ id: "feed" }));
});

it("doesn't read anything to discard an ordinary unsent change, since nothing behind it survives", async () => {
  const b = setup([save("edit", "feed", { conflict: true, error: "Changed" })]);
  await discard();
  expect(b.api.record).not.toHaveBeenCalled();
  expect(b.discardQueued).toHaveBeenCalledWith("edit", undefined);
});

it("keeps a sent tap when the record can't be read, and says why", async () => {
  const b = setup([action({ sent: true })]);
  b.api.record = vi.fn(async () => { throw new ApiError("Offline", 0); });
  await discard();
  expect(b.discardQueued).not.toHaveBeenCalled();
  expect(notices().join()).toContain("Reconnect to check it");
});

it("forgets the row when the read says the record is gone", async () => {
  const b = setup([action({ sent: true })]);
  b.api.record = vi.fn(async () => { throw new ApiError("Gone", 404); });
  await discard();
  expect(b.discardQueued).toHaveBeenCalledWith("end", null);
});

it("needs no read for a tap that never left this phone, offline included", async () => {
  const b = setup([action()]);
  await discard();
  expect(b.api.record).not.toHaveBeenCalled();
  expect(b.discardQueued).toHaveBeenCalledWith("end", undefined);
});

it("asks the API about a sent birth date too, and names it", async () => {
  const child = { id: "baby", name: "Mia", revision: 4, birth_date: "2026-11-05" }, born: Mutation = { id: "b", generation: 1, type: "child_birth", child_id: "baby", birth_date: "2026-11-05", previous: null, sent: true, error: "Review" };
  const b = setup([born]);
  b.api.bootstrap = vi.fn(async () => ({ children: [child] }));
  await discard();
  expect(b.discardQueued).toHaveBeenCalledWith("b", undefined, child);
  expect(renderer!.root.findAll((n) => String(n.type) === "Copy").map((n) => [n.props.children].flat().join("")).join()).toContain("Birth date");
});

it("names a waiting switch, and asks the API about a sent one before showing the old copy", async () => {
  const child = { id: "baby", name: "Mia", revision: 4, birth_date: "2026-11-01" }, off: Mutation = { id: "t", generation: 1, type: "child_tracking", child_id: "baby", tracking: { diaper: false, expecting_breast: false }, previous: { diaper: null, expecting_breast: null }, sent: true };
  const b = setup([off]);
  b.api.bootstrap = vi.fn(async () => ({ children: [child] }));
  await discard();
  expect(b.discardQueued).toHaveBeenCalledWith("t", undefined, child);
  const words = renderer!.root.findAll((n) => String(n.type) === "Copy").map((n) => [n.props.children].flat().join("")).join();
  expect(words).toContain("What shows");
  expect(words).toContain("Diaper off, Breastfeed off.");
});

it("doesn't read out a suggestion's own memory as if it were a switch", async () => {
  const off: Mutation = { id: "t", generation: 1, type: "child_tracking", child_id: "baby", tracking: { diaper: false, asked_diaper: true }, previous: { diaper: null, asked_diaper: null } };
  setup([off]);
  await act(async () => { renderer = create(<Sync />); });
  const words = renderer!.root.findAll((n) => String(n.type) === "Copy").map((n) => [n.props.children].flat().join("")).join();
  expect(words).toContain("Diaper off.");
  expect(words).not.toContain("asked_diaper");
});

it("names a refused split in plain words, and says what discarding it takes along", async () => {
  const event = (id: string, title: string) => ({ id, kind: "event" as const, title, body: "", child_id: null, occurred_at: "2026-11-16T00:00:00.000Z", data: { timezone: "Pacific/Guam" } }),
    split: Mutation = { id: "next", generation: 1, type: "event_split", series: { ...event("class", "Class"), revision: 4 }, event: event("next", "New class"), from_start: "2026-11-16T00:00:00.000Z", files: [], conflict: true, error: "This event changed somewhere else" },
    b = setup([split, { id: "edit", generation: 1, type: "save", files: [], record: { ...event("next", "Newer class"), revision: 0 } }]);
  expect(await ask("Discard this queued change")).toContain("This also removes 1 later change");
  const words = renderer!.root.findAll((n) => String(n.type) === "Copy").map((n) => [n.props.children].flat().join(""));
  expect(words).toContain("New class");
  expect(words.join(" ")).toMatch(/Changes Class from November 16, 2026 on\. Discarding this keeps every date as it was\./);
  await act(async () => { await scope.alerts.at(-1)!.buttons.find((button) => button.text === "Discard change")!.onPress!(); });
  expect(b.discardQueued).toHaveBeenCalledWith("next", undefined);
});

describe("what a former family's queue offers", () => {
  const stopped = (over: object = {}) => save("q", "entry", { space_id: "f", left_space: "f", error: "Not sent: you’re no longer in this family.", ...over });
  const titles = () => renderer!.root.findAll((n) => String(n.type) === "Button").map((n) => n.props.title);
  it("offers Keep and Discard, and never Retry", async () => {
    setup([stopped()]);
    await act(async () => { renderer = create(<Sync />); });
    expect(titles()).toEqual(expect.arrayContaining(["Keep in my personal space", "Discard this queued change"]));
    expect(titles()).not.toContain("Retry");
    expect(titles()).not.toContain("Keep on this phone");
    expect(notices()).toContain("Not sent: you’re no longer in this family.");
  });
  it("offers only Discard for a tap, which has nothing to copy", async () => {
    setup([action({ space_id: "f", left_space: "f", error: "Not sent: you’re no longer in this family." })]);
    await act(async () => { renderer = create(<Sync />); });
    expect(titles()).not.toContain("Keep in my personal space");
    expect(titles()).toContain("Discard this queued change");
  });
  it("copies it when she chooses Keep", async () => {
    const b = setup([stopped()]);
    await act(async () => { renderer = create(<Sync />); });
    await act(async () => renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === "Keep in my personal space")!.props.onPress());
    const changed = b.commit.mock.calls[0][0]({ ...b.state, bootstrap: { generation: 1, personal_space_id: "p", children: [] } });
    expect(changed.outbox).toMatchObject([{ space_id: "p", record: { title: "q" } }]);
    expect(changed.outbox[0].record.id).not.toBe("entry");
    expect(b.sync).toHaveBeenCalled();
  });
});

describe("reviewing a conflict before replacing the saved version", () => {
  const conflicted = () => { const local = save("edit", "feed", { conflict: true, error: "Changed" }) as Extract<Mutation, { type: "save" }>; local.record.kind = "source"; return local; };
  const load = async (saved: object) => {
    const b = setup([conflicted()]);
    b.api.record = vi.fn(async () => ({ id: "feed", kind: "source", title: "Saved post", body: "Their notes", occurred_at: "2026-11-05T00:00:00Z", updated_at: "2026-11-05T00:00:00Z", revision: 3, data: {}, ...saved }));
    await act(async () => { renderer = create(<Sync />); });
    await act(async () => { await renderer!.root.findAll((n) => String(n.type) === "Button").find((n) => n.props.title === "Load saved version to compare")!.props.onPress(); });
    return renderer!;
  };
  const words = (root: ReactTestRenderer) => root.root.findAll((n) => String(n.type) === "Copy").map((n) => [n.props.children].flat().join("")).join(" | ");
  it("shows the attachments on the saved version", async () => {
    const root = await load({ data: { attachment_ids: ["their-photo", "their-scan"] } });
    expect(root.root.findAll((n) => String(n.type) === "PrivateAttachment").map((n) => n.props.id)).toEqual(["their-photo", "their-scan"]);
  });
  it("shows the saved care details and category, in words", async () => {
    const root = await load({ kind: "feeding", title: "Bottle", data: { method: "bottle", contents: "formula", amount_ml: 90, topics: ["sleep", "labor"], status: "saved" } });
    const said = words(root);
    expect(said).toMatch(/Method: bottle/);
    expect(said).toMatch(/Contents: formula/);
    expect(said).toMatch(/Amount ml: 90/);
    expect(said).toMatch(/Topics: sleep, labor/);
  });
  it("leaves out what isn't for reading, and cuts long source text short", async () => {
    const root = await load({ data: { attachment_ids: ["a"], actions: [{ id: "x" }], evidence: [{ q: "z" }], provenance: "caregiver_observation", source_text: "w".repeat(900) } });
    const said = words(root);
    expect(said).not.toMatch(/Attachment ids|Evidence|Provenance|caregiver_observation/);
    expect(said).toMatch(/Actions: 1/);
    expect((said.match(/w/g) ?? []).length).toBeLessThan(300);
  });
  it("doesn't offer the save until it's shown", async () => {
    setup([conflicted()]);
    await act(async () => { renderer = create(<Sync />); });
    expect(renderer!.root.findAll((n) => String(n.type) === "Button").some((n) => n.props.title === "Save my version after review")).toBe(false);
  });
});

it("offers only one personal recovery action on a stopped journal", async () => {
  setup([save("journal", "entry", { left_space: "f", space_id: "f", error: "Not sent", record: { ...(save("journal") as any).record, kind: "journal" } })]);
  await act(async () => { renderer = create(<Sync />); });
  const titles = renderer!.root.findAll((n) => String(n.type) === "Button").map((n) => n.props.title);
  expect(titles).toContain("Save privately in Journal"); expect(titles).not.toContain("Keep in my personal space");
});

it("keeps unfinished work separate, never offers Retry, and confirms exact-row Keep and Discard", async () => {
  const b = setup([]);
  b.state.heldDrafts = [{ id: "held", draft: { ...(save("draft") as any).record, files: [] }, followups: [action()] }];
  await act(async () => { renderer = create(<Sync />); });
  const buttons = () => renderer!.root.findAll((n) => String(n.type) === "Button");
  expect(buttons().map((n) => n.props.title)).not.toContain("Retry");
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("1 pending change");
  await act(async () => buttons().find((n) => n.props.title === "Keep this draft in my personal space")!.props.onPress());
  expect(scope.alerts.at(-1)!.message).toContain("1 later saved change");
  expect(b.commit).not.toHaveBeenCalled();
  await act(async () => buttons().find((n) => n.props.title === "Discard this unfinished draft")!.props.onPress());
  expect(scope.alerts.at(-1)!.message).toContain("1 later saved change");
});

it("confirms Keep and Discard for the selected snapshot, retains the other, and releases only removed uploads", async () => {
  const b = setup([]), file = (id: string) => ({ id, uri: `file:///${id}`, uploaded_id: `upload-${id}`, name: `${id}.jpg`, mime_type: "image/jpeg" }),
    held = (id: string) => ({ id, draft: { ...(save(id) as any).record, title: id, body: `${id} words`, space_id: "family", files: [file(id)] } });
  b.state.bootstrap = { generation: 1, personal_space_id: "personal", children: [] };
  b.state.heldDrafts = [held("one"), held("two")];
  b.commit.mockImplementation(async (change: (s: DeviceState) => DeviceState) => { b.state = change(b.state); });
  let sent!: () => void; b.sync.mockImplementation(() => new Promise<void>((resolve) => { sent = resolve; }));
  await act(async () => { renderer = create(<Sync />); });
  const buttons = () => renderer!.root.findAll((n) => String(n.type) === "Button"),
    drafts = () => buttons().filter((n) => ["Keep this draft in my personal space", "Discard this unfinished draft"].includes(n.props.title));
  await act(async () => buttons().filter((n) => n.props.title === "Keep this draft in my personal space")[1].props.onPress());
  expect(b.commit).not.toHaveBeenCalled();
  await act(async () => { scope.alerts.at(-1)!.buttons.find((one) => one.text === "Keep this draft")!.onPress!(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(b.sync).toHaveBeenCalledOnce(); expect(drafts().every((one) => one.props.disabled)).toBe(true);
  await act(async () => { sent(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(b.state.outbox).toHaveLength(1); expect(b.state.outbox[0].record.body).toBe("two words");
  expect(b.state.heldDrafts.map((one: any) => one.id)).toEqual(["one"]); expect(b.state.fileReleases).toEqual(["upload-two"]);
  b.syncing = true; await act(async () => renderer!.update(<Sync />)); expect(drafts().every((one) => one.props.disabled)).toBe(true);
  b.syncing = false; await act(async () => renderer!.update(<Sync />));
  await act(async () => buttons().find((one) => one.props.title === "Discard this unfinished draft")!.props.onPress());
  await act(async () => { scope.alerts.at(-1)!.buttons.find((one) => one.text === "Discard draft")!.onPress!(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(b.state.heldDrafts).toEqual([]); expect(b.state.fileReleases).toEqual(["upload-two", "upload-one"]);
  expect(b.state.outbox[0].record.body).toBe("two words"); expect(b.sync).toHaveBeenCalledOnce();
});

it.each([0, 1])("discards snapshot %i while another held draft and its upload remain", async (selected) => {
  const b = setup([]), held = ["one", "two"].map((id) => ({ id, draft: { ...(save(id) as any).record,
    files: [{ id, uri: `file:///${id}`, uploaded_id: `upload-${id}`, name: `${id}.jpg`, mime_type: "image/jpeg" }] } }));
  b.state.heldDrafts = held;
  b.commit.mockImplementation(async (change: (s: DeviceState) => DeviceState) => { b.state = change(b.state); });
  await act(async () => { renderer = create(<Sync />); });
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "Button" && n.props.title === "Discard this unfinished draft")[selected].props.onPress());
  expect(b.commit).not.toHaveBeenCalled();
  await act(async () => { scope.alerts.at(-1)!.buttons.find((one) => one.text === "Discard draft")!.onPress!(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(b.state.heldDrafts).toEqual([held[1 - selected]]);
  expect(b.state.fileReleases).toEqual([`upload-${held[selected].id}`]);
  expect(b.state.outbox).toEqual([]);
  expect(b.sync).not.toHaveBeenCalled();
});

it("does not say caught up when unfinished drafts are the only work", async () => {
  const b = setup([]); b.state.heldDrafts = [{ id: "held", draft: { ...(save("draft") as any).record, files: [] } }];
  await act(async () => { renderer = create(<Sync />); });
  expect(renderer!.root.findAll((n) => String(n.type) === "Empty")).toEqual([]);
});
it("offers an explicit confirmed Send to family for ambiguous old work", async () => {
  const b = setup([]); b.state.bootstrap = { generation: 1, personal_space_id: "p", children: [], spaces: [{ id: "f", kind: "family", role: "parent", generation: 2 }] };
  b.state.heldDrafts = [{ id: "old-delivery", uncertain: true, draft: { ...(save("draft") as any).record, space_id: "f", generation: 2, files: [] } }];
  b.commit.mockImplementation(async (change: (s: DeviceState) => DeviceState) => { b.state = change(b.state); });
  await act(async () => { renderer = create(<Sync />); });
  const send = renderer!.root.findAll((n) => String(n.type) === "Button" && n.props.title === "Send to family")[0];
  await act(async () => send.props.onPress()); expect(b.commit).not.toHaveBeenCalled();
  await act(async () => { scope.alerts.at(-1)!.buttons.find((one) => one.text === "Send to family")!.onPress!(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(b.state.outbox).toMatchObject([{ id: "old-delivery", space_id: "f", base: { after: [] } }]); expect(b.state.heldDrafts).toEqual([]); expect(b.sync).toHaveBeenCalledOnce();
});

it.each([false, true])("only offers confirmed Send for ambiguous work, never a true unfinished draft (uncertain %s)", async (uncertain) => {
  const b = setup([]);
  b.state.bootstrap = { generation: 1, children: [], personal_space_id: "p", spaces: [{ id: "f", kind: "family", role: "parent", generation: 1 }] };
  b.state.heldDrafts = [{ id: "h", uncertain, draft: { id: "row", kind: "journal", title: "My words", body: "Unfinished", child_id: null, occurred_at: "2026-11-07T00:00:00Z", data: {}, files: [], space_id: "f", generation: 1 } }];
  await act(async () => { renderer = create(<Sync />); });
  const send = renderer!.root.findAll((n) => String(n.type) === "Button" && n.props.title === "Send to family");
  expect(send).toHaveLength(uncertain ? 1 : 0);
  if (uncertain) { send[0].props.onPress(); expect(b.commit).not.toHaveBeenCalled(); expect(scope.alerts.at(-1)!.buttons.map((b) => b.text)).toContain("Keep reviewing"); }
});


it("keeps held drafts distinct from a refused source read and visible after clearing it", async () => {
  const b = setup([{id:"refused",type:"import",record_id:"source",generation:1,files:[],
    url:"https://example.com/post",error:"This post reached its processing limit. The original remains saved."}]);
  b.state.heldDrafts = [{id:"held",draft:{...(save("private-note") as any).record,
    title:"Private visit note",body:"Unfinished words",files:[]}}];
  await act(async () => { renderer = create(<Sync />); });
  let visible = JSON.stringify(renderer!.toJSON());
  expect(visible).toContain("Unfinished drafts · not sent");
  expect(visible).toContain("This draft won’t sync.");
  expect(visible).toContain("Source import");
  expect(visible).toContain("This post reached its processing limit");
  expect(visible).not.toContain("Everything is caught up");
  b.state = withoutRefusedRetry(b.state, "refused");
  await act(async () => renderer!.update(<Sync />));
  visible = JSON.stringify(renderer!.toJSON());
  expect(visible).toContain("Private visit note");
  expect(visible).toContain("Unfinished words");
  expect(visible).not.toContain("Source import");
  expect(visible).not.toContain("Everything is caught up");
});
