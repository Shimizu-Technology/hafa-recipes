import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBabyApi } from "./api";
import { emptyState, optimisticRecord, type DeviceState } from "./models";
import { useLibraryHistory } from "./use-library-history";
import type { LibraryView } from "./library-history";

const scope = vi.hoisted(() => ({ account: null as unknown, focused: true }));
vi.mock("./context", () => ({ useBaby: () => scope.account }));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return {
    useFocusEffect: (callback: () => (() => void) | undefined) =>
      React.useEffect(() => (scope.focused ? callback() : undefined), [callback, scope.focused]),
  };
});
let renderer: ReactTestRenderer | undefined;
let result: ReturnType<typeof useLibraryHistory>;
const view: LibraryView = { kind: "source", childId: null, query: "", collectionId: "collection" };
const row = optimisticRecord({
  id: "old-source",
  kind: "source",
  title: "Old advice",
  body: "",
  child_id: null,
  occurred_at: "2026-10-20T00:00:00Z",
  data: {},
});
function Probe({ currentView = view }: { currentView?: LibraryView }) {
  result = useLibraryHistory(currentView);
  return null;
}
function setup(transport: (url: string, init?: RequestInit) => Promise<Response>) {
  const account = {
    owner: "owner",
    state: {
      ...emptyState(),
      bootstrap: {
        generation: 1,
        active: true,
        ai_available: true,
        children: [],
        profile: { display_name: "Parent", ai_consent: true, timezone: "Pacific/Guam" },
      },
    } as DeviceState,
    api: createBabyApi(
      "https://service.example",
      async () => "token",
      () => true,
      transport
    ),
    current: () => true,
    commit: vi.fn(async (change: (state: DeviceState) => DeviceState) => {
      account.state = change(account.state);
    }),
  };
  scope.account = account;
  return account;
}
async function mount(currentView = view) {
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Probe, { currentView }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  scope.focused = true;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated")) throw Error(String(args[0]));
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("commits and displays an old member from a collection-scoped page with no local source cache", async () => {
  const transport = vi.fn(async (_url: string) => Response.json({ items: [row], total: 1, has_more: false }));
  const account = setup(transport);
  await mount();
  expect(transport).toHaveBeenCalledOnce();
  expect(new URL(transport.mock.calls[0][0]).searchParams.get("collection_id")).toBe("collection");
  expect(result.rows.map((record) => record.id)).toEqual(["old-source"]);
  expect(account.state.records).toEqual([row]);
  expect(result.complete).toBe(true);
});
it("does not merge a held old-collection result after selecting another collection", async () => {
  let release!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const transport = vi.fn(async (url: string) =>
    new URL(url).searchParams.get("collection_id") === "collection"
      ? held
      : Response.json({ items: [], total: 0, has_more: false })
  );
  const account = setup(transport);
  await mount();
  await act(async () =>
    renderer!.update(React.createElement(Probe, { currentView: { ...view, collectionId: "new-collection" } }))
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
    release(Response.json({ items: [row], total: 1, has_more: false }));
  });
  expect(account.state.records).toEqual([]);
  expect(result.rows).toEqual([]);
});
it("retires a held response and refuses a new load while blurred", async () => {
  let release!: (response: Response) => void;
  const transport = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      })
  );
  const account = setup(transport);
  await mount();
  scope.focused = false;
  await act(async () => renderer!.update(React.createElement(Probe)));
  await act(async () => {
    await result.loadMore();
    release(Response.json({ items: [row], total: 1, has_more: false }));
  });
  expect(transport).toHaveBeenCalledOnce();
  expect(account.state.records).toEqual([]);
});
it("fences a returned page at the actual API generation lease before its queued commit executes", async () => {
  const transport = vi.fn(async (_url: string) => Response.json({ items: [row], total: 1, has_more: false }));
  const account = setup(transport);
  let commit!: () => void;
  account.commit.mockImplementation(
    (change) =>
      new Promise<void>((resolve, reject) => {
        commit = () => {
          try {
            account.state = change(account.state);
            resolve();
          } catch (error) {
            reject(error);
          }
        };
      })
  );
  await mount();
  expect(account.commit).toHaveBeenCalledOnce();
  await act(async () => {
    await account.api.erase(1);
    account.state = { ...emptyState(), bootstrap: { ...account.state.bootstrap!, generation: 2 } };
    commit();
  });
  expect(account.state.records).toEqual([]);
  expect(result.rows).toEqual([]);
});
it("treats a deleted collection404 as unavailable without showing cached members as generic library matches", async () => {
  const account = setup(async () => Response.json({ detail: "not found" }, { status: 404 }));
  account.state.records = [row, { ...row, id: "collection", kind: "collection", data: { record_ids: [row.id] } }];
  await mount();
  expect(result.missing).toBe(true);
  expect(result.rows).toEqual([]);
  expect(result.more).toBe(false);
});
