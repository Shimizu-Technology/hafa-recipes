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


async function rerender(currentView: LibraryView, milliseconds = 1) {
  await act(async () => renderer!.update(React.createElement(Probe, { currentView })));
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}
it("automatically refreshes new and completed imports without losing filters or polling on processing", async () => {
  const filters: LibraryView = { ...view, query: "feeding", topic: "Feeding", childId: "baby" };
  const imported = { ...row, id: "new-source", title: "Feeding tips", revision: 1,
    child_id: "baby", data: { topics: ["Feeding"], summary: "Original saved" } };
  let items: typeof imported[] = [];
  const transport = vi.fn(async (_url: string) => Response.json({ items, total: items.length, has_more: false }));
  const account = setup(transport);
  await mount(filters);
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(result.complete).toBe(true);
  expect(result.rows).toEqual([]);
  items = [imported];
  account.state.imports = [{ id: "job", record_id: imported.id, status: "queued", error: null }];
  await rerender(filters, 350);
  expect(result.rows.map((item) => item.id)).toEqual([imported.id]);
  expect(transport).toHaveBeenCalledTimes(2);
  account.state.imports = [{ ...account.state.imports[0], status: "processing" }];
  await rerender(filters, 350);
  expect(transport).toHaveBeenCalledTimes(2);
  items = [{ ...imported, revision: 2, data: { ...imported.data, summary: "Extracted source summary" } }];
  account.state.imports = [{ ...account.state.imports[0], status: "incomplete", error: null }];
  await rerender(filters, 350);
  expect(transport).toHaveBeenCalledTimes(3);
  expect(result.rows[0].data.summary).toBe("Extracted source summary");
  for (const [url] of transport.mock.calls) {
    const params = new URL(url).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ collection_id: "collection", topic: "Feeding", child_id: "baby", q: "feeding", offset: "0" });
  }
  account.state.imports = [{ ...account.state.imports[0], status: "queued" }];
  await rerender(filters, 350);
  expect(transport).toHaveBeenCalledTimes(4);
});
it("retires a held pre-import page when completion refreshes the same source view", async () => {
  let release!: (response: Response) => void;
  const stale = new Promise<Response>((resolve) => { release = resolve; });
  const transport = vi.fn().mockReturnValueOnce(stale).mockResolvedValueOnce(Response.json({ items: [row], total: 1, has_more: false }));
  const account = setup(transport);
  account.state.imports = [{ id: "job", record_id: row.id, status: "processing" }];
  await mount();
  account.state.imports = [{ ...account.state.imports[0], status: "incomplete", error: null }];
  await rerender(view);
  expect(result.rows.map((item) => item.id)).toEqual([row.id]);
  await act(async () => { release(Response.json({ items: [], total: 0, has_more: false })); });
  expect(result.rows.map((item) => item.id)).toEqual([row.id]);
  expect(result.loading).toBe(false);
  expect(result.error).toBe("");
});
it("retains loaded pages during import refresh and drops server-deleted IDs at completion", async () => {
  let release!: (response: Response) => void;
  const fresh = new Promise<Response>((resolve) => { release = resolve; });
  const older = { ...row, id: "older" };
  const transport = vi.fn()
    .mockResolvedValueOnce(Response.json({ items: [row], total: 2, has_more: true }))
    .mockResolvedValueOnce(Response.json({ items: [older], total: 2, has_more: false }))
    .mockReturnValueOnce(fresh);
  const account = setup(transport);
  await mount();
  await act(async () => { await result.loadMore(); });
  expect(result.rows.map((item) => item.id)).toEqual([older.id, row.id]);
  account.state.imports = [{ id: "job", record_id: row.id, status: "incomplete", error: null }];
  await rerender(view);
  expect(result.rows.map((item) => item.id)).toEqual([older.id, row.id]);
  expect(new URL(transport.mock.calls[2][0]).searchParams.get("offset")).toBe("0");
  await act(async () => { release(Response.json({ items: [older], total: 1, has_more: false })); });
  expect(result.rows.map((item) => item.id)).toEqual([older.id]);
  expect(account.state.records.some((item) => item.id === row.id)).toBe(true);
});
it("waits for focus after an import changes and leaves collection pagination alone", async () => {
  const transport = vi.fn(async (_url: string) => Response.json({ items: [], total: 0, has_more: false }));
  const account = setup(transport);
  await mount();
  scope.focused = false;
  account.state.imports = [{ id: "job", record_id: row.id, status: "incomplete", error: null }];
  await rerender(view);
  expect(transport).toHaveBeenCalledOnce();
  scope.focused = true;
  await rerender(view);
  expect(transport).toHaveBeenCalledTimes(2);
  const collections: LibraryView = { kind: "collection", childId: null, query: "" };
  await rerender(collections);
  expect(transport).toHaveBeenCalledTimes(3);
  account.state.imports = [{ ...account.state.imports[0], status: "queued" }];
  await rerender(collections);
  expect(transport).toHaveBeenCalledTimes(3);
});

it("shows a completed import after the focused source page was authoritatively empty", async () => {
  let items: typeof row[] = [];
  const transport = vi.fn(async (_url: string) => Response.json({ items, total: items.length, has_more: false }));
  const account = setup(transport);
  account.state.imports = [{ id: "job", record_id: row.id, status: "processing" }];
  await mount();
  expect(result.complete).toBe(true);
  expect(result.rows).toEqual([]);
  items = [row];
  account.state.imports = [{ ...account.state.imports[0], status: "incomplete", error: null }];
  await rerender(view);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(result.rows.map((item) => item.id)).toEqual([row.id]);
});
it("keeps loaded sources when an import-triggered refresh fails and permits retry", async () => {
  const transport = vi.fn()
    .mockResolvedValueOnce(Response.json({ items: [row], total: 1, has_more: false }))
    .mockResolvedValueOnce(Response.json({ detail: "offline" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ items: [row], total: 1, has_more: false }));
  const account = setup(transport);
  await mount();
  account.state.imports = [{ id: "job", record_id: row.id, status: "incomplete", error: null }];
  await rerender(view);
  expect(result.rows.map((item) => item.id)).toEqual([row.id]);
  expect(result.error).not.toBe("");
  await act(async () => { await result.loadMore(); });
  expect(result.rows.map((item) => item.id)).toEqual([row.id]);
  expect(result.error).toBe("");
});
