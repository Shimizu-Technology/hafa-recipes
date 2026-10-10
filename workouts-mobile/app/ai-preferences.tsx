import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Copy, Notice, Screen } from "@/components/ui";
import { useTraining } from "@/lib/context";
export default function AiPreferences() {
  const { api, owner, enrollment } = useTraining();
  const cache = useQueryClient();
  const q = useQuery({
    queryKey: [owner, "ai-consent", enrollment?.generation],
    queryFn: api.aiConsent,
    enabled: !!enrollment?.enrolled,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(accepted: boolean) {
    setBusy(true);
    try {
      await api.setAiConsent(accepted, enrollment?.generation ?? undefined);
      await cache.invalidateQueries({ queryKey: [owner, "ai-consent"] });
      await cache.invalidateQueries({ queryKey: [owner, "health-connection"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen back title="AI sharing preferences." subtitle="Useful assistance, with an explicit choice.">
      <Copy>
        AI extraction and coaching use OpenAI. Extraction sends the source you choose. Coaching can send the relevant
        profile, workout, plan and recorded training context you permit. Imported health activity additionally requires
        its own health connection permission and reviewed source eligibility.
      </Copy>
      <Notice>
        Declining keeps manual entry, saved training and planning controls available. Revoking stops future AI use; it
        does not recall information already processed by a provider.
      </Notice>
      {q.error && <Notice error>{q.error.message}</Notice>}
      <Copy>AI sharing is currently {q.data?.accepted ? "enabled" : "not enabled"}.</Copy>
      <Button
        title={q.data?.accepted ? "Turn off AI sharing" : "Accept AI sharing disclosure"}
        busy={busy}
        disabled={!q.data || !enrollment?.enrolled}
        onPress={() => {
          void save(!q.data?.accepted);
        }}
      />
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}
