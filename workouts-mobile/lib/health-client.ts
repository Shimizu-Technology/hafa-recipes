import type { HealthObservation, HealthPage, HealthProvider, ActualWorkout, ExportReceipt } from "./health/types";
import { HealthError } from "./health/types";
import { createHealthSync, type HealthGrant, type HealthSyncState } from "./health/sync";
import type { Storage } from "./drafts";
export type ProviderName = "apple_health" | "health_connect";
export interface HealthConnection {
  provider: ProviderName;
  generation: number;
  revision: number;
  connected: boolean;
  read_on_device: boolean;
  upload_to_server: boolean;
  use_for_ai: boolean;
  write_actuals: boolean;
  last_sync_at: string | null;
  cursor: Record<string, unknown> | null;
}
export type HealthChoices = Pick<
  HealthConnection,
  "connected" | "read_on_device" | "upload_to_server" | "use_for_ai" | "write_actuals"
>;
export interface SyncBody {
  receipt_id: string;
  expected_revision: number;
  observations: HealthObservation[];
  deleted_source_ids: string[];
  next_cursor: HealthPage["next_cursor"] | null;
  has_more: boolean;
  reset_required: boolean;
}
export interface ExportIntent {
  status: "ready" | "unsupported";
  message?: string;
  intent_id: string | null;
  actual: ActualWorkout | null;
  provider_write_status?: string;
  source_id?: string | null;
}
export interface HealthApi {
  healthConnection(provider: ProviderName): Promise<HealthConnection>;
  saveHealthConnection(
    provider: ProviderName,
    choices: HealthChoices,
    expected_revision: number,
    generation: number
  ): Promise<HealthConnection>;
  uploadHealth(provider: ProviderName, body: SyncBody, generation: number): Promise<{ receipt_id: string }>;
  reconcileHealth(
    provider: ProviderName,
    body: { expected_revision: number; window_start: string; window_end: string; receipt_ids: string[] },
    generation: number
  ): Promise<unknown>;
  prepareHealthExport(
    provider: ProviderName,
    session_id: string,
    expected_revision: number,
    generation: number
  ): Promise<ExportIntent>;
  acknowledgeHealthExport(
    provider: ProviderName,
    intent_id: string,
    expected_revision: number,
    receipt: Pick<ExportReceipt, "status" | "source_id">,
    generation: number
  ): Promise<unknown>;
}
interface PendingUpload {
  generation: number;
  revision: number;
  parts: SyncBody[];
  page: HealthPage;
  done: number;
}
interface DisconnectCommand {
  generation: number;
  revision: number;
}
interface PendingAck {
  generation: number;
  revision: number;
  intent_id: string;
  receipt: Pick<ExportReceipt, "status" | "source_id">;
}
export interface HealthClientDependencies {
  api: HealthApi;
  storage: Storage;
  owner: string;
  enrollment_generation: number;
  provider: HealthProvider;
  provider_name: ProviderName;
  currentOwnerScope(): string | null;
  isForeground(): boolean;
  uuid(): string;
}
export function healthOwnerScope(owner: string, generation: number) {
  return `${owner}:workouts:${generation}`;
}

// Keep JSON receipts comfortably below request limits as well as the 200-record count cap.
export function syncParts(page: HealthPage, revision: number, uuid: () => string): SyncBody[] {
  const parts: SyncBody[] = [];
  let observations: HealthObservation[] = [],
    deleted: string[] = [];
  const make = (): SyncBody => ({
    receipt_id: uuid(),
    expected_revision: revision,
    observations,
    deleted_source_ids: deleted,
    next_cursor: null,
    has_more: true,
    reset_required: page.reset_required,
  });
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  const flush = () => {
    parts.push(make());
    observations = [];
    deleted = [];
  };
  for (const observation of page.observations) {
    if (observations.length === 200 || bytes([...observations, observation]) + bytes(deleted) > 110000) flush();
    if (bytes(observation) > 110000)
      throw new HealthError(
        "record_too_large",
        "A health summary is too large to upload safely. Nothing was checkpointed."
      );
    observations.push(observation);
  }
  for (const id of page.deleted_source_ids) {
    if (deleted.length === 200 || bytes(observations) + bytes([...deleted, id]) > 110000) flush();
    deleted.push(id);
  }
  if (observations.length || deleted.length || !parts.length) flush();
  const last = parts[parts.length - 1];
  last.next_cursor = page.next_cursor;
  last.has_more = page.has_more;
  return parts;
}

