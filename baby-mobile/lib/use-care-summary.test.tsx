import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ baby: null as any, days: undefined as any }));
vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return { useFocusEffect: (fn: () => void) => useEffect(fn, [fn]) };
});
vi.mock("./context", () => ({ useBaby: () => mock.baby }));
import { useCareSummary, summaryPollMs } from "./use-care-summary";

const day = (feeds: number) => ({ days: [{ date: "2026-11-05", feeding: { count: feeds }, diapers: { count: 0, pee: 0, poo: 0, dry: 0 }, sleep: { total_minutes: 0 }, dots: [] }] });
function Probe() { mock.days = useCareSummary("baby", "2026-11-05", "2026-11-05", { poll: true }); return null; }
let renderer: ReactTestRenderer | undefined;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("doesn't let an older answer overwrite a newer one", async () => {
  const answers: ((value: unknown) => void)[] = [];
  mock.baby = { owner: "o", state: { outbox: [], bootstrap: { generation: 1 } }, api: { careSummary: vi.fn(() => new Promise((yes) => answers.push(yes))) } };
  await act(async () => { renderer = create(<Probe />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(summaryPollMs); });
  expect(answers).toHaveLength(2);
  // The second question is answered first, with the newer totals. The first then arrives late.
  await act(async () => { answers[1](day(5)); });
  expect(mock.days["2026-11-05"].feeding.count).toBe(5);
  await act(async () => { answers[0](day(1)); });
  expect(mock.days["2026-11-05"].feeding.count).toBe(5);
});

it("still shows an answer when a newer question is slow, rather than waiting on every poll", async () => {
  const answers: ((value: unknown) => void)[] = [];
  mock.baby = { owner: "o", state: { outbox: [], bootstrap: { generation: 1 } }, api: { careSummary: vi.fn(() => new Promise((yes) => answers.push(yes))) } };
  await act(async () => { renderer = create(<Probe />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(summaryPollMs); });
  await act(async () => { answers[0](day(1)); });
  expect(mock.days["2026-11-05"].feeding.count).toBe(1);
  await act(async () => { answers[1](day(2)); });
  expect(mock.days["2026-11-05"].feeding.count).toBe(2);
});

it("reads when changes arrive instead of on a timer, once the app fetches changes", async () => {
  const careSummary = vi.fn(async () => day(1));
  mock.baby = { owner: "o", changeTick: 0, state: { outbox: [], bootstrap: { generation: 1, spaces: [{ id: "p" }] } }, api: { careSummary } };
  await act(async () => { renderer = create(<Probe />); });
  expect(careSummary).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(summaryPollMs * 2); });
  expect(careSummary).toHaveBeenCalledTimes(1);
  mock.baby = { ...mock.baby, changeTick: 1 };
  await act(async () => { renderer!.update(<Probe />); });
  expect(careSummary).toHaveBeenCalledTimes(2);
});
