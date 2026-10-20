import * as Crypto from "expo-crypto";
import type { useBaby } from "./context";
import type { BabyRecord, DeviceState, Kind, Mutation, RecordData, RecordWrite } from "./models";
import { kindName } from "./models";
import { addMutation } from "./outbox";

type Account = Pick<ReturnType<typeof useBaby>, "commit" | "queue" | "state" | "sync">;

/** The newest revision this device knows when an undo runs. A save still waiting in the
 * outbox has none yet; the sync loop advances later queued changes when it lands. */
function currentRevision(state: DeviceState, id: string, fallback = 0) {
  return state.records.find((row) => row.id === id)?.revision ?? fallback;
}

/** Queue a change built from the state at the moment it is committed, then sync. */
async function queueLatest(b: Account, build: (state: DeviceState) => Mutation) {
  await b.commit((state) => addMutation(state, build(state)));
  void b.sync();
}

/** Undo queues an ordinary delete after the save. The outbox applies them in order, so an
 * unsynced save and its undo cancel locally and a synced one is removed at its current revision. */
export function undoSaved(b: Account, record: BabyRecord | RecordWrite) {
  const id = Crypto.randomUUID(),
    generation = b.state.bootstrap!.generation;
  return () =>
    queueLatest(b, (state) => ({
      id,
      generation,
      type: "delete",
      record: {
        created_at: "",
        updated_at: "",
        ...record,
        revision: currentRevision(state, record.id, record.revision ?? 0),
      } as BabyRecord,
    }));
}

export function careWrite(kind: Kind, childId: string | null, data: RecordData, occurredAt = new Date()): RecordWrite {
  return {
    id: Crypto.randomUUID(),
    kind,
    title: kindName[kind],
    body: "",
    child_id: childId,
    occurred_at: occurredAt.toISOString(),
    data,
  };
}

/** Save a care entry in one tap and return its undo. */
export async function logCare(b: Account, record: RecordWrite) {
  const mutation: Mutation = { id: Crypto.randomUUID(), generation: b.state.bootstrap!.generation, type: "save", record, files: [] };
  await b.queue(mutation);
  return undoSaved(b, record);
}

/** Change a saved entry's data (for example finishing a sleep) and return the undo that restores it. */
export async function updateCare(b: Account, record: BabyRecord, data: RecordData) {
  const generation = b.state.bootstrap!.generation,
    id = Crypto.randomUUID();
  await b.queue({ id: Crypto.randomUUID(), generation, type: "save", record: { ...record, data }, files: [] });
  return () =>
    queueLatest(b, (state) => ({
      id,
      generation,
      type: "save",
      record: { ...record, data: record.data, revision: currentRevision(state, record.id, record.revision) },
      files: [],
    }));
}
