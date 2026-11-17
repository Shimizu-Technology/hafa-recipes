import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Modal: "Modal", View: "View" }));
vi.mock("expo-speech", () => ({ speak: vi.fn() }));
vi.mock("@/components/ui", () => ({ Button: "Button", Copy: "Copy", haptics: { tick: vi.fn(), warning: vi.fn() }, useColors: () => ({ background: "#fff" }) }));
vi.mock("@/components/training/session-parts", () => ({ announce: vi.fn() }));
vi.mock("@/components/training/keep-awake", () => ({ useKeepAwakeWhile: vi.fn() }));
import { LeadIn } from "@/components/training/lead-in";

it("Start now is a full-size button whose label stays on one line beside its icon", () => {
  const onSkip = vi.fn();
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(createElement(LeadIn, { until: Date.now() + 3_000, label: "AMRAP 15", onSkip, onDone: vi.fn() })); });
  const start = renderer!.root.find((node) => (node.type as unknown) === "Button");
  // A filled, large target (50 pt), not a ghost text link; the label is capped so it doesn't wrap away from the icon.
  expect(start.props).toMatchObject({ title: "Start now", variant: "secondary", icon: "play-skip-forward", maxScale: 1.3 });
  start.props.onPress();
  expect(onSkip).toHaveBeenCalledOnce();
  act(() => renderer!.unmount());
});
