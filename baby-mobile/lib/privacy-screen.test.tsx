import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ current: null as null | { state: { bootstrap: { ask_consent_version: number | null } } } }));
vi.mock("expo-router", () => ({ router: {} }));
vi.mock("@/lib/context", () => ({ useBabyIfSignedIn: () => account.current }));
vi.mock("@/lib/ai-consent", () => ({ ASK_CONSENT_BODY: "NEW ASK WORDS" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Card: "Card", Copy: "Copy", Screen: "Screen", Section: "Section" }));
import Privacy from "../app/privacy";

let renderer: ReactTestRenderer | undefined;
const words = () => renderer!.root.findAll((n) => (n.type as unknown) === "Copy").map((n) => n.props.children).join(" ");
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("opens signed out, when there is no account to read", async () => {
  account.current = null;
  await act(async () => { renderer = create(<Privacy />); });
  expect(words()).toMatch(/AI is off until you give explicit permission/);
  expect(words()).not.toMatch(/NEW ASK WORDS/);
});

it.each([[null, false], [1, true]])("with the new Ask at version %s, its words show: %s", async (version, shown) => {
  account.current = { state: { bootstrap: { ask_consent_version: version } } };
  await act(async () => { renderer = create(<Privacy />); });
  expect(words().includes("NEW ASK WORDS")).toBe(shown);
});
