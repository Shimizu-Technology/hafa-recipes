import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyState } from "./models";
const mock = vi.hoisted(() => ({ b: null as any, lease: 1, changeOwner: false, sequence: 0 }));
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
  return Object.fromEntries(["Button", "Card", "Choice", "Copy", "Field", "FilterChips", "Notice", "Row", "Screen"].map((name) => [name, (props: any) => { const { footer, ...rest } = props; return React.createElement(name, rest, props.children, footer); }]));
});
import PasteVisits from "../app/paste-visits";
let tree: ReactTestRenderer;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mock.lease = 1; mock.changeOwner = false; mock.sequence = 0;
  mock.b = { owner: "stable-app-owner", state: { ...emptyState(), bootstrap: { generation: 1, visit_import_available: true, personal_space_id: "me", profile: { timezone: "Pacific/Guam" }, children: [] } },
    api: { lease: () => mock.lease, assertLease: (lease: number) => { if (lease !== mock.lease) throw Error("Your account changed."); } },
    commit: vi.fn(async (change: any) => { mock.b.state = change(mock.b.state); }), sync: vi.fn(async () => {}) };
});
const host = (type: string, key: string, value: string) => tree.root.findAll((node) => node.type === type && node.props[key] === value)[0];
async function review(text: string) {
  const before = mock.b.state.outbox.length;
  await act(async () => { tree = create(<PasteVisits />); });
  await act(async () => host("Field", "label", "Paste your note").props.onChange(text));
  await act(async () => host("Button", "title", "Review dated items").props.onPress());
  expect(mock.b.state.outbox).toHaveLength(before);
  await act(async () => host("Choice", "label", "Save this item").props.onPress());
}
it("keeps all words, writes only on confirmation, and reuses identities on a repeated review", async () => {
  const text = "April 1, 2026 first test 💛\n" + "Words to keep. ".repeat(1000);
  await review(text);
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.state.outbox).toHaveLength(2);
  expect(mock.b.state.outbox.every((item: any) => item.record.body === text && item.space_id === "me")).toBe(true);
  const hasUndefined = (value: any): boolean => value === undefined || (value !== null && typeof value === "object" && Object.values(value).some(hasUndefined));
  expect(hasUndefined(mock.b.state.outbox)).toBe(false);
  await act(async () => tree.unmount());
  await review(text);
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.state.outbox).toHaveLength(2);
  await act(async () => tree.unmount());
});
it("fences an account change during asynchronous identity preparation", async () => {
  await review("2026-11-08 GBS swab done");
  mock.changeOwner = true;
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.commit).not.toHaveBeenCalled();
  expect(mock.b.state.outbox).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain("Your account changed.");
  await act(async () => tree.unmount());
});

it("uses the shared space for item identity across two family members", async () => {
  const ids: string[] = [];
  for (const owner of ["parent-a", "parent-b"]) {
    mock.b.owner = owner;
    mock.b.state = { ...emptyState(), bootstrap: { generation: 1, visit_import_available: true, personal_space_id: owner, profile: { timezone: "Pacific/Guam" }, children: [], spaces: [{ id: owner, kind: "personal", generation: 1 }, { id: "family", kind: "family", role: "parent", generation: 1 }] } };
    await review("2026-11-09 Clinic class");
    await act(async () => host("Choice", "label", "Share this item and its original words with family").props.onPress());
    await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
    const event = mock.b.state.outbox.find((item: any) => item.record.kind === "event");
    expect(event.space_id).toBe("family"); ids.push(event.record.id);
    await act(async () => tree.unmount());
  }
  expect(ids[0]).toBe(ids[1]);
});

it("snapshots the chosen pregnancy without linking a private event to a family child", async () => {
  mock.b.state.bootstrap = { ...mock.b.state.bootstrap, children: [{ id: "family-baby", space_id: "family", due_date: "2026-12-10" }], spaces: [{ id: "me", kind: "personal", generation: 1 }, { id: "family", kind: "family", role: "parent", generation: 1 }] };
  mock.b.state.selectedChild = "family-baby";
  await review("2026-11-08 35 weeks per clinic");
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  const event = mock.b.state.outbox.find((item: any) => item.record.kind === "event");
  expect(event.space_id).toBe("me");
  expect(event.record.child_id).toBeNull();
  expect(event.record.data.due_date_snapshot).toBe("2026-12-10");
  await act(async () => tree.unmount());
});

