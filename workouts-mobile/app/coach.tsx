import { createCoachDraftStore } from "@/lib/coach-drafts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, View } from "react-native";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bubble, Button, Card, Chip, ChipRow, Copy, Field, ListGroup, ListRow, Notice, Screen, SectionHeader } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { coachFocusErrors, type CoachFocus, type PendingCoachMessage } from "@/lib/coach";
export default function Coach() {
  const params = useLocalSearchParams<{
    workout_id?: string;
    program_id?: string;
    session_id?: string;
    revision?: string;
  }>();
  const { api, owner, enrollment, storage } = useTraining();
  const drafts = useMemo(() => createCoachDraftStore(storage), [storage]);
  const generation = enrollment?.generation ?? 0;
  const cache = useQueryClient();
  const profile = useQuery({ queryKey: [owner, "profile", generation], queryFn: api.profile, enabled: !!enrollment?.enrolled });
  const focus: CoachFocus = {
    ...(params.workout_id ? { context_workout_id: params.workout_id } : {}),
    ...(params.program_id ? { context_program_id: params.program_id } : {}),
    ...(params.session_id ? { context_session_id: params.session_id } : {}),
    ...(params.revision ? { context_revision: Number(params.revision) } : {}),
  };
  const focusKey = params.workout_id ?? params.program_id ?? params.session_id ?? "general";
  const [epoch, setEpoch] = useState("initial");
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<PendingCoachMessage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [readiness, setReadiness] = useState<"ready" | "limited" | "unknown">("unknown");
  const checkIn = useQuery({
    queryKey: [owner, "readiness", generation],
    queryFn: api.readiness,
    enabled: !!enrollment?.enrolled,
  });
  async function saveCheckIn() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await api.setReadiness(readiness, generation);
      await checkIn.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const [clearedRequest, setClearedRequest] = useState(false);
  const guard = useRef(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void drafts
        .load(owner, generation, focusKey)
        .then((loaded) => {
          if (active && loaded.epoch !== epoch) {
            setEpoch(loaded.epoch);
            setPending(loaded.value?.pending ?? null);
            setMessage(loaded.value?.message ?? "");
          }
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [owner, generation, focusKey, epoch])
  );
  const capabilities = useQuery({
    queryKey: [owner, "capabilities", generation],
    queryFn: api.capabilities,
    enabled: !!enrollment?.enrolled,
  });
  const consent = useQuery({
    queryKey: [owner, "ai-consent", generation],
    queryFn: api.aiConsent,
    enabled: !!enrollment?.enrolled,
  });
  const q = useInfiniteQuery({
    queryKey: [owner, "coach-history", generation, epoch],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.coachHistory(pageParam),
    getNextPageParam: (page) => (page.messages.length === page.limit ? page.offset + page.limit : undefined),
    enabled: !!enrollment?.enrolled,
    refetchInterval: focused && foreground && pending ? 3000 : false,
  });
  const history = [
    ...new Map(q.data?.pages.flatMap((page) => page.messages).map((item) => [item.id, item]) ?? []).values(),
  ];
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setPending(null);
    setMessage("");
    void drafts
      .load(owner, generation, focusKey)
      .then((loaded) => {
        if (active) {
          setEpoch(loaded.epoch);
          const value = loaded.value;
          if (value?.pending?.generation === generation) setPending(value.pending);
          setMessage(value?.message ?? "");
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setLoaded(true);
          setError("Could not restore this conversation draft. Saved conversation remains on your account.");
        }
      });
    return () => {
      active = false;
    };
  }, [owner, focusKey, generation]);
  useEffect(() => {
    if (loaded)
      void drafts
        .save(owner, generation, focusKey, { message, pending }, epoch)
        .catch(() => setError("Could not keep the message draft locally. Stay here and retry."));
  }, [loaded, message, pending, owner, focusKey, generation, epoch]);
  useEffect(() => {
    if (!pending) return;
    const receipt = history.find((item) => item.request_id === pending.request_id);
    if (receipt && receipt.state !== "pending") {
      setPending(null);
      setMessage("");
      if (receipt.state === "failed")
        setError("The saved request failed. You can write a new message with a new request identity.");
    }
  }, [history, pending]);
  async function send() {
    if (guard.current) return;
    const problems = coachFocusErrors(focus);
    if (!pending && (!message.trim() || message.length > 4000)) problems.push("Write a message of 1–4000 characters.");
    if (!consent.data?.accepted) problems.push("Accept the separate AI sharing disclosure first.");
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    guard.current = true;
    setBusy(true);
    setError("");
    setClearedRequest(false);
    try {
      const request = pending ?? {
        request_id: Crypto.randomUUID(),
        message: message.trim(),
        generation,
        focus,
        created_at: new Date().toISOString(),
      };
      if (!(await drafts.save(owner, generation, focusKey, { message: request.message, pending: request }, epoch)))
        throw Error("This conversation was cleared while the draft was open. Reload before sending another message.");
      setPending(request);
      const receipt = await api.coachMessage(request.request_id, request.message, request.focus, request.generation);
      if ((await drafts.epoch(owner, generation)) !== epoch) return;
      await cache.invalidateQueries({ queryKey: [owner, "coach-history"] });
      if (receipt.state !== "pending") {
        setPending(null);
        setMessage("");
        if (receipt.state === "failed")
          setError("The request could not finish. Your saved history is unchanged; write a new message to try again.");
      }
    } catch (e) {
      setError((e as Error).message);
      setClearedRequest((e as { status?: number }).status === 410);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  async function clear() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await api.clearCoach(generation);
      setPending(null);
      setMessage("");
      const nextEpoch = Crypto.randomUUID();
      await drafts.clear(owner, generation, nextEpoch);
      setEpoch(nextEpoch);
      await cache.invalidateQueries({ queryKey: [owner, "coach-history"] });
      setClearConfirm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  if (enrollment?.enrolled && profile.isPending) return <Screen back title="Your coach starts with you."><Copy>Loading your training preferences…</Copy></Screen>;
  if (!enrollment?.enrolled || (profile.isSuccess && !profile.data)) return <Screen back title="Your coach starts with you." subtitle="Set up your training preferences when you’re ready.">
    <Copy>Choose a goal, your equipment and a realistic schedule so the coach can use your saved workouts. Personal measurements are optional.</Copy>
    <Button title={enrollment?.enrolled ? "Set up training" : "Join Workouts"} onPress={() => router.push({ pathname: enrollment?.enrolled ? "/profile" : "/onboarding", params: { return_to: "coach", ...params } })} />
  </Screen>;
  return (
    <Screen
      back
      title="Talk through your training."
      subtitle="Your profile and recent work, with any change shown to you first."
    >
      {(params.workout_id || params.program_id || params.session_id) && (
        <Card tone="accent" compact>
          <Copy kind="caption" tone="accent">This conversation has a specific focus</Copy>
          <Copy>
            {params.workout_id
              ? "The selected workout and its saved revision"
              : params.program_id
                ? "The selected plan and its saved revision"
                : "The selected actual training session"}
          </Copy>
          <Button title="Start a general conversation instead" variant="ghost" size="sm" inline onPress={() => router.replace("/coach")} />
        </Card>
      )}
      {!enrollment?.enrolled && <Button title="Set up my training" onPress={() => router.push("/onboarding")} />}
      {capabilities.data && !capabilities.data.coach && (
        <Notice>
          Coach messages are unavailable for this build. Manual training, saved libraries and profile controls remain
          usable.
        </Notice>
      )}
      {profile.error && <Notice error>{profile.error.message}</Notice>}
      {consent.error && <Notice error>{consent.error.message}</Notice>}
      <Card>
        <Field
          label="Message to your coach"
          multiline
          value={pending?.message ?? message}
          onChange={(value) => {
            if (!busy && !pending) setMessage(value);
          }}
          placeholder="Help me fit strength and running around basketball this week."
        />
        {pending && (
          <Notice>
            This message keeps its saved request identity through retries. Its content stays locked while the outcome is
            pending.
          </Notice>
        )}
        <Button
          title={pending ? "Retry this saved message" : "Send message"}
          icon="send"
          busy={busy}
          disabled={!loaded || !enrollment?.enrolled || !profile.data || !capabilities.data?.coach || !consent.data?.accepted}
          onPress={() => {
            void send();
          }}
        />
        <Copy kind="small" tone="muted">
          AI coaching uses your chosen profile and bounded recent training context. Imported Health activity currently
          stays excluded. Suggestions are reviewed separately before any change is applied.
        </Copy>
      </Card>
      {!!error && <Notice error>{error}</Notice>}
      {clearedRequest && pending && (
        <Button
          title="Discard this cleared request and write a new message"
          secondary
          disabled={busy}
          onPress={() => {
            setMessage(pending.message);
            setPending(null);
            setClearedRequest(false);
          }}
        />
      )}
      {enrollment?.enrolled && (
        <ListGroup>
          <ListRow
            icon="pulse-outline"
            title={showCheckIn ? "Hide today’s check-in" : "Check in before planning or returning"}
            onPress={() => setShowCheckIn(!showCheckIn)}
            trailing="none"
          />
          <ListRow icon="shield-checkmark-outline" title="Inspect AI sharing preferences" onPress={() => router.push("/ai-preferences")} />
        </ListGroup>
      )}
      {!enrollment?.enrolled && (
        <ListRow icon="shield-checkmark-outline" title="Inspect AI sharing preferences" onPress={() => router.push("/ai-preferences")} />
      )}
      {enrollment?.enrolled && showCheckIn && (
        <Card>
          <Copy kind="heading">How are you feeling today?</Copy>
          <ChipRow wrap label="How are you feeling today?">
            {(["ready", "limited", "unknown"] as const).map((value) => (
              <Chip
                key={value}
                label={
                  value === "ready"
                    ? "Ready for general training"
                    : value === "limited"
                      ? "I need to take it easier"
                      : "Unsure / prefer not to say"
                }
                selected={readiness === value}
                disabled={busy}
                onPress={() => setReadiness(value)}
              />
            ))}
          </ChipRow>
          <Button
            title="Save today’s check-in"
            busy={busy}
            onPress={() => {
              void saveCheckIn();
            }}
          />
          {checkIn.data?.confirmed_at && (
            <Copy kind="small" tone="muted">Last check-in · {new Date(checkIn.data.confirmed_at).toLocaleString()}</Copy>
          )}
          {checkIn.data?.expires_at && (
            <Copy kind="small" tone="muted">Valid until · {new Date(checkIn.data.expires_at).toLocaleString()}</Copy>
          )}
          <Copy kind="small" tone="muted">
            This check-in expires. Returning from a pause also requires reviewing your current comfortable baseline.
          </Copy>
        </Card>
      )}
      {q.error && (
        <>
          <Notice error>{q.error.message}</Notice>
          <Button
            title="Refresh saved conversation"
            secondary
            onPress={() => {
              void q.refetch();
            }}
          />
        </>
      )}
      {!!history.length && <SectionHeader title="Conversation" />}
      {history.map((item) => (
        <View key={item.id} style={{ gap: 10 }}>
          <Bubble from="you" meta={`${new Date(item.created_at).toLocaleString()} · ${item.state}`}>
            <Copy>{item.user_message}</Copy>
          </Bubble>
          {item.assistant_message && (
            <Bubble from="coach">
              <Copy>{item.assistant_message}</Copy>
            </Bubble>
          )}
          {item.state === "pending" && (
            <Notice>
              Still processing. You can leave and return; this request will not be resent as a new message.
            </Notice>
          )}
          {item.state === "failed" && <Notice>The request failed without applying a change.</Notice>}
          {item.actions.map((action) => (
            <Card key={action.proposal_id} tone="accent" compact>
              <Copy kind="caption" tone="accent">
                {action.state === "accepted" ? "Applied" : action.state === "undone" ? "Undone" : "Suggested change"}
              </Copy>
              <Button
                title={`${action.state === "accepted" ? "Inspect or undo" : action.state === "undone" ? "Inspect undone" : "Review"} ${action.kind.replaceAll("_", " ")} suggestion`}
                variant={action.state === "proposed" ? "primary" : "secondary"}
                size="sm"
                onPress={() =>
                  router.push({
                    pathname: "/coach-action/[id]",
                    params: { id: action.proposal_id, generation: String(item.generation), state: action.state },
                  })
                }
              />
            </Card>
          ))}
        </View>
      ))}
      {q.hasNextPage && (
        <Button
          title="Load earlier messages"
          variant="ghost"
          busy={q.isFetchingNextPage}
          onPress={() => {
            void q.fetchNextPage();
          }}
        />
      )}
      <Button
        title="Clear saved coach conversation"
        variant="ghost"
        icon="trash-outline"
        disabled={busy || !enrollment?.enrolled}
        onPress={() => setClearConfirm(true)}
      />
      {clearConfirm && (
        <Card tone="sunken">
          <Copy kind="small">
            This removes retained conversation and related pending suggestions. Accepted workouts/plans remain saved.
            Short content-free request/quota receipts stay temporarily to prevent replay and allowance resets.
          </Copy>
          <Button
            title="Clear conversation and pending suggestions"
            variant="destructive"
            busy={busy}
            onPress={() => {
              void clear();
            }}
          />
          <Button title="Keep conversation" secondary disabled={busy} onPress={() => setClearConfirm(false)} />
        </Card>
      )}
    </Screen>
  );
}
