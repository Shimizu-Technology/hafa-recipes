import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ baby: null as any, caregiver: false, consent: vi.fn(), toast: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/lib/ai-consent", () => ({ ensureAiConsent: (...args: any[]) => mock.consent(...args) }));
vi.mock("@/lib/spaces", () => ({ isCaregiver: () => mock.caregiver }));
vi.mock("../lib/spaces", () => ({ rowFence: () => 1 }));
vi.mock("../lib/outbox", () => ({ withoutRefusedRetry: (state: any, id: string) => ({ ...state, outbox: state.outbox.filter((item: any) => item.id !== id) }) }));
vi.mock("@/lib/import-status", () => import("./import-status"));
vi.mock("expo-crypto", () => ({ randomUUID: () => "mutation-id" }));
vi.mock("expo-router", () => ({ router: { push: (...args: any[]) => mock.push(...args) } }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() } }));
vi.mock("../components/ui", () => ({ Button: "Button", Card: "Card", Copy: "Copy", Notice: "Notice", Section: "Section", useToast: () => mock.toast }));
vi.mock("../components/disclosure", () => ({ Disclosure: "Disclosure" }));
import { SourceContent } from "../components/source-content";
import { Linking } from "react-native";
import { importRetryable, sourceRefusalMessages } from "./import-status";
import { ImportUpdates } from "../components/import-updates";
import { SourceRecovery } from "../components/source-recovery";
import type { BabyRecord } from "./models";
it("shows read failures and the original above disclosures on an older API source", async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<SourceContent data={{ url: "https://www.tiktok.com/@example/photo/123", status: "incomplete",
    source_text: "Available caption", coverage_notes: ["Slide 2 could not be read; its details may be missing."] }} onError={vi.fn()} />); });
  const visible = JSON.stringify(view.toJSON());
  expect(visible).toContain("Slide 2 could not be read");
  expect(visible).toContain("Available caption");
  expect(visible).toContain("https://www.tiktok.com/@example/photo/123");
  await act(async () => view.root.findByType("Button" as React.ElementType).props.onPress());
  expect(Linking.openURL).toHaveBeenCalledWith("https://www.tiktok.com/@example/photo/123");
  expect(importRetryable("incomplete", null)).toBe(true);
  await act(async () => view.unmount());
  vi.unstubAllGlobals();
});

const source = (status: string | undefined = "incomplete") => ({ id: "saved-post", kind: "source", title: "Saved source", body: "My own note",
  data: { url: "https://www.tiktok.com/@example/photo/123", status, source_text: "Previous caption and AI labels", attachment_ids: ["screenshot"] },
  occurred_at: "2026-11-07T01:00:00Z", revision: 1 } as BabyRecord);
