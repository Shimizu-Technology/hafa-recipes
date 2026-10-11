import type { Enrollment } from "./models";
import type { drafts } from "./drafts";
import type { UnitSystem } from "./training";

type Drafts = ReturnType<typeof drafts>;
export interface BootstrapState {
  status: "pending" | "ready" | "setup" | "blocked";
  enrollment: Enrollment | null;
  units: UnitSystem;
  error: string;
}
export interface SetupDeviceScope {
  drafts: Drafts;
  guard(): void;
}
export interface EnrollmentSetupLease {
  guard(): void;
  acknowledge(member: Enrollment): Promise<SetupDeviceScope>;
  complete(member: Enrollment, units: UnitSystem): void;
  fail(): Promise<void>;
  scope(): SetupDeviceScope;
}

/** One owner/binding bootstrap; private consumers wait for both initial inputs. */
export function createEnrollmentBootstrap(deps: {
  isCurrent(): boolean;
  load(): Promise<{ enrollment: Enrollment | null; units: UnitSystem }>;
  retire(): Promise<void>;
  clearQueries(): void;
  fresh(): { drafts: Drafts; isCurrent(): boolean };
  owner: string;
  publish(state: BootstrapState): void;
  publishEnrollment(member: Enrollment): void;
  rememberIdentity?(): Promise<void>;
}) {
  let disposed = false;
  let lifetime = 0;
  let disk: { enrollment: Enrollment | null; units: UnitSystem } | undefined;
  let server: Enrollment | null | undefined;
  let serverSettled = false;
  let denied = false;
  let revision = 0;
  let chain = Promise.resolve();
  let state: BootstrapState = { status: "pending", enrollment: null, units: "imperial", error: "" };
  let lease: { expected: number | null; acknowledged: Enrollment | null; error: boolean; scope: SetupDeviceScope | null } | null = null;
  const current = () => !disposed && deps.isCurrent();
  const emit = (value: BootstrapState) => { if (current()) { state = value; deps.publish(value); } };
  const guard = (capturedLifetime = lifetime) => { if (!current() || capturedLifetime !== lifetime) throw Error("The Håfa account changed. Refresh before continuing."); };
  const generation = (value: Enrollment | null) => value?.generation ?? null;
  function selected() { return server ?? disk?.enrollment ?? null; }
  async function remember(member: Enrollment | null, units: UnitSystem) {
    const capturedLifetime = lifetime;
    guard(capturedLifetime);
    const fresh = deps.fresh();
    if (!fresh.isCurrent()) throw Error("Private device state was retired. Refresh enrollment.");
    await fresh.drafts.save(deps.owner, "enrollment", member);
    guard(capturedLifetime);
    if (!fresh.isCurrent()) throw Error("Private device state was retired. Refresh enrollment.");
    await fresh.drafts.save(deps.owner, "units", units);
    guard(capturedLifetime);
    await deps.rememberIdentity?.();
    guard(capturedLifetime);
    if (!fresh.isCurrent()) throw Error("Private device state was retired. Refresh enrollment.");
  }
  function queue() {
    const captured = ++revision;
    emit({ ...state, status: "pending", error: "" });
    chain = chain.catch(() => undefined).then(async () => {
      if (!current() || captured !== revision || !disk || !serverSettled) return;
      if (denied) { emit({ ...state, status: "blocked", error: "Verify your account before opening private training." }); return; }
      if (lease && !lease.error) return; // Keep the original generation until an acknowledged setup completes.
      const member = selected();
      try {
        let units = disk.units;
        if (generation(disk.enrollment) != null && (generation(disk.enrollment) !== generation(member)
            || (!!disk.enrollment?.enrolled && !member?.enrolled))) {
          guard();
          deps.clearQueries();
          await deps.retire();
          guard();
          units = "imperial";
        }
        if (captured !== revision) return;
        await remember(member, units);
        if (captured !== revision) return;
        disk = { enrollment: member, units };
        emit({ status: "ready", enrollment: member, units, error: "" });
      } catch {
        if (current() && captured === revision) emit({ ...state, status: "blocked",
          error: "Private device state needs another cleanup attempt before training can open." });
      }
    });
    return chain;
  }
  return {
    snapshot: () => state,
    activate() { disposed = false; lifetime++; revision++; },
    async hydrate() {
      const capturedLifetime = lifetime;
      const captured = revision;
      try {
        const value = await deps.load();
        if (!current() || capturedLifetime !== lifetime || captured !== revision && disk) return;
        // A completed/acknowledged setup supersedes any delayed disk read.
        if (lease?.acknowledged) return;
        const member = value.enrollment;
        if (member && (typeof member.enrolled !== "boolean" || (member.generation != null && (!Number.isSafeInteger(member.generation) || member.generation < 1)) || (member.enrolled && member.generation == null)))
          throw Error("Invalid saved enrollment");
        disk = value;
        return queue();
      } catch {
        if (current() && capturedLifetime === lifetime && !disk) emit({ ...state, status: "blocked",
          error: "Could not verify this device's enrollment. Retry before opening private training." });
      }
    },
    server(member: Enrollment | null, errorStatus?: number) {
      if (!current()) return Promise.resolve();
      serverSettled = true;
      denied = errorStatus === 401 || errorStatus === 403;
      if (!denied && member && disk && (generation(member)! < (generation(disk.enrollment) ?? 0)
          || (member.generation === disk.enrollment?.generation && disk.enrollment?.enrolled && !member.enrolled))) return Promise.resolve();
      server = member;
      if (denied && lease) lease.error = true;
      if (lease && !lease.error && member) {
        const target = lease.acknowledged?.generation;
        const conflict = denied || (!member.enrolled && member.generation !== lease.expected)
          || (target != null && member.generation !== lease.expected && member.generation !== target)
          || (target == null && member.generation !== lease.expected && member.generation !== (lease.expected ?? 1));
        if (conflict) lease.error = true;
        else { emit({ ...state, status: "setup", error: "" }); return Promise.resolve(); }
      }
      if (!denied && !lease && disk && state.status === "ready" && member
          && member.generation === disk.enrollment?.generation && member.enrolled === disk.enrollment?.enrolled) {
        disk.enrollment = member;
        emit({ ...state, enrollment: member });
        return remember(member, disk.units).catch(() => {
          if (current()) emit({ ...state, status: "blocked", error: "Could not keep verified enrollment on this device. Retry the device check." });
        });
      }
      return queue();
    },
    async retry() { return disk ? queue() : this.hydrate(); },
    dispose() { disposed = true; lifetime++; revision++; if (lease) lease.error = true; },
    units(value: UnitSystem) {
      if (!current()) return;
      if (disk) disk.units = value;
      state = { ...state, units: value };
    },
    beginSetup(expected: number | null): EnrollmentSetupLease {
      guard();
      if (state.status !== "ready" || generation(state.enrollment) !== expected || lease)
        throw Error("Refresh your enrollment before starting setup.");
      const active = { expected, acknowledged: null as Enrollment | null, error: false, scope: null as SetupDeviceScope | null };
      lease = active;
      const check = () => {
        guard();
        if (lease !== active || active.error) throw Error("Your enrollment changed during setup. Reload before continuing.");
      };
      return {
        guard: check,
        async acknowledge(member) {
          check();
          const target = member.generation;
          const wanted = expected ?? 1; // Deletion advances the epoch; explicit re-enrollment reactivates it.
          if (!member.enrolled || target == null || target !== wanted
              || (server?.generation != null && server.generation !== expected && server.generation !== target)) {
            active.error = true;
            throw Error("Your enrollment changed during setup. Reload before continuing.");
          }
          active.acknowledged = member;
          ++revision;
          emit({ ...state, status: "setup", error: "" });
          if (generation(disk!.enrollment) !== target) {
            deps.clearQueries();
            await deps.retire();
            check();
          }
          const fresh = deps.fresh();
          const scopeGuard = () => { check(); if (!fresh.isCurrent()) throw Error("Private setup state was retired. Reload enrollment."); };
          active.scope = { drafts: fresh.drafts, guard: scopeGuard };
          disk = { enrollment: member, units: disk!.units };
          server = member;
          await remember(member, disk.units);
          scopeGuard();
          deps.publishEnrollment(member);
          return active.scope;
        },
        scope() { check(); if (!active.scope) throw Error("Setup enrollment has not been acknowledged."); return active.scope; },
        complete(member, units) {
          check();
          if (member.generation !== active.acknowledged?.generation || !member.enrolled) throw Error("Enrollment changed before setup completed.");
          ++revision;
          disk = { enrollment: member, units }; server = member; serverSettled = true;
          lease = null;
          emit({ status: "ready", enrollment: member, units, error: "" });
        },
        async fail() {
          if (lease !== active || !current()) return;
          lease = null;
          return queue();
        },
      };
    },
  };
}

/** Serialized binding metadata writes are fenced before and after native I/O. */
export function createVerifiedIdentityCache(storage: import("./drafts").Storage) {
  const pending = new Map<string, Promise<unknown>>();
  const key = (binding: string) => `hafa-workouts:v1:${encodeURIComponent(binding)}:verified-identity`;
  return {
    async load(binding: string) {
      await pending.get(binding)?.catch(() => undefined);
      const raw = await storage.getItem(key(binding));
      if (!raw) return null;
      try {
        const value = JSON.parse(raw) as { id: string; binding: string };
        return typeof value.id === "string" && !!value.id && value.binding === binding ? value : null;
      } catch { return null; }
    },
    save(binding: string, owner: string, isCurrent: () => boolean) {
      const value = JSON.stringify({ id: owner, binding });
      const work = (pending.get(binding) ?? Promise.resolve()).catch(() => undefined).then(async () => {
        if (!isCurrent()) throw Error("Account identity changed before device mapping was saved.");
        await storage.setItem(key(binding), value);
        if (!isCurrent()) {
          if (await storage.getItem(key(binding)) === value) await storage.removeItem(key(binding));
          throw Error("Account identity changed while device mapping was saved.");
        }
      });
      pending.set(binding, work);
      return work;
    },
  };
}
