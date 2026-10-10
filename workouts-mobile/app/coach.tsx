import { createCoachDraftStore } from "@/lib/coach-drafts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
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
  return (
    <Screen
      back
      title="Talk through your training."
      subtitle="Your current profile and recent work, with changes you review first."
    >
      <Notice>
        AI coaching uses your chosen profile and bounded recent training context. Imported Health activity currently
        stays excluded. Suggestions are reviewed separately before any change is applied.
      </Notice>
      {(params.workout_id || params.program_id || params.session_id) && (
        <Card>
          <Copy kind="heading">This conversation has a specific focus</Copy>
          <Copy>
            {params.workout_id
              ? "The selected workout and its saved revision"
              : params.program_id
                ? "The selected plan and its saved revision"
                : "The selected actual training session"}
          </Copy>
          <Button title="Start a general conversation instead" secondary onPress={() => router.replace("/coach")} />
        </Card>
      )}
      {!enrollment?.enrolled && <Button title="Set up my training" onPress={() => router.push("/onboarding")} />}
      {enrollment?.enrolled && (
        <>
          <Button
            title={showCheckIn ? "Hide today’s check-in" : "Check in before planning or returning"}
            secondary
            onPress={() => setShowCheckIn(!showCheckIn)}
          />
          {showCheckIn && (
            <Card>
              <Copy kind="heading">How are you feeling today?</Copy>
              {(["ready", "limited", "unknown"] as const).map((value) => (
                <Choice
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
              <Button
                title="Save today’s check-in"
                busy={busy}
                onPress={() => {
                  void saveCheckIn();
                }}
              />
              {checkIn.data?.confirmed_at && (
                <Copy>Last check-in · {new Date(checkIn.data.confirmed_at).toLocaleString()}</Copy>
              )}
              {checkIn.data?.expires_at && (
                <Copy>Valid until · {new Date(checkIn.data.expires_at).toLocaleString()}</Copy>
              )}
              <Copy>
                This check-in expires. Returning from a pause also requires reviewing your current comfortable baseline.
              </Copy>
            </Card>
          )}
        </>
      )}
      <Button title="Inspect AI sharing preferences" secondary onPress={() => router.push("/ai-preferences")} />
      {capabilities.data && !capabilities.data.coach && (
        <Notice>
          Coach messages are unavailable for this build. Manual training, saved libraries and profile controls remain
          usable.
        </Notice>
      )}
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
          busy={busy}
          disabled={!loaded || !enrollment?.enrolled || !capabilities.data?.coach || !consent.data?.accepted}
          onPress={() => {
            void send();
          }}
        />
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
      {history.map((item) => (
        <Card key={item.id}>
          <Copy kind="small">
            {new Date(item.created_at).toLocaleString()} · {item.state}
          </Copy>
          <Copy kind="label">You</Copy>
          <Copy>{item.user_message}</Copy>
          {item.assistant_message && (
            <>
              <Copy kind="label">Your AI coach</Copy>
              <Copy>{item.assistant_message}</Copy>
            </>
          )}
          {item.state === "pending" && (
            <Notice>
              Still processing. You can leave and return; this request will not be resent as a new message.
            </Notice>
          )}
          {item.state === "failed" && <Notice>The request failed without applying a change.</Notice>}
          {item.actions.map((action) => (
            <Button
              key={action.proposal_id}
              title={`${action.state === "accepted" ? "Inspect or undo" : action.state === "undone" ? "Inspect undone" : "Review"} ${action.kind.replaceAll("_", " ")} suggestion`}
              secondary
              onPress={() =>
                router.push({
                  pathname: "/coach-action/[id]",
                  params: { id: action.proposal_id, generation: String(item.generation), state: action.state },
                })
              }
            />
          ))}
        </Card>
      ))}
      {q.hasNextPage && (
        <Button
          title="Load earlier messages"
          secondary
          busy={q.isFetchingNextPage}
          onPress={() => {
            void q.fetchNextPage();
          }}
        />
      )}
      <Button
        title="Clear saved coach conversation"
        secondary
        disabled={busy || !enrollment?.enrolled}
        onPress={() => setClearConfirm(true)}
      />
      {clearConfirm && (
        <>
          <Notice>
            This removes retained conversation and related pending suggestions. Accepted workouts/plans remain saved.
            Short content-free request/quota receipts stay temporarily to prevent replay and allowance resets.
          </Notice>
          <Button
            title="Clear conversation and pending suggestions"
            secondary
            busy={busy}
            onPress={() => {
              void clear();
            }}
          />
          <Button title="Keep conversation" secondary disabled={busy} onPress={() => setClearConfirm(false)} />
        </>
      )}
    </Screen>
  );
}
