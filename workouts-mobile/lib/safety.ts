export interface BlockedContributor {
  contributor_id: string;
  display_name: string;
  created_at: string;
}

export function contributorName(name: string | null | undefined) {
  const value = name?.trim();
  return !value || value === "Anonymous Chef" ? "Håfa member" : value;
}

export const blockedContributorsKey = (owner: string, generation: number | null | undefined) =>
  [owner, "blocked-contributors", generation ?? null] as const;
