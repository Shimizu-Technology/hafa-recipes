import { CoachVoiceButton, CoachVoiceStatus } from "@/components/coach-voice-controls";
import { CoachChatShell, CoachInput, CoachSnackbar, type Snack } from "@/components/coach-chat";
import { useCoachVoice } from "@/lib/use-coach-voice";
import { stopCoachReadAloud, useCoachReadAloud } from "@/lib/use-coach-read-aloud";
import { CoachMessagePhoto, CoachPhotoControl, useCoachPhoto } from "@/components/coach-photo";
import { CoachReply } from "@/components/coach-reply";
import { CoachSuggestionCard } from "@/components/coach-suggestion";
import { createCoachDraftStore } from "@/lib/coach-drafts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, ScrollView, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Bubble, Button, Card, Chip, ChipRow, Copy, IconButton, ListGroup, ListRow, Notice, Sheet } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useTraining } from "@/lib/context";
import { coachFocusErrors, type CoachFocus, type CoachHistory, type CoachMessage, type PendingCoachMessage } from "@/lib/coach";
const HISTORY_POSITION_ERROR = "Could not keep your reading position. Try loading earlier messages again.";
const COPY_ERROR = "Could not copy this reply. Try again or select the text to copy it.";
const messageOrder = (a: CoachMessage, b: CoachMessage) =>
  Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id);
