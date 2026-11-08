import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyState } from "./models";
const mock = vi.hoisted(() => ({ b: null as any, lease: 1, changeOwner: false, sequence: 0, mounts: 0 }));
vi.mock("../lib/context", () => ({ useBaby: () => mock.b }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-crypto", async () => {
  const { createHash } = await import("node:crypto");
  return { randomUUID: () => `candidate-${++mock.sequence}`, CryptoDigestAlgorithm: { SHA256: "sha256" }, digestStringAsync: async (_: string, text: string) => {
    if (mock.changeOwner) mock.lease++;
    return createHash("sha256").update(text).digest("hex");
  } };
});
vi.mock("../components/ui", async () => {
  const React = await import("react");
  return Object.fromEntries(["Button", "Card", "Choice", "Copy", "Field", "FilterChips", "Notice", "Row", "Screen"].map((name) => [name, (props: any) => { const { footer, ...rest } = props; const [mount] = React.useState(() => ++mock.mounts); return React.createElement(name, { ...rest, ...(name === "Screen" ? { mount } : {}) }, props.children, footer); }]));
});
vi.mock("../components/disclosure", () => ({ Disclosure: ({ children }: any) => children }));
vi.mock("../components/date-field", () => ({ DateField: "DateField" }));
import PasteVisits from "../app/paste-visits";
let tree: ReactTestRenderer;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mock.lease = 1; mock.changeOwner = false; mock.sequence = 0;
  mock.b = { owner: "stable-app-owner", state: { ...emptyState(), bootstrap: { generation: 1, visit_import_available: true, personal_space_id: "me", profile: { timezone: "Pacific/Guam" }, children: [{ id: "pregnancy", name: "Baby", space_id: "me", due_date: "2026-12-10" }] } },
    api: { lease: () => mock.lease, assertLease: (lease: number) => { if (lease !== mock.lease) throw Error("Your account changed."); } },
    commit: vi.fn(async (change: any) => { mock.b.state = change(mock.b.state); }), sync: vi.fn(async () => {}) };
});
const saveButton = () => tree.root.findAll((node) => String(node.type) === "Button" && /^Save \d+ items?$/.test(node.props.title))[0];
const host = (type: string, key: string, value: string) => tree.root.findAll((node) => node.type === type && node.props[key] === value)[0];
async function review(text: string) {
  const before = mock.b.state.outbox.length;
  await act(async () => { tree = create(<PasteVisits />); });
  await act(async () => host("Field", "label", "Paste your note").props.onChange(text));
  await act(async () => host("Button", "title", "Review your note").props.onPress());
  expect(mock.b.state.outbox).toHaveLength(before);
}
it("keeps all words, writes only on confirmation, and reuses identities on a repeated review", async () => {
  const text = "April 1, 2026 first test 💛\n" + "Words to keep. ".repeat(1000);
  await review(text);
  await act(async () => saveButton().props.onPress());
  expect(mock.b.state.outbox).toHaveLength(2);
  expect(mock.b.state.outbox.every((item: any) => item.record.body === text && item.space_id === "me")).toBe(true);
  const hasUndefined = (value: any): boolean => value === undefined || (value !== null && typeof value === "object" && Object.values(value).some(hasUndefined));
  expect(hasUndefined(mock.b.state.outbox)).toBe(false);
  await act(async () => tree.unmount());
  await review(text);
  await act(async () => saveButton().props.onPress());
  expect(mock.b.state.outbox).toHaveLength(2);
  await act(async () => tree.unmount());
});
it("fences an account change during asynchronous identity preparation", async () => {
  await review("2026-11-08 GBS swab done");
  mock.changeOwner = true;
  await act(async () => saveButton().props.onPress());
  expect(mock.b.commit).not.toHaveBeenCalled();
  expect(mock.b.state.outbox).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain("Your account changed.");
  await act(async () => tree.unmount());
});

it("uses the shared space for item identity across two family members", async () => {
  const ids: string[] = [];
  for (const owner of ["parent-a", "parent-b"]) {
    mock.b.owner = owner;
    mock.b.state = { ...emptyState(), bootstrap: { generation: 1, visit_import_available: true, personal_space_id: owner, profile: { timezone: "Pacific/Guam" }, children: [{ id: "family-baby", name: "Baby", space_id: "family", due_date: "2026-12-10" }], spaces: [{ id: owner, kind: "personal", generation: 1 }, { id: "family", kind: "family", role: "parent", generation: 1 }] } };
    await review("2026-11-09 Clinic class");
    await act(async () => host("Choice", "label", "Share this item and its original words with family").props.onPress());
    await act(async () => saveButton().props.onPress());
    const event = mock.b.state.outbox.find((item: any) => item.record.kind === "event");
    expect(event.space_id).toBe("family"); ids.push(event.record.id);
    await act(async () => tree.unmount());
  }
  expect(ids[0]).toBe(ids[1]);
});

