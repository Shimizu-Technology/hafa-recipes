import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { nov17Class } from "./fixtures/nov17-class";
const f = vi.hoisted(() => ({ library: vi.fn(), profile: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({ api: f, owner: "owner", enrollment: { enrolled: true, generation: 1 } }) }));
vi.mock("@/lib/use-focus-refresh", () => ({ useFocusRefresh: () => {} }));
vi.mock("expo-router", () => ({ router: { push: f.push } }));
vi.mock("@/components/ui", () => ({ ListGroup: "ListGroup", ListRow: "ListRow", Notice: "Notice", Button: "Button" }));
import { TodaysClass } from "../components/todays-class";
it("shows a saved gym class on its profile-local day and opens the shared workout start flow", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T15:00:00Z")); // Nov 17 in Guam, Nov 16 in UTC.
  f.profile.mockResolvedValue({ timezone: "Pacific/Guam" });
  f.library.mockResolvedValue([
    { ...nov17Class, id: "today-class" },
    { ...nov17Class, id: "old", programming: { ...nov17Class.programming, date: "2026-11-16" } },
    { ...nov17Class, id: "self", programming: { ...nov17Class.programming, source_kind: "self" } },
  ]);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let tree: ReturnType<typeof create> | undefined;
  try {
    await act(async () => { tree = create(createElement(QueryClientProvider, { client: cache }, createElement(TodaysClass))); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const rows = tree!.root.findAllByType("ListRow" as any);
    expect(rows).toHaveLength(2);
    expect(cache.getQueryData(["owner", "library", "search", 1])).toHaveLength(3);
    expect(f.library).toHaveBeenCalledOnce();
    expect(rows[0].props.detail).toBe("Today’s class · Ready to train");
    await act(async () => rows[0].props.onPress());
    expect(f.push).toHaveBeenCalledWith({ pathname: "/workout/[id]", params: { id: "today-class" } });
    await act(async () => rows[1].props.onPress());
    expect(f.push).toHaveBeenCalledWith("/extract?class=1");
  } finally {
    if (tree) await act(async () => tree!.unmount());
    cache.clear(); vi.useRealTimers();
  }
});
it("keeps classes hidden when the profile timezone fails and offers a retry", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T05:00:00Z"));
  f.profile.mockReset(); f.library.mockReset(); f.push.mockClear();
  f.profile.mockRejectedValueOnce(Error("Offline"));
  f.library.mockResolvedValue([{ ...nov17Class, id: "class" },
    { ...nov17Class, id: "undated", programming: { ...nov17Class.programming, date: null } }]);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let tree: ReturnType<typeof create> | undefined;
  try {
    await act(async () => { tree = create(createElement(QueryClientProvider, { client: cache }, createElement(TodaysClass))); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(tree!.root.findAllByType("ListRow" as any)).toHaveLength(1);
    expect(tree!.root.findAllByType("Notice" as any)).toHaveLength(1);
    f.profile.mockResolvedValue({ timezone: "Pacific/Guam" });
    const retry = tree!.root.findAllByType("Button" as any).find(n => n.props.title === "Retry timezone")!;
    await act(async () => retry.props.onPress());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(f.profile).toHaveBeenCalledTimes(2);
    const rows = tree!.root.findAllByType("ListRow" as any);
    expect(rows).toHaveLength(2);
    expect(rows[0].props.title).toBe(nov17Class.title);
  } finally {
    if (tree) await act(async () => tree!.unmount());
    cache.clear(); vi.useRealTimers();
  }
});
