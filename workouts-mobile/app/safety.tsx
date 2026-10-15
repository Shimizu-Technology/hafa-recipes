import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Copy, Empty, Notice, Screen, SectionHeader, Sheet } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { ApiError } from "@/lib/api";
import { useTraining } from "@/lib/context";
import { discoverKeys } from "@/lib/discover";
import { blockedContributorsKey, contributorName, type BlockedContributor } from "@/lib/safety";

export default function SafetyCenter() {
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const cache = useQueryClient();
  const generation = enrollment?.enrolled ? enrollment.generation : null;
  const scope = useMemo(() => ({}), [owner, generation, storage]);
  const live = useRef<object | null>(null);
  // Keep the last committed identity for same-account cache reconciliation after
  // leaving this screen. Speculative renders cannot retire its acknowledgement.
  useLayoutEffect(() => { live.current = scope; }, [scope]);
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const currentScope = () => live.current === scope && storage.isCurrent() && isCurrentAccount();
  const current = () => mounted.current && currentScope();
  const q = useQuery({
    queryKey: blockedContributorsKey(owner, generation),
    queryFn: async ({ signal }) => {
      const rows = await api.blockedContributors(signal);
      if (!current()) throw new ApiError("The account changed. Reload your safety controls.", 409, true);
      return rows;
    },
    enabled: !!owner && generation != null,
  });
  const [selected, setSelected] = useState<BlockedContributor | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef<object | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useLayoutEffect(() => { working.current = null; setBusy(false); setSelected(null); setError(""); setMessage(""); }, [scope]);

  async function unblock() {
    if (!selected || working.current || generation == null || !current()) return;
    const operation = {};
    working.current = operation;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.unblockContributor(selected.contributor_id);
      if (!currentScope()) return;
      cache.setQueryData<BlockedContributor[]>(blockedContributorsKey(owner, generation), (rows) =>
        rows?.filter((row) => row.contributor_id !== selected.contributor_id));
      if (current()) {
        setSelected(null);
        setMessage(`Unblocked ${contributorName(selected.display_name)}. Their public content can appear again.`);
      }
      void cache.invalidateQueries({ queryKey: blockedContributorsKey(owner, generation) });
      void cache.invalidateQueries({ queryKey: discoverKeys.all(owner) });
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Couldn’t unblock this contributor. Try again.");
    } finally {
      if (working.current === operation) working.current = null;
      if (current()) setBusy(false);
    }
  }

  return (
    <Screen back title="Safety Center." subtitle="Control whose public content you see.">
      <Copy tone="muted">Blocking applies across Håfa Workouts and Håfa Recipes. People aren’t told when you block or unblock them. Your saved copies stay in your library.</Copy>
      <SectionHeader title="Blocked contributors" />
      <QueryState loading={q.isPending && generation != null} error={q.error} retry={() => { void q.refetch(); }}>
        {!q.data?.length ? (
          <Empty icon="people-outline" title="No blocked contributors" description="You can block a contributor from a workout’s options in Discover." />
        ) : q.data.map((contributor) => (
          <Card key={contributor.contributor_id}>
            <Copy kind="heading">{contributorName(contributor.display_name)}</Copy>
            <Copy kind="small" tone="muted">Public workouts and recipes hidden</Copy>
            <Button title={`Unblock ${contributorName(contributor.display_name)}`} secondary disabled={busy} onPress={() => {
              if (!current()) return;
              setError(""); setMessage(""); setSelected(contributor);
            }} />
          </Card>
        ))}
      </QueryState>
      {!!message && <Notice>{message}</Notice>}
      <Sheet visible={!!selected} title={`Unblock ${contributorName(selected?.display_name)}?`} onClose={() => { if (!busy) setSelected(null); }}>
        <Copy>Their public workouts and recipes can appear in Discover and search again in both Håfa apps.</Copy>
        {!!error && <Notice error>{error}</Notice>}
        <Button title="Unblock" busy={busy} onPress={() => { void unblock(); }} />
        <Button title="Keep blocked" variant="ghost" disabled={busy} onPress={() => setSelected(null)} />
      </Sheet>
    </Screen>
  );
}
