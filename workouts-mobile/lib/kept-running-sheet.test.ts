import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import type { SessionDraft } from "./training";

vi.mock("react-native", () => ({ View: "View" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Copy: "Copy", Row: "Row", Sheet: "Sheet",
  formatClock: (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` }));
import { KeptRunningSheet } from "@/components/training/kept-running-sheet";

it("keeps the clock on one line at the largest text size, reading time left for an AMRAP", () => {
  // 10 s into a 15-minute AMRAP that started at 0.
  const d = { active_milliseconds: 0, active_started_at: 0, paused: false, timed_circuit: { time_cap_seconds: 900, round_size: 4 },
    clock_kept_running: { left_at: 5_000 } } as unknown as SessionDraft & { clock_kept_running: { left_at: number } };
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(createElement(KeptRunningSheet, { d, now: 10_000, busy: false, cap: 900, onKeep: vi.fn(), onStoppedAt: vi.fn() })); });
  const clock = renderer!.root.findAll((node) => (node.type as unknown) === "Copy" && node.props.kind === "numeric")[0];
  expect(clock.props.fit).toBe(true);
  expect(clock.props.children).toBe("14:50");
});
