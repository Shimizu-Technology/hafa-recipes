import { describe, expect, it } from "vitest";
import { applyChanges as applied, type ChangesAnswer, type ChangesPage, removedFrom } from "./changes";
import { accessKey, spacesLive } from "./spaces";
import { emptyState, optimisticRecord, type Bootstrap, type DeviceState } from "./models";

const personal = "p0000000-0000-0000-0000-000000000000", family = "f0000000-0000-0000-0000-000000000000";
const boot = (extra: Partial<Bootstrap> = {}): Bootstrap => ({ generation: 1, ai_available: false, children: [],
  profile: { display_name: "", timezone: "UTC", ai_consent: false }, personal_space_id: personal,
  spaces: [{ id: personal, kind: "personal", role: "parent", generation: 1, access_version: 1 }], ...extra });
const row = (id: string, revision = 1, space_id?: string, occurred_at = "2026-11-05T00:00:00.000Z") =>
  ({ ...optimisticRecord({ id, kind: "diaper", title: id, body: "", child_id: null, occurred_at, data: { type: "wet" } }), revision, ...(space_id ? { space_id } : {}) });
const page = (id: string, items: ChangesPage["items"], extra: Partial<ChangesPage> = {}): ChangesPage =>
  ({ id, generation: 1, access_version: 1, cursor: items.length, has_more: false, reset: false, items, ...extra });
const answer = (...pages: ChangesPage[]): ChangesAnswer => ({ spaces: pages, cursor: Object.fromEntries(pages.map((p) => [p.id, p.cursor])),
  has_more: pages.some((p) => p.has_more), removed_space_ids: [] });
const applyChanges = (state: DeviceState, changes: ChangesAnswer) => applied(state, changes, () => "new-id");
const start = (extra: Partial<DeviceState> = {}): DeviceState => ({ ...emptyState(), bootstrap: boot(), ...extra });

