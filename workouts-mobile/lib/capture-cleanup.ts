import type { Storage } from "./drafts";

type JournalStorage = Storage & { getAllKeys(): Promise<readonly string[]> };
export type CaptureAssetKind = "capture" | "picker" | "document" | "manipulator";
interface Asset {
  uri: string;
  kind: CaptureAssetKind;
}
interface Record {
  version: 1;
  owner: string;
  operation: string;
  assets: Asset[];
  nativeProcessIdentity: string;
  state: "open" | "settled";
  nativeKind: "known" | "opaque" | null;
  opaqueIncomplete: boolean;
}
const prefix = "hafa-workouts:capture-cleanup:v1:";
const directories: { [K in CaptureAssetKind]: string } = {
  capture: "hafa-workouts-capture/",
  picker: "ImagePicker/",
  document: "DocumentPicker/",
  manipulator: "ImageManipulator/"
};
const queues = new Map<string, Promise<unknown>>();
interface LiveLease {
  cancelled: boolean;
  nativePending: boolean;
  nativeProcessIdentity: string;
}
const liveLeases = new Map<string, LiveLease>();

/** Exact operation metadata outlives product erasure; no raw source bytes live here. */
export function createCaptureCleanupJournal(
  storage: JournalStorage,
  cache: () => string | null,
  remove: (uri: string) => Promise<void>,
  processIdentity: () => Promise<string>
) {
  const keyFor = (owner: string, operation: string) =>
    `${prefix}${encodeURIComponent(owner)}:${encodeURIComponent(operation)}`;
  function ordered<T>(key: string, work: () => Promise<T>) {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    queues.set(key, next);
    void next
      .finally(() => {
        if (queues.get(key) === next) queues.delete(key);
      })
      .catch(() => undefined);
    return next;
  }
  function valid(asset: Asset) {
    const root = cache();
    if (!root || !Object.prototype.hasOwnProperty.call(directories, asset.kind) || typeof asset.uri !== "string")
      return false;
    const expected = root + directories[asset.kind];
    if (!asset.uri.startsWith(expected) || asset.uri.endsWith("/")) return false;
    try {
      const path = decodeURIComponent(asset.uri.slice(expected.length));
      return (
        !!path && !/[\\?#\0]/.test(path) && !path.split("/").some((part) => !part || part === "." || part === "..")
      );
    } catch {
      return false;
    }
  }
  function recoveredAsset(asset: Asset): Asset | null {
    if (valid(asset)) return asset;
    const root = cache();
    if (!root || !Object.prototype.hasOwnProperty.call(directories, asset.kind)) return null;
    const uuid = "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}";
    // An iOS upgrade can move this same app's cache to a new data-container UUID.
    // Keep the physical/simulator parent exact, including the simulator device.
    const container = root.match(new RegExp(
      String.raw`^(file:///(?:var/mobile|private/var/mobile|Users/[^/\\?#\x00]+/Library/Developer/CoreSimulator/Devices/${uuid}/data)/Containers/Data/Application/)(${uuid})/Library/Caches/$`
    ));
    if (!container || !asset.uri.startsWith(container[1])) return null;
    const old = asset.uri.slice(container[1].length).match(new RegExp(`^(${uuid})/Library/Caches/(.+)$`));
    if (!old || old[1].toLowerCase() === container[2].toLowerCase()) return null;
    // Encoded separators or another encoding layer are not a recoverable asset name.
    if (/%(?:2f|5c|00|25)/i.test(old[2])) return null;
    const recovered = { ...asset, uri: root + old[2] };
    return valid(recovered) ? recovered : null;
  }
  function checked(value: Record, key: string, checkLocations = true) {
    if (
      value?.version !== 1 ||
      typeof value.owner !== "string" ||
      !value.owner ||
      typeof value.operation !== "string" ||
      !value.operation ||
      key !== keyFor(value.owner, value.operation) ||
      typeof value.nativeProcessIdentity !== "string" ||
      !value.nativeProcessIdentity ||
      !["open", "settled"].includes(value.state) ||
      ![null, "known", "opaque"].includes(value.nativeKind) ||
      (value.state === "settled" && value.nativeKind !== null) ||
      typeof value.opaqueIncomplete !== "boolean" ||
      !Array.isArray(value.assets) ||
      value.assets.some((asset) => !asset || typeof asset.uri !== "string" ||
        !Object.prototype.hasOwnProperty.call(directories, asset.kind) || checkLocations && !valid(asset))
    )
      throw Error("Source-file cleanup metadata needs review before private training can open.");
    return value;
  }
  async function registered(owner: string) {
    const protectedUris = new Set<string>();
    const draftPrefix = `hafa-workouts:v1:${encodeURIComponent(owner)}:capture%3A`;
    for (const key of await storage.getAllKeys()) {
      if (!key.startsWith(draftPrefix)) continue;
      const raw = await storage.getItem(key);
      if (!raw) continue;
      // An unreadable draft may contain a registered source; fail closed.
      const draft = JSON.parse(raw) as { files?: Array<{ owned?: boolean; uri?: string }> };
      for (const file of draft.files ?? []) if (file.owned && typeof file.uri === "string") {
        protectedUris.add(file.uri);
        const recovered = recoveredAsset({ uri: file.uri, kind: "capture" });
        if (recovered) protectedUris.add(recovered.uri);
      }
    }
    return protectedUris;
  }
  function lease(owner: string, operation: string, identity: string, initial?: Record, live?: LiveLease) {
    const key = keyFor(owner, operation);
    let local = [...(initial?.assets ?? [])];
    let state: Record["state"] = initial?.state ?? "open",
      nativeKind: Record["nativeKind"] = initial?.nativeKind ?? null;
    let opaqueIncomplete = initial?.opaqueIncomplete ?? false;
    const merge = (assets: Asset[]) => {
      local = [...new Map([...local, ...assets].map((asset) => [asset.uri, asset])).values()];
    };
    async function persisted() {
      const raw = await storage.getItem(key);
      if (raw) merge(checked(JSON.parse(raw), key).assets);
    }
    const write = () =>
      storage.setItem(
        key,
        JSON.stringify({
          version: 1,
          owner,
          operation,
          assets: local,
          nativeProcessIdentity: identity,
          state,
          nativeKind,
          opaqueIncomplete
        } satisfies Record)
      );
    return {
      async native<T>(
        kind: "known" | "opaque",
        work: () => Promise<T>,
        returned: (value: T) => Asset[] = () => [],
        guard: () => void = () => {}
      ) {
        if (!live || live.cancelled || state !== "open")
          throw Error("This source action stopped. Choose the source again.");
        if (live.nativePending) throw Error("A source action is still finishing. Retry cleanup after it closes.");
        live.nativePending = true;
        let invoked = false,
          completed = false;
        try {
          await ordered(key, async () => {
            await persisted();
            nativeKind = kind;
            await write();
          });
          if (live.cancelled) throw Error("This source action stopped. Choose the source again.");
          guard();
          invoked = true;
          const value = await work();
          completed = true;
          const assets = returned(value);
          if (assets.some((asset) => !valid(asset))) {
            opaqueIncomplete = true;
            throw Error("That source file cannot be safely saved. Choose it again.");
          }
          await ordered(key, async () => {
            merge(assets);
            await persisted();
            nativeKind = null;
            await write();
          });
          if (live.cancelled) throw Error("This source action stopped. Choose the source again.");
          return value;
        } catch (error) {
          if (invoked && !completed && kind === "opaque") opaqueIncomplete = true;
          nativeKind = null;
          throw error;
        } finally {
          live.nativePending = false;
        }
      },
      async finish() {
        if (live?.nativePending) throw Error("A source action is still finishing. Retry cleanup after it closes.");
        state = "settled";
        nativeKind = null;
        try {
          await ordered(key, async () => {
            await persisted();
            await write();
          });
        } finally {
          if (liveLeases.get(key) === live) liveLeases.delete(key);
        }
      },
      remember(assets: Asset[]) {
        if (assets.some((asset) => !valid(asset)))
          return Promise.reject(Error("That source-file location cannot be owned by this capture."));
        const snapshot = assets.map((asset) => ({ ...asset }));
        return ordered(key, async () => {
          // Keep exact URIs even if the durable read/write itself fails.
          if (live?.cancelled || state !== "open") throw Error("This source action stopped. Choose the source again.");
          merge(snapshot);
          await persisted();
          await write();
        });
      },
      cleanup(kinds: readonly CaptureAssetKind[] = ["capture", "picker", "document", "manipulator"]) {
        return ordered(key, async () => {
          await persisted();
          if (state !== "settled" || live?.nativePending)
            throw Error("A source action is still finishing. Retry cleanup after it closes.");
          const active = await registered(owner),
            remaining: Asset[] = [];
          let failure: unknown;
          for (const asset of local) {
            if (!kinds.includes(asset.kind)) {
              remaining.push(asset);
              continue;
            }
            // A registered asset is transferred to its draft. Journal failures must
            // never turn an accepted source into a startup deletion candidate.
            if (asset.kind === "capture" && active.has(asset.uri)) continue;
            try {
              await remove(asset.uri);
            } catch (error) {
              remaining.push(asset);
              failure ??= error;
            }
          }
          local = remaining;
          if (local.length || opaqueIncomplete) await write();
          else await storage.removeItem(key);
          if (failure) throw failure;
          if (opaqueIncomplete)
            throw Error(
              "A source action ended without confirming its files. Cleanup needs review before private training can open."
            );
        });
      }
    };
  }
  return {
    async begin(owner: string, operation: string) {
      if (!owner || !operation) throw Error("Source capture requires an account and an operation identity.");
      const identity = await processIdentity();
      if (typeof identity !== "string" || !identity) throw Error("Use an updated installed app to capture files.");
      const key = keyFor(owner, operation),
        live: LiveLease = { cancelled: false, nativePending: false, nativeProcessIdentity: identity };
      liveLeases.set(key, live);
      const result = lease(owner, operation, identity, undefined, live);
      try {
        await result.remember([]);
      } catch (error) {
        liveLeases.delete(key);
        throw error;
      }
      return result;
    },
    async recover(owner?: string) {
      const keys = (await storage.getAllKeys()).filter(
        (key) => key.startsWith(prefix) && (!owner || key.startsWith(`${prefix}${encodeURIComponent(owner)}:`))
      );
      if (!keys.length) return;
      const identity = await processIdentity();
      if (typeof identity !== "string" || !identity)
        throw Error("Use an updated installed app to finish source-file cleanup.");
      for (const key of keys) {
        const value = await ordered(key, async () => {
          const raw = await storage.getItem(key);
          if (!raw) return null;
          const value = checked(JSON.parse(raw), key, false);
          const live = liveLeases.get(key);
          if (live?.nativeProcessIdentity === identity) live.cancelled = true;
          if (value.state === "open") {
            // Missing JS liveness is not evidence that an old native write stopped.
            if (value.nativeProcessIdentity === identity)
              throw Error(
                "A source action is still finishing. Close it, then retry cleanup. If it cannot finish, fully close and reopen the app."
              );
            if (value.nativeKind === "opaque")
              throw Error(
                "An earlier source action did not return its file locations. Cleanup needs review before private training can open."
              );
            // A changed native process token proves known writers from that process
            // cannot create bytes after this cleanup. It is not a clock/JS session.
          }
          const assets = value.assets.map((asset) => {
            const recovered = recoveredAsset(asset);
            if (!recovered) throw Error("Source-file cleanup metadata needs review before private training can open.");
            return recovered;
          });
          const normalized = { ...value, assets };
          // Persist the current-cache targets before an idempotent delete can run.
          if (assets.some((asset, index) => asset.uri !== value.assets[index].uri))
            await storage.setItem(key, JSON.stringify(normalized));
          return normalized;
        });
        if (!value) continue;
        const recovering = lease(value.owner, value.operation, value.nativeProcessIdentity, value);
        await recovering.finish();
        await recovering.cleanup();
      }
    }
  };
}
export type CaptureCleanupLease = Awaited<ReturnType<ReturnType<typeof createCaptureCleanupJournal>["begin"]>>;
