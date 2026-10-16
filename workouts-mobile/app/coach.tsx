import { CoachVoiceControls } from "@/components/coach-voice-controls";
import { useCoachVoice } from "@/lib/use-coach-voice";
import { stopCoachReadAloud, useCoachReadAloud } from "@/lib/use-coach-read-aloud";
import { CoachMessagePhoto, CoachPhotoControl, useCoachPhoto } from "@/components/coach-photo";
import { CoachReply } from "@/components/coach-reply";
import { createCoachDraftStore } from "@/lib/coach-drafts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, ScrollView, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Bubble, Button, Card, Chip, ChipRow, Copy, Field, ListGroup, ListRow, Notice, Screen, SectionHeader } from "@/components/ui";
import { useTraining } from "@/lib/context";
import { coachFocusErrors, type CoachFocus, type CoachHistory, type CoachMessage, type PendingCoachMessage } from "@/lib/coach";
const HISTORY_POSITION_ERROR = "Could not keep your reading position. Try loading earlier messages again.";
const COPY_ERROR = "Could not copy this reply. Try again or select the text to copy it.";
const messageOrder = (a: CoachMessage, b: CoachMessage) =>
  Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id);
export default function Coach() {
  const params = useLocalSearchParams<{
    workout_id?: string;
    program_id?: string;
    session_id?: string;
    revision?: string;
  }>();
  const { api, owner, enrollment, storage, isCurrentAccount } = useTraining();
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
  const focusToken = JSON.stringify(focus);
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
  const [copied, setCopied] = useState<string | null>(null);
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
    setCopied(null); setDraftNotice(""); setReuse(null); setError(""); setBusy(false);
    setClearConfirm(false); setClearedRequest(false); setShowCheckIn(false); setReadiness("unknown");
    sending.current?.controller.abort(); sending.current = null; setProvisional("");
    stoppingRef.current = null; finishing.current = null; setStopping(null); guard.current = false;
    return () => { if (liveScope.current === scope) { liveScope.current = null; sending.current?.controller.abort(); } };
  }, [scope]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
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
    enabled: loaded && !busy && !pending && !stopping && !!enrollment?.enrolled && !!profile.data &&
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
  async function send() {
    if (guard.current || stoppingRef.current || !currentDelivery() || !loaded) return;
    if (pendingRef.current?.stop_requested) return; // A lost Stop acknowledgement must never resend.
    if (voice.preparing) return;
    voice.cancel();
    if (!pending && (!photos.loaded || photos.busy || photos.removing || photos.photo?.discard ||
        photos.photo && (!photos.photo.attachment_id || !!photos.photo.expires_at && Date.parse(photos.photo.expires_at) <= Date.now()))) {
      setError("Finish uploading or removing the photo before sending."); return;
    }
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
    setDraftNotice("");
    setReuse(null);
    setClearedRequest(false);
    let operation: NonNullable<typeof sending.current> | undefined;
    try {
      const request = pending ?? {
        request_id: Crypto.randomUUID(),
        message: message.trim(),
        generation,
        focus,
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
      setClearConfirm(false);
    } catch (e) {
      if (currentConversation()) setError((e as Error).message);
    } finally {
      releasePhotoClear();
      if (current()) { guard.current = false; setBusy(false); }
    }
  }
  async function copyReply(text: string, id: string) {
    if (!currentConversation()) return;
    try {
      if ((await Clipboard.setStringAsync(text)) !== true) throw Error("Clipboard did not confirm copying");
      if (currentConversation()) { setCopied(id); setError(value => value === COPY_ERROR ? "" : value); }
    } catch {
      if (currentConversation()) { setCopied(null); setError(COPY_ERROR); }
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
  const composer = (
      <View style={{ gap: 8, flexShrink: 1, minHeight: 0 }}>
        <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
        {speechFeedback}
        {awayFromLatest && (!!history.length || !!provisional) && <Button title="Jump to latest reply" variant="ghost" size="sm" onPress={latest} />}
        {!!draftNotice && <Notice>{draftNotice}</Notice>}
        {!!error && <Notice error>{error}</Notice>}
        {draftLoadError && <Button title="Retry restoring message draft" secondary onPress={() => { if (currentConversation()) { setError(""); setRestoreAttempt(value => value + 1); } }} />}
        {pending ? (
          <Copy kind="small" numberOfLines={2} accessibilityLabel={`Your message: ${pending.message}`}>
            Your message: {pending.message}
          </Copy>
        ) : <>
        <Field
          label="Message to your coach"
          multiline
          compact
          disabled={!loaded || busy || !!pending}
          value={message}
          onChange={(value) => {
            if (currentConversation() && loaded && !busy && !pending) { voice.cancel(); setMessage(value); setDraftNotice(""); setReuse(null); }
          }}
          placeholder="Help me fit strength and running around basketball this week."
        />
        <CoachVoiceControls voice={voice} disabled={!loaded || busy || !!stopping || photos.busy || photos.removing || !enrollment?.enrolled || !profile.data || !capabilities.data?.coach || !consent.data?.accepted} />
        </>}
        {!pending && <CoachPhotoControl state={photos} allowed={!!capabilities.data?.coach_images && !!consent.data?.accepted} disabled={busy || !loaded || voiceActive} />}
        {pending && (
          <Copy kind="small" tone="muted">
            {pending.stop_requested ? "Stop was requested. Until the service confirms the outcome, this message will not be resent. You can leave and return to retry stopping it."
              : busy ? "Sending your message…" : history.some(item => item.request_id === pending.request_id)
              ? "Preparing a reply. You can leave and return."
              : "Delivery unconfirmed. Retry uses this saved message."}
          </Copy>
        )}
        </ScrollView>
        <View style={{ gap: 8 }}>
        {(!pending || !busy) && !pending?.stop_requested && <Button
          title={pending ? history.some(item => item.request_id === pending.request_id) ? "Check for reply" : "Retry saved message" : "Send message"}
          icon="send"
          busy={busy}
          size="sm"
          disabled={!loaded || voice.preparing || !pending && (!photos.loaded || photos.busy || photos.removing || !!photos.photo?.discard || !!photos.photo && (!photos.photo.attachment_id || !!photos.photo.expires_at && Date.parse(photos.photo.expires_at) <= Date.now())) || !!stopping || !enrollment?.enrolled || !profile.data || !capabilities.data?.coach || !consent.data?.accepted}
          onPress={() => {
            void send();
          }}
        />}
        {pending && capabilities.data?.coach_cancellation && <Button
          title={pending.stop_requested ? "Retry stopping reply" : "Stop reply"}
          secondary busy={stopping === pending.request_id} disabled={!loaded || !!stopping}
          onPress={() => { void stopReply(pending.request_id); }} />}
        </View>
      </View>
  );
  if (enrollment?.enrolled && profile.isPending && !retryingCoach) return <Screen back title="Your coach starts with you."><Copy>Loading your training preferences…</Copy>{speechFeedback}</Screen>;
  if (!enrollment?.enrolled || (profile.isSuccess && !profile.data)) return <Screen back title="Your coach starts with you." subtitle="Set up your training preferences when you’re ready.">
    {speechFeedback}
    <Copy>Choose a goal, your equipment and a realistic schedule so the coach can use your saved workouts. Personal measurements are optional.</Copy>
    <Button title={enrollment?.enrolled ? "Set up training" : "Join Workouts"} onPress={() => router.push({ pathname: enrollment?.enrolled ? "/profile" : "/onboarding", params: { return_to: "coach", ...params } })} />
  </Screen>;
  return (
    <Screen
      key="conversation"
      back
      title="Talk through your training."
      subtitle="Your profile and recent work, with any change shown to you first."
      footer={composer}
      scrollRef={scroll}
      disableBrowserScrollAnchoring
      constrainFooter
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
      {(prerequisiteErrors.length > 0 || retryingCoach) && <>
        {prerequisiteErrors.length > 0 && <Notice error>{[...new Set([...prerequisiteErrors, ...(q.error ? [q.error.message] : [])])].join(" ")}</Notice>}
        <Button title="Retry loading coach" secondary busy={retryingCoach} onPress={() => { void retryCoach(); }} />
      </>}
      {q.error && !prerequisiteErrors.length && !retryingCoach && (
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
      {q.isPending && <Notice>Loading your saved conversation…</Notice>}
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
      {enrollment?.enrolled && (
        <ListGroup>
          <ListRow
            icon="pulse-outline"
            title={showCheckIn ? "Hide today’s check-in" : "Check in before planning or returning"}
            onPress={() => { if (currentConversation()) setShowCheckIn(!showCheckIn); }}
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
                onPress={() => { if (currentConversation()) setReadiness(value); }}
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
        <Copy kind="small" tone="muted">
          AI coaching uses your chosen profile and bounded recent training context. Imported Health activity currently
          stays excluded. Suggestions are reviewed separately before any change is applied.
        </Copy>
      <Button
        title="Clear saved coach conversation"
        variant="ghost"
        icon="trash-outline"
        disabled={busy || !!stopping || photos.busy || photos.removing || !enrollment?.enrolled}
        onPress={() => { if (currentConversation()) setClearConfirm(true); }}
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
            disabled={photos.busy || photos.removing}
            onPress={() => {
              void clear();
            }}
          />
          <Button title="Keep conversation" secondary disabled={busy} onPress={() => { if (currentConversation()) setClearConfirm(false); }} />
        </Card>
      )}
      {q.hasNextPage && (
        <Button
          title="Load earlier messages"
          variant="ghost"
          busy={q.isFetchingNextPage}
          onPress={() => {
            void loadEarlier();
          }}
        />
      )}

      {!!history.length && <SectionHeader title="Conversation" />}
      {history.map((item) => (
        <View key={item.id} collapsable={false} ref={node => { if (node) messageViews.current.set(item.id, node); else messageViews.current.delete(item.id); }} onLayout={event => messageLayout(item.id, event.nativeEvent.layout.y)} style={{ gap: 10 }}>
          <Bubble from="you" meta={`${new Date(item.created_at).toLocaleString()} · ${item.cancelled ? "Stopped" : item.state === "pending" ? "Awaiting reply" : item.state === "failed" ? "Reply unavailable" : "Sent"}`}>
            <Copy selectable>{item.user_message}</Copy>
            {item.attachment_id && <CoachMessagePhoto id={item.attachment_id} generation={item.generation} expires={item.attachment_expires_at} />}
          </Bubble>
          {!!item.assistant_message && (
            <Bubble from="coach">
              <CoachReply text={item.assistant_message} scopeToken={replyScope} isCurrent={() => current() && routeActive.current && AppState.currentState === "active"} />
              <Button title={copied === item.id ? "Reply copied" : "Copy reply"} icon={copied === item.id ? "checkmark" : "copy-outline"} variant="ghost" size="sm" inline onPress={() => { void copyReply(item.assistant_message!, item.id); }} />
              {item.state === "completed" && item.generation === generation && <Button
                title={readAloud.messageId === item.id ? "Stop reading" : "Read aloud"}
                icon={readAloud.messageId === item.id ? "stop-circle-outline" : "volume-high-outline"} variant="ghost" size="sm" inline
                disabled={busy || voiceActive || photos.busy || photos.removing || readAloud.busy && readAloud.messageId !== item.id}
                onPress={() => { if (guard.current || voiceActive || photos.busy || photos.removing) return; if (readAloud.messageId === item.id) void readAloud.stop().catch(() => undefined); else readAloud.read(item); }} />}
            </Bubble>
          )}
          {item.state === "pending" && <>
            <Notice>Still processing. You can leave and return; this request will not be resent as a new message.</Notice>
            {capabilities.data?.coach_cancellation && item.request_id !== pending?.request_id && <Button
              title="Stop this reply" secondary busy={stopping === item.request_id} disabled={!loaded || !!stopping}
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
      {!!provisional && <Bubble from="coach" meta="Reply in progress · not saved yet"><Copy>{provisional}</Copy></Bubble>}
    </Screen>
  );
}
