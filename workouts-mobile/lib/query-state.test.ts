import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../components/ui", () => ({ Button: "Button", Notice: "Notice", SkeletonCard: "SkeletonCard" }));
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
  expect(renderer!.root.findByType("Notice" as never).props.children).toBe("Plans are unavailable.");
  await act(async () => renderer!.root.findByType("Button" as never).props.onPress());
  expect(retry).toHaveBeenCalledTimes(1);
});
