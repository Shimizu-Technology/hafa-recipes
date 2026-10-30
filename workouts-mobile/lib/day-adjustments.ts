import { draftKey, type Storage } from "./drafts";
import type { Program, ScheduledSession } from "./models";
import type { DayProposal } from "../components/adjust-training";
export interface DayReceipt {
  owner: string; generation: number; program: Program; session?: ScheduledSession;
  proposal: DayProposal; state: string; pending: "accept" | "undo" | null; invalid?: string;
}
const queues = new Map<string, Promise<unknown>>();
/** One receipt per logical session (or missed-session shift), fenced by private account storage. */
export function dayAdjustments(storage: Storage & { isCurrent(): boolean }, owner: string, generation: number) {
  const key = draftKey(owner, `day-adjustments:${generation}`);
  const scope = (r: Pick<DayReceipt, "program" | "session">) => JSON.stringify([r.program.id, r.session?.id ?? null]);
  function guard() { if (!storage.isCurrent()) throw Error("Your account or training enrollment changed. Return to its original account to review this adjustment."); }
  async function read(): Promise<DayReceipt[]> {
    guard(); const raw = await storage.getItem(key); guard();
    return (raw ? JSON.parse(raw) as DayReceipt[] : []).filter(r => r.owner === owner && r.generation === generation);
  }
  function ordered<T>(work: () => Promise<T>) {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(key, next);
    void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
    return next;
  }
  return {
    list: () => ordered(read),
    save: (receipt: DayReceipt) => ordered(async () => {
      const current = await read();
      if (receipt.owner !== owner || receipt.generation !== generation) throw Error("Adjustment ownership changed.");
      const existing = current.find(r => scope(r) === scope(receipt));
      if (existing && existing.proposal.id !== receipt.proposal.id) throw Error("Resolve the saved adjustment before replacing it.");
      guard(); await storage.setItem(key, JSON.stringify([...current.filter(r => scope(r) !== scope(receipt)), receipt])); guard();
    }),
    remove: (receipt: DayReceipt) => ordered(async () => {
      const current = await read(); guard();
      await storage.setItem(key, JSON.stringify(current.filter(r => r.proposal.id !== receipt.proposal.id))); guard();
    }),
  };
}