export default function Coach() {
  const raw = useLocalSearchParams<{
    workout_id?: string; workoutId?: string;
    program_id?: string; programId?: string;
    session_id?: string; sessionId?: string;
    revision?: string;
    check_in?: string;
  }>();
  // Detail screens may link with camelCase (`/coach?workoutId=…`) or the original snake_case.
  const params = Object.fromEntries(Object.entries({
    workout_id: raw.workout_id ?? raw.workoutId,
    program_id: raw.program_id ?? raw.programId,
    session_id: raw.session_id ?? raw.sessionId,
    revision: raw.revision,
  }).filter(([, value]) => !!value)) as { workout_id?: string; program_id?: string; session_id?: string; revision?: string };
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
  const drafts = useMemo(() => createCoachDraftStore(storage), [storage]);
  const generation = enrollment?.generation ?? 0;
  const cache = useQueryClient();
  const profile = useQuery({ queryKey: [owner, "coach-profile", generation, !!params.workout_id], queryFn: async () => {
    try { return await api.profile(); }
    catch (error) {
      if (params.workout_id && error instanceof ApiError && error.status === 409) return null;
      throw error;
    }
  }, enabled: !!enrollment?.enrolled });
  const sourceOnly = !!params.workout_id && profile.isSuccess && !profile.data;
  const focus: CoachFocus = {
    ...(params.workout_id ? { context_workout_id: params.workout_id } : {}),
    ...(params.program_id ? { context_program_id: params.program_id } : {}),
    ...(params.session_id ? { context_session_id: params.session_id } : {}),
    ...(params.revision ? { context_revision: Number(params.revision) } : {}),
  };
  const focusToken = JSON.stringify(focus);
  const about = useQuery({
    queryKey: [owner, "coach-about", params.workout_id, params.program_id, params.session_id, generation],
    queryFn: async () => (params.workout_id ? await api.workout(params.workout_id)
      : params.program_id ? await api.program(params.program_id) : await api.session(params.session_id!)).title,
    enabled: !!enrollment?.enrolled && !!(params.workout_id || params.program_id || params.session_id),
  });
  const focusKey = params.workout_id ?? params.program_id ?? params.session_id ?? "general";
  const [epoch, setEpoch] = useState("initial");
  const [focused, setFocused] = useState(false);
  const routeActive = useRef(false);
  useFocusEffect(
    useCallback(() => {
      routeActive.current = true; setFocused(true);
      return () => { routeActive.current = false; setFocused(false); };
    }, [])
  );
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const replyScope = useMemo(() => ({}), [owner, generation, focusToken, storage, epoch, focused, foreground]);
  const [message, setMessage] = useState("");
  const [pending, updatePending] = useState<PendingCoachMessage | null>(null);
  const pendingRef = useRef<PendingCoachMessage | null>(null);
  function setPending(value: PendingCoachMessage | null) { pendingRef.current = value; updatePending(value); }
  const sending = useRef<{ request_id: string; controller: AbortController } | null>(null);
  const stoppingRef = useRef<object | null>(null);
  const finishing = useRef<object | null>(null);
  const [provisional, setProvisional] = useState("");
  const [stopping, setStopping] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draftLoadError, setDraftLoadError] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState<Snack | null>(null);
  const [optionsOpen, setOptions] = useState(false);
  const [replyMenu, setReplyMenu] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState("");
  const [reuse, setReuse] = useState<{ id: string; message: string } | null>(null);
  const scope = useMemo(() => ({ owner, generation, focusKey, focusToken, storage }), [owner, generation, focusKey, focusToken, storage]);
  const liveScope = useRef<typeof scope | null>(null);
  const loadedScope = useRef<typeof scope | null>(null);
  const current = () => liveScope.current === scope && isCurrentAccount() && storage.isCurrent();
  const conversation = useMemo(() => ({}), [scope, epoch]);
  const liveConversation = useRef<object | null>(null);
  useLayoutEffect(() => {
    liveConversation.current = conversation;
    return () => { if (liveConversation.current === conversation) liveConversation.current = null; };
  }, [conversation]);
  const currentConversation = () => current() && liveConversation.current === conversation;
  useLayoutEffect(() => { finishing.current = null; }, [scope, epoch]);
  useLayoutEffect(() => {
    liveScope.current = scope; loadedScope.current = null;
    setSnack(null); setOptions(false); setReplyMenu(null); setDraftNotice(""); setReuse(null); setError(""); setBusy(false);
    setClearConfirm(false); setClearedRequest(false); setShowCheckIn(raw.check_in === "today"); setOptions(raw.check_in === "today"); setReadiness("unknown");
    sending.current?.controller.abort(); sending.current = null; setProvisional("");
    stoppingRef.current = null; finishing.current = null; setStopping(null); guard.current = false;
    return () => { if (liveScope.current === scope) { liveScope.current = null; sending.current?.controller.abort(); } };
  }, [scope]);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
  useEffect(() => {
    if (raw.check_in === "today") { setOptions(true); setShowCheckIn(true); }
  }, [raw.check_in]);
  const [readiness, setReadiness] = useState<"ready" | "limited" | "unknown">("unknown");
  const checkIn = useQuery({
    queryKey: [owner, "readiness", generation],
    queryFn: api.readiness,
    enabled: !!enrollment?.enrolled,
  });
  async function saveCheckIn() {
    if (!currentConversation() || guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await api.setReadiness(readiness, generation);
      if (!current()) return;
      await checkIn.refetch();
      if (current()) { setOptions(false); setShowCheckIn(false); }
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      if (current()) { guard.current = false; setBusy(false); }
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
          if (active && current() && loaded.epoch !== epoch) {
            setEpoch(loaded.epoch);
            setPending(loaded.value?.pending ?? null);
            setMessage(loaded.value?.message ?? "");
          }
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [owner, generation, focusKey, focusToken, epoch, storage])
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
  const readAloud = useCoachReadAloud({ owner, generation, storage, focus: focusToken, epoch,
    enabled: !!enrollment?.enrolled && focused && foreground && !!consent.data?.accepted,
    isCurrentAccount: () => isCurrentAccount() && !voiceActive && !photos.busy && !photos.removing });
  const voiceIdentity = useMemo(() => ({}), [scope, epoch, consent.data?.accepted, capabilities.data?.coach]);
  const voice = useCoachVoice({ scope: JSON.stringify([owner, generation, focusToken, epoch]), identity: voiceIdentity,
    enabled: loaded && !busy && !pending && !stopping && !!enrollment?.enrolled && (!!profile.data || sourceOnly) &&
      !!capabilities.data?.coach && !!consent.data?.accepted,
    message, current: () => currentConversation() && !photos.busy && !photos.removing,
    write: setMessage, beforeCapture: stopCoachReadAloud });
  const voiceActive = voice.preparing || voice.phase !== "idle" || voice.unavailable;
  const q = useInfiniteQuery({
    queryKey: [owner, "coach-history", generation, epoch],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.coachHistory(pageParam),
    getNextPageParam: (page) => (page.messages.length >= page.limit ? page.offset + page.limit : undefined),
    enabled: !!enrollment?.enrolled,
    refetchInterval: query => focused && foreground && (pending || query.state.data?.pages.some(page => page.messages.some(item => item.state === "pending"))) ? 3000 : false,
  });
  const prerequisiteErrors = [...new Set([profile.error, consent.error, capabilities.error].flatMap(error => error ? [error.message] : []))];
  const [retryingCoach, setRetryingCoach] = useState(false);
  const retryAttempt = useRef<object | null>(null);
  const retryActivation = useRef<object | null>(null);
  useLayoutEffect(() => {
    retryActivation.current = replyScope; retryAttempt.current = null; setRetryingCoach(false);
    return () => { if (retryActivation.current === replyScope) retryActivation.current = null; };
  }, [replyScope]);
  async function retryCoach() {
    if (!currentConversation() || retryActivation.current !== replyScope || !routeActive.current ||
      AppState.currentState !== "active" || retryAttempt.current) return;
    const attempt = {}; retryAttempt.current = attempt; setRetryingCoach(true);
    try {
      await Promise.allSettled([profile.refetch(), consent.refetch(), capabilities.refetch(), ...(q.error ? [q.refetch()] : [])]);
    } finally {
      if (currentConversation() && retryActivation.current === replyScope && retryAttempt.current === attempt) {
        retryAttempt.current = null; setRetryingCoach(false);
      }
    }
  }
  const photos = useCoachPhoto(focusToken, epoch, busy || !!pending || !loaded || voiceActive || !capabilities.data?.coach_images || !consent.data?.accepted, stopCoachReadAloud);
  const delivery = useRef(false);
  const deliveryScope = useMemo(() => ({}), [replyScope, consent.data?.accepted, capabilities.data?.coach, photos.busy, photos.removing]);
  const liveDelivery = useRef<object | null>(null);
  useLayoutEffect(() => {
    liveDelivery.current = deliveryScope;
    delivery.current = focused && foreground && !!consent.data?.accepted && !!capabilities.data?.coach && !photos.busy && !photos.removing;
    if (!delivery.current) { sending.current?.controller.abort(); setProvisional(""); }
    return () => { if (liveDelivery.current === deliveryScope) { liveDelivery.current = null; sending.current?.controller.abort(); } };
  }, [deliveryScope]);
  const currentDelivery = () => currentConversation() && liveDelivery.current === deliveryScope && delivery.current && routeActive.current && AppState.currentState === "active";
  useLayoutEffect(() => {
    if (sending.current && sending.current.request_id !== pending?.request_id) {
      sending.current.controller.abort(); setProvisional("");
    }
  }, [pending?.request_id, epoch]);
  const history = [
    ...new Map(q.data?.pages.flatMap((page) => page.messages).map((item) => [item.id, item]) ?? []).values(),
  ].sort(messageOrder);
  const scroll = useRef<ScrollView | null>(null);
  const reading = useRef({ offset: 0, latest: true, viewport: 0 });
  const positions = useRef(new Map<string, number>());
  const positionVersions = useRef(new Map<string, number>());
  const messageViews = useRef(new Map<string, View>());
  const earlier = useRef<{ id: string; top: number; offset: number; firstId: string; measuring: boolean; positions: Map<string, { top: number; version: number }> } | null>(null);
  const loadingEarlier = useRef(false);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  useLayoutEffect(() => {
    reading.current = { offset: 0, latest: true, viewport: 0 };
    positions.current.clear(); positionVersions.current.clear(); earlier.current = null; loadingEarlier.current = false;
    setAwayFromLatest(false);
  }, [owner, generation, focusKey, focusToken, storage, epoch]);
  function latest() {
    if (!currentConversation()) return;
    earlier.current = null; reading.current.latest = true; setAwayFromLatest(false);
    scroll.current?.scrollToEnd({ animated: true });
  }
  async function loadEarlier() {
    if (!currentConversation() || loadingEarlier.current || !q.hasNextPage) return;
    loadingEarlier.current = true;
    setError(previous => previous === HISTORY_POSITION_ERROR ? "" : previous);
    // Anchor an existing visible message, so new replies below cannot affect
    // the offset correction when older messages are prepended above it.
    const known = history.filter(item => positions.current.has(item.id));
    const anchor = known.filter(item => positions.current.get(item.id)! <= reading.current.offset).at(-1) ?? known[0];
    reading.current.latest = false; setAwayFromLatest(true);
    if (anchor)
      earlier.current = { id: anchor.id, top: positions.current.get(anchor.id)!,
      offset: reading.current.offset, firstId: history[0].id, measuring: false, positions: new Map([...positions.current].map(([id, top]) => [id, { top, version: positionVersions.current.get(id) ?? 0 }])) };
    const captured = earlier.current;
    let fetching = false;
    try {
      const reader = scroll.current as (ScrollView & { getInnerViewRef?: () => View | null }) | null;
      const row = captured && messageViews.current.get(captured.id);
      const content = reader?.getInnerViewRef?.();
      if (captured && row && content) {
        captured.measuring = true;
        // onLayout may already be stale after an earlier position-only shift.
        const top = await new Promise<number>((resolve, reject) => row.measureLayout(content, (_x, y) => resolve(y), reject));
        if (!currentConversation() || earlier.current !== captured || scroll.current !== reader || messageViews.current.get(captured.id) !== row) return;
        captured.top = top;
      }
      // The cached position can be stale after a first-page refresh removes
      // its previous oldest row. Decide visibility from the measured baseline.
      if (captured && captured.top >= reading.current.offset + reading.current.viewport) earlier.current = null;
      if (!currentConversation()) return;
      fetching = true;
      const result = await q.fetchNextPage();
      const oldest = result.data?.pages.flatMap(page => page.messages).sort(messageOrder)[0]?.id;
      if (currentConversation() && (result.isError || !oldest || oldest === earlier.current?.firstId)) earlier.current = null;
    } catch {
      if (currentConversation() && earlier.current === captured) {
        earlier.current = null;
        if (!fetching) setError(HISTORY_POSITION_ERROR);
      }
    }
    finally { if (currentConversation()) loadingEarlier.current = false; }
  }
  function messageLayout(id: string, top: number, measured = false) {
    if (!currentConversation()) return;
    positions.current.set(id, top);
    positionVersions.current.set(id, (positionVersions.current.get(id) ?? 0) + 1);
    const anchor = earlier.current;
    if (anchor?.id === id && history[0]?.id !== anchor.firstId && (!anchor.measuring || measured)) {
      earlier.current = null;
      const delta = top - anchor.top;
      for (const [oldId, previous] of anchor.positions)
        if (positionVersions.current.get(oldId) === previous.version) positions.current.set(oldId, previous.top + delta);
      const offset = Math.max(0, anchor.offset + delta);
      reading.current.offset = offset;
      scroll.current?.scrollTo({ y: offset, animated: false });
    }
  }
  // Position-only changes do not emit onLayout on every platform (RNWeb
  // observes size). Measure the existing anchor after the prepend commits.
  useLayoutEffect(() => {
    const anchor = earlier.current;
    const reader = scroll.current as (ScrollView & { getInnerViewRef?: () => View | null }) | null;
    const row = anchor && messageViews.current.get(anchor.id);
    const content = reader?.getInnerViewRef?.();
    if (!anchor?.measuring || history[0]?.id === anchor.firstId || !row || !content) return;
    row.measureLayout(content, (_x, y) => {
      if (currentConversation() && earlier.current === anchor && scroll.current === reader && messageViews.current.get(anchor.id) === row)
        messageLayout(anchor.id, y, true);
    }, () => {
      if (currentConversation() && earlier.current === anchor) earlier.current = null;
    });
  }, [history[0]?.id, conversation]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setDraftLoadError(false);
    setPending(null);
    setMessage("");
    void drafts
      .load(owner, generation, focusKey)
      .then((loaded) => {
        if (active && current()) {
          setEpoch(loaded.epoch);
          const value = loaded.value;
          if (value?.pending?.generation === generation) setPending(value.pending);
          setMessage(value?.message ?? "");
          loadedScope.current = scope;
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active && current()) {
          setDraftLoadError(true);
          setError("Could not restore this conversation draft. Saved conversation remains on your account.");
        }
      });
    return () => {
      active = false;
    };
  }, [owner, focusKey, focusToken, generation, storage, restoreAttempt]);
  useEffect(() => {
    if (loaded && loadedScope.current === scope)
      void drafts
        .save(owner, generation, focusKey, { message, pending }, epoch)
        .catch(() => { if (current()) setError("Could not keep the message draft locally. Stay here and retry."); });
  }, [loaded, message, pending, owner, focusKey, focusToken, generation, epoch, storage]);
  useEffect(() => {
    if (!pending) return;
    const receipt = history.find(item => item.request_id === pending.request_id);
    if (receipt && receipt.state !== "pending") void finishReply(receipt);
  }, [history, pending]);
  async function finishReply(receipt: CoachMessage) {
    const request = pendingRef.current;
    if (!currentConversation() || receipt.generation !== generation || !request || request.request_id !== receipt.request_id || receipt.state === "pending" || finishing.current) return;
    const completion = {}; finishing.current = completion;
    try {
      if (!(await sameConversation()) || finishing.current !== completion || pendingRef.current?.request_id !== request.request_id) return;
      await photos.handoff(request.attachment_id);
      if (!(await sameConversation()) || finishing.current !== completion || pendingRef.current?.request_id !== request.request_id) return;
      if (sending.current?.request_id === receipt.request_id) {
        sending.current.controller.abort(); sending.current = null;
        guard.current = false; setBusy(false);
      }
      setProvisional(""); setPending(null);
      setMessage(receipt.state === "failed" ? request.message : "");
      setError(receipt.state === "failed" && !receipt.cancelled
        ? "Your coach couldn’t finish this reply. Your message is ready to edit and send again; no training changes were applied." : "");
      if (receipt.cancelled) setDraftNotice("Reply stopped. Your message is ready to edit; no training changes were applied.");
      else if (request.stop_requested) setDraftNotice(receipt.state === "completed"
        ? "This reply finished before Stop. Its reply and suggestions remain in your saved conversation."
        : "This request had already finished without a reply. Your message is ready to edit.");
    } catch {
      if (currentConversation() && finishing.current === completion && pendingRef.current?.request_id === request.request_id && await sameConversation() && finishing.current === completion && pendingRef.current?.request_id === request.request_id)
        setError("The reply is saved. Retry checking it to finish photo cleanup on this device.");
    } finally { if (finishing.current === completion) finishing.current = null; }
  }
  function rememberReceipt(receipt: CoachMessage) {
    if (!receipt.user_message) return; // Pre-send Stop tombstones remain hidden.
    cache.setQueryData<InfiniteData<CoachHistory>>([owner, "coach-history", generation, epoch], previous => {
      const pages = previous?.pages ?? [{ messages: [], limit: 50, offset: 0 }];
      const found = pages.some(page => page.messages.some(item => item.request_id === receipt.request_id));
      return { pageParams: previous?.pageParams ?? [0], pages: pages.map((page, index) => ({ ...page,
        messages: found ? page.messages.map(item => item.request_id === receipt.request_id ? receipt : item)
          : index === 0 ? [receipt, ...page.messages] : page.messages,
      })) };
    });
  }
  async function stopReply(requestId: string) {
    if (stoppingRef.current || !currentConversation() || !loaded || !capabilities.data?.coach_cancellation) return;
    const operation = {};
    stoppingRef.current = operation; setStopping(requestId); setError(""); setProvisional("");
    try {
      const request = pendingRef.current;
      if (request?.request_id === requestId) {
        const intent: PendingCoachMessage = { ...request, stop_requested: true };
        setPending(intent);
        if (!(await drafts.save(owner, generation, focusKey, { message: intent.message, pending: intent }, epoch)))
          throw Error("This conversation was cleared. Refresh the saved conversation before continuing.");
      }
      if (!currentConversation() || stoppingRef.current !== operation || (await drafts.epoch(owner, generation)) !== epoch || !currentConversation()) return;
      const receipt = await api.cancelCoachMessage(requestId, generation);
      if (!currentConversation() || stoppingRef.current !== operation || (await drafts.epoch(owner, generation)) !== epoch || !currentConversation()) return;
      if (receipt.request_id !== requestId || receipt.generation !== generation || receipt.state === "pending")
        throw Error("The service has not confirmed that this reply stopped. Try stopping it again.");
      rememberReceipt(receipt);
      await finishReply(receipt);
      if (!currentConversation() || stoppingRef.current !== operation || !(await sameConversation())) return;
      if (!pendingRef.current && receipt.cancelled) setDraftNotice("Reply stopped. No training changes were applied.");
      void cache.invalidateQueries({ queryKey: [owner, "coach-history"] });
    } catch (e) {
      if (currentConversation() && stoppingRef.current === operation && await sameConversation() && stoppingRef.current === operation) {
        const known = cache.getQueryData<InfiniteData<CoachHistory>>([owner, "coach-history", generation, epoch])
          ?.pages.flatMap(page => page.messages).find(item => item.request_id === requestId && item.generation === generation && item.state !== "pending");
        if (known) {
          await finishReply(known);
          if (!currentConversation() || stoppingRef.current !== operation || !(await sameConversation())) return;
          if (pendingRef.current?.request_id === requestId) return;
          setDraftNotice(known.cancelled ? "Reply stopped. No training changes were applied."
            : known.state === "completed" ? "This reply finished before Stop. Its reply and suggestions remain in your saved conversation."
              : "This request had already finished without a reply. Your message is ready to edit.");
        } else setError(`Could not confirm Stop. The reply may still finish; retry stopping it. ${(e as Error).message}`);
      }
    } finally {
      if (current() && stoppingRef.current === operation) { stoppingRef.current = null; setStopping(null); }
    }
  }
  async function send(text = message, requestFocus = focus) {
    if (guard.current || stoppingRef.current || !currentDelivery() || !loaded) return;
    if (pendingRef.current?.stop_requested) return; // A lost Stop acknowledgement must never resend.
    if (voice.preparing) return;
    voice.cancel();
    if (!pending && (!photos.loaded || photos.busy || photos.removing || photos.photo?.discard ||
        photos.photo && (!photos.photo.attachment_id || !!photos.photo.expires_at && Date.parse(photos.photo.expires_at) <= Date.now()))) {
      setError("Finish uploading or removing the photo before sending."); return;
    }
    const problems = coachFocusErrors(requestFocus);
    if (!pending && (!text.trim() || text.length > 4000)) problems.push("Write a message of 1–4000 characters.");
    if (!consent.data?.accepted) problems.push("Accept the separate AI sharing disclosure first.");
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    guard.current = true;
    setBusy(true);
    setError("");
    setDraftNotice("");
    setReuse(null);
    setClearedRequest(false);
    let operation: NonNullable<typeof sending.current> | undefined;
    try {
      const request = pending ?? {
        request_id: Crypto.randomUUID(),
        message: text.trim(),
        generation,
        focus: requestFocus,
        ...(photos.photo?.attachment_id ? { attachment_id: photos.photo.attachment_id } : {}),
        created_at: new Date().toISOString(),
      };
      if (!(await drafts.save(owner, generation, focusKey, { message: request.message, pending: request }, epoch)))
        throw Error("This conversation was cleared while the draft was open. Reload before sending another message.");
      if (!currentConversation()) return;
      if (!(await sameConversation())) throw Error("This conversation was cleared while the draft was open. Reload before sending another message.");
      if (!currentConversation()) return;
      setPending(request);
      if (!currentDelivery()) return;
      operation = { request_id: request.request_id, controller: new AbortController() };
      sending.current = operation;
      const active = operation;
      const receipt = capabilities.data?.coach_streaming
        ? await api.coachStream(request.request_id, request.message, request.focus, request.generation, active.controller.signal, async text => {
          if (!currentDelivery() || sending.current !== active || (pendingRef.current?.stop_requested || pendingRef.current?.request_id !== request.request_id) || !(await sameConversation()))
            throw Error("This reply view was retired. Check the saved request when you return.");
          if (currentDelivery() && sending.current === active && !pendingRef.current?.stop_requested && pendingRef.current?.request_id === request.request_id) setProvisional(text);
        }, request.attachment_id)
        : await api.coachMessage(request.request_id, request.message, request.focus, request.generation, active.controller.signal, request.attachment_id);
      if (!currentDelivery() || sending.current !== operation || active.controller.signal.aborted ||
          (await drafts.epoch(owner, generation)) !== epoch || !currentDelivery() || active.controller.signal.aborted) return;
      if (receipt.request_id !== request.request_id || receipt.generation !== request.generation)
        throw Error("Could not confirm delivery of this saved message. Retry the same request.");
      rememberReceipt(receipt); await finishReply(receipt);
      void cache.invalidateQueries({ queryKey: [owner, "coach-history"] });
    } catch (e) {
      if (currentDelivery() && (!operation || sending.current === operation) && !pendingRef.current?.stop_requested) {
        setError((e as Error).message);
        setClearedRequest((e as { status?: number }).status === 410);
      }
    } finally {
      if (current() && (!operation || sending.current === operation)) { sending.current = null; guard.current = false; setBusy(false); setProvisional(""); }
    }
  }
  async function sameConversation() {
    try { return currentConversation() && (await drafts.epoch(owner, generation)) === epoch && currentConversation(); }
    catch { return false; }
  }
  async function clear() {
    if (!currentConversation() || guard.current || stoppingRef.current) return;
    let releasePhotoClear: () => void;
    try { releasePhotoClear = photos.beginClear(); }
    catch (error) { if (currentConversation()) setError((error as Error).message); return; }
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      voice.cancel();
      if (!currentConversation() || !(await sameConversation()) || !currentConversation()) return;
      try { await readAloud.stop(); } catch { return; }
      if (!currentConversation() || !(await sameConversation()) || !currentConversation()) return;
      await api.clearCoach(generation);
      if (!currentConversation() || !(await sameConversation()) || !currentConversation()) return;
      await photos.clearAfterConfirmedServerClear();
      if (!currentConversation() || !(await sameConversation()) || !currentConversation()) return;
      setPending(null);
      setMessage("");
      const nextEpoch = Crypto.randomUUID();
      await drafts.clear(owner, generation, nextEpoch);
      if (!currentConversation()) return;
      setEpoch(nextEpoch);
      await cache.invalidateQueries({ queryKey: [owner, "coach-history"] });
      if (!current()) return;
      setClearConfirm(false); setOptions(false); setSnack(null);
    } catch (e) {
      if (currentConversation()) setError((e as Error).message);
    } finally {
      releasePhotoClear();
      if (current()) { guard.current = false; setBusy(false); }
    }
  }
  async function copyReply(text: string) {
    if (!currentConversation()) return;
    try {
      if ((await Clipboard.setStringAsync(text)) !== true) throw Error("Clipboard did not confirm copying");
      if (currentConversation()) { setSnack({ id: Date.now(), text: "Reply copied" }); setError(value => value === COPY_ERROR ? "" : value); }
    } catch {
      if (currentConversation()) { setSnack(null); setError(COPY_ERROR); }
    }
  }
  function useMessage(text: string) {
    if (!currentConversation() || !loaded || busy || pending) return;
    voice.cancel();
    setMessage(text);
    setError("");
    setDraftNotice("Your message is ready to edit before sending; it uses this conversation’s current focus.");
    setReuse(null);
  }
  const speechFeedback = <>
    {!!readAloud.error && <Notice error>{readAloud.error}</Notice>}
    {readAloud.stopFailed && <Button title="Retry stopping speech" variant="ghost" size="sm" inline onPress={() => { void readAloud.retryStop().catch(() => undefined); }} />}
    {!!readAloud.messageId && Platform.OS === "ios" && <Copy kind="small" tone="muted">If you can’t hear speech, turn off silent mode.</Copy>}
  </>;
  const needsConsent = !!enrollment?.enrolled && (!!profile.data || sourceOnly) && !!capabilities.data?.coach &&
    consent.isSuccess && consent.data.accepted === false && !prerequisiteErrors.length;
  const unavailable = !enrollment?.enrolled || (!profile.data && !sourceOnly) || !capabilities.data?.coach || !consent.data?.accepted;
  const photoBlocked = !photos.loaded || photos.busy || photos.removing || !!photos.photo?.discard ||
    !!photos.photo && (!photos.photo.attachment_id || !!photos.photo.expires_at && Date.parse(photos.photo.expires_at) <= Date.now());
  const sendDisabled = !loaded || voice.preparing || !pending && photoBlocked || !!stopping || unavailable;
  const composer = (
      <View style={{ gap: 8, flexShrink: 1, minHeight: 0 }}>
        <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
        {speechFeedback}
        {awayFromLatest && (!!history.length || !!provisional) && <Button title="Jump to latest reply" icon="arrow-down" variant="ghost" size="sm" inline onPress={latest} />}
        {!!draftNotice && <Notice>{draftNotice}</Notice>}
        {!!error && <Notice error>{error}</Notice>}
        {draftLoadError && <Button title="Retry restoring message draft" secondary size="sm" inline onPress={() => { if (currentConversation()) { setError(""); setRestoreAttempt(value => value + 1); } }} />}
        {pending ? <>
          <Copy kind="small" numberOfLines={2} accessibilityLabel={`Your message: ${pending.message}`}>
            Your message: {pending.message}
          </Copy>
          <Copy kind="small" tone="muted">
            {pending.stop_requested ? "Stopping… This message won’t be resent. You can leave and come back."
              : busy ? "Sending your message…" : history.some(item => item.request_id === pending.request_id)
              ? "Preparing a reply. You can leave and return."
              : "Delivery unconfirmed. Retry uses this saved message."}
          </Copy>
        </> : <>
          <CoachVoiceStatus voice={voice} />
          <CoachPhotoControl slot="status" state={photos} allowed={!!capabilities.data?.coach_images && !!consent.data?.accepted} disabled={busy || !loaded || voiceActive} />
        </>}
        </ScrollView>
        {pending ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          {!busy && !pending.stop_requested && <Button
            title={history.some(item => item.request_id === pending.request_id) ? "Check for reply" : "Retry saved message"}
            icon="refresh" size="sm" inline disabled={sendDisabled} onPress={() => { void send(); }} />}
          {capabilities.data?.coach_cancellation && <Button
            title={pending.stop_requested ? "Retry stopping reply" : "Stop reply"} icon="stop-circle-outline"
            secondary size="sm" inline busy={stopping === pending.request_id} disabled={!loaded || !!stopping}
            onPress={() => { void stopReply(pending.request_id); }} />}
        </View> : <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4 }}>
          <CoachPhotoControl slot="button" state={photos} allowed={!!capabilities.data?.coach_images && !!consent.data?.accepted} disabled={busy || !loaded || voiceActive} />
          <CoachInput
            label="Message to your coach"
            disabled={!loaded || busy}
            value={message}
            onChange={(value) => {
              if (currentConversation() && loaded && !busy && !pending) { voice.cancel(); setMessage(value); setDraftNotice(""); setReuse(null); }
            }}
            placeholder={params.workout_id ? "Ask about this workout…" : params.program_id ? "Ask about this plan…" : params.session_id ? "Ask about this session…" : "Ask your coach…"}
          />
          <CoachVoiceButton voice={voice} disabled={!loaded || busy || !!stopping || photos.busy || photos.removing || unavailable} />
          <IconButton icon="arrow-up" label="Send message" variant="primary"
            disabled={sendDisabled || busy || !message.trim()} onPress={() => { void send(); }} />
        </View>}
      </View>
  );
  const close = () => { setOptions(false); setClearConfirm(false); setShowCheckIn(false); };
  const optionsSheet = <Sheet visible={optionsOpen} title={clearConfirm ? "Clear conversation?" : showCheckIn ? "How are you feeling today?" : "Coach"} onClose={close}>
    {!!error && <Notice error>{error}</Notice>}
    {clearConfirm ? <>
      <Copy kind="small">Clears messages and pending suggestions. Changes you accepted stay saved. Some content-free usage records stay briefly.</Copy>
      <Button title="Clear conversation and pending suggestions" variant="destructive" busy={busy}
        disabled={photos.busy || photos.removing} onPress={() => { void clear(); }} />
      <Button title="Keep conversation" secondary disabled={busy} onPress={() => { if (currentConversation()) setClearConfirm(false); }} />
    </> : showCheckIn ? <>
      <ChipRow wrap label="How are you feeling today?">
        {(["ready", "limited", "unknown"] as const).map((value) => (
          <Chip key={value} role="radio" selected={readiness === value} disabled={busy}
            label={value === "ready" ? "Ready to train" : value === "limited" ? "I need to take it easier" : "Not sure"}
            onPress={() => { if (currentConversation()) setReadiness(value); }} />
        ))}
      </ChipRow>
      <Button title="Save today’s check-in" busy={busy} onPress={() => { void saveCheckIn(); }} />
      {checkIn.data?.confirmed_at && <Copy kind="small" tone="muted">
        Last check-in {new Date(checkIn.data.confirmed_at).toLocaleString()}{checkIn.data.expires_at ? ` · good until ${new Date(checkIn.data.expires_at).toLocaleString()}` : ""}
      </Copy>}
    </> : <>
      <ListGroup>
        {enrollment?.enrolled && <ListRow icon="pulse-outline" title="Check in for today" trailing="none"
          onPress={() => { if (currentConversation()) setShowCheckIn(true); }} />}
        <ListRow icon="shield-checkmark-outline" title="AI preferences" onPress={() => {
          // Let the options sheet finish closing; iOS can't present a screen from a view that is still presenting one.
          close(); setTimeout(() => { if (currentConversation()) router.push("/ai-preferences"); }, 350);
        }} />
        <ListRow icon="trash-outline" title="Clear conversation" destructive trailing="none"
          disabled={busy || !!stopping || photos.busy || photos.removing || !enrollment?.enrolled}
          onPress={() => { if (currentConversation()) setClearConfirm(true); }} />
      </ListGroup>
      <Copy kind="small" tone="muted">{sourceOnly ? "Source explanation shares only this saved workout with OpenAI. Personal changes need only the relevant missing details; no changes are applied here." : "Coach uses your profile and recent training, not Health data. You approve any change before it’s saved."} Voice input uses your device’s speech service; check the text before sending.</Copy>
    </>}
  </Sheet>;
  const replyItem = history.find(item => item.id === replyMenu);
  const replyOptions = <Sheet visible={!!replyItem?.assistant_message} title="Reply" onClose={() => setReplyMenu(null)}>
    {replyItem?.assistant_message && <ListGroup>
      <ListRow icon="copy-outline" title="Copy reply" trailing="none"
        onPress={() => { setReplyMenu(null); void copyReply(replyItem.assistant_message!); }} />
      {replyItem.state === "completed" && replyItem.generation === generation && <ListRow
        icon={readAloud.messageId === replyItem.id ? "stop-circle-outline" : "volume-high-outline"}
        title={readAloud.messageId === replyItem.id ? "Stop reading" : "Read aloud"} trailing="none"
        disabled={busy || voiceActive || photos.busy || photos.removing || readAloud.busy && readAloud.messageId !== replyItem.id}
        onPress={() => {
          if (guard.current || voiceActive || photos.busy || photos.removing) return;
          setReplyMenu(null);
          if (readAloud.messageId === replyItem.id) void readAloud.stop().catch(() => undefined); else readAloud.read(replyItem);
        }} />}
    </ListGroup>}
  </Sheet>;
  const aboutLabel = focusKey === "general" ? "" : `About: ${about.data ?? (params.workout_id ? "this workout" : params.program_id ? "this plan" : "this session")}`;
  const banner = !!aboutLabel && <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingBottom: 4 }}>
    <Chip label={aboutLabel} icon={params.workout_id ? "barbell-outline" : params.program_id ? "calendar-outline" : "time-outline"} />
    <IconButton icon="close" label="Talk about anything instead" variant="plain" size={32} onPress={() => router.replace("/coach")} />
  </View>;
  const prompts = params.workout_id ? ["Make this easier", "Make it shorter", "Swap an exercise", "How should I warm up?"]
    : params.program_id ? ["Move a session", "Make this week lighter", "Pause my plan", "How am I doing?"]
    : ["Plan my week", "Make today easier", "Swap an exercise", "How am I progressing?"];
  if (enrollment?.enrolled && profile.isPending && !retryingCoach) return <CoachChatShell><Copy>Loading your training preferences…</Copy>{speechFeedback}</CoachChatShell>;
  if (!enrollment?.enrolled || (profile.isSuccess && !profile.data && !sourceOnly)) return <CoachChatShell>
    {speechFeedback}
    <Copy kind="heading">Set up your training first</Copy>
    <Copy tone="muted">Add your goal, equipment and schedule so Coach can use your saved workouts.</Copy>
    <Button title={enrollment?.enrolled ? "Set up training" : "Join Workouts"} inline onPress={() => router.push({ pathname: enrollment?.enrolled ? "/profile" : "/onboarding", params: { return_to: "coach", ...params } })} />
  </CoachChatShell>;
  const empty = !q.isPending && !q.error && !history.length && !provisional && !pending;
  return (
    <CoachChatShell
      key="conversation"
      menu={() => { if (currentConversation()) setOptions(true); }}
      banner={banner}
      footer={composer}
      overlay={<CoachSnackbar snack={snack} onDone={id => setSnack(value => value?.id === id ? null : value)} />}
      scrollRef={scroll}
      onScroll={({ nativeEvent }) => {
        if (!currentConversation() || (!history.length && !provisional)) return;
        const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
        if (earlier.current) {
          earlier.current.offset = contentOffset.y; reading.current.offset = contentOffset.y;
          return;
        }
        const atLatest = contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
        reading.current = { offset: contentOffset.y, latest: atLatest, viewport: layoutMeasurement.height };
        setAwayFromLatest(!atLatest);
      }}
      onContentSizeChange={() => {
        if (currentConversation() && (history.length || provisional) && reading.current.latest && !earlier.current)
          scroll.current?.scrollToEnd({ animated: false });
      }}
    >
      {optionsSheet}
      {replyOptions}
      {capabilities.data && !capabilities.data.coach && (
        <Notice>Coach isn’t available in this version. Everything else still works.</Notice>
      )}
      {(prerequisiteErrors.length > 0 || retryingCoach) && <>
        {prerequisiteErrors.length > 0 && <Notice error>{[...new Set([...prerequisiteErrors, ...(q.error ? [q.error.message] : [])])].join(" ")}</Notice>}
        <Button title="Retry loading coach" secondary inline busy={retryingCoach} onPress={() => { void retryCoach(); }} />
      </>}
      {needsConsent && <Card>
        <Copy>{sourceOnly ? "Source explanation sends your question and the selected saved workout to OpenAI. Turn on AI sharing to continue." : "Coach sends your question and relevant training details to OpenAI. Turn on AI sharing to start chatting."}</Copy>
        <Button title="Review AI sharing" onPress={() => router.push({
          pathname: "/ai-preferences", params: { return_to: "coach", ...params },
        })} />
      </Card>}
      {q.error && !prerequisiteErrors.length && !retryingCoach && <>
        <Notice error>{q.error.message}</Notice>
        <Button title="Refresh saved conversation" secondary inline onPress={() => { void q.refetch(); }} />
      </>}
      {q.isPending && <Copy tone="muted" align="center">Loading your conversation…</Copy>}
      {clearedRequest && pending && (
        <Button
          title="Discard this cleared request and write a new message"
          secondary
          disabled={busy}
          onPress={() => {
            if (!currentConversation() || pendingRef.current !== pending) return;
            setMessage(pending.message);
            setPending(null);
            setClearedRequest(false);
          }}
        />
      )}
      {empty && <View style={{ flexGrow: 1, justifyContent: "center", gap: 12, paddingVertical: 24 }}>
        <Copy kind="heading" align="center">{focusKey === "general" ? "What can I help with?" : "What would you like to change?"}</Copy>
        {!needsConsent && <Copy kind="small" tone="muted" align="center">{sourceOnly ? "Source-only context · this saved workout, without a training profile or history." : "Coach uses your profile and recent training. You approve any change first."}</Copy>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, paddingTop: 4 }}>
          {prompts.map(prompt => <Button key={prompt} title={prompt} secondary size="sm" inline
            disabled={sendDisabled || busy || !!message.trim()} onPress={() => { void send(prompt); }} />)}
        </View>
      </View>}
      {q.hasNextPage && (
        <Button
          title="Load earlier messages"
          variant="ghost"
          size="sm"
          busy={q.isFetchingNextPage}
          onPress={() => {
            void loadEarlier();
          }}
        />
      )}
      {history.map((item) => (
        <View key={item.id} collapsable={false} ref={node => { if (node) messageViews.current.set(item.id, node); else messageViews.current.delete(item.id); }} onLayout={event => messageLayout(item.id, event.nativeEvent.layout.y)} style={{ gap: 10 }}>
          <Bubble from="you" meta={item.cancelled ? "Stopped" : item.state === "pending" ? "Awaiting reply" : item.state === "failed" ? "Reply unavailable" : undefined}>
            <Copy selectable>{item.user_message}</Copy>
            {item.attachment_id && <CoachMessagePhoto id={item.attachment_id} generation={item.generation} expires={item.attachment_expires_at} />}
          </Bubble>
          {!!item.assistant_message && <View style={{ gap: 2 }}>
            <Bubble from="coach">
              <CoachReply text={item.assistant_message} scopeToken={replyScope} isCurrent={() => current() && routeActive.current && AppState.currentState === "active"} />
            </Bubble>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <IconButton icon="ellipsis-horizontal" label="Reply options" variant="plain" size={32} onPress={() => { if (currentConversation()) setReplyMenu(item.id); }} />
              {readAloud.messageId === item.id && <Button title="Stop reading" icon="stop-circle-outline" variant="ghost" size="sm" inline
                onPress={() => { void readAloud.stop().catch(() => undefined); }} />}
            </View>
          </View>}
          {item.state === "pending" && <>
            {!item.assistant_message && <Bubble from="coach"><Copy tone="muted">Thinking… You can leave and come back; this message won’t be sent twice.</Copy></Bubble>}
            {capabilities.data?.coach_cancellation && item.request_id !== pending?.request_id && <Button
              title="Stop this reply" secondary size="sm" inline busy={stopping === item.request_id} disabled={!loaded || !!stopping}
              onPress={() => { void stopReply(item.request_id); }} />}
          </>}
          {item.state === "failed" && <>
            {!item.assistant_message && <Notice>{item.cancelled ? "Reply stopped. No training changes were applied." : "Your coach couldn’t finish this reply. No training changes were applied."}</Notice>}
            {message !== item.user_message && <Button title="Use message again" variant="ghost" size="sm" inline disabled={busy || !!pending || !loaded} onPress={() => {
              if (!currentConversation() || !loaded || busy || pending) return;
              if (message.trim() && message !== item.user_message) setReuse({ id: item.id, message: item.user_message });
              else useMessage(item.user_message);
            }} />}
            {reuse?.id === item.id && <Card compact tone="sunken">
              <Copy>Replace your current unsent draft with this message?</Copy>
              <Button title="Replace unsent draft" secondary onPress={() => useMessage(reuse.message)} />
              <Button title="Keep my draft" variant="ghost" onPress={() => { if (currentConversation()) setReuse(null); }} />
            </Card>}
          </>}
          {item.actions.map((action) => <CoachSuggestionCard key={action.proposal_id} item={action} generation={item.generation}
            recovery={{ focus: item.focus, disabled: sendDisabled || busy || !!pending || !!message.trim() || !!photos.photo,
              blockedReason: message.trim() ? "Send or clear your unsent message to continue." : photos.photo ? "Send or remove your attached photo to continue." : undefined,
              checkIn: () => { if (currentConversation()) { setClearConfirm(false); setShowCheckIn(true); setOptions(true); } },
              askAgain: () => { if (currentConversation() && !sendDisabled && !busy && !pending && !message.trim() && !photos.photo) void send(item.user_message, item.focus); },
            }}
            notify={(text, undo) => { if (currentConversation()) setSnack({ id: Date.now(), text, ...(undo ? { action: { label: "Undo", onPress: () => { setSnack(null); undo(); } } } : {}) }); }} />)}
        </View>
      ))}
      {!!provisional && <Bubble from="coach" meta="Reply in progress · not saved yet"><Copy>{provisional}</Copy></Bubble>}
    </CoachChatShell>
  );
}
