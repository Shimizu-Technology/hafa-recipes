import { useEffect, useState } from "react";
import { Alert, Share } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Copy, Empty, Notice, Row, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import type { OwnerShare } from "@/lib/sharing";
import { sharingURL, shareAvailable } from "@/lib/sharing";
export default function SharingLinks() {
  const { api, owner, enrollment } = useTraining();
  const q = useQuery({
    queryKey: [owner, "sharing", enrollment?.generation],
    queryFn: api.shares,
    enabled: !!enrollment?.enrolled,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const future = (q.data ?? []).filter(share => shareAvailable(share)).map(share => Date.parse(share.expires_at));
    if (!future.length) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.min(2147483647, Math.max(1, Math.min(...future) - Date.now() + 1)));
    return () => clearTimeout(timer);
  }, [q.data, clock]);
  async function revoke(share: OwnerShare) {
    setBusy(true);
    try {
      await api.revokeShare(share);
      await q.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function url(share: OwnerShare) {
    const website = process.env.EXPO_PUBLIC_WORKOUTS_WEBSITE_URL;
    return sharingURL(share, website);
  }
  return (
    <Screen back title="Sharing links" subtitle="Turn off a link to stop new visits.">
      <QueryState hasData={q.data !== undefined}
        loading={q.isPending && !!enrollment?.enrolled}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {!q.data?.length ? (
          <Empty
            icon="link-outline"
            title="No sharing links yet"
            description="Open a workout or plan and tap Share to create one."
          />
        ) : (
          q.data.map((share) => (
            <Card key={share.id}>
              <Copy kind="heading">{share.content.title}</Copy>
              <Copy tone="muted">
                {share.kind === "program" ? "Plan" : "Workout"} ·{" "}
                {share.revoked_at
                  ? "Turned off"
                  : !shareAvailable(share, Math.max(clock, Date.now()))
                    ? "Expired"
                    : `Works until ${new Date(share.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
              </Copy>
              {shareAvailable(share, Math.max(clock, Date.now())) && (
                <Row wrap>
                  <Button
                    title="Share"
                    accessibilityHint={`Shares the link to ${share.content.title}`}
                    icon="share-outline"
                    size="sm"
                    inline
                    secondary
                    onPress={() => {
                      if (!shareAvailable(share)) { setClock(Date.now()); setError("This link expired. Open the workout or plan to create a new sharing link."); return; }
                      void Share.share({ message: url(share) }).catch(() => setError("Could not open sharing."));
                    }}
                  />
                  <Button
                    title="Turn off"
                    accessibilityHint={`Turns off the link to ${share.content.title}`}
                    variant="ghost"
                    size="sm"
                    inline
                    busy={busy}
                    onPress={() =>
                      Alert.alert(
                        "Turn off this link?",
                        "New visits stop. Copies people already saved stay with them.",
                        [
                          { text: "Keep link", style: "cancel" },
                          {
                            text: "Turn off",
                            style: "destructive",
                            onPress: () => {
                              void revoke(share);
                            },
                          },
                        ]
                      )
                    }
                  />
                </Row>
              )}
            </Card>
          ))
        )}
      </QueryState>
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}