it.each([false, true])("blocks an incompatible visit destination without changing privacy (shared=%s)", async (shared) => {
  mock.b.state.bootstrap = { ...mock.b.state.bootstrap, children: [{ id: "pregnancy", name: "Baby", space_id: shared ? "me" : "family", due_date: "2026-12-10" }], spaces: [{ id: "me", kind: "personal", generation: 1 }, { id: "family", kind: "family", role: "parent", generation: 1 }] };
  await review("1st Visit - November 8, 2026\n35 weeks");
  if (shared) await act(async () => host("Choice", "label", "Share this item and its original words with family").props.onPress());
  expect(saveButton().props.disabled).toBe(true);
  await act(async () => saveButton().props.onPress());
  expect(mock.b.commit).not.toHaveBeenCalled();
  expect(mock.b.state.outbox).toEqual([]);
  expect(host("Choice", "label", "Share this item and its original words with family").props.selected).toBe(shared);
  expect(JSON.stringify(tree.toJSON())).toContain("Choose a pregnancy that matches each visit");
  await act(async () => host("Choice", "label", "Share this item and its original words with family").props.onPress());
  expect(saveButton().props.disabled).toBe(false);
  await act(async () => saveButton().props.onPress());
  const event = mock.b.state.outbox.find((item: any) => item.record.kind === "event");
  expect(event.record.child_id).toBe("pregnancy");
  expect(event.space_id).toBe(shared ? "me" : "family");
  expect(event.record.data.due_date_snapshot).toBe("2026-12-10");
  expect(mock.b.state.outbox[0].space_id).toBe("me");
  await act(async () => tree.unmount());
});

it("keeps the original personal in a family and imports visits without reminders", async () => {
  mock.b.state.bootstrap.children[0].space_id = "family";
  mock.b.state.bootstrap.spaces = [{ id: "me", kind: "personal", generation: 1 }, { id: "family", kind: "family", role: "parent", generation: 1 }];
  await review("1st Visit - November 8, 2026\n35 weeks");
  await act(async () => host("Choice", "label", "Share this item and its original words with family").props.onPress());
  await act(async () => saveButton().props.onPress());
  const original = mock.b.state.outbox.find((m: any) => m.record.data.paste_origin.original);
  expect(original.space_id).toBe("me");
  const event = mock.b.state.outbox.find((m: any) => m.record.kind === "event");
  expect(event.space_id).toBe("family"); expect(event.record.data.reminder_minutes).toEqual([]);
  await act(async () => tree.unmount());
});
it("targets the expecting child even when an older born child is selected", async () => {
  mock.b.state.bootstrap.children = [{ id: "older", name: "Older", space_id: "me", due_date: "2024-12-10", birth_date: "2024-12-05" }, { id: "expecting", name: "Baby", space_id: "me", due_date: "2026-12-10" }];
  mock.b.state.selectedChild = "older";
  await review("1st Visit - November 8, 2026\n35 weeks");
  expect(tree.root.findAll((n) => String(n.type) === "Copy").map((n) => React.Children.toArray(n.props.children).join("")).join("\n")).toContain("Visits for Baby.");
  await act(async () => saveButton().props.onPress());
  const row = mock.b.state.outbox.find((m: any) => m.record.kind === "event");
  expect(row.record.child_id).toBe("expecting");expect(row.record.data.due_date_snapshot).toBe("2026-12-10");
  await act(async () => tree.unmount());
});
it("asks which expecting child when more than one pregnancy is available", async () => {
  mock.b.state.bootstrap.children = ["a", "b"].map((id) => ({ id, name: id, space_id: "me", due_date: "2026-12-10" }));
  await review("1st Visit - November 8, 2026\n35 weeks");
  await act(async () => saveButton().props.onPress());
  expect(mock.b.state.outbox).toHaveLength(0);
  await act(async () => host("FilterChips", "label", "Expecting baby").props.onChange("b"));
  await act(async () => saveButton().props.onPress());
  expect(mock.b.state.outbox.find((m: any) => m.record.kind === "event").record.child_id).toBe("b");
  await act(async () => tree.unmount());
});

