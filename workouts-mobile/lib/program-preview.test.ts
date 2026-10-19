import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import type { Program, Workout } from "./models";
import type { ProgramReceipt } from "./plans";

vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable" }));
vi.mock("../components/ui", () => ({ Card: "Card", Copy: "Copy", Notice: "Notice" }));
import { ProgramPreview } from "../components/program-preview";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });
const steady = "Controlled, manageable repetitions; stop before form breaks down. Load is not inferred.";
const workout = (provenance: Workout["provenance"], exercises: Workout["blocks"][number]["exercises"]): Workout =>
  ({ id: provenance, title: `${provenance} session`, generation: 1, revision: 1, kind: "session", provenance,
    blocks: [{ id: "main", label: "Main", grouping: "sequential", exercises }] });
async function render(sessions: Workout[], notes: { status?: string; questions?: string[]; warnings?: string[] } = {}) {
  const receipt = { expires_at: "2026-10-20T12:00:00Z", proposal: { status: notes.status ?? "ready", questions: notes.questions ?? [],
    warnings: notes.warnings ?? [], assumptions: [], source_ids: [],
    rule_version: "test", sessions: sessions.map((w, i) => ({ id: `s${i}`, date: "2026-11-13", purpose: "Strength", workout: w })) } as unknown as Program };
  await act(async () => { renderer = create(createElement(ProgramPreview, { receipt: receipt as unknown as ProgramReceipt })); });
  return renderer!.root.findAll((n) => String(n.type) === "Copy" || String(n.type) === "Notice")
    .map((n) => [n.props.children].flat(3).filter((c) => typeof c === "string").join(""));
}

it("shows shared effort once only when every exercise has it", async () => {
  const lines = await render([workout("suggestion", [{ name: "Row", sets: 3, effort: steady }, { name: "Squat", sets: 3, effort: steady }])]);
  expect(lines.filter((line) => line.includes(steady))).toEqual([`Effort for every exercise · ${steady}`]);
});

it("keeps effort on the exercises that have it when a saved exercise has none", async () => {
  const lines = await render([workout("suggestion", [{ name: "Row", sets: 3, effort: steady }]), workout("user", [{ name: "My curl", sets: 2 }])]);
  expect(lines.some((line) => line.startsWith("Effort for every exercise"))).toBe(false);
  expect(lines.filter((line) => line.includes(steady))).toEqual([`Effort · ${steady}`]);
});

it("discloses each session's source once and labels only exercises from a different source", async () => {
  const lines = await render([
    workout("suggestion", [{ name: "Row", sets: 3 }, { name: "Saved press", sets: 3, provenance: "user" }]),
    workout("user", [{ name: "My curl", sets: 2, provenance: "user" }]),
  ]);
  expect(lines.filter((line) => line === "Suggested by Håfa")).toHaveLength(1);
  expect(lines.filter((line) => line === "From your saved workout")).toHaveLength(2); // Session 2, plus the one differing exercise.
  expect(lines.some((line) => line.includes("prescription"))).toBe(false);
  expect(lines.some((line) => /Nov 13(, 2026)? · suggestion session/.test(line))).toBe(true);
});

it("expands a compact cue and updates its accessibility hint", async () => {
  const cue = "Keep the ribs down and control each repetition through the full range.";
  await render([workout("suggestion", [{ name: "Row", sets: 3, instructions: cue }])]);
  const pressable = () => renderer!.root.findAll((node) => String(node.type) === "Pressable")[0];
  const copy = () => renderer!.root.findAll((node) => String(node.type) === "Copy").find((node) => node.props.children === cue)!;
  expect(copy().props.numberOfLines).toBe(1);
  expect(pressable().props.accessibilityHint).toBe("Shows the full cue");
  await act(async () => pressable().props.onPress());
  expect(copy().props.numberOfLines).toBeUndefined();
  expect(pressable().props.accessibilityHint).toBe("Shows one line");
});

it.each([["ready", "Good to know"], ["needs_information", "Before this plan is ready"]])(
  "groups questions and warnings in one %s card", async (status, heading) => {
    const lines = await render([workout("suggestion", [{ name: "Row", sets: 3 }])], {
      status, questions: ["Which days suit you?"], warnings: ["Load is not inferred; qualified programming review is pending (D03)."],
    });
    expect(renderer!.root.findAll((node) => String(node.type) === "Notice")).toHaveLength(0);
    const start = lines.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(lines.slice(start + 1, start + 3)).toEqual(["• Which days suit you?", "• Load is not inferred; qualified programming review is pending."]);
    expect(lines.join(" ")).not.toContain("D03");
  });