it("keeps the original personal in a family and imports visits without reminders", async () => {
  mock.b.state.bootstrap.spaces = [{ id: "me", kind: "personal", generation: 1 }, { id: "family", kind: "family", role: "parent", generation: 1 }];
  await review("1st Visit - November 8, 2026\n35 weeks");
  await act(async () => host("Choice", "label", "Share this item and its original words with family").props.onPress());
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
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
  expect(JSON.stringify(tree.toJSON())).toContain("Prenatal visits for Baby.");
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  const row = mock.b.state.outbox.find((m: any) => m.record.kind === "event");
  expect(row.record.child_id).toBe("expecting");expect(row.record.data.due_date_snapshot).toBe("2026-12-10");
  await act(async () => tree.unmount());
});
it("asks which expecting child when more than one pregnancy is available", async () => {
  mock.b.state.bootstrap.children = ["a", "b"].map((id) => ({ id, name: id, space_id: "me", due_date: "2026-12-10" }));
  await review("1st Visit - November 8, 2026\n35 weeks");
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.state.outbox).toHaveLength(0);
  await act(async () => host("FilterChips", "label", "Expecting baby").props.onChange("b"));
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.state.outbox.find((m: any) => m.record.kind === "event").record.child_id).toBe("b");
  await act(async () => tree.unmount());
});

it("keeps candidate selection and edits independent", async () => {
  await review("1st Visit - May 6, 2026\n8 weeks\n2nd Visit - June 3, 2026\n12 weeks");
  const choices = tree.root.findAll((n) => String(n.type) === "Choice" && n.props.label === "Save this item");
  expect(choices.map((n) => n.props.selected)).toEqual([true, false]);
  await act(async () => choices[1].props.onPress());
  const titles = tree.root.findAll((n) => String(n.type) === "Field" && n.props.label === "Title");
  await act(async () => titles[1].props.onChange("Second, edited"));
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.state.outbox.map((m: any) => m.record.title)).toEqual(["Original pregnancy notes", "1st Visit", "Second, edited"]);
  expect(new Set(mock.b.state.outbox.map((m: any) => m.record.id)).size).toBe(3);
  await act(async () => tree.unmount());
});
it("does not deduplicate the same words for different expecting children", async () => {
  mock.b.state.bootstrap.children = ["a", "b"].map((id) => ({ id, name: id, space_id: "me", due_date: "2026-12-10" }));
  for (const child of ["a", "b"]) {
    await review("1st Visit - November 8, 2026\n35 weeks");
    await act(async () => host("FilterChips", "label", "Expecting baby").props.onChange(child));
    await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
    await act(async () => tree.unmount());
  }
  const events = mock.b.state.outbox.filter((m: any) => m.record.kind === "event");
  expect(events.map((m: any) => m.record.child_id)).toEqual(["a", "b"]);
  expect(events[0].record.id).not.toBe(events[1].record.id);
});
it("uses the fallback for a whitespace-only source title", async () => {
  await act(async () => { tree = create(<PasteVisits />); });
  await act(async () => host("Field", "label", "Original note title").props.onChange("   "));
  await act(async () => host("Field", "label", "Paste your note").props.onChange("April 1, 2026 first test"));
  await act(async () => host("Button", "title", "Review dated items").props.onPress());
  await act(async () => host("Choice", "label", "Save this item").props.onPress());
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.state.outbox[0].record.title).toBe("Original pregnancy notes");
  await act(async () => tree.unmount());
});

it("keeps review editable without committing when the service predates import support", async () => {
  mock.b.state.bootstrap.visit_import_available = false;
  await review("1st Visit - May 6, 2026\n8 weeks");
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.commit).not.toHaveBeenCalled(); expect(mock.b.state.outbox).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain("updated Håfa Baby service");
  mock.b.state.bootstrap.visit_import_available = true;
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.state.outbox).toHaveLength(2);
  await act(async () => tree.unmount());
});

it("reuses an older import identity when the API returns an equivalent UTC offset", async () => {
  const text = "1st Visit - May 6, 2026\n8 weeks";
  mock.b.state.bootstrap.children = [{ id: "baby", name: "Baby", space_id: "me", due_date: "2026-12-10" }];
  mock.b.state.records = [{ id: "earlier-capture", kind: "event", title: "1st Visit", body: text, child_id: "baby", space_id: "me", occurred_at: "2026-05-05T14:00:00+00:00", data: { paste_origin: { text, start: 0, end: text.length, original: false } } }];
  await review(text);
  await act(async () => host("Button", "title", "Confirm selected items").props.onPress());
  expect(mock.b.state.outbox.find((m: any) => m.record.kind === "event").record.id).toBe("earlier-capture");
  await act(async () => tree.unmount());
});
