import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AccessibilityInfo, Animated, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useBaby } from "@/lib/context";
import { pendingRecords } from "../lib/outbox";
import { messageFor, type BabyRecord, type Child } from "@/lib/models";
import { retimedActions, runningFeed, withFeedAction, type RunningFeed } from "@/lib/feed-reducer";
import { careGlance, nextSide } from "@/lib/care-glance";
import { amendCare, bottleStart, careWrite, changeUnit, lastAmountUnit, logCare, stepAmount, updateCare, type AmountChoice, type BottleChoice } from "@/lib/quick-care";
import { careSummary, contentWords, friendlyTime } from "@/lib/care-format";
import { activeTimer, clockText, type FeedSide } from "@/lib/feed-timer";
import { feedWrite, finishFeed, startFeed, switchFeed, undoShown } from "@/lib/running-feed";
import { router } from "expo-router";
import { Icon, KeyboardDone, PressTarget, easeOut, fonts, radii, tap, typeScale, useColors, useToast, type IconName } from "./ui";
import { useReducedMotion } from "./motion";
import { useSecondClock } from "./feed-timer";
import { TimeChip, TimeChoices, type PastDay } from "./quick-time";
import { zonedInstant } from "@/lib/tracker";
import { trackerRoute, trackers, type Tracker } from "../lib/trackers";

const quickTiles = trackers.filter((tracker) => tracker.opens === "quick-log");
const word = { left: "Left", right: "Right", both: "Both" } as const;
const other = (side: FeedSide): FeedSide => (side === "left" ? "right" : "left");
/** Every night target is at least this tall. */
export const quickTarget = 56;

export type Saved = { key: number; label: string; undo?: () => Promise<unknown>; recordId?: string; at?: string; follow?: "note" | "color";
  /** A held tap: Undo goes at this moment, whatever else happens on screen, so it never outlasts the hold. */
  until?: number;
  /** Faded out, but still holding its place, so the tiles under it don't jump. See `keepPlace`. */
  faded?: boolean };
/** The row's time is up, where tiles sit right under it: it fades and they stay put, in case a thumb is on its way to one. */
export const keepPlace = (saved: Saved) => (current: Saved | null) => (current?.key === saved.key ? { ...current, faded: true } : current);
const placeBack = (current: Saved | null) => (current?.faded ? null : current);
/** She's gone, so it can give its place back without moving anything under her. */
export function usePlaceBackOnLeaving(setSaved: (change: typeof placeBack) => void) {
  useFocusEffect(useCallback(() => () => setSaved(placeBack), []));
}
type PoopColor = NonNullable<BabyRecord["data"]["color"]>;
const swatches: { label: string; value?: PoopColor; fill?: string }[] = [
  { label: "Black", value: "black", fill: "#1A1512" }, { label: "Green", value: "green", fill: "#5E6B38" }, { label: "Yellow", value: "yellow", fill: "#D8AE3F" },
  { label: "Brown", value: "brown", fill: "#7A5230" }, { label: "Red", value: "red", fill: "#B3392F" }, { label: "White", value: "white", fill: "#F7F3EA" }, { label: "Other" },
];
const diaperChoices = [{ label: "Pee", type: "wet" }, { label: "Poo", type: "dirty" }, { label: "Both", type: "both" }, { label: "Dry", type: "dry" }] as const;
type DiaperType = (typeof diaperChoices)[number]["type"];

/** One big choice inside a panel or running card. `strong` marks the suggested one. */
export function Option({ label, detail, hint, strong, height = 76, wraps, onPress }: { label: string; detail?: string; hint?: string; strong?: boolean; height?: number;
  /** One of too many for a row, so it wraps rather than splitting a word. */
  wraps?: boolean; onPress: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="button" accessibilityLabel={detail ? `${label}, ${detail}` : label} accessibilityHint={hint} onPress={onPress}
    style={{ flexGrow: 1, flexBasis: fontScale >= 1.5 ? "100%" : wraps ? "30%" : 0, minWidth: 0, minHeight: Math.max(quickTarget, height), borderRadius: 20, paddingVertical: 8, paddingHorizontal: 6,
      alignItems: "center", justifyContent: "center", backgroundColor: strong ? c.action : c.tile }}>
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 18, lineHeight: 23, textAlign: "center", color: strong ? c.onAction : c.text }}>{label}</Text>
    {!!detail && <Text key={`d:${fontScale}`} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15, textAlign: "center", color: strong ? c.onAction : c.muted }}>{detail}</Text>}
  </PressTarget>;
}

