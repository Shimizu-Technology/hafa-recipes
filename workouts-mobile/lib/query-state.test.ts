import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../components/ui", () => ({ Button: "Button", Copy: "Copy", Notice: "Notice", SkeletonCard: "SkeletonCard" }));
import { QueryState } from "../components/query-state";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });
const types = () => renderer!.root.findAll((node) => typeof node.type === "string").map((node) => String(node.type));

it("shows a labelled skeleton while loading, then the content, then a retryable error", async () => {
  const retry = vi.fn();
  const view = (loading: boolean, error: Error | null) =>
    createElement(QueryState, { loading, error, retry, loadingLabel: "Loading your plan" }, createElement("Content"));
  await act(async () => { renderer = create(view(true, null)); });
  const skeleton = renderer!.root.findByType("SkeletonCard" as never);
  expect(skeleton.props.label).toBe("Loading your plan");
  expect(types()).not.toContain("Content");
  await act(async () => renderer!.update(view(false, null)));
  expect(types()).toEqual(["Content"]);
  await act(async () => renderer!.update(view(false, Error("Plans are unavailable."))));
  expect(renderer!.root.findByType("Notice" as never).props.children).toBe("We couldn’t load this right now. Check your connection and try again.");
  await act(async () => renderer!.root.findAllByType("Button" as never).find(node => node.props.title === "Try again")!.props.onPress());
  expect(retry).toHaveBeenCalledTimes(1);
});

it("keeps technical errors hidden until details are requested", async () => {
  await act(async () => { renderer = create(createElement(QueryState, { loading: false, error: Error("Network request failed: ECONNREFUSED"), retry() {} })); });
  expect(renderer!.root.findAllByType("Copy" as never)).toHaveLength(0);
  await act(async () => { renderer!.root.findAllByType("Button" as never).find(node => node.props.title === "Show details")!.props.onPress(); });
  expect(renderer!.root.findByType("Copy" as never).props.children).toBe("Network request failed: ECONNREFUSED");
});