const queues = new Map<string, Promise<void>>();
export function createHealthClient(deps: HealthClientDependencies) {
  const { api, storage, provider, provider_name: name, enrollment_generation: generation } = deps;
  const ownerScope = healthOwnerScope(deps.owner, generation);
  const prefix = `hafa-workouts:health:v1:${encodeURIComponent(deps.owner)}:${generation}:${name}`;
  const key = (kind: string) => `${prefix}:${kind}`;
  const read = async <T>(kind: string): Promise<T | null> => {
    const raw = await storage.getItem(key(kind));
    return raw ? (JSON.parse(raw) as T) : null;
  };
  const save = (kind: string, value: unknown) => storage.setItem(key(kind), JSON.stringify(value));
  let localDisconnected = false;
  let busy = false;
  let exporting = false;
  function ordered(work: () => Promise<void>) {
    const next = (queues.get(prefix) ?? Promise.resolve()).catch(() => undefined).then(work);
    queues.set(prefix, next);
    void next
      .finally(() => {
        if (queues.get(prefix) === next) queues.delete(prefix);
      })
      .catch(() => undefined);
    return next;
  }
  function owner() {
    if (deps.currentOwnerScope() !== ownerScope)
      throw new HealthError("owner_changed", "The signed-in account changed. Health work was stopped.");
  }
  async function current(): Promise<HealthGrant> {
    owner();
    const connection = await api.healthConnection(name);
    owner();
    if (connection.generation !== generation)
      throw new HealthError("generation_changed", "Your Workouts enrollment changed. Reconnect explicitly.");
    const fence = await read<{ disconnected: boolean }>("fence");
    owner();
    return {
      owner_scope: ownerScope,
      generation: connection.revision,
      connected: connection.connected && !localDisconnected && !fence?.disconnected,
      read_on_device: connection.read_on_device,
      upload_to_server: connection.upload_to_server,
      use_for_ai: connection.use_for_ai,
      write_actuals: connection.write_actuals,
    };
  }
  async function flushUpload() {
    const pending = await read<PendingUpload>("upload");
    if (!pending) return;
    owner();
    const grant = await current();
    if (
      pending.generation !== generation ||
      pending.revision !== grant.generation ||
      !grant.connected ||
      !grant.upload_to_server
    )
      throw new HealthError(
        "grant_changed",
        "This saved health page uses older permissions. It has not been resent under new permissions."
      );
    for (let i = pending.done; i < pending.parts.length; i++) {
      owner();
      const fresh = await current();
      if (!deps.isForeground() || fresh.generation !== pending.revision || !fresh.connected || !fresh.upload_to_server)
        throw new HealthError("grant_changed", "Health refresh stopped because access changed.");
      await api.uploadHealth(name, pending.parts[i], pending.generation);
      owner();
      pending.done = i + 1;
      await ordered(() => save("upload", pending));
    }
    await ordered(async () => {
      const fresh = await current();
      if (!fresh.connected || fresh.generation !== pending.revision)
        throw new HealthError("grant_changed", "Health permissions changed before checkpointing.");
      const prior = await read<HealthSyncState>("state");
      const bootstrap = pending.page.reset_required || prior?.cursor?.phase === "bootstrap" || !prior?.cursor;
      if (name === "health_connect" && bootstrap) {
        const snapshots = await read<{ start: string; end: string; revision: number; receipts: string[] }>("snapshot");
        const matching =
          snapshots?.revision === pending.revision &&
          snapshots.start === pending.page.next_cursor.window_start &&
          snapshots.end === pending.page.next_cursor.window_end;
        const receipts = [
          ...new Set([...(matching ? snapshots.receipts : []), ...pending.parts.map((p) => p.receipt_id)]),
        ];
        await save("snapshot", {
          start: pending.page.next_cursor.window_start,
          end: pending.page.next_cursor.window_end,
          revision: pending.revision,
          receipts,
        });
        if (!pending.page.has_more && pending.page.next_cursor.phase === "changes") {
          await api.reconcileHealth(
            name,
            {
              expected_revision: pending.revision,
              window_start: pending.page.next_cursor.window_start,
              window_end: pending.page.next_cursor.window_end,
              receipt_ids: receipts,
            },
            generation
          );
          await storage.removeItem(key("snapshot"));
        }
      }
      owner();
      await save("state", {
        owner_scope: ownerScope,
        provider: name,
        generation: pending.revision,
        cursor: pending.page.next_cursor,
        last_sync_at: new Date().toISOString(),
        disconnected: false,
      });
      await storage.removeItem(key("upload"));
    });
  }
  const sync = createHealthSync(provider, {
    currentGrant: current,
    isForeground: () => deps.isForeground() && deps.currentOwnerScope() === ownerScope,
    loadState: async () => {
      owner();
      const state = await read<HealthSyncState>("state");
      owner();
      return state;
    },
    saveState: (state) =>
      ordered(async () => {
        owner();
        const fence = await read<{ disconnected: boolean }>("fence");
        if (!state.disconnected && (localDisconnected || fence?.disconnected))
          throw new HealthError("disconnected", "A pending refresh cannot undo your disconnection.");
        await save("state", state);
      }),
    async upload(page, grant) {
      owner();
      const existing = await read<PendingUpload>("upload");
      if (existing) await flushUpload();
      const parts = syncParts(page, grant.generation, deps.uuid);
      await ordered(() => save("upload", { generation, revision: grant.generation, parts, page, done: 0 }));
      await flushUpload();
    },
    async revoke(grant) {
      const command = (await read<DisconnectCommand>("disconnect")) ?? { generation, revision: grant.generation };
      await save("disconnect", command);
      await api.saveHealthConnection(
        name,
        { connected: false, read_on_device: false, upload_to_server: false, use_for_ai: false, write_actuals: false },
        command.revision,
        command.generation
      );
      await storage.removeItem(key("disconnect"));
    },
  });
  return {
    scope: ownerScope,
    async connection() {
      owner();
      return await api.healthConnection(name);
    },
    async isDisconnectedLocally() {
      return localDisconnected || !!(await read<{ disconnected: boolean }>("fence"))?.disconnected;
    },
    async saveChoices(choices: HealthChoices, expectedRevision: number) {
      owner();
      const pending = await read<DisconnectCommand>("disconnect");
      if (pending) await this.retryDisconnect();
      const result = await api.saveHealthConnection(name, choices, expectedRevision, generation);
      owner();
      localDisconnected = !result.connected;
      await ordered(async () => {
        await save("fence", { disconnected: !result.connected });
        await save("state", {
          owner_scope: ownerScope,
          provider: name,
          generation: result.revision,
          cursor: null,
          last_sync_at: null,
          disconnected: !result.connected,
        });
        await storage.removeItem(key("upload"));
        await storage.removeItem(key("snapshot"));
      });
      if (result.connected) await sync.reconnect();
      return result;
    },
    async refresh() {
      if (busy) throw new HealthError("sync_busy", "A health refresh is already running.");
      busy = true;
      try {
        owner();
        await flushUpload();
        const end = new Date();
        const start = new Date(end.getTime() - 30 * 86400000);
        return await sync.refresh({ start: start.toISOString(), end: end.toISOString() }, 5);
      } finally {
        busy = false;
      }
    },
    async readOnDevice() {
      owner();
      const grant = await current();
      if (!grant.connected || !grant.read_on_device || !deps.isForeground())
        throw new HealthError("read_not_consented", "Enable reading on this device first.");
      const end = new Date();
      const start = new Date(end.getTime() - 30 * 86400000);
      const page = await provider.readPage(null, { start: start.toISOString(), end: end.toISOString() });
      const fresh = await current();
      if (fresh.generation !== grant.generation || !fresh.connected || !deps.isForeground())
        throw new HealthError("grant_changed", "Read permission changed; these results were not retained.");
      return page;
    },
    async disconnect(expectedRevision: number) {
      owner();
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw new HealthError("revision_required", "Reload health choices before disconnecting.");
      localDisconnected = true;
      await ordered(async () => {
        await save("fence", { disconnected: true });
        await save("disconnect", { generation, revision: expectedRevision });
      });
      await sync.disconnect();
      await ordered(async () => {
        await storage.removeItem(key("upload"));
        await storage.removeItem(key("snapshot"));
      });
    },
    async retryDisconnect() {
      owner();
      const command = await read<DisconnectCommand>("disconnect");
      if (!command) return;
      const current = await api.healthConnection(name);
      owner();
      if (current.generation !== command.generation)
        throw new HealthError(
          "generation_changed",
          "The enrollment changed. No old disconnection was applied to the new enrollment."
        );
      if (current.connected)
        await api.saveHealthConnection(
          name,
          { connected: false, read_on_device: false, upload_to_server: false, use_for_ai: false, write_actuals: false },
          command.revision,
          command.generation
        );
      await storage.removeItem(key("disconnect"));
    },
    async exportSession(sessionId: string) {
      if (exporting) throw new HealthError("write_busy", "A health write is already in progress.");
      exporting = true;
      try {
        owner();
        const grant = await current();
        if (!grant.connected || !grant.write_actuals)
          throw new HealthError("write_not_consented", "Enable actual-workout writing for your current account first.");
        const intent = await api.prepareHealthExport(name, sessionId, grant.generation, generation);
        owner();
        if (intent.status === "unsupported" || !intent.actual || !intent.intent_id)
          return {
            status: "unsupported" as const,
            message: intent.message ?? "This record cannot be exported truthfully. It stays in the app.",
          };
        const receipt = await sync.exportActual(intent.actual, ownerScope);
        const pending: PendingAck = {
          generation,
          revision: grant.generation,
          intent_id: intent.intent_id,
          receipt: { status: receipt.status, source_id: receipt.source_id },
        };
        await ordered(async () => {
          const old = await read<PendingAck | PendingAck[]>("ack");
          const queue = old ? (Array.isArray(old) ? old : [old]) : [];
          await save("ack", [...queue.filter((item) => item.intent_id !== pending.intent_id), pending]);
        });
        await this.retryAcknowledgment();
        return receipt;
      } finally {
        exporting = false;
      }
    },
    async retryAcknowledgment() {
      owner();
      const old = await read<PendingAck | PendingAck[]>("ack");
      if (!old) return;
      const queue = Array.isArray(old) ? old : [old];
      for (const pending of queue) {
        const grant = await current();
        if (
          pending.generation !== generation ||
          pending.revision !== grant.generation ||
          !grant.connected ||
          !grant.write_actuals
        )
          throw new HealthError(
            "grant_changed",
            "A device write may exist, but its older server acknowledgment was not replayed under new permissions."
          );
        await api.acknowledgeHealthExport(
          name,
          pending.intent_id,
          pending.revision,
          pending.receipt,
          pending.generation
        );
        owner();
        await ordered(async () => {
          const latest = await read<PendingAck | PendingAck[]>("ack");
          const values = latest ? (Array.isArray(latest) ? latest : [latest]) : [];
          const remaining = values.filter((value) => value.intent_id !== pending.intent_id);
          if (remaining.length) await save("ack", remaining);
          else await storage.removeItem(key("ack"));
        });
      }
    },
  };
}