it("keeps candidate selection and edits independent", async () => {
  await review("1st Visit - May 6, 2026\n8 weeks\n2nd Visit - June 3, 2026\n12 weeks");
  const choices = tree.root.findAll((n) => String(n.type) === "Choice" && n.props.label === "Include this item");
  expect(choices.map((n) => n.props.selected)).toEqual([true, true]);
  await act(async () => choices[1].props.onPress());
  expect(saveButton().props.title).toBe("Save 1 item");
  await act(async () => choices[1].props.onPress());
  const titles = tree.root.findAll((n) => String(n.type) === "Field" && n.props.label === "Title");
  await act(async () => titles[1].props.onChange("Second, edited"));
  await act(async () => saveButton().props.onPress());
  expect(mock.b.state.outbox.map((m: any) => m.record.title)).toEqual(["Original pregnancy notes", "1st Visit", "Second, edited"]);
  expect(new Set(mock.b.state.outbox.map((m: any) => m.record.id)).size).toBe(3);
  await act(async () => tree.unmount());
});
it("does not deduplicate the same words for different expecting children", async () => {
  mock.b.state.bootstrap.children = ["a", "b"].map((id) => ({ id, name: id, space_id: "me", due_date: "2026-12-10" }));
  for (const child of ["a", "b"]) {
    await review("1st Visit - November 8, 2026\n35 weeks");
    await act(async () => host("FilterChips", "label", "Expecting baby").props.onChange(child));
    await act(async () => saveButton().props.onPress());
    await act(async () => tree.unmount());
  }
  const events = mock.b.state.outbox.filter((m: any) => m.record.kind === "event");
  expect(events.map((m: any) => m.record.child_id)).toEqual(["a", "b"]);
  expect(events[0].record.id).not.toBe(events[1].record.id);
});
it("uses the fallback for a whitespace-only source title", async () => {
  await act(async () => { tree = create(<PasteVisits />); });
  await act(async () => host("Field", "label", "Note title").props.onChange("   "));
  await act(async () => host("Field", "label", "Paste your note").props.onChange("April 1, 2026 first test"));
  await act(async () => host("Button", "title", "Review your note").props.onPress());
  await act(async () => saveButton().props.onPress());
  expect(mock.b.state.outbox[0].record.title).toBe("Original pregnancy notes");
  await act(async () => tree.unmount());
});

it("keeps review editable without committing when the service predates import support", async () => {
  mock.b.state.bootstrap.visit_import_available = false;
  await review("1st Visit - May 6, 2026\n8 weeks");
  await act(async () => saveButton().props.onPress());
  expect(mock.b.commit).not.toHaveBeenCalled(); expect(mock.b.state.outbox).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain("updated Håfa Baby service");
  mock.b.state.bootstrap.visit_import_available = true;
  await act(async () => saveButton().props.onPress());
  expect(mock.b.state.outbox).toHaveLength(2);
  await act(async () => tree.unmount());
});

it("reuses an older import identity when the API returns an equivalent UTC offset", async () => {
  const text = "1st Visit - May 6, 2026\n8 weeks";
  mock.b.state.bootstrap.children = [{ id: "baby", name: "Baby", space_id: "me", due_date: "2026-12-10" }];
  mock.b.state.records = [{ id: "earlier-capture", kind: "event", title: "1st Visit", body: text, child_id: "baby", space_id: "me", occurred_at: "2026-05-05T14:00:00+00:00", data: { paste_origin: { text, start: 0, end: text.length, original: false } } }];
  await review(text);
  await act(async () => saveButton().props.onPress());
  expect(mock.b.state.outbox.find((m: any) => m.record.kind === "event").record.id).toBe("earlier-capture");
  await act(async () => tree.unmount());
});