/** The dock's four tiles, in the thumb's reach just above the tab bar. */
function Tile({ icon, label, hint, primary, open, many, onPress }: { icon: IconName; label: string; hint?: string; primary?: boolean; open?: boolean;
  /** More than a row's worth, so they wrap rather than squeeze. */
  many?: boolean; onPress: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ expanded: !!open }} onPress={onPress}
    style={{ flexGrow: 1, flexBasis: fontScale >= 2 ? "100%" : fontScale >= 1.3 ? "45%" : many ? "22%" : 0, minWidth: 0, minHeight: 76, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radii.tile,
      alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: primary ? c.action : c.surface,
      borderWidth: 2, borderColor: open ? c.accent : "transparent" }}>
    <Icon name={icon} size={24} color={primary ? c.onAction : c.accentText} />
    {/* One word stays whole, a little smaller if four tiles share the row. */}
    <Text key={fontScale} maxFontSizeMultiplier={0} numberOfLines={label.includes(" ") ? undefined : 1} adjustsFontSizeToFit={!label.includes(" ")} minimumFontScale={0.8}
      style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 16, textAlign: "center", color: primary ? c.onAction : c.text }}>{label}</Text>
  </PressTarget>;
}

/** The running feed: side and elapsed time, Switch and Done. Ignoring it is fine; the feed is already saved. */
function RunningCard({ feed, timeZone, onSwitch, onDone }: { feed: RunningFeed; timeZone?: string | null; onSwitch: () => void; onDone: () => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), now = useSecondClock(true),
    open = feed.segments[feed.segments.length - 1], side = open.side,
    earlier = feed.segments.slice(0, -1)
      .map((s) => `${word[s.side]} ${clockText(new Date(s.ended_at!).getTime() - new Date(s.started_at).getTime())}`).join(", "),
    spent = clockText(now.getTime() - new Date(open.started_at).getTime()),
    stacked = fontScale >= 1.3;
  return <View style={{ backgroundColor: c.surface, borderRadius: radii.card, padding: 12, gap: 10 }}>
    <View style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "flex-start" : "flex-end", justifyContent: "space-between", gap: 10, paddingHorizontal: 4 }}>
      {/* Read as one line, and not again every second. */}
      <PressTarget accessibilityRole="button" accessibilityLabel={`Feeding, ${side} side, started ${friendlyTime(feed.started_at, now, timeZone)}`} accessibilityHint="Opens this feed"
        onPress={() => router.push({ pathname: "/record/[id]", params: { id: feed.record.id } })} style={{ flexShrink: 0, minHeight: 56 }}>
        <Text key={`e:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.footnote, fontFamily: fonts.semibold, color: c.accentText }}>Feeding</Text>
        <Text key={`t:${fontScale}`} maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 34, lineHeight: 40, color: c.text, fontVariant: ["tabular-nums"] }}>{`${word[side]} · ${spent}`}</Text>
      </PressTarget>
      <Text key={`c:${fontScale}`} maxFontSizeMultiplier={0} style={{ flexShrink: 1, ...typeScale.caption, color: c.muted, textAlign: stacked ? "left" : "right" }}>
        {earlier || "You can put the phone down. It stays saved."}
      </Text>
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Option label={`Switch to ${word[other(side)]}`} height={64} onPress={onSwitch} />
      <Option label="Done" strong height={64} hint="Records how long this feed took" onPress={onDone} />
    </View>
  </View>;
}

/** The optional row after a diaper: colour for a poo, and a note. Skipping it costs nothing. */
function Follow({ colors, color, undone, onColor, onNote, onFocusChange }: { colors: boolean; color?: PoopColor; undone: { current: boolean }; onColor: (value?: PoopColor) => void; onNote: (note: string) => void; onFocusChange: (holding: boolean) => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), input = useRef<TextInput>(null), [note, setNote] = useState(""), [other, setOther] = useState(false),
    latest = useRef({ note: "", sent: "", onNote });
  latest.current.note = note;
  latest.current.onNote = onNote;
  const send = () => {
    const text = latest.current.note.trim();
    if (text !== latest.current.sent) { latest.current.sent = text; latest.current.onNote(text); }
  };
  // The row can leave while she's mid-note (the next log, or a tab with the keyboard still up). What she wrote stays,
  // unless she undid the entry.
  useEffect(() => () => { if (!undone.current) send(); }, []);
  return <View style={{ gap: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
    {colors && <View accessibilityRole="radiogroup" accessibilityLabel="Colour" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {swatches.map((swatch) => {
        const on = swatch.value ? color === swatch.value : other;
        return <PressTarget key={swatch.label} accessibilityRole="radio" accessibilityLabel={swatch.label} accessibilityState={{ selected: on }}
          onPress={() => {
            tap();
            // Other has no stored colour: she says what it was in the note.
            if (!swatch.value) { setOther(!other); if (color) onColor(undefined); if (!other) input.current?.focus(); return; }
            setOther(false);
            onColor(on ? undefined : swatch.value);
          }}
          style={{ flexGrow: 1, flexBasis: fontScale >= 1.3 ? "30%" : "22%", minWidth: 0, minHeight: quickTarget, borderRadius: 16, paddingVertical: 6, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: on ? c.action : c.tile }}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: swatch.fill ?? "transparent", borderWidth: 1, borderColor: c.outline }} />
          <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15, color: on ? c.onAction : c.text }}>{swatch.label}</Text>
        </PressTarget>;
      })}
    </View>}
    <TextInput key={fontScale} ref={input} accessibilityLabel="Add a note" value={note} onChangeText={setNote} placeholder={other ? "What colour? (optional)" : "Add a note (optional)"} placeholderTextColor={c.muted}
      returnKeyType="done" maxLength={1000} maxFontSizeMultiplier={0} onFocus={() => onFocusChange(true)}
      onBlur={() => { send(); onFocusChange(false); }}
      style={{ minHeight: 52, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: c.tile, color: c.text, fontFamily: fonts.regular, fontSize: 16, lineHeight: 21 }} />
  </View>;
}

/** What just saved, with Undo. It fades on its own; nothing here needs an answer. */
export function SavedRow({ saved, compact, color, now, day, timeZone, onUndo, onGone, onMove, onColor, onNote }: { saved: Saved;
  /** Another log is open: one line with Undo, so the dock never buries the page. */
  compact?: boolean;
  color?: PoopColor; now: Date; day?: PastDay; timeZone?: string | null; onUndo: () => void; onGone: () => void;
  onMove: (iso: string | null) => void; onColor: (value?: PoopColor) => void; onNote: (note: string) => void }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), reduced = useReducedMotion(), fade = useRef(new Animated.Value(1)).current,
    [choosing, setChoosing] = useState(false), [holding, setHolding] = useState(false), [touched, setTouched] = useState(0),
    undone = useRef(false),
    touch = () => setTouched((value) => value + 1);
  useEffect(() => {
    if (saved.faded) { fade.setValue(0); return; }
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    fade.setValue(1);
    void AccessibilityInfo.isScreenReaderEnabled().then((reader) => {
      if (!active) return;
      if (reader && !touched) AccessibilityInfo.announceForAccessibility(`${saved.label} saved.${saved.undo ? " Undo available." : ""}`);
      // Never fade while she is choosing a time or writing a note.
      if ((holding || choosing) && !compact) return;
      timer = setTimeout(() => {
        if (reduced) return onGone();
        Animated.timing(fade, { toValue: 0, duration: 240, easing: easeOut, useNativeDriver: true }).start(({ finished }) => { if (finished) onGone(); });
      }, saved.until ? Math.max(0, saved.until - Date.now()) : reader ? 20000 : saved.follow ? 9000 : 6000);
    });
    return () => { active = false; if (timer) clearTimeout(timer); fade.stopAnimation(); };
  }, [saved.key, saved.faded, holding, choosing, touched, compact]);
  return <Animated.View pointerEvents={saved.faded ? "none" : undefined} accessibilityElementsHidden={saved.faded ? true : undefined} importantForAccessibility={saved.faded ? "no-hide-descendants" : undefined}
    style={{ opacity: fade, borderRadius: radii.toast, backgroundColor: c.surface, borderWidth: 1, borderColor: c.outline }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: quickTarget, paddingLeft: 12 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: c.addFill }}>
        <Icon name="checkmark" size={17} color={c.onAdd} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text key={`l:${fontScale}`} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 19, color: c.text }}>{saved.label}</Text>
        <Text key={`s:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, color: c.muted }}>Saved</Text>
      </View>
      {!!saved.at && <TimeChip label={friendlyTime(saved.at, now, timeZone)} open={choosing} onPress={() => { tap(); setChoosing(!choosing); }} />}
      {!!saved.undo && <PressTarget accessibilityRole="button" accessibilityLabel={`Undo ${saved.label}`} onPress={() => { undone.current = true; onUndo(); }}
        style={{ minHeight: quickTarget, minWidth: quickTarget, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" }}>
        <Text key={`u:${fontScale}`} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 20, color: c.accentText }}>Undo</Text>
      </PressTarget>}
    </View>
    {choosing && !compact && !!saved.at && <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
      <TimeChoices value={saved.at} now={now} day={day} timeZone={timeZone} onChange={(iso) => { setChoosing(false); onMove(iso); touch(); }} />
    </View>}
    {!!saved.follow && !compact && <Follow colors={saved.follow === "color"} color={color} undone={undone} onFocusChange={setHolding}
      onColor={(value) => { onColor(value); touch(); }} onNote={(note) => { onNote(note); touch(); }} />}
  </Animated.View>;
}

