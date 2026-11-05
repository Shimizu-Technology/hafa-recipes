import * as Crypto from "expo-crypto";
import type { useBaby } from "./context";
import type { BabyRecord, Child, DeviceState, Kind, Mutation, RecordData, RecordWrite, SessionAction } from "./models";
import { kindName } from "./models";
import { newestFirst } from "./feed-reducer";
import { addMutation, pendingRecords, withoutBirth } from "./outbox";

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

/**
 * Change a saved entry's time, note or details. Built inside the write from the newest local copy, queued changes
 * included, so changes made seconds apart all land rather than each undoing the one before.
 */
export async function amendCare(b: Account, id: string, change: (record: BabyRecord) => Partial<Pick<BabyRecord, "body" | "occurred_at" | "data">>) {
  const mutation = Crypto.randomUUID(), generation = b.state.bootstrap!.generation;
  await b.commit((state) => {
    const record = pendingRecords(state).find((row) => row.id === id);
    return record ? addMutation(state, { id: mutation, generation, type: "save", record: { ...record, ...change(record) }, files: [] }) : state;
  });
  void b.sync();
}

/**
 * "Baby's here?": today becomes the birth date, which is what turns care logs on. It's kept on this phone first, since
 * there may be no signal in a delivery room, and care turns on straight away. Only the date changes, so everything
 * logged during the pregnancy stays where it was. Returns the undo for a tap made by mistake.
 */
export async function babyArrived(b: Account, child: Child, today: string) {
  const id = Crypto.randomUUID(), back = Crypto.randomUUID(), generation = b.state.bootstrap!.generation, previous = child.birth_date ?? null;
  await b.queue({ id, generation, type: "child_birth", child_id: child.id, birth_date: today, previous });
  return async () => {
    await b.commit((state) => {
      const queued = state.outbox.find((m) => m.id === id);
      // Still on this phone, so it can simply not happen. Once its request has begun the API may have it, so it goes back the same way.
      if (queued?.type === "child_birth" && !queued.sent) return withoutBirth({ ...state, outbox: state.outbox.filter((m) => m.id !== id) }, queued);
      return addMutation(state, { id: back, generation, type: "child_birth", child_id: child.id, birth_date: previous, previous: today });
    });
    void b.sync();
  };
}

/** A "What shows" switch. It moves at once and waits on this phone if it must; quick taps travel as one change. */
export async function setTracking(b: Account, child: Child, id: string, on: boolean) {
  const previous = child.details?.tracking?.[id] ?? null;
  await b.commit((state) => {
    // One already on its way can't take more: it leaves the queue when it lands.
    const waiting = state.outbox.find((m) => m.type === "child_tracking" && m.child_id === child.id && !m.sent && !m.error);
    if (waiting?.type === "child_tracking") return { ...state, outbox: state.outbox.map((m) => (m.id !== waiting.id ? m
      : { ...waiting, tracking: { ...waiting.tracking, [id]: on }, previous: { [id]: previous, ...waiting.previous } })) };
    return addMutation(state, { id: Crypto.randomUUID(), generation: state.bootstrap!.generation, type: "child_tracking", child_id: child.id, tracking: { [id]: on }, previous: { [id]: previous } });
  });
  void b.sync();
}

/** One tap, take-back or stop, kept on this phone and replayed by its own id until the API has it. Returns its id. */
export function queueSessionAction(b: Pick<Account, "queue" | "state">, recordId: string, action: Omit<SessionAction, "id">) {
  const id = Crypto.randomUUID();
  return b.queue({ id, generation: b.state.bootstrap!.generation, type: "session_action", record_id: recordId, action: { ...action, id } }).then(() => id);
}

const ozToMl = 30;
const bottleStep = { oz: 0.5, ml: 10 } as const;
/** Where a first bottle starts, before there is a last time to copy. */
const firstAmount = { oz: 3, ml: 90 } as const;

export interface BottleChoice { amount: number; unit: "oz" | "ml"; contents?: NonNullable<RecordData["contents"]>; fromLast: boolean }

/** A bottle starts from the last one: same amount, same unit, same milk. Ounces until she uses something else. */
export function bottleStart(rows: BabyRecord[], childId: string | null): BottleChoice {
  const last = rows.filter((row) => row.kind === "feeding" && row.child_id === childId && row.data.method === "bottle").sort(newestFirst)[0];
  const unit = last?.data.unit ?? "oz", amount = last?.data.amount;
  return typeof amount === "number" && amount > 0
    ? { amount, unit, contents: last!.data.contents ?? undefined, fromLast: true }
    : { amount: firstAmount[unit], unit, contents: last?.data.contents ?? undefined, fromLast: false };
}

/** The same for pumping: what came out last time, in the same unit. */
export function pumpStart(rows: BabyRecord[], childId: string | null): BottleChoice {
  const last = rows.filter((row) => row.kind === "pumping" && row.child_id === childId).sort(newestFirst)[0],
    unit = last?.data.unit ?? "oz", amount = last?.data.amount;
  return typeof amount === "number" && amount > 0 ? { amount, unit, fromLast: true } : { amount: firstAmount[unit], unit, fromLast: false };
}

/** Pumping can be a small amount, especially early on. */
export const pumpStep = { oz: 0.25, ml: 5 } as const;

export function stepAmount(choice: Pick<BottleChoice, "amount" | "unit">, direction: 1 | -1, steps: Record<"oz" | "ml", number> = bottleStep) {
  const step = steps[choice.unit];
  return Math.max(step, Math.round((choice.amount + direction * step) / step) * step);
}

/** The same bottle in the other unit, on the nearest step. */
export function changeUnit(choice: Pick<BottleChoice, "amount" | "unit">, steps: Record<"oz" | "ml", number> = bottleStep): Pick<BottleChoice, "amount" | "unit"> {
  const unit = choice.unit === "oz" ? "ml" : "oz", step = steps[unit],
    converted = choice.unit === "oz" ? choice.amount * ozToMl : choice.amount / ozToMl;
  return { unit, amount: Math.max(step, Math.round(converted / step) * step) };
}