it("suggests a pregnancy year for review and never saves or applies it silently", async () => {
  mock.b.state.bootstrap.children = [{ id: "baby", name: "Baby", due_date: "2026-12-10", space_id: "me" }];
  const text = "First test on April 4\n\n1st Visit - May 6, 2026\n8 weeks";
  await review(text);
  expect(host("Field", "label", "Which year were these?").props.value).toBe("2026");
  expect(saveButton().props.title).toBe("Save 2 items");expect(saveButton().props.disabled).toBe(true);
  expect(mock.b.commit).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).not.toContain("Original characters");
  expect(tree.root.findAll((n) => String(n.type) === "Copy").map((n) => React.Children.toArray(n.props.children).join("")).join("\n")).toContain("1 visit and 1 moment from your note");
  await act(async () => host("Button", "title", "Use 2026").props.onPress());
  expect(saveButton().props.disabled).toBe(false);expect(mock.b.commit).not.toHaveBeenCalled();
  await act(async () => saveButton().props.onPress());
  expect(mock.b.state.outbox[0].record.body).toBe(text);
  expect(mock.b.state.outbox[1].record.occurred_at).toBe("2026-04-03T14:00:00.000Z");
  expect(mock.b.state.outbox[1].record.data.paste_origin).toMatchObject({ text: "First test on April 4\n\n", start: 0 });
  await act(async () => tree.unmount());
});
it("leaves an uncertain year blank and lets a date be set directly", async () => {
  mock.b.state.bootstrap.children = [{ id: "baby", name: "Baby", due_date: "2026-12-10", space_id: "me" }];
  await review("First test on January 4");
  expect(host("Field", "label", "Which year were these?").props.value).toBe("");
  expect(saveButton().props.disabled).toBe(true);
  await act(async () => host("DateField", "label", "Date").props.onChange("2026-01-04"));
  expect(saveButton().props.disabled).toBe(false);expect(mock.b.state.outbox).toHaveLength(0);
  await act(async () => tree.unmount());
});

it("starts the review at the top without jumping during item edits", async () => {
  await act(async () => { tree = create(<PasteVisits />); });
  const before = host("Screen", "title", "Bring in pregnancy notes").props.mount;
  await act(async () => host("Field", "label", "Paste your note").props.onChange("April 1, 2026 first test"));
  await act(async () => host("Button", "title", "Review your note").props.onPress());
  const after = host("Screen", "title", "Bring in pregnancy notes").props.mount;
  expect(after).not.toBe(before);
  await act(async () => host("Choice", "label", "Include this item").props.onPress());
  expect(host("Screen", "title", "Bring in pregnancy notes").props.mount).toBe(after);
  await act(async () => tree.unmount());
});

it("never saves an unchecked candidate, while keeping the private original intact", async () => {
  const note = "1st Visit - May 6, 2026\n8 weeks\n2nd Visit - June 3, 2026\n12 weeks";
  await review(note);
  const choices = tree.root.findAll((n) => String(n.type) === "Choice" && n.props.label === "Include this item");
  await act(async () => choices[1].props.onPress());
  expect(saveButton().props.title).toBe("Save 1 item");
  await act(async () => saveButton().props.onPress());
  expect(mock.b.state.outbox).toHaveLength(2);
  expect(mock.b.state.outbox[0].record.body).toBe(note);
  expect(mock.b.state.outbox.filter((m: any) => m.record.kind === "event").map((m: any) => m.record.title)).toEqual(["1st Visit"]);
  await act(async () => tree.unmount());
});
it("requires an expecting profile for selected visits without saving even the original", async () => {
  mock.b.state.bootstrap.children = [{ id: "born", name: "Baby", space_id: "me", due_date: "2026-12-10", birth_date: "2026-12-10" }];
  await review("1st Visit - May 6, 2026\n8 weeks");
  expect(saveButton().props.disabled).toBe(true);
  expect(host("Button", "title", "Add expecting baby")).toBeDefined();
  await act(async () => saveButton().props.onPress());
  expect(mock.b.state.outbox).toHaveLength(0);expect(mock.b.commit).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("Add an expecting baby profile to save visits");
  await act(async () => tree.unmount());
});
it.each([false, true])("allows moments without an expecting profile, with explicit family sharing (%s)", async (shared) => {
  mock.b.state.bootstrap.children = [];
  mock.b.state.bootstrap.spaces = [{ id: "me", kind: "personal", generation: 1 }, { id: "family", kind: "family", role: "parent", generation: 1 }];
  await review("First test on April 4, 2026\n\n1st Visit - May 6, 2026\n8 weeks");
  const choices = tree.root.findAll((n) => String(n.type) === "Choice" && n.props.label === "Include this item");
  await act(async () => choices[1].props.onPress());
  if (shared) await act(async () => host("Choice", "label", "Share this item and its original words with family").props.onPress());
  expect(saveButton().props.disabled).toBe(false);
  await act(async () => saveButton().props.onPress());
  expect(mock.b.state.outbox).toHaveLength(2);
  expect(mock.b.state.outbox[0].space_id).toBe("me");
  expect(mock.b.state.outbox[1].space_id).toBe(shared ? "family" : "me");
  expect(mock.b.state.outbox[1].record.kind).toBe("journal");
  expect(mock.b.state.outbox[1].record.child_id).toBeNull();
  await act(async () => tree.unmount());
});