/** A panel above the tiles: what it's for, and when it happened. */
export function Panel({ title, detail, at, now, day, timeZone, needTime, onTime, children }: { title: string; detail?: string; at: string | null; now: Date; day?: PastDay; timeZone?: string | null;
  /** She tried to save on another day before saying when. */
  needTime?: boolean; onTime: (iso: string | null) => void; children: React.ReactNode }) {
  // On another day "now" would be wrong, so the times are already open, and asking. Nothing saves until she answers.
  const c = useColors(), { fontScale } = useWindowDimensions(), [open, setOpen] = useState(!!day),
    showing = open || !!needTime, asking = !!day && !at;
  return <View style={{ backgroundColor: c.surface, borderRadius: radii.card, padding: 12, gap: 10 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <Text key={fontScale} maxFontSizeMultiplier={0} style={{ flexShrink: 1, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 19, color: c.text, paddingHorizontal: 2 }}>
        {title}{detail ? <Text style={{ fontFamily: fonts.regular, fontSize: 13, color: c.muted }}>{`  ${detail}`}</Text> : null}
      </Text>
      <TimeChip label={at ? friendlyTime(at, now, timeZone) : day ? "Choose a time" : "Now"} open={showing} asking={asking} onPress={() => { tap(); setOpen(!showing); }} />
    </View>
    {needTime && asking && <Text accessibilityLiveRegion="polite" key={`n:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, color: c.accentText, paddingHorizontal: 2 }}>Choose a time first.</Text>}
    {showing && <TimeChoices value={at ?? (day ? zonedInstant(day.key, 12, 0, day.timezone).toISOString() : now.toISOString())} now={now} day={day} timeZone={timeZone} onChange={(iso) => { onTime(iso); setOpen(false); }} />}
    {children}
  </View>;
}

const amountDone = "amount-done";
/** An amount to step up or down, whose middle changes the unit. */
export function AmountStepper({ amount, onChange, note, steps, typing }: { amount: AmountChoice; onChange: (next: AmountChoice) => void; note?: string; steps?: Record<"oz" | "ml", number>;
  /** The number can be typed as well, and nothing typed is an amount of 0. */
  typing?: boolean }) {
  const c = useColors(), { fontScale } = useWindowDimensions(), [text, setText] = useState<string | null>(null),
    unitWord = amount.unit === "oz" ? "oz" : "mL",
    step = (direction: 1 | -1, label: string) => <PressTarget accessibilityRole="button" accessibilityLabel={label} onPress={() => { tap(); setText(null); onChange({ unit: amount.unit, amount: stepAmount(amount, direction, steps) }); }}
      style={{ width: 64, minHeight: quickTarget, alignItems: "center", justifyContent: "center" }}>
      <Icon name={direction > 0 ? "add" : "remove"} size={24} color={c.text} />
    </PressTarget>,
    // Both units in sight, so the one she wants is one tap whatever else is on the panel.
    unit = (value: "oz" | "ml", word: string, spoken: string) => {
      const on = amount.unit === value;
      return <PressTarget key={value} accessibilityRole="radio" accessibilityLabel={spoken} accessibilityState={{ selected: on, checked: on }} onPress={() => { if (on) return; tap(); setText(null); onChange(changeUnit(amount, steps)); }}
        style={{ minWidth: 48, minHeight: 56, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: on ? c.action : "transparent" }}>
        <Text key={fontScale} maxFontSizeMultiplier={1.6} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: on ? c.onAction : c.text }}>{word}</Text>
      </PressTarget>;
    };
  return <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 20, backgroundColor: c.tile }}>
    {step(-1, "Less")}
    <View style={{ flex: 1, minHeight: quickTarget, alignItems: "center", justifyContent: "center", paddingVertical: 4, gap: 2 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8 }}>
        {typing ? <TextInput key={fontScale} accessibilityLabel={`Amount in ${unitWord}`} value={text ?? String(amount.amount)} keyboardType="decimal-pad" selectTextOnFocus maxLength={8} inputAccessoryViewID={amountDone} maxFontSizeMultiplier={0}
          onChangeText={(typed) => { const number = Number(typed); setText(typed); onChange({ unit: amount.unit, amount: typed && number > 0 ? number : 0 }); }}
          style={{ minWidth: 48, minHeight: 44, textAlign: "right", fontFamily: fonts.semibold, fontSize: 20, lineHeight: 25, color: c.text, fontVariant: ["tabular-nums"] }} />
          : <Text key={fontScale} accessibilityLabel={`${amount.amount} ${unitWord}`} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 20, lineHeight: 25, color: c.text, fontVariant: ["tabular-nums"] }}>{String(amount.amount)}</Text>}
        <View accessibilityRole="radiogroup" accessibilityLabel="Unit" style={{ flexDirection: "row", borderRadius: 14, padding: 2, backgroundColor: c.surface }}>
          {unit("oz", "oz", "Ounces")}
          {unit("ml", "mL", "Milliliters")}
        </View>
      </View>
      {!!(note ?? (typing && "Tap the number to type it")) && <Text key={`d:${fontScale}`} maxFontSizeMultiplier={0} style={{ ...typeScale.caption, color: c.muted, textAlign: "center" }}>{note ?? "Tap the number to type it"}</Text>}
      {typing && <KeyboardDone id={amountDone} />}
    </View>
    {step(1, "More")}
  </View>;
}

/** The amount, the unit, and the two milks. Choosing a milk saves it. */
function BottlePanel({ start, detail, at, now, day, timeZone, needTime, onTime, onSave }: { start: BottleChoice; detail?: string; at: string | null; now: Date; day?: PastDay; timeZone?: string | null; needTime?: boolean; onTime: (iso: string | null) => void; onSave: (bottle: Pick<BottleChoice, "amount" | "unit" | "contents">) => void }) {
  const [bottle, setBottle] = useState<AmountChoice>({ amount: start.amount, unit: start.unit }),
    same = start.fromLast && bottle.amount === start.amount && bottle.unit === start.unit;
  return <Panel title="Bottle" detail={detail} at={at} now={now} day={day} timeZone={timeZone} needTime={needTime} onTime={onTime}>
    <AmountStepper amount={bottle} onChange={setBottle} note={same ? "Same as last time" : undefined} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {(["breast_milk", "formula"] as const).map((contents) => <Option key={contents} label={contentWords[contents]} strong={start.contents === contents} height={64}
        onPress={() => onSave({ ...bottle, contents })} />)}
    </View>
  </Panel>;
}

/** What a log's buttons share: its open panel, when it happened, and the row that says it saved. */
export function useLogFlow<P extends string>(pastDay?: PastDay,
  /** Takes over from the row that says it saved, for a page that closes when something's logged. `current` is whether she's still on what she saved from. */
  afterSave?: (saved: Saved, current: boolean) => void) {
  const b = useBaby(), toast = useToast(),
    [panel, setPanel] = useState<P | null>(null),
    [at, setAt] = useState<string | null>(null),
    [saved, setSaved] = useState<Saved | null>(null),
    [needTime, setNeedTime] = useState(false),
    // A ref, not state, so two taps in the same frame cannot both start a write.
    writing = useRef(false),
    keys = useRef(0),
    /** Moves on whenever what's open changes, so a save finishing late leaves what she's doing now alone. */
    views = useRef(0),
    /** When this entry happened. On another day only she can say, so until she has, nothing saves. */
    when = () => {
      if (at) return new Date(at);
      if (!pastDay) return new Date();
      tap();
      setNeedTime(true);
      return null;
    },
    change = (iso: string | null) => { setAt(iso); setNeedTime(false); };
  async function save(label: string, action: () => Promise<() => Promise<unknown>>, details: Pick<Saved, "recordId" | "at" | "follow" | "until"> = {}) {
    if (writing.current) return;
    writing.current = true;
    const view = views.current;
    try {
      const undo = await action(), current = view === views.current;
      tap("success");
      if (current) {
        setPanel(null);
        setAt(null);
        setNeedTime(false);
      }
      const done = { key: ++keys.current, label, undo, ...details };
      if (afterSave) afterSave(done, current); else setSaved(done);
    } catch (e) { toast(messageFor(e)); }
    finally { writing.current = false; }
  }
  /** A follow-up to what just saved. It is its own queued change, so it works offline and Undo still removes the entry. */
  function amend(change: Parameters<typeof amendCare>[2]) {
    if (saved?.recordId) void amendCare(b, saved.recordId, change).catch((e) => toast(messageFor(e)));
  }
  async function undo() {
    if (!saved?.undo) return;
    const action = saved.undo;
    setSaved(null);
    tap();
    try { await action(); } catch (e) { toast(messageFor(e)); }
  }
  function toggle(name: P) {
    tap();
    views.current++;
    setAt(null);
    setNeedTime(false);
    setSaved(placeBack);
    setPanel(panel === name ? null : name);
  }
  /** Something else opened, or the baby changed. */
  function close() {
    views.current++;
    setPanel(null);
    setAt(null);
    setNeedTime(false);
    setSaved(placeBack);
  }
  return { panel, at, saved, setSaved, needTime, when, change, save, amend, undo, toggle, close };
}

type QuickProps = {
  child: Child;
  rows: BabyRecord[];
  now: Date;
  /** Logging a day that isn't today: entries get that day's time, and nothing runs. */
  pastDay?: PastDay;
  /** Where the page doesn't already say whose log this is: the panel and what saved both name the baby. */
  who?: string;
  afterSave?: (saved: Saved, current: boolean) => void;
};
type QuickPanelName = "breast" | "bottle" | "diaper" | "sleep";

/** What the breast, bottle, diaper and sleep panels know and do, so anywhere that shows `QuickPanels` logs the same way. */
export function useQuickLog({ child, rows, now, pastDay, who, afterSave }: QuickProps) {
  const b = useBaby(), toast = useToast(),
    flow = useLogFlow<QuickPanelName>(pastDay, afterSave),
    { when } = flow,
    save: typeof flow.save = (label, action, details) => flow.save(who ? `${label}, for ${who}` : label, action, details),
    timeZone = b.state.bootstrap!.profile.timezone,
    // A timer started on an older build is still running; it finishes on its own card first.
    legacyTimer = activeTimer(b.state)?.child_id === child.id,
    running = pastDay ? undefined : runningFeed(rows, child.id, now),
    next = running ? undefined : nextSide(rows, child.id),
    openSleeps = pastDay ? [] : careGlance(rows, child.id, now, timeZone).openSleeps, openSleep = openSleeps[0],
    last = rows.find((row) => row.kind === "feeding" && row.child_id === child.id && row.data.method === "breast"),
    savedRow = flow.saved?.recordId ? b.records.find((row) => row.id === flow.saved!.recordId) : undefined;
  // A tap meant for one baby can't land on the other.
  useEffect(() => flow.close, [child.id]);
  function toggle(name: QuickPanelName) {
    if (name === "breast" && legacyTimer && !pastDay) return toast("A feeding timer is running. Finish it from the timer above.");
    flow.toggle(name);
  }
  function side(choice: FeedSide | "both") {
    const time = when();
    if (!time) return;
    if (choice === "both") {
      const record = careWrite("feeding", child.id, { method: "breast", side: "both" }, time);
      return save("Both sides", () => (pastDay ? logCare(b, record) : startFeed(b, record)), { recordId: record.id, at: record.occurred_at });
    }
    if (pastDay) {
      const plain = careWrite("feeding", child.id, { method: "breast", side: choice }, time);
      return save(word[choice], () => logCare(b, plain), { recordId: plain.id, at: plain.occurred_at });
    }
    const record = feedWrite(child.id, choice, time);
    return save(word[choice], () => startFeed(b, record), { recordId: record.id, at: record.occurred_at });
  }
  function bottle(choice: Pick<BottleChoice, "amount" | "unit" | "contents">) {
    const time = when();
    if (!time) return;
    const record = careWrite("feeding", child.id, { method: "bottle", amount: choice.amount, unit: choice.unit, ...(choice.contents ? { contents: choice.contents } : {}) }, time);
    return save(`${choice.contents ? contentWords[choice.contents] : "Bottle"}, ${choice.amount} ${choice.unit === "oz" ? "oz" : "mL"}`,
      () => logCare(b, record), { recordId: record.id, at: record.occurred_at });
  }
  function diaper(label: string, type: DiaperType) {
    const time = when();
    if (!time) return;
    const record = careWrite("diaper", child.id, { type }, time);
    return save(label, () => logCare(b, record), { recordId: record.id, at: record.occurred_at, follow: type === "dirty" || type === "both" ? "color" : "note" });
  }
  /** On another day a sleep is logged whole: when it started, and how long. */
  function sleepFor(minutes: number) {
    const start = when();
    if (!start) return;
    const record = careWrite("sleep", child.id, { end_at: new Date(start.getTime() + minutes * 60_000).toISOString() }, start);
    return save(careSummary("sleep", record.data, record.occurred_at), () => logCare(b, record), { recordId: record.id, at: record.occurred_at });
  }
  function sleep() {
    const time = when();
    if (!time) return;
    if (openSleep) {
      // A sleep can't end before it began, even if the chosen time says so.
      const ending = openSleeps.map((row) => ({ row, data: { ...row.data, end_at: new Date(Math.max(time.getTime(), new Date(row.occurred_at).getTime())).toISOString() } }));
      return save(ending.length > 1 ? `${ending.length} sleeps ended` : careSummary("sleep", ending[0].data, openSleep.occurred_at), async () => {
        const undos: (() => Promise<unknown>)[] = [];
        for (const { row, data } of ending) undos.push(await updateCare(b, row, data));
        return async () => { for (const undo of undos) await undo(); };
      });
    }
    const record = careWrite("sleep", child.id, {}, time);
    return save("Sleep started", () => logCare(b, record), { recordId: record.id, at: record.occurred_at });
  }
  /** A Switch or Done waits on this phone as long as Undo is offered, however long that is for her. */
  async function heldTap(label: string, action: (hold: number) => Promise<() => Promise<unknown>>) {
    const shown = undoShown(await AccessibilityInfo.isScreenReaderEnabled().catch(() => false));
    return save(label, () => action(shown + 500), { until: Date.now() + shown });
  }
  return { child, rows, now, pastDay, who, flow, timeZone, legacyTimer, running, next, openSleep, openSleeps, last, savedRow, toggle, side, bottle, diaper, sleepFor, sleep, heldTap };
}
type Quick = ReturnType<typeof useQuickLog>;

/** A quick tile says what's under way, so it reads the same wherever it's shown. */
export function quickFace({ running, legacyTimer, openSleep, openSleeps, pastDay }: Quick, tracker: Tracker): { icon: IconName; label: string; hint: string } {
  if (tracker.id === "breast" && (running || legacyTimer) && !pastDay) return { icon: tracker.icon, label: "Feeding", hint: tracker.detail! };
  if (tracker.id === "sleep" && openSleep) return { icon: "moon", label: "Sleeping", hint: openSleeps.length > 1 ? `${openSleeps.length} sleeps are running. Ends them` : "Ends the current sleep" };
  return { icon: tracker.icon, label: tracker.label, hint: tracker.detail! };
}

/** What just saved, a running feed, and whichever quick panel is open. Its tiles can be anywhere. */
export function QuickPanels({ quick, keepsPlace }: { quick: Quick;
  /** The tiles are right under this, rather than docked at the bottom where it can't move them. */
  keepsPlace?: boolean }) {
  const b = useBaby(), { child, rows, now, pastDay, who, flow, timeZone, running, next, openSleep, openSleeps, last, savedRow, side, bottle, diaper, sleepFor, sleep, heldTap } = quick,
    { panel, at, saved, setSaved, needTime, change, amend, undo } = flow, whose = who ? `For ${who}` : undefined;
  return <>
    {!!saved && <SavedRow key={saved.key} saved={saved} compact={!!panel} now={now} day={pastDay} timeZone={timeZone} color={savedRow?.data.color as PoopColor | undefined} onUndo={() => void undo()}
      onGone={() => setSaved(keepsPlace ? keepPlace(saved) : (current) => (current?.key === saved.key ? null : current))}
      onMove={(iso) => {
        const moved = iso ?? new Date().toISOString();
        setSaved({ ...saved, at: moved });
        // A running feed's time is its start, so the clock on the card follows. The API moves its own copy the same way.
        amend((row) => ({ occurred_at: moved, ...(row.data.actions ? { data: { ...row.data, actions: retimedActions(row.data.actions, moved) } } : {}) }));
      }}
      // An explicit null clears it: the API keeps a field a PATCH leaves out.
      onColor={(color) => amend((row) => ({ data: { ...row.data, color: color ?? null } }))}
      onNote={(note) => amend((row) => (row.body === note ? {} : { body: note }))} />}
    {running && <RunningCard feed={running} timeZone={timeZone}
      onSwitch={() => {
        const at = new Date();
        void heldTap(`Switched to ${word[other(running.segments[running.segments.length - 1].side)]}`, (hold) => switchFeed(b, running, at, hold));
      }}
      onDone={() => {
        const at = new Date(),
          done = withFeedAction(running.record.data, { id: "preview", action: "finish", at: at.toISOString() });
        void heldTap(careSummary("feeding", done, running.started_at), (hold) => finishFeed(b, running, at, hold));
      }} />}
    {panel === "breast" && <Panel title="Which side?" detail={[whose, last?.data.side ? `Last: ${word[last.data.side]}, ${friendlyTime(last.occurred_at, now, timeZone)}` : ""].filter(Boolean).join(" · ") || undefined} at={at} now={now} day={pastDay} timeZone={timeZone} needTime={needTime} onTime={change}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(["left", "right", "both"] as const).map((choice) => <Option key={choice} label={word[choice]} strong={choice === next} detail={choice === next ? "Next" : undefined}
          onPress={() => void side(choice)} />)}
      </View>
    </Panel>}
    {panel === "bottle" && <BottlePanel start={bottleStart(rows, child.id, lastAmountUnit(pendingRecords(b.state)))} detail={whose} at={at} now={now} day={pastDay} timeZone={timeZone} needTime={needTime} onTime={change} onSave={(choice) => void bottle(choice)} />}
    {panel === "diaper" && <Panel title="Diaper" detail={whose} at={at} now={now} day={pastDay} timeZone={timeZone} needTime={needTime} onTime={change}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {diaperChoices.map((choice) => <Option key={choice.type} label={choice.label} onPress={() => void diaper(choice.label, choice.type)} />)}
      </View>
    </Panel>}
    {panel === "sleep" && <Panel title={openSleeps.length > 1 ? `${openSleeps.length} sleeps running` : openSleep ? `Sleeping since ${friendlyTime(openSleep.occurred_at, now, timeZone)}` : pastDay ? "Sleep, how long?" : "Sleep"} detail={whose} at={at} now={now} day={pastDay} timeZone={timeZone} needTime={needTime} onTime={change}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {pastDay ? ([["30 min", 30], ["1 hr", 60], ["2 hr", 120], ["3 hr", 180]] as const).map(([label, minutes]) => <Option key={label} label={label} onPress={() => void sleepFor(minutes)} />)
          : <Option label={openSleeps.length === 2 ? "End both" : openSleeps.length > 2 ? `End all ${openSleeps.length}` : openSleep ? "End" : "Start"} strong onPress={() => void sleep()} />}
      </View>
    </Panel>}
  </>;
}

/** From this size the pages show the tiles in the page rather than docked. */
const tilesInline = 1.5;
export function QuickLog({ tilesAside, tiles = quickTiles, ...props }: QuickProps & {
  /** Another log on the page is open, and may need the keyboard: the tiles step out of its way. A running feed stays. */
  tilesAside?: boolean;
  /** What this baby has on. A tile with no quick panel goes where it goes. */
  tiles?: readonly Tracker[];
}) {
  const quick = useQuickLog(props), { fontScale } = useWindowDimensions();
  usePlaceBackOnLeaving(quick.flow.setSaved);
  return <View style={{ gap: 8 }}>
    <QuickPanels quick={quick} keepsPlace={fontScale >= tilesInline} />
    {!tilesAside && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {tiles.map((tracker, at) => tracker.opens === "quick-log"
        ? <Tile key={tracker.id} primary={at === 0} many={tiles.length > 4} {...quickFace(quick, tracker)} open={quick.flow.panel === tracker.id} onPress={() => quick.toggle(tracker.id as QuickPanelName)} />
        : <Tile key={tracker.id} many={tiles.length > 4} icon={tracker.icon} label={tracker.label} hint={tracker.detail} onPress={() => { tap(); router.push(trackerRoute(tracker)); }} />)}
    </View>}
  </View>;
}
