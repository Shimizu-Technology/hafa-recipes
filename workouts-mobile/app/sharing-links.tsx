import { useState } from "react";
import { Alert, Share } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Copy, Empty, Notice, Screen } from "@/components/ui";
import { QueryState } from "@/components/query-state";
import { useTraining } from "@/lib/context";
import type { OwnerShare } from "@/lib/sharing";
import { sharingURL } from "@/lib/sharing";
export default function SharingLinks() {
  const { api, owner, enrollment } = useTraining();
  const q = useQuery({
    queryKey: [owner, "sharing", enrollment?.generation],
    queryFn: api.shares,
    enabled: !!enrollment?.enrolled,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    <Screen back title="Your sharing links." subtitle="Control future access to the snapshots you chose to share.">
      <QueryState
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
            description="Open a selected workout or program to preview its public snapshot before creating a link."
          />
        ) : (
          q.data.map((share) => (
            <Card key={share.id}>
              <Copy kind="heading">{share.content.title}</Copy>
              <Copy>
                {share.kind} ·{" "}
                {share.revoked_at
                  ? "Revoked"
                  : new Date(share.expires_at).getTime() < Date.now()
                    ? "Expired"
                    : `Expires ${new Date(share.expires_at).toLocaleDateString()}`}
              </Copy>
              {!share.revoked_at && (
                <>
                  <Button
                    title="Share this link"
                    secondary
                    onPress={() => {
                      void Share.share({ message: url(share) }).catch(() => setError("Could not open sharing."));
                    }}
                  />
                  <Button
                    title="Revoke this link"
                    secondary
                    busy={busy}
                    onPress={() =>
                      Alert.alert(
                        "Revoke this sharing link?",
                        "Future views and copies will stop. Independent copies already saved cannot be recalled.",
                        [
                          { text: "Keep link", style: "cancel" },
                          {
                            text: "Revoke",
                            style: "destructive",
                            onPress: () => {
                              void revoke(share);
                            },
                          },
                        ]
                      )
                    }
                  />
                </>
              )}
            </Card>
          ))
        )}
      </QueryState>
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}
