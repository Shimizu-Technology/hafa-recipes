import React from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/models", () => import("./models"));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() } }));
vi.mock("../components/ui", () => ({ Button: "Button", Card: "Card", Copy: "Copy", Notice: "Notice", Section: "Section" }));
vi.mock("../components/disclosure", () => ({ Disclosure: "Disclosure" }));
import { SourceContent } from "../components/source-content";
import { Linking } from "react-native";
import { importRetryable } from "./import-status";
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
