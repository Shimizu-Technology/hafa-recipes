import { reconcileObservations } from "./shared";
import {
  HealthError,
  type ActualWorkout,
  type HealthCursor,
  type HealthObservation,
  type HealthPage,
  type HealthProvider,
} from "./types";

export interface HealthGrant {
  owner_scope: string;
  generation: number;
  connected: boolean;
  read_on_device: boolean;
  upload_to_server: boolean;
  use_for_ai: boolean;
  write_actuals: boolean;
}
export interface HealthSyncState {
  owner_scope: string;
  provider: string;
  generation: number;
  cursor: HealthCursor | null;
  last_sync_at: string | null;
  disconnected: boolean;
}
export interface SyncDependencies {
  currentGrant(): Promise<HealthGrant>;
  isForeground(): boolean;
  loadState(): Promise<HealthSyncState | null>;
  saveState(state: HealthSyncState): Promise<void>;
  /** Must authenticate/authorize generation and atomically acknowledge a whole page. */
  upload(page: HealthPage, grant: HealthGrant): Promise<void>;
  /** Called on disconnect even with no OS permission; must revoke server use/derived memory. */
  revoke(grant: HealthGrant): Promise<void>;
}
export function createHealthSync(provider: HealthProvider, deps: SyncDependencies) {
  let syncing = false;
  let disconnectEpoch = 0;
  let disconnected = false;
  let stateWrites = Promise.resolve();
  function save(state: HealthSyncState, expectedEpoch?: number) {
    const task = stateWrites.then(async () => {
      if (expectedEpoch !== undefined && expectedEpoch !== disconnectEpoch)
        throw new HealthError("grant_changed", "Disconnected health state cannot be overwritten by an older refresh.");
      await deps.saveState(state);
    });
    stateWrites = task.catch(() => {});
    return task;
  }
  async function guard(original: HealthGrant, epoch: number) {
    const current = await deps.currentGrant();
    if (
      disconnected ||
      epoch !== disconnectEpoch ||
      !deps.isForeground() ||
      !current.connected ||
      !current.read_on_device ||
      !current.upload_to_server ||
      current.owner_scope !== original.owner_scope ||
      current.generation !== original.generation
    )
      throw new HealthError(
        "grant_changed",
        "Health access changed; refresh was stopped without advancing the cursor."
      );
    return current;
  }
  return {
    async refresh(window: { start: string; end: string }, maxPages = 5) {
      if (syncing) throw new HealthError("sync_busy", "A health refresh is already running.");
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10)
        throw new HealthError("invalid_page_budget", "Refresh page budget must be between one and ten.");
      syncing = true;
      const epoch = disconnectEpoch;
      const received: HealthObservation[] = [];
      const deleted: string[] = [];
      const notes: string[] = [];
      try {
        const grant = await deps.currentGrant();
        await guard(grant, epoch);
        const previous = await deps.loadState();
        if (
          previous?.owner_scope === grant.owner_scope &&
          previous.generation === grant.generation &&
          previous.disconnected
        )
          throw new HealthError("disconnected", "Reconnect explicitly before reading or uploading health records.");
        let cursor =
          previous?.owner_scope === grant.owner_scope &&
          previous.generation === grant.generation &&
          previous.provider === provider.platform &&
          !previous.disconnected
            ? previous.cursor
            : null;
        let hasMore = false;
        for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
          await guard(grant, epoch);
          const page = await provider.readPage(cursor, window);
          const current = await guard(grant, epoch);
          // No external origin becomes AI-eligible solely because the user consents.
          const projected = {
            ...page,
            observations: page.observations.map((record) => ({
              ...record,
              ai_eligibility: record.ai_eligibility === "restricted" ? ("restricted" as const) : ("unknown" as const),
            })),
          };
          await deps.upload(projected, current);
          await guard(grant, epoch);
          await save(
            {
              owner_scope: grant.owner_scope,
              provider: provider.platform,
              generation: grant.generation,
              cursor: page.next_cursor,
              last_sync_at: new Date().toISOString(),
              disconnected: false,
            },
            epoch
          );
          await guard(grant, epoch);
          cursor = page.next_cursor;
          received.push(...projected.observations);
          deleted.push(...page.deleted_source_ids);
          notes.push(...page.coverage_notes);
          hasMore = page.has_more;
          if (!hasMore) break;
        }
        return {
          observations: reconcileObservations(received, deleted),
          deleted_source_ids: [...new Set(deleted)],
          has_more: hasMore,
          coverage_notes: [...new Set(notes)],
        };
      } finally {
        syncing = false;
      }
    },
    async reconnect() {
      const grant = await deps.currentGrant();
      const state = await deps.loadState();
      if (
        !grant.connected ||
        state?.disconnected ||
        (state && (state.owner_scope !== grant.owner_scope || state.generation !== grant.generation))
      )
        throw new HealthError("reconnect_required", "Save fresh explicit connection choices before reconnecting.");
      disconnectEpoch++;
      disconnected = false;
    },
    async disconnect() {
      disconnectEpoch++;
      disconnected = true;
      const grant = await deps.currentGrant();
      // Persist local refusal first, then revoke server grants. OS revocation on
      // Android may not take effect until restart, so never rely on it alone.
      await save({
        owner_scope: grant.owner_scope,
        provider: provider.platform,
        generation: grant.generation,
        cursor: null,
        last_sync_at: null,
        disconnected: true,
      });
      await deps.revoke(grant);
    },
    async exportActual(workout: ActualWorkout, ownerScope: string) {
      const epoch = disconnectEpoch;
      const grant = await deps.currentGrant();
      const state = await deps.loadState();
      if (
        disconnected ||
        (state?.disconnected && state.generation === grant.generation) ||
        !grant.connected ||
        !grant.write_actuals ||
        ownerScope !== grant.owner_scope
      )
        throw new HealthError(
          "write_not_consented",
          "Enable actual-workout writing for the current account before exporting."
        );
      const beforeWrite = await deps.currentGrant();
      if (
        disconnected ||
        epoch !== disconnectEpoch ||
        beforeWrite.owner_scope !== grant.owner_scope ||
        beforeWrite.generation !== grant.generation ||
        !beforeWrite.connected ||
        !beforeWrite.write_actuals
      )
        throw new HealthError(
          "write_grant_changed",
          "Write access changed before the provider save. No workout was exported."
        );
      const receipt = await provider.exportActual(workout);
      const current = await deps.currentGrant();
      if (
        epoch !== disconnectEpoch ||
        !current.connected ||
        !current.write_actuals ||
        current.generation !== grant.generation ||
        current.owner_scope !== grant.owner_scope
      )
        throw new HealthError(
          "write_grant_changed",
          "Write access changed while the provider was saving; reconcile the owned write before retrying."
        );
      return receipt;
    },
  };
}
