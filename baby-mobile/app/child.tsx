import { useEffect, useRef, useState } from "react";
import { Alert, View, useWindowDimensions, type ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useBaby } from "@/lib/context";
import { ApiError } from "@/lib/api";
import { canAddBaby, canChangeBaby, rowFence, spaceFence, spaceForChild } from "../lib/spaces";
import { messageFor, type Child, type ChildEdits, type ChildField } from "@/lib/models";
import { dayKey } from "@/lib/tracker";
import { profileToday } from "@/lib/timing";
import {
  changesAnything, changeUnit, childWrite, chooseDue, dueSaid, formFor, measureProblem, noEdits, progressProblem, sameSpace, saveProblem, shownForm,
  startingUnit, touch, typeProgress, withChildDraft, type ChildForm,
} from "@/lib/child-setup";
import { contactsOn } from "../lib/contacts";
import { Button, Chips, Copy, Field, Notice, Row, Screen, useToast } from "@/components/ui";
import { DateField } from "@/components/date-field";
import { Disclosure } from "@/components/disclosure";
import { StageOptions } from "@/components/stage-options";

function Pair({ children }: { children: React.ReactNode }) {
  const { fontScale } = useWindowDimensions();
  return <View style={{ flexDirection: fontScale >= 1.3 ? "column" : "row", gap: 12 }}>{children}</View>;
}
/** Typing one box of a weight starts from what the others show. */
const typedWeight = (form: ChildForm) => ({ lb: form.lb, oz: form.oz, kg: form.kg });
const Half = ({ children }: { children: React.ReactNode }) => <View style={{ flex: 1, flexBasis: "auto" }}>{children}</View>;