let recoveryView: ReturnType<typeof create> | undefined;
const onError = vi.fn();
async function recovery(record = source()) {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.caregiver = false; mock.consent.mockResolvedValue(true); mock.baby = { owner: "owner",
    state: { bootstrap: { generation: 1 }, outbox: [], imports: [] }, commit: vi.fn(async (update: any) => { mock.baby.state = update(mock.baby.state); }), queue: vi.fn(async () => {}) };
  await act(async () => { recoveryView = create(<SourceRecovery record={record} onError={onError} />); });
  return recoveryView!;
}
afterEach(async () => { if (recoveryView) await act(async () => recoveryView!.unmount()); recoveryView = undefined; vi.clearAllMocks(); vi.unstubAllGlobals(); });
it("retries the same source with only her own note and current attachments", async () => {
  const view = await recovery();
  await act(async () => view.root.findAllByType("Button" as React.ElementType)[0].props.onPress());
  expect(mock.baby.queue).toHaveBeenCalledWith(expect.objectContaining({ record_id: "saved-post", text: "My own note", attachment_ids: ["screenshot"] }));
  expect(JSON.stringify(mock.baby.queue.mock.calls)).not.toContain("Previous caption");
});
it("works with a current API source that has no new user_text field", async () => {
  const record = source(); record.body = "";
  const view = await recovery(record);
  await act(async () => view.root.findAllByType("Button" as React.ElementType)[0].props.onPress());
  expect(mock.baby.queue.mock.calls[0][0].text).toBeUndefined();
  expect(record.data.source_text).toBe("Previous caption and AI labels");
});
it.each(["queued", "processing", undefined])("doesn't offer an improvement action for %s", async (status) => {
  const record = source(); record.data.status = status as any;
  expect((await recovery(record)).toJSON()).toBeNull();
});
it.each(["saved", "incomplete", "failed", "cancelled"])("offers the recovery path for %s", async (status) => {
  const view = await recovery(source(status));
  expect(JSON.stringify(view.toJSON())).toContain(status === "saved" ? "Read with AI" : "Try again");
});
it("holds repeat taps while consent or an import is pending", async () => {
  const record = source(); const view = await recovery(record);
  let allow!: (value: boolean) => void;
  mock.consent.mockReturnValue(new Promise<boolean>((resolve) => { allow = resolve; }));
  const button = view.root.findAllByType("Button" as React.ElementType)[0];
  await act(async () => { button.props.onPress(); button.props.onPress(); });
  expect(mock.consent).toHaveBeenCalledTimes(1);
  expect(view.root.findAllByType("Button" as React.ElementType)[0].props.disabled).toBe(true);
  await act(async () => { allow(true); });
  expect(mock.baby.queue).toHaveBeenCalledTimes(1);
  mock.baby.state.outbox = [{ type: "import", record_id: record.id }];
  await act(async () => view.update(<SourceRecovery record={record} onError={onError} />));
  expect(view.root.findAllByType("Button" as React.ElementType)[0].props.title).toBe("Waiting to process");
  expect(view.root.findAllByType("Button" as React.ElementType)[0].props.disabled).toBe(true);
});
it("describes the existing editor Save changes path", async () => {
  const view = await recovery();
  const visible = JSON.stringify(view.toJSON());
  expect(visible).toContain("Save changes"); expect(visible).not.toContain("Process & organize with AI");
  await act(async () => view.root.findAllByType("Button" as React.ElementType)[1].props.onPress());
  expect(mock.push).toHaveBeenCalledWith({ pathname: "/edit", params: { id: "saved-post", kind: "source" } });
});
it("hides processing from a caregiver and for a partial offline record", async () => {
  const record = source(); record.cache_partial = true;
  const view = await recovery(record); expect(view.toJSON()).toBeNull();
  record.cache_partial = false; mock.caregiver = true;
  await act(async () => view.update(<SourceRecovery record={record} onError={onError} />));
  expect(view.toJSON()).toBeNull();
});
it("keeps older saved text separate from a new read and never resubmits it", async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let content!: ReturnType<typeof create>;
  await act(async () => { content = create(<SourceContent data={{ source_text: "New caption", legacy_saved_text: "Earlier ambiguous note" }} onError={vi.fn()} />); });
  const earlier = content.root.findAllByType("Disclosure" as React.ElementType).find((item) => item.props.title === "Earlier saved text");
  expect(earlier?.findAllByType("Copy" as React.ElementType).map((item) => item.props.children).join(" ")).toContain("Earlier ambiguous note");
  const record = source(); record.body = ""; record.data.legacy_saved_text = "Earlier ambiguous note";
  const view = await recovery(record);
  await act(async () => view.root.findAllByType("Button" as React.ElementType)[0].props.onPress());
  expect(mock.baby.queue.mock.calls[0][0].text).toBeUndefined();
  await act(async () => content.unmount());
});

it("keeps a quiet re-read action on a ready source", async () => {
  const view = await recovery(source("ready"));
  expect(JSON.stringify(view.toJSON())).toContain("Process this post again");
  await act(async () => view.root.findAllByType("Button" as React.ElementType)[0].props.onPress());
  expect(mock.baby.queue).toHaveBeenCalledTimes(1);
});
it.each(Object.entries(sourceRefusalMessages))("shows and clears %s without blocking screenshots", async (_code, error) => {
  const record = source(); const view = await recovery(record);
  mock.baby.state.outbox = [{ id: "refused", type: "import", record_id: record.id, error }];
  await act(async () => view.update(<SourceRecovery record={record} onError={onError} />));
  const buttons = view.root.findAllByType("Button" as React.ElementType);
  expect(JSON.stringify(view.toJSON())).toContain(error);
  expect(JSON.stringify(view.toJSON())).not.toContain("Waiting to process");
  const screenshots = buttons.find((item) => item.props.title === "Add screenshots or missing text")!;
  expect(screenshots.props.disabled).toBe(false);
  await act(async () => screenshots.props.onPress());
  expect(mock.push).toHaveBeenCalledTimes(1);
  await act(async () => buttons.find((item) => item.props.title === "Clear processing request")!.props.onPress());
  expect(mock.baby.state.outbox).toEqual([]);
});

it.each(Object.values(sourceRefusalMessages))("Library retry shows the refusal: %s", async (error) => {
  await recovery();
  mock.baby.state.imports = [{id:"job", record_id:"saved-post", status:"incomplete"}];
  mock.baby.records = [source()];
  mock.baby.api = {retryJob: vi.fn(async () => { throw Error(error); })};
  await act(async () => recoveryView!.update(<ImportUpdates />));
  const button = recoveryView!.root.findAllByType("Button" as React.ElementType).find((item) => item.props.title === "Retry processing")!;
  await act(async () => button.props.onPress());
  expect(JSON.stringify(recoveryView!.toJSON())).toContain(error);
  expect(mock.baby.api.retryJob).toHaveBeenCalledTimes(1);
});
