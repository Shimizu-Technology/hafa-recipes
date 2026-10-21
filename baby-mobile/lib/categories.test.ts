import { expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { changeCategory } from "./categories";
import { optimisticRecord } from "./models";

const category = (ids: string[], revision = 1) => ({ ...optimisticRecord({ id: "category", kind: "collection",
  title: "Getting ready", body: "Keep this note", child_id: null, occurred_at: "2026-10-21T00:00:00Z",
  data: { record_ids: ids } }), revision });

it("preserves concurrent additions and retries a revision conflict with fresh membership", async () => {
  const api = { record: vi.fn().mockResolvedValueOnce(category(["old"]))
    .mockResolvedValueOnce(category(["old", "another-device"], 2)),
  save: vi.fn().mockRejectedValueOnce(new ApiError("Changed", 409)).mockImplementation(async (value) => value) };
  const result = await changeCategory(api, "category", ["new", "new"], 3);
  expect(result.record.data.record_ids).toEqual(["old", "another-device", "new"]);
  expect(result.record.body).toBe("Keep this note");
  expect(result.added).toEqual(["new"]);
  expect(api.save.mock.calls[1][0].revision).toBe(2);
});
it("undo removes only the operation's new members and retains later unrelated additions", async () => {
  const api = { record: vi.fn().mockResolvedValue(category(["old", "new", "later"])), save: vi.fn(async (value) => value) };
  const result = await changeCategory(api, "category", ["new"], 3, "remove");
  expect(result.record.data.record_ids).toEqual(["old", "later"]);
});
it("does not claim success or retry a failed save, and refuses a non-category", async () => {
  const api = { record: vi.fn().mockResolvedValue(category([])), save: vi.fn().mockRejectedValue(new ApiError("Offline", 0)) };
  await expect(changeCategory(api, "category", ["new"], 3)).rejects.toThrow("Offline");
  expect(api.save).toHaveBeenCalledOnce();
  api.record.mockResolvedValue({ ...category([]), kind: "source" });
  await expect(changeCategory(api, "category", ["new"], 3)).rejects.toThrow("available category");
});
