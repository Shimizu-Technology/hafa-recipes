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

it("restores failed phone-only attachments through a new partition-vault instance", async () => {
  const f = fixture(), first = createPartitionVault(f.secret, "owner", f.uuid, f.files);
  const outbox = [{ id: "failed", type: "save", error: "Upload failed", localOnly: true,
    files: [{ id: "photo", uri: "file:///photo.jpg", name: "photo.jpg", mime_type: "image/jpeg" }] }];
  await first.write({ outbox }); first.retire();
  const restored = await createPartitionVault(f.secret, "owner", f.uuid, f.files).read<{ outbox: typeof outbox }>();
  expect(restored?.outbox).toEqual(outbox);
});

it("keeps the pre-import baseline through admission loss and cold vault restore", async () => {
  const f = fixture(), first = createPartitionVault(f.secret, "owner", f.uuid, f.files);
  const baseline = { id: "source", revision: 1, title: "Saved source", body: "Original note",
    child_id: "child", data: { source_text: "Original", topics: ["Care"], attachment_ids: ["photo"] } };
  const state = { outbox: [{ id: "job", type: "import", baseline }],
    imports: [{ id: "other-job", status: "processing", baseline, reconciled: false }] };
  await first.write(state); first.retire();
  expect(await createPartitionVault(f.secret, "owner", f.uuid, f.files).read()).toEqual(state);
});

describe("the fence for an older build", () => {
  /** Build 35's own check on the manifest, as shipped: anything but version 1 is refused, and nothing is overwritten. */
  const shippedRead = (raw: string) => { const parsed = JSON.parse(raw); if (parsed.version !== 1) throw Error("Private device data needs recovery. It has not been overwritten."); return parsed; };
  function vault(stamp?: (state: Record<string, unknown>) => 1 | 2) {
    const held = new Map<string, string>(), files = new Map<string, string>(); let id = 0;
    const secret = { getItemAsync: async (k: string) => held.get(k) ?? null, setItemAsync: async (k: string, v: string) => { held.set(k, v); }, deleteItemAsync: async (k: string) => { held.delete(k); } };
    const store = { read: async (name: string) => files.get(name)!, write: async (name: string, value: string) => { files.set(name, value); }, remove: async (name: string) => { files.delete(name); }, clear: async () => files.clear(), seal: async (value: string) => value, open: async (value: string) => value };
    return { held, make: () => createPartitionVault(secret, "n", () => String(++id), store, (_: string, v: unknown) => v, stamp) };
  }
  const manifest = (held: Map<string, string>) => [...held.entries()].find(([k]) => k.endsWith(".manifest"))![1];
  it("stays version 1 with no family work, so a rollback still opens", async () => {
    const v = vault((state) => (state.family ? 2 : 1));
    await v.make().write({ family: false, outbox: [] });
    expect(JSON.parse(manifest(v.held)).version).toBe(1);
    expect(() => shippedRead(manifest(v.held))).not.toThrow();
  });
  it("becomes version 2 with family work, which a shipped build refuses without touching it", async () => {
    const v = vault((state) => (state.family ? 2 : 1)), mine = v.make();
    await mine.write({ family: true, outbox: ["queued tap"] });
    const before = manifest(v.held);
    expect(JSON.parse(before).version).toBe(2);
    expect(() => shippedRead(before)).toThrow(/has not been overwritten/);
    expect(await v.make().read()).toEqual({ family: true, outbox: ["queued tap"] });
  });
  it("goes back to version 1 when the family work is gone", async () => {
    const v = vault((state) => (state.family ? 2 : 1)), mine = v.make();
    await mine.write({ family: true });
    await mine.write({ family: false });
    expect(JSON.parse(manifest(v.held)).version).toBe(1);
  });
  it("this build reads both, and refuses one from further ahead", async () => {
    const v = vault(() => 2), mine = v.make();
    await mine.write({ a: 1 });
    expect(await v.make().read()).toEqual({ a: 1 });
    v.held.set([...v.held.keys()].find((k) => k.endsWith(".manifest"))!, JSON.stringify({ version: 3, parts: {} }));
    await expect(v.make().read()).rejects.toThrow(/needs recovery/);
  });
});
