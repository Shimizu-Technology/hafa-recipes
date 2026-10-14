import { createElement, type PropsWithChildren } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
const clerk = vi.hoisted(() => ({ signOut: vi.fn() }));
const revoke = vi.hoisted(() => vi.fn(async () => undefined));
const resume = vi.hoisted(() => vi.fn());
vi.mock("@/lib/native-share-session", () => ({ suspendNativeSharing: () => ({ clear: revoke(), resume }) }));
vi.mock("@clerk/expo", () => ({ useClerk: () => clerk, useAuth: () => ({ userId: "subject", sessionId: "original-session" }) }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({ owner: "owner" }) }));
vi.mock("@/lib/config", () => ({ configuration: { clerkEnvironment: "production", clerkKey: "pk_live_synthetic" } }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/components/ui", () => ({
  Screen: ({ children }: PropsWithChildren) => createElement("screen", null, children),
  Card: ({ children }: PropsWithChildren) => createElement("card", null, children),
  Copy: ({ children }: PropsWithChildren) => createElement("copy", null, children),
  Notice: ({ children }: PropsWithChildren) => createElement("notice", null, children),
  Button: ({ title, onPress }: { title: string; onPress(): void }) => createElement("button", { onClick: onPress }, title),
  ListGroup: ({ children }: PropsWithChildren) => createElement("list", null, children),
  ListRow: ({ title }: { title: string }) => createElement("row", null, title),
  SectionHeader: ({ title }: { title: string }) => createElement("section", null, title),
}));
import Settings from "../app/settings";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps cached account data after a failed sign-out and clears it only after sign-out succeeds", async () => {
  const cache = new QueryClient();
  cache.setQueryData(["owner", "profile", 1], "PRIVATE");
  let tree: ReactTestRenderer;
  await act(async () => { tree = create(createElement(QueryClientProvider, { client: cache }, createElement(Settings))); });
  const signOut = () => tree.root.findAll((node) => node.type === "button").find((node) => node.children.join("") === "Sign out")!;
  clerk.signOut.mockRejectedValueOnce(Error("offline"));
  await act(async () => { signOut().props.onClick(); });
  expect(revoke).toHaveBeenCalled();
  expect(revoke.mock.invocationCallOrder[0]).toBeLessThan(clerk.signOut.mock.invocationCallOrder[0]);
  expect(cache.getQueryData(["owner", "profile", 1])).toBe("PRIVATE");
  expect(resume).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(tree!.toJSON())).toContain("Could not sign out");
  clerk.signOut.mockResolvedValueOnce(undefined);
  cache.setQueryData(["another-owner", "profile", 1], "ANOTHER ACCOUNT");
  await act(async () => { signOut().props.onClick(); });
  expect(cache.getQueryData(["owner", "profile", 1])).toBeUndefined();
  expect(cache.getQueryData(["another-owner", "profile", 1])).toBe("ANOTHER ACCOUNT");
  expect(clerk.signOut).toHaveBeenLastCalledWith({ sessionId: "original-session" });
  expect(resume).toHaveBeenCalledTimes(1);
  await act(async () => { tree!.unmount(); });
});
