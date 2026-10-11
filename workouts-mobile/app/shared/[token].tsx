import { useRef, useState } from "react";
import { useAuth } from "@clerk/expo";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { Button, Choice, Field, Notice, Screen } from "@/components/ui";
import { SharedSnapshot } from "@/components/shared-snapshot";
import { QueryState } from "@/components/query-state";
import { configuration } from "@/lib/config";
import { useTraining } from "@/lib/context";
import { publicShareReader, rememberShare, clearPendingShare, isISODate, type PublicShare } from "@/lib/sharing";
import { dateInTimezone } from "@/lib/training";
const read = publicShareReader(configuration.apiBase);
export default function SharedPrescription() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { isSignedIn } = useAuth();
  const q = useQuery({ queryKey: ["public-share", token], queryFn: () => read(token), retry: 1 });
  return (
    <Screen title="A workout worth keeping." subtitle="An intentional snapshot, shared with you.">
      <QueryState
        loading={q.isPending}
        error={q.error}
        retry={() => {
          void q.refetch();
        }}
      >
        {q.data && (
          <>
            <SharedSnapshot snapshot={q.data} />
            {isSignedIn ? (
              <CopyControls token={token} share={q.data} />
            ) : (
              <Button
                title="Sign in to save a private copy"
                onPress={() => {
                  rememberShare(token);
                  router.push("/sign-in");
                }}
              />
            )}
          </>
        )}
      </QueryState>
    </Screen>
  );
}
function CopyControls({ token, share }: { token: string; share: PublicShare }) {
  const { api, owner, enrollment } = useTraining();
  const cache = useQueryClient();
  const [date, setDate] = useState(dateInTimezone(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(Crypto.randomUUID());
  async function copy() {
    if (!enrollment?.enrolled || !enrollment.generation || !confirmed) return;
    if (share.kind === "program" && !isISODate(date)) {
      setError("Choose a valid start date in YYYY-MM-DD format.");
      return;
    }
    setBusy(true);
    try {
      const result = await api.copyShare(
        token,
        share.snapshot_digest,
        key.current,
        enrollment.generation,
        share.kind === "program" ? date : undefined
      );
      clearPendingShare();
      await cache.invalidateQueries({ queryKey: [owner, result.kind === "workout" ? "library" : "programs"] });
      router.replace(
        result.kind === "workout" ? { pathname: "/workout/[id]", params: { id: result.record.id } } : "/(tabs)/plan"
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!enrollment?.enrolled)
    return (
      <>
        <Notice>
          Join Workouts to save your own private copy. Joining does not connect your Recipes or health data.
        </Notice>
        <Button
          title="Set up my training"
          onPress={() => {
            rememberShare(token);
            router.push("/onboarding");
          }}
        />
      </>
    );
  return (
    <>
      <Notice>
        This prescription was not personalized for you. Review equipment, missing details and your own limitations. Your
        copy stays independent if the sender later revokes the link.
      </Notice>
      {share.kind === "program" && (
        <>
          <Field label="Your start date · YYYY-MM-DD" value={date} onChange={setDate} />
          <Notice>A copied program starts in review status. It will not activate or progress automatically.</Notice>
        </>
      )}
      <Choice
        label="I understand this is a shared template, not my personal training advice"
        selected={confirmed}
        onPress={() => setConfirmed(!confirmed)}
      />
      <Button
        title="Save my private copy"
        busy={busy}
        disabled={!confirmed}
        onPress={() => {
          void copy();
        }}
      />
      {!!error && <Notice error>{error}</Notice>}
    </>
  );
}
