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
async function queueLatest(b: Account, build: (state: DeviceState) => Mutation, alongside = (state: DeviceState) => state) {
  await b.commit((state) => addMutation(alongside(state), build(state)));
  void b.sync();
}

/** Undo queues an ordinary delete after the save. The outbox applies them in order, so an
 * unsynced save and its undo cancel locally and a synced one is removed at its current revision. */
export function undoSaved(b: Account, record: BabyRecord | RecordWrite, alongside?: (state: DeviceState) => DeviceState) {
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
    }), alongside);
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

/** Save a care entry in one tap and return its undo. `alongside` changes device state in the
 * same write (a feeding timer), so the entry and that change land or fail together; `undone` does the same for its undo. */
export async function logCare(b: Account, record: RecordWrite, alongside?: (state: DeviceState) => DeviceState, undone?: (state: DeviceState) => DeviceState) {
  const mutation: Mutation = { id: Crypto.randomUUID(), generation: b.state.bootstrap!.generation, type: "save", record, files: [] };
  if (alongside) await queueLatest(b, () => mutation, alongside);
  else await b.queue(mutation);
  return undoSaved(b, record, undone);
}

/** Change a saved entry's data (for example finishing a sleep) and return the undo that restores it. */
export async function updateCare(b: Account, record: BabyRecord, data: RecordData, alongside?: (state: DeviceState) => DeviceState, undone?: (state: DeviceState) => DeviceState) {
  const generation = b.state.bootstrap!.generation,
    id = Crypto.randomUUID(),
    change: Mutation = { id: Crypto.randomUUID(), generation, type: "save", record: { ...record, data }, files: [] };
  if (alongside) await queueLatest(b, () => change, alongside);
  else await b.queue(change);
  return () =>
    queueLatest(b, (state) => ({
      id,
      generation,
      type: "save",
      record: { ...record, data: record.data, revision: currentRevision(state, record.id, record.revision) },
      files: [],
    }), undone);
}

/** Change a saved entry's time, note or details. Built from the newest local copy, so changes made seconds apart all land. */
export async function amendCare(b: Account & Pick<ReturnType<typeof useBaby>, "records">, id: string, change: (record: BabyRecord) => Partial<Pick<BabyRecord, "body" | "occurred_at" | "data">>) {
  const record = b.records.find((row) => row.id === id);
  if (!record) return;
  await b.queue({ id: Crypto.randomUUID(), generation: b.state.bootstrap!.generation, type: "save", record: { ...record, ...change(record) }, files: [] });
}

const ozToMl = 30;
const bottleStep = { oz: 0.5, ml: 10 } as const;
/** Where a first bottle starts, before there is a last time to copy. */
const firstAmount = { oz: 3, ml: 90 } as const;

export interface BottleChoice { amount: number; unit: "oz" | "ml"; contents?: NonNullable<RecordData["contents"]>; fromLast: boolean }

/** A bottle starts from the last one: same amount, same unit, same milk. Ounces until she uses something else. */
export function bottleStart(rows: BabyRecord[], childId: string | null): BottleChoice {
  const last = rows.filter((row) => row.kind === "feeding" && row.child_id === childId && row.data.method === "bottle")
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
  const unit = last?.data.unit ?? "oz", amount = last?.data.amount;
  return typeof amount === "number" && amount > 0
    ? { amount, unit, contents: last!.data.contents ?? undefined, fromLast: true }
    : { amount: firstAmount[unit], unit, contents: last?.data.contents ?? undefined, fromLast: false };
}

export function stepAmount(choice: Pick<BottleChoice, "amount" | "unit">, direction: 1 | -1) {
  const step = bottleStep[choice.unit];
  return Math.max(step, Math.round((choice.amount + direction * step) / step) * step);
}

/** The same bottle in the other unit, on the nearest step. */
export function changeUnit(choice: Pick<BottleChoice, "amount" | "unit">): Pick<BottleChoice, "amount" | "unit"> {
  const unit = choice.unit === "oz" ? "ml" : "oz", step = bottleStep[unit],
    converted = choice.unit === "oz" ? choice.amount * ozToMl : choice.amount / ozToMl;
  return { unit, amount: Math.max(step, Math.round(converted / step) * step) };
}
