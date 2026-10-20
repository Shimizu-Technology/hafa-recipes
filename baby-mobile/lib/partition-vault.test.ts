import { describe, it, expect } from "vitest";
import { createPartitionVault, type EncryptedFiles } from "./partition-vault";
import type { SecretStorage } from "./vault";
function fixture() {
  const secrets = new Map<string, string>(),
    disk = new Map<string, string>(),
    writes: string[] = [];
  let id = 0,
    fail = false;
  const secret: SecretStorage = {
    getItemAsync: async (k) => secrets.get(k) ?? null,
    setItemAsync: async (k, v) => {
      if (fail) throw Error("interrupted manifest");
      secrets.set(k, v);
    },
    deleteItemAsync: async (k) => {
      secrets.delete(k);
    },
  };
  const files: EncryptedFiles = {
    read: async (n) => {
      const v = disk.get(n);
      if (v === undefined) throw Error("Missing encrypted section");
      return v;
    },
    write: async (n, v) => {
      writes.push(n);
      disk.set(n, v);
    },
    remove: async (n) => {
      disk.delete(n);
    },
    clear: async () => disk.clear(),
    seal: async (v, s) => s + ":" + v,
    open: async (v, s) => {
      if (!v.startsWith(s + ":")) throw Error("wrong section");
      return v.slice(s.length + 1);
    },
  };
  return {
    secret,
    files,
    writes,
    disk,
    uuid: () => String(++id),
    fail: () => {
      fail = true;
    },
  };
}
describe("partitioned private persistence", () => {
  it("does not rewrite a realistic source library when saving a care log", async () => {
    const f = fixture(),
      vault = createPartitionVault(f.secret, "owner", f.uuid, f.files),
      records = Array.from({ length: 200 }, (_, i) => ({ id: i, transcript: "saved evidence ".repeat(1000) })),
      state = { records, drafts: {}, outbox: [] as unknown[] };
    await vault.write(state);
    const before = f.writes.length;
    await vault.write({ ...state, outbox: [{ kind: "feeding", notes: "offline entry" }] });
    expect(f.writes.length - before).toBe(1);
    expect(await vault.read()).toEqual({ ...state, outbox: [{ kind: "feeding", notes: "offline entry" }] });
  });
  it("atomically keeps the previous state when the manifest commit fails", async () => {
    const f = fixture(),
      v = createPartitionVault(f.secret, "owner", f.uuid, f.files);
    await v.write({ outbox: ["keep"] });
    f.fail();
    await expect(v.write({ outbox: ["new"] })).rejects.toThrow();
    expect(await v.read()).toEqual({ outbox: ["keep"] });
  });
  it("never silently drops an offline draft or outbox while projecting synced cache", async () => {
    const f = fixture(),
      v = createPartitionVault(f.secret, "owner", f.uuid, f.files, (part, value) => (part === "records" ? [] : value)),
      drafts = { entry: "x".repeat(100000) },
      outbox = Array.from({ length: 500 }, (_, i) => i);
    await v.write({ records: [1, 2], drafts, outbox });
    expect(await v.read()).toEqual({ records: [], drafts, outbox });
  });
  it("detects missing files and preserves damaged state for recovery", async () => {
    const f = fixture(),
      v = createPartitionVault(f.secret, "owner", f.uuid, f.files);
    await v.write({ drafts: { note: "keep" } });
    f.disk.clear();
    await expect(v.read()).rejects.toThrow("Missing encrypted section");
  });
  it("serializes concurrent saves without losing either committed outcome", async () => {
    const f = fixture(),
      v = createPartitionVault(f.secret, "owner", f.uuid, f.files);
    await Promise.all([v.write({ outbox: [1] }), v.write({ outbox: [1, 2] })]);
    expect(await v.read()).toEqual({ outbox: [1, 2] });
  });
});