export default function ChildEditor() {
  const { id, stage: param, doctor: toDoctor } = useLocalSearchParams<{ id?: string; stage?: string; doctor?: string }>(),
    b = useBaby(),
    toast = useToast(),
    today = profileToday(new Date(), b.state.bootstrap!.profile.timezone),
    [generation] = useState(b.state.bootstrap!.generation),
    child = b.state.bootstrap!.children.find((c) => c.id === id),
    // The route says what this is. A profile that's gone stays that profile, and never becomes a new one.
    slot = id ?? "new",
    removed = !!id && !child,
    asked = param === "expecting" || param === "here" ? param : null,
    [restored] = useState(() => {
      const saved = b.state.childDrafts?.[slot];
      return saved?.generation === generation && Array.isArray(saved.touched) ? saved : undefined;
    }),
    [edits, setEdits] = useState<ChildEdits>(() => {
      // Today's choice is hers: she tapped it there.
      const start = restored ?? noEdits(formFor(child, null, today, startingUnit(b.records)));
      return asked && !(start.touched.includes("stage") && start.form.stage === asked) ? touch(start, "stage", (form) => ({ ...form, stage: asked })) : start;
    }),
    form = shownForm(child, edits, today),
    [creationId, setCreationId] = useState(() => restored?.creation_id ?? Crypto.randomUUID()),
    [kept, setKept] = useState(!!restored),
    [fromEarlier, setFromEarlier] = useState(!!restored),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    working = useRef(false),
    finished = useRef(false),
    failed = useRef(!!restored),
    // A choice made on Today alone isn't worth keeping if she just backs out. One tapped here is, on a saved profile.
    stageFromToday = useRef(!!asked),
    scroller = useRef<ScrollView>(null),
    expecting = form.stage === "expecting", here = form.stage === "here",
    details = child?.details ?? {},
    hasMore = !!(details.weight_at_birth_g || details.length_at_birth_cm || details.weeks_at_birth || details.feeding)
      || edits.touched.some((field) => ["weight", "length", "weeksAtBirth", "feeding"].includes(field));
  /** Anything she does clears the last problem, which no longer applies. */
  const edit = (field: ChildField, change: (current: ChildForm) => ChildForm) => {
    setError("");
    setEdits((current) => touch(current, field, change));
  };
  const latest = useRef({ b, edits, creationId });
  latest.current = { b, edits, creationId };
  async function keepDraft() {
    const now = latest.current,
      wanted = failed.current || now.edits.touched.some((field) => field !== "stage" || (!!id && !stageFromToday.current));
    if (finished.current || (!wanted && !now.b.state.childDrafts?.[slot])) return;
    await now.b.commit((s) => withChildDraft(s, slot, wanted ? { ...now.edits, creation_id: now.creationId, generation } : null, generation)).catch(() => undefined);
  }
  useEffect(() => {
    const timer = setTimeout(() => void keepDraft(), 400);
    return () => clearTimeout(timer);
  }, [edits]);
  useEffect(() => () => void keepDraft(), []);
  // Help's "Add a baby's doctor" lands on the fields it means, which are at the end.
  useEffect(() => {
    if (!toDoctor) return;
    const timer = setTimeout(() => scroller.current?.scrollToEnd(), 300);
    return () => clearTimeout(timer);
  }, []);
  // The problem shows next to Save, which is often at the fold. Keep it, and Save, on screen.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => scroller.current?.scrollToEnd(), 50);
    return () => clearTimeout(timer);
  }, [error]);
  function switchUnit(unit: ChildForm["unit"]) {
    const problem = measureProblem(form, edits.touched);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setEdits((current) => ({ ...current, form: changeUnit(current.form, unit) }));
  }
  /** A first try can land with its answer lost. If she changed something since, the same id now conflicts, so it becomes an edit of just that. */
  async function send(write: Partial<Child>) {
    // An existing baby's write goes where they live, and a new one's where this account adds babies.
    const fence = child ? rowFence(child, generation) : spaceFence(b.state.bootstrap!, spaceForChild(b.state));
    try {
      return await b.api.child(write, fence);
    } catch (failure) {
      if (child || !(failure instanceof ApiError) || failure.status !== 409) throw failure;
      const landed = (await b.api.request<{ items: Child[] }>("/children")).items.find((row) => row.id === creationId),
        retry = landed && childWrite(form, edits.since, landed, creationId, today);
      if (!retry || "error" in retry) throw failure;
      return changesAnything(retry.write) ? b.api.child(retry.write, rowFence(landed, generation)) : landed;
    }
  }
  async function save() {
    if (working.current) return;
    const answer = childWrite(form, edits.touched, child, creationId, today);
    if ("error" in answer) {
      setError(answer.error);
      return;
    }
    working.current = true;
    setBusy(true);
    setError("");
    if (!child) setEdits((current) => (current.attempted ? current : { ...current, attempted: true }));
    try {
      const result = child && !changesAnything(answer.write) ? child : await send(answer.write);
      finished.current = true;
      await b.commit((s) => sameSpace(s, generation) ? withChildDraft({
        ...s,
        bootstrap: { ...s.bootstrap!, children: [result, ...s.bootstrap!.children.filter((c) => c.id !== result.id)] },
      }, slot, null, generation) : s);
      toast(!child?.birth_date && result.birth_date === dayKey(today) ? "Birth date set to today. You can change it in Settings." : "Profile saved.");
      router.back();
    } catch (e) {
      finished.current = false;
      failed.current = true;
      setKept(true);
      setError(saveProblem(e));
      if (!child) latest.current = { ...latest.current, edits: { ...latest.current.edits, attempted: true } };
      void keepDraft();
      // Read the profile again: a new revision to save over, or that it's gone.
      if (child && e instanceof ApiError && (e.status === 409 || e.status === 404)) void Promise.resolve(b.refresh()).catch(() => {});
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function discard() {
    Alert.alert("Discard what you typed?", child ? "This profile stays as it was saved." : undefined, [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => {
        failed.current = false;
        stageFromToday.current = !!asked;
        const start = noEdits(formFor(child, null, today, form.unit)),
          fresh = asked ? touch(start, "stage", (current) => ({ ...current, stage: asked })) : start;
        setEdits(fresh);
        setCreationId(Crypto.randomUUID());
        setKept(false);
        setFromEarlier(false);
        setError("");
        latest.current = { ...latest.current, edits: fresh };
        void b.commit((s) => withChildDraft(s, slot, null, generation)).catch(() => undefined);
      } },
    ]);
  }
  if (child ? !canChangeBaby(b.state.bootstrap, child) : !canAddBaby(b.state.bootstrap)) return (
    <Screen title="Baby profile" back><Notice>Only a parent can add a baby or change a profile. You can still log for them.</Notice></Screen>
  );
  if (removed) return (
    <Screen key="removed" title="Baby profile" back>
      <Notice>This baby’s profile was removed, so there’s nothing to edit here.</Notice>
      {(kept || edits.touched.length > 0) && <Button variant="ghost" title="Discard what you typed" onPress={discard} />}
      <Button secondary title="Back" onPress={() => router.back()} />
    </Screen>
  );
  const sex = <View style={{ gap: 8 }}>
    <Copy kind="small">Girl or boy?</Copy>
    {expecting ? <Chips label="Girl or boy" value={form.sex || "unsure"} onChange={(value) => edit("sex", (current) => ({ ...current, sex: value === "unsure" ? "" : value as ChildForm["sex"] }))}
      options={[{ label: "Girl", value: "girl" }, { label: "Boy", value: "boy" }, { label: "Not sure yet", value: "unsure" }]} />
      : <Chips label="Girl or boy" value={form.sex} onChange={(value) => edit("sex", (current) => ({ ...current, sex: value === form.sex ? "" : value as ChildForm["sex"] }))}
        options={[{ label: "Girl", value: "girl" }, { label: "Boy", value: "boy" }]} />}
  </View>;
  return (
    <Screen title={child ? "Baby profile" : "Add your baby"} subtitle="Only a name is needed. Everything else can wait." back scrollRef={scroller}>
      {kept && <View style={{ gap: 8 }}>
        {fromEarlier && <Notice>Restored what you typed earlier.</Notice>}
        <Button variant="ghost" title="Discard what you typed" onPress={discard} />
      </View>}
      <View style={{ gap: 10 }}>
        <Copy kind="label">Is your baby here yet?</Copy>
        <StageOptions labels={{ expecting: "Still expecting", here: "Baby’s here" }} value={form.stage ?? null}
          onChoose={(stage) => { stageFromToday.current = false; edit("stage", (current) => ({ ...current, stage })); }} />
      </View>
      {(form.stage || child) && <>
        <Field label="Name or nickname" capitalize="words" value={form.name} onChange={(name) => edit("name", (current) => ({ ...current, name }))} placeholder="Their name or a nickname" maxLength={120} />
        {expecting && <>
          <DateField label="Due date" value={form.due} onChange={(due) => edit("due", (current) => chooseDue(current, due, today))} dateOnly optional />
          <View style={{ gap: 8 }}>
            <Copy kind="small" tone="muted">Or how far along are you?</Copy>
            <Pair>
              <Half><Field label="Weeks" numeric value={form.weeks} maxLength={4} placeholder="0"
                onChange={(weeks) => edit("due", (current) => typeProgress({ ...current, days: form.days }, { weeks }, today))} /></Half>
              <Half><Field label="Days" numeric value={form.days} maxLength={4} placeholder="0"
                onChange={(days) => edit("due", (current) => typeProgress({ ...current, weeks: form.weeks }, { days }, today))} /></Half>
            </Pair>
            {progressProblem(form) ? <Copy kind="small" tone="error">{progressProblem(form)}</Copy>
              : !!form.due && !!(form.weeks || form.days) && <Copy numeric kind="small" tone="muted">{dueSaid(form.due)}</Copy>}
          </View>
          {!!child?.birth_date && <Notice>Saving this removes the birth date.</Notice>}
        </>}
        {here && <View style={{ gap: 8 }}>
          <DateField label="Birth date" value={form.birth} onChange={(birth) => edit("birth", (current) => ({ ...current, birth }))} dateOnly optional maximumDate={today} />
          {!child?.birth_date && form.birth === dayKey(today) && <Copy kind="small" tone="muted">Set to today. Change it if it was another day.</Copy>}
        </View>}
        {sex}
        {here && <Disclosure title={hasMore ? "More details" : "Add more details"} startOpen={hasMore}>
          <View style={{ gap: 8 }}>
            <Copy kind="small">Units</Copy>
            <Chips label="Units" value={form.unit} onChange={(unit) => switchUnit(unit as ChildForm["unit"])}
              options={[{ label: "lb and in", value: "imperial" }, { label: "kg and cm", value: "metric" }]} />
          </View>
          {form.unit === "imperial" ? <Pair>
            <Half><Field label="Weight, lb" numeric value={form.lb} maxLength={6} onChange={(lb) => edit("weight", (current) => ({ ...current, ...typedWeight(form), lb, grams: null }))} /></Half>
            <Half><Field label="and oz" numeric value={form.oz} maxLength={6} onChange={(oz) => edit("weight", (current) => ({ ...current, ...typedWeight(form), oz, grams: null }))} /></Half>
          </Pair> : <Field label="Weight, kg" numeric value={form.kg} maxLength={6} onChange={(kg) => edit("weight", (current) => ({ ...current, ...typedWeight(form), kg, grams: null }))} />}
          <Field label={form.unit === "imperial" ? "Length, in" : "Length, cm"} numeric value={form.length} maxLength={6} onChange={(length) => edit("length", (current) => ({ ...current, length, cm: null }))} />
          <Field label="Weeks pregnant at birth" numeric value={form.weeksAtBirth} maxLength={4} onChange={(weeksAtBirth) => edit("weeksAtBirth", (current) => ({ ...current, weeksAtBirth }))} />
          <View style={{ gap: 8 }}>
            <Copy kind="small">How are you feeding?</Copy>
            <Chips label="How are you feeding" value={form.feeding || "unsure"} onChange={(value) => edit("feeding", (current) => ({ ...current, feeding: value === "unsure" ? "" : value as ChildForm["feeding"] }))}
              options={[{ label: "Nursing", value: "nursing" }, { label: "Bottle", value: "bottle" }, { label: "Both", value: "both" }, { label: "Not sure", value: "unsure" }]} />
          </View>
          {!!form.due && <DateField label="Due date" value={form.due} onChange={(due) => edit("due", (current) => chooseDue(current, due, today))} dateOnly optional />}
        </Disclosure>}
        {contactsOn(b.state.bootstrap) && <Disclosure title="Baby’s doctor" detail="Adds a call button on Help" startOpen={!!toDoctor || !!details.doctor || edits.touched.includes("doctorName") || edits.touched.includes("doctorPhone")}>
          <Field label="Name" value={form.doctorName} maxLength={120} onChange={(doctorName) => edit("doctorName", (current) => ({ ...current, doctorName }))} />
          <Field label="Phone" purpose="phone" value={form.doctorPhone} maxLength={40} onChange={(doctorPhone) => edit("doctorPhone", (current) => ({ ...current, doctorPhone }))} />
        </Disclosure>}
        {!!error && <Notice error>{error}</Notice>}
        <Button title="Save profile" size="lg" busy={busy} onPress={() => void save()} />
        {child && <Row title="What shows" detail="Choose the buttons on Today and Tracker" icon="options-outline" onPress={() => router.push({ pathname: "/what-shows", params: { child: child.id } })} />}
      </>}
      {child && (
        <Button
          variant="destructive"
          title="Remove this profile"
          busy={busy}
          onPress={() =>
            Alert.alert(
              "Remove this child profile?",
              "Saved entries remain in your personal history without this profile. Review or export anything you need first.",
              [
                { text: "Keep profile", style: "cancel" },
                {
                  text: "Remove profile",
                  style: "destructive",
                  onPress: () => {
                    if (working.current) return;
                    working.current = true;
                    setBusy(true);
                    setError("");
                    void b.api
                      .deleteChild(child, b.state.bootstrap!.generation)
                      .then(() => {
                        finished.current = true;
                        return b.commit((s) => withChildDraft(s, slot, null, generation));
                      })
                      .then(() => b.refresh())
                      .then(() => router.back())
                      .catch((e) => setError(messageFor(e)))
                      .finally(() => {
                        working.current = false;
                        setBusy(false);
                      });
                  },
                },
              ]
            )
          }
        />
      )}
    </Screen>
  );
}
