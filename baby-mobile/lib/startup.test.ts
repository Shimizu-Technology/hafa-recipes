import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { openingAccount } from "./startup";
afterEach(() => vi.useRealTimers());
it("bounds temporary startup failures and returns the eventual saved result", async () => {
  vi.useFakeTimers(); const result = { id: "owner" };
  const action = vi.fn().mockRejectedValueOnce(new ApiError("Unavailable", 503))
    .mockRejectedValueOnce(new ApiError("Offline", 0)).mockResolvedValueOnce(result);
  const pending = openingAccount(action, () => true);
  await vi.runAllTimersAsync(); expect(await pending).toBe(result); expect(action).toHaveBeenCalledTimes(3);
});
it.each([401, 403, 409, 410, 422])("never hides account or permission failure %s with retries", async status => {
  const failure = new ApiError("Stopped", status), action = vi.fn().mockRejectedValue(failure);
  await expect(openingAccount(action, () => true)).rejects.toBe(failure); expect(action).toHaveBeenCalledTimes(1);
});
it("stops queued retries when the account changes", async () => {
  vi.useFakeTimers(); let current = true;
  const action = vi.fn().mockRejectedValue(new ApiError("Offline", 0));
  const pending = expect(openingAccount(action, () => current)).rejects.toThrow("stopped");
  await Promise.resolve(); current = false; await vi.runAllTimersAsync(); await pending;
  expect(action).toHaveBeenCalledTimes(1);
});
