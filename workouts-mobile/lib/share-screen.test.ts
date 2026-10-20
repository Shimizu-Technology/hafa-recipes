import { createElement, type PropsWithChildren, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "./api";

const fixture = vi.hoisted(() => ({
  previewShare: vi.fn(),
  confirmShare: vi.fn(),
  revokeShare: vi.fn(),
  share: vi.fn(async () => ({})),
  alert: vi.fn(),
}));
vi.mock("react-native", () => ({ Alert: { alert: fixture.alert }, Share: { share: fixture.share } }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({ id: "w1", kind: "workout" }) }));
const query = vi.hoisted(() => ({ data: { id: "w1", title: "Leg day", revision: 3, generation: 2 }, error: null }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => query }));
vi.mock("@/lib/context", () => ({
  useTraining: () => ({ owner: "owner", enrollment: { enrolled: true, generation: 2 },
    api: { previewShare: fixture.previewShare, confirmShare: fixture.confirmShare, revokeShare: fixture.revokeShare } }),
}));
vi.mock("@/components/shared-snapshot", () => ({ SharedSnapshot: "SharedSnapshot" }));
vi.mock("@/components/ui", () => ({
  Screen: ({ children, footer }: PropsWithChildren<{ footer?: ReactNode }>) => createElement("Screen", null, children, footer),
  Sheet: ({ visible, children }: PropsWithChildren<{ visible: boolean }>) => (visible ? createElement("Sheet", null, children) : null),
  Button: "Button", Choice: "Choice", Copy: "Copy", Field: "Field", Notice: "Notice", Segmented: "Segmented", SkeletonCard: "SkeletonCard",
}));
import SharePrescription from "../app/share";

const token = "A".repeat(43);
const preview = { id: "p1", generation: 2, preview_digest: "d", expires_at: "2026-10-21T00:10:00Z", link_expires_at: "2026-10-28T00:00:00Z",
  kind: "workout", content: { title: "Leg day" }, attribution: { shared_by_display_name: null, source_revision: 3, original_source_included: false }, review_required: false };
const link = { ...preview, id: "s1", expires_at: "2026-10-28T00:00:00Z", revoked_at: null, snapshot_digest: "d", api_path: "", app_path: `hafaworkouts://shared/${token}`, website_path: "" };
let renderer: ReactTestRenderer | undefined;
const all = (type: string) => renderer!.root.findAll((node) => String(node.type) === type);
const button = (title: string) => all("Button").find((node) => node.props.title === title);
async function mount() { await act(async () => { renderer = create(createElement(SharePrescription)); }); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const mock of Object.values(fixture)) mock.mockReset();
  fixture.share.mockResolvedValue({});
  fixture.previewShare.mockResolvedValue(preview);
  fixture.confirmShare.mockResolvedValue(link);
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });

it("previews with a 7-day link and shares in one tap through the share sheet", async () => {
  await mount();
  expect(fixture.previewShare).toHaveBeenCalledExactlyOnceWith("workout", "w1", 3,
    { title: undefined, display_name: undefined, include_source_url: false, allow_incomplete: false, expires_in_days: 7 }, 2);
  expect(all("SharedSnapshot")).toHaveLength(1);
  expect(all("Choice").some((node) => node.props.label === "I reviewed this exact public snapshot")).toBe(false);
  await act(async () => button("Share link")!.props.onPress());
  expect(fixture.confirmShare).toHaveBeenCalledExactlyOnceWith(preview);
  expect(fixture.share).toHaveBeenCalledExactlyOnceWith({ message: `hafaworkouts://shared/${token}` });
  expect(button("Share again")).toBeDefined();
  expect(button("Link options")).toBeUndefined();
});

it("keeps link options in a sheet and previews again only after they change", async () => {
  await mount();
  await act(async () => button("Link options")!.props.onPress());
  const sheet = () => all("Sheet")[0];
  await act(async () => sheet().findAll((node) => String(node.type) === "Segmented")[0].props.onChange("30"));
  expect(button("Share link")!.props.disabled).toBe(true);
  await act(async () => sheet().findAll((node) => String(node.type) === "Button").find((node) => node.props.title === "Done")!.props.onPress());
  expect(fixture.previewShare).toHaveBeenCalledTimes(2);
  expect(fixture.previewShare.mock.lastCall![3]).toMatchObject({ expires_in_days: 30 });
  expect(button("Share link")!.props.disabled).toBe(false);
});

it("asks before sharing a workout with missing details", async () => {
  fixture.previewShare.mockRejectedValueOnce(new ApiError("changed", 409, false, "This content needs review; explicitly choose to share a reviewed draft"));
  await mount();
  expect(all("SharedSnapshot")).toHaveLength(0);
  expect(button("Share link")!.props.disabled).toBe(true);
  await act(async () => all("Choice").find((node) => node.props.label === "Share it anyway")!.props.onPress());
  expect(fixture.previewShare.mock.lastCall![3]).toMatchObject({ allow_incomplete: true });
  expect(all("SharedSnapshot")).toHaveLength(1);
});

it("makes a fresh preview when the old one expired before sharing", async () => {
  fixture.confirmShare.mockRejectedValueOnce(new ApiError("changed", 409, false, "Preview expired; review a new preview"));
  await mount();
  await act(async () => button("Share link")!.props.onPress());
  expect(fixture.previewShare).toHaveBeenCalledTimes(2);
  expect(fixture.share).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer!.toJSON())).toContain("That preview expired");
});
