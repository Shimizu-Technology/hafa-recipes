import type { QueryClient } from "@tanstack/react-query";
import type { Enrollment, TrainingProfile } from "./models";
import type { UnitSystem } from "./training";
import type { drafts } from "./drafts";
import type { EnrollmentSetupLease } from "./enrollment-bootstrap";
export const profileKey = (owner: string, generation: number) => [owner, "profile", generation] as const;
export function activeTrainingGeneration(member: Enrollment | null) {
  return member?.enrolled ? member.generation : null;
}
type Drafts = ReturnType<typeof drafts>;
export async function commitTrainingSetup(deps: {
  owner: string;
  expected_generation: number | null;
  member: Enrollment;
  profile: TrainingProfile;
  units: UnitSystem;
  draft_scope: string;
  cache: QueryClient;
  drafts: Drafts;
  guardOriginal(): void;
  guardOwner(): void;
  cleanPrevious(): Promise<void>;
  freshDrafts(): { drafts: Drafts; isCurrent(): boolean };
  rememberGeneration(generation: number): void;
  sealEnrollment?(member: Enrollment): void;
  ready(units: UnitSystem, member: Enrollment, replaced: boolean): void;
  rememberUnits?(units: UnitSystem): void;
}) {
  const { owner, member, cache } = deps;
  deps.guardOriginal();
  if (!member.enrolled || member.generation == null || member.generation < 1)
    throw Error("The service did not acknowledge an active training enrollment.");
  const generation = member.generation;
  function guardCache() {
    deps.guardOwner();
    const current = cache.getQueryData<Enrollment>([owner, "enrollment"]);
    if (current && current.generation !== deps.expected_generation && current.generation !== generation)
      throw Error("Your enrollment changed before setup finished. Refresh it before starting again.");
  }
  guardCache();
  const preferred = await deps.drafts.load<UnitSystem>(owner, "units");
  deps.guardOriginal();
  const units = preferred === "metric" || preferred === "imperial" ? preferred : deps.units;
  deps.rememberUnits?.(units);
  const previous = cache.getQueryData<Enrollment>([owner, "enrollment"]);
  const replaced = (previous?.generation ?? deps.expected_generation) !== generation;
  if (replaced) await deps.cleanPrevious();
  else {
    await deps.drafts.remove(owner, deps.draft_scope);
    if (deps.draft_scope !== `profile:${generation}`) await deps.drafts.remove(owner, `profile:${generation}`);
  }
  guardCache();
  const fresh = deps.freshDrafts();
  if (!fresh.isCurrent()) throw Error("Private training state was retired while setup finished.");
  await fresh.drafts.save(owner, "units", units);
  guardCache();
  if (!fresh.isCurrent()) throw Error("Private training state was retired while setup finished.");
  await fresh.drafts.save(owner, "enrollment", member);
  guardCache();
  if (!fresh.isCurrent()) throw Error("Private training state was retired while setup finished.");
  deps.sealEnrollment?.(member);
  await cache.cancelQueries({ queryKey: [owner, "enrollment"], exact: true });
  guardCache();
  if (!fresh.isCurrent()) throw Error("Private training state was retired while setup finished.");
  // Profile must exist under the actual query key before enrollment enables Today.
  // Mark the handled generation before observers publish to prevent a second erasure.
  deps.rememberGeneration(generation);
  cache.removeQueries({
    predicate: (q) =>
      q.queryKey[0] === owner &&
      q.queryKey[1] !== "enrollment" &&
      !(q.queryKey[1] === "profile" && q.queryKey[2] === generation),
  });
  cache.setQueryData(profileKey(owner, generation), deps.profile);
  cache.setQueryData([owner, "enrollment"], member);
  deps.ready(units, member, replaced);
}
export async function saveTrainingSetup(deps: {
  profile: TrainingProfile;
  expected_generation: number | null;
  owner: string;
  drafts: Drafts;
  guard(): void;
  setup?: EnrollmentSetupLease;
  api: {
    enroll(adult: boolean, generation?: number | null): Promise<Enrollment>;
    profile(): Promise<TrainingProfile | null>;
    profileRevision(): number | null;
    saveProfile(profile: TrainingProfile, revision: number | null, generation: number): Promise<TrainingProfile>;
    enrollment(): Promise<Enrollment>;
  };
  complete(member: Enrollment, profile: TrainingProfile): Promise<void>;
}) {
  deps.guard();
  const setup = deps.setup;
  let sourceDrafts = deps.drafts;
  let guard = deps.guard;
  try {
    setup?.guard();
    const member = await deps.api.enroll(deps.profile.adult_confirmed, deps.expected_generation);
    if (setup) {
      const fresh = await setup.acknowledge(member);
      sourceDrafts = fresh.drafts;
      guard = fresh.guard;
    } else deps.guard();
    if (!member.enrolled || member.generation == null)
      throw Error("Enrollment was not completed. Your profile draft remains on this device.");
    guard();
    await sourceDrafts.save(deps.owner, `profile:${member.generation}`, deps.profile);
    guard();
    await deps.api.profile();
    guard();
    const saved = await deps.api.saveProfile(
      { ...deps.profile,
        limitations: deps.profile.limitations.map((x) => x.trim()).filter(Boolean),
        movement_exclusions: deps.profile.movement_exclusions.map((x) => x.trim()).filter(Boolean),
      }, deps.api.profileRevision(), member.generation);
    guard();
    const current = await deps.api.enrollment();
    guard();
    if (!current.enrolled || current.generation !== member.generation)
      throw Error("Your training enrollment changed after saving. Refresh before starting again.");
    await deps.complete(current, saved);
  } catch (error) {
    await setup?.fail();
    throw error;
  }
}
