import { expect, it } from "vitest";
import { createShareFence } from "./share-fence";

it("ignores delayed results after the address changes, before passive cleanup", async () => {
  let token = "A";
  const fence = createShareFence(() => token);
  const request = fence.begin("A");
  let resolve!: (value: string) => void;
  const transport = new Promise<string>((done) => { resolve = done; });
  let displayed: string | null = null;
  const completion = transport.then((result) => { if (request.current()) displayed = result; });
  token = "B";
  resolve("old private projection");
  await completion;
  expect(request.controller.signal.aborted).toBe(false);
  expect(displayed).toBeNull();
});

it("synchronously aborts a retired link and rejects its errors/timeouts", () => {
  const fence = createShareFence(() => "A");
  const request = fence.begin("A");
  fence.invalidate();
  expect(request.controller.signal.aborted).toBe(true);
  expect(request.current()).toBe(false);
});

it("does not revive the first A request during A to B to A navigation", () => {
  let token = "A";
  const fence = createShareFence(() => token);
  const first = fence.begin("A");
  token = "B";
  const second = fence.begin("B");
  token = "A";
  const final = fence.begin("A");
  expect(first.current()).toBe(false);
  expect(second.current()).toBe(false);
  expect(final.current()).toBe(true);
  first.dispose();
  expect(final.current()).toBe(true);
  final.dispose();
  expect(final.current()).toBe(false);
});

it("ignores a pending clipboard success or failure after switching links", async () => {
  let token: string | null = "A";
  const fence = createShareFence(() => token);
  fence.begin("A");
  const copyCurrent = fence.capture("A");
  token = "B";
  fence.invalidate();
  fence.begin("B");
  expect(copyCurrent()).toBe(false);
  expect(fence.capture("B")()).toBe(true);
  token = null;
  expect(fence.capture("B")()).toBe(false);
});
