import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ Pressable: "Pressable", View: "View" }));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/lib/source-title", () => import("./source-title"));
vi.mock("../components/ui", () => ({ Copy: "Copy", Icon: "Icon", useColors: () => ({ tile: "#eee", border: "#ddd" }) }));
import { SavedPostRow } from "../components/saved-post-row";
import { optimisticRecord } from "./models";
const row = optimisticRecord({ id: "post", kind: "source", title: "Packing a diaper bag", body: "", child_id: null,
  occurred_at: "2026-10-30T00:00:00Z", data: { status: "ready", platform: "instagram", creator: "Example parent" } });
afterEach(() => vi.unstubAllGlobals());
it("shows a platform mark and known creator without a redundant ready line", async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(<SavedPostRow record={row} pending={false} />); });
  expect(renderer.root.findAll(n => String(n.type) === "Icon").some(n => n.props.name === "logo-instagram")).toBe(true);
  const copy = renderer.root.findAll(n => String(n.type) === "Copy");
  expect(copy.some(n => JSON.stringify(n.props.children).includes("Example parent"))).toBe(true);
  expect(copy.some(n => n.props.children === "Ready to read")).toBe(false);
  await act(async () => { renderer.update(<SavedPostRow record={{ ...row, data: { ...row.data, thumbnail_url: "https://example.com/thumbnail.jpg" } }} pending />); });
  expect(renderer.root.findAll(n => String(n.type) === "Image")).toHaveLength(1);
  expect(renderer.root.findAll(n => String(n.type) === "Copy").some(n => n.props.children === "Saved on this device")).toBe(true);
  await act(async () => renderer.unmount());
});