describe("applying what the other phone did", () => {
  it("adds its rows, newest first, and keeps the cursor and access version it came with", () => {
    const { state, changed, more } = applyChanges(start({ records: [row("old", 1, personal, "2026-11-01T00:00:00.000Z")] }),
      answer(page(personal, [{ ...row("new", 1, personal), seq: 7, entity: "record" }], { cursor: 7, access_version: 3 })));
    expect(state.records.map((r) => r.id)).toEqual(["new", "old"]);
    expect(state.changes).toEqual({ cursor: { [personal]: 7 }, access: { [personal]: 3 } });
    expect(changed).toBe(true);
    expect(more).toBe(false);
  });
  it("has nothing to show when the only news is the frontier moving, so no screen reads again", () => {
    const before = start({ changes: { cursor: { [personal]: 1 }, access: { [personal]: 1 } } });
    const { state, changed } = applyChanges(before, answer(page(personal, [], { cursor: 9 })));
    expect(changed).toBe(false);
    expect(state.changes?.cursor[personal]).toBe(9);
  });
  it("doesn't let an older copy overwrite a newer one this phone already holds", () => {
    const { state } = applyChanges(start({ records: [row("a", 5, personal)] }), answer(page(personal, [{ ...row("a", 4, personal), seq: 2, entity: "record" }])));
    expect(state.records[0].revision).toBe(5);
  });
  it("removes a deleted row", () => {
    const { state, changed } = applyChanges(start({ records: [row("a", 1, personal)] }), answer(page(personal, [{ id: "a", removed: true, seq: 2 }])));
    expect(state.records).toEqual([]);
    expect(changed).toBe(true);
  });
  it("counts a row saved by an older build, which has no space yet, as personal when it's removed", () => {
    const { state } = applyChanges(start({ records: [row("a")] }), answer(page(personal, [{ id: "a", removed: true, seq: 2 }])));
    expect(state.records).toEqual([]);
  });
  it("keeps a row that moved, whichever side of the move is read first", () => {
    const moved = { ...row("a", 2, family), seq: 4, entity: "record" as const }, gone = { id: "a", removed: true as const, seq: 3 };
    for (const pages of [[page(personal, [gone]), page(family, [moved])], [page(family, [moved]), page(personal, [gone])]]) {
      const { state } = applyChanges(start({ records: [row("a", 1, personal)] }), answer(...pages));
      expect(state.records).toMatchObject([{ id: "a", revision: 2, space_id: family }]);
    }
  });
  it("leaves routines to their own snapshot, which also sets their reminders", () => {
    const { state, changed } = applyChanges(start(), answer(page(personal, [{ ...row("r", 1, personal), kind: "routine", seq: 2, entity: "record" }])));
    expect(state.records).toEqual([]);
    expect(changed).toBe(false);
  });
  it("updates a child, and removes one only from the space it was removed from", () => {
    const child = { id: "c", name: "Baby", revision: 2, space_id: personal };
    const moved = applyChanges(start({ bootstrap: boot({ children: [{ ...child, revision: 1 }] }) }), answer(page(personal, [{ ...child, seq: 3, entity: "child" }])));
    expect(moved.state.bootstrap?.children).toEqual([child]);
    const stays = applyChanges(start({ bootstrap: boot({ children: [{ ...child, space_id: family }] }) }), answer(page(personal, [{ id: "c", removed: true, seq: 4 }])));
    expect(stays.state.bootstrap?.children).toHaveLength(1);
    const gone = applyChanges(start({ bootstrap: boot({ children: [child] }) }), answer(page(personal, [{ id: "c", removed: true, seq: 4 }])));
    expect(gone.state.bootstrap?.children).toEqual([]);
  });
  it("ignores what this phone doesn't keep: files, chats, captures and credentials", () => {
    const { state, changed } = applyChanges(start(), answer(page(personal, [
      { id: "x", seq: 1, entity: "attachment" }, { id: "y", seq: 2, entity: "conversation" }, { id: "z", seq: 3, entity: "credential", revoked: true },
    ])));
    expect(state.records).toEqual([]);
    expect(changed).toBe(false);
  });
  it("asks for the next page", () => {
    expect(applyChanges(start(), answer(page(personal, [], { has_more: true }))).more).toBe(true);
  });
  it("on a reset drops that space's rows at once and starts again from nothing, leaving the other space alone", () => {
    const { state, changed, more } = applyChanges(
      start({ records: [row("mine", 1, personal), row("shared", 1, family)], changes: { cursor: { [personal]: 5, [family]: 8 }, access: { [personal]: 1, [family]: 1 } } }),
      answer(page(family, [], { reset: true, cursor: 0, access_version: 2 })));
    expect(state.records.map((r) => r.id)).toEqual(["mine"]);
    expect(state.changes).toEqual({ cursor: { [personal]: 5, [family]: 0 }, access: { [personal]: 1, [family]: 2 } });
    expect(changed).toBe(true);
    expect(more).toBe(true);
  });
  it("forgets a space it's no longer in", () => {
    const { state, changed } = applyChanges(
      start({ records: [row("mine", 1, personal), row("shared", 1, family)], changes: { cursor: { [personal]: 5, [family]: 8 }, access: { [personal]: 1, [family]: 1 } } }),
      { ...answer(page(personal, [], { cursor: 5 })), removed_space_ids: [family] });
    expect(state.records.map((r) => r.id)).toEqual(["mine"]);
    expect(state.changes).toEqual({ cursor: { [personal]: 5 }, access: { [personal]: 1 } });
    expect(changed).toBe(true);
  });
  it("remembers what the API said was removed, even a row this phone had no copy of", () => {
    const { state } = applyChanges(start({ removed: ["older"] }), answer(page(personal, [{ id: "never-cached", removed: true, seq: 2 }])));
    expect(state.removed).toEqual(["older", `${personal}:never-cached`]);
    expect(removedFrom(state, personal, "never-cached")).toBe(true);
    expect(removedFrom(state, family, "never-cached")).toBe(false);
  });
  it("doesn't count a reset, or a row merely missing here, as removed", () => {
    const { state } = applyChanges(start({ records: [row("a", 1, family)] }), answer(page(family, [], { reset: true, cursor: 0 })));
    expect(state.records).toEqual([]);
    expect(state.removed ?? []).toEqual([]);
  });
  it("keeps that list from growing without end", () => {
    const { state } = applyChanges(start({ removed: Array.from({ length: 300 }, (_, i) => String(i)) }), answer(page(personal, [{ id: "new", removed: true, seq: 2 }])));
    expect(state.removed).toHaveLength(300);
    expect(state.removed?.at(-1)).toBe(`${personal}:new`);
  });
  it("finishes the job when a space is gone: its baby, its queue and its rows", () => {
    const queued = { id: "q", generation: 1, space_id: family, type: "save" as const, base: { after: [] }, record: row("q", 1, family), files: [] };
    const { state } = applyChanges(start({ records: [row("shared", 1, family)], outbox: [queued], bootstrap: boot({ children: [{ id: "c", name: "Mia", revision: 1, space_id: family }] }) }),
      { ...answer(page(personal, [], { cursor: 5 })), removed_space_ids: [family] });
    expect(state.bootstrap?.children).toEqual([]);
    expect(state.records).toEqual([]);
    expect(state.outbox[0]).toMatchObject({ left_space: family });
  });
  it("never sheds a queued change or a draft", () => {
    const save = { id: "m", generation: 1, type: "save" as const, record: row("a", 1, family), files: [] };
    const { state } = applyChanges(start({ records: [row("a", 1, family)], outbox: [save] }), answer(page(family, [], { reset: true, cursor: 0 })));
    expect(state.outbox).toEqual([save]);
  });
});

describe("what the app reads off bootstrap", () => {
  it("only uses change-fetching when the API listed its spaces", () => {
    expect(spacesLive(boot())).toBe(true);
    expect(spacesLive(boot({ spaces: undefined }))).toBe(false);
    expect(spacesLive(undefined)).toBe(false);
  });
  it("gives the same access key to the flag turning on, so that alone never remounts an open editor", () => {
    expect(accessKey(boot())).toBe(accessKey(boot({ spaces: undefined, personal_space_id: undefined })));
  });
  it("changes the access key when a family arrives, leaves or changes role, and not on its access version", () => {
    const space = { id: family, kind: "family" as const, role: "parent" as const, generation: 1, access_version: 1 }, own = boot().spaces!;
    const joined = accessKey(boot({ spaces: [...own, space] }));
    expect(joined).not.toBe(accessKey(boot()));
    expect(accessKey(boot({ spaces: [...own, { ...space, role: "caregiver" }] }))).not.toBe(joined);
    expect(accessKey(boot({ spaces: [...own, { ...space, access_version: 9 }] }))).toBe(joined);
  });
});
