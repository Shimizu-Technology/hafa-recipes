import { useEffect, useRef } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { Copy, Row, Screen, tap, useToast } from "@/components/ui";
import { ChildFilter } from "@/components/child-filter";
import { useMinuteClock } from "@/components/care-glance";
import { LegacyTimer } from "@/components/feed-timer";
import { QuickPanels, quickFace, useLogFlow, useQuickLog, type Saved } from "@/components/quick-log";
import { LogTile, TrackerTile } from "@/components/more-logs";
import { TrackerPanel } from "@/components/tracker-panel";
import { kindIcon } from "@/components/record-row";
import { useBaby } from "@/lib/context";
import { useTodayCare } from "@/lib/today-care";
import { profileToday, timingChild, todayStage, trackerStage } from "@/lib/timing";
import { messageFor, type Child } from "@/lib/models";
import { keepItems, otherStage, trackerById, trackerOn, trackersFor, type Tracker } from "../lib/trackers";

const tileRow = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;

/** Close the sheet. She lands back where she was, with Undo in the toast that outlives it. */
const close = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/(today)"));

/** This baby's main trackers, then what to keep, then the rest of what fits this stage. They open the same panels as Today, right here, so a feed is Breast, then side. */
function Track({ child, now, stage, scroller, opening }: { opening?: string; child: Child; now: Date; stage: ReturnType<typeof trackerStage>; scroller: React.RefObject<ScrollView | null> }) {
  const b = useBaby(), toast = useToast(),
    // With two babies she can log for either from here, so it says which.
    who = b.state.bootstrap!.children.length > 1 ? child.name : undefined,
    care = useTodayCare({ child: child.id }),
    afterSave = ({ label, undo, until }: Saved, current: boolean) => {
      toast(`Saved: ${label}`, { label: "Undo", until, onPress: async () => {
        try { await undo?.(); toast("Undone."); } catch (e) { toast(messageFor(e)); }
      } });
      // She's moved on since she tapped, to the other baby or off this sheet altogether, so it stays where she is.
      if (current) close();
    },
    quick = useQuickLog({ child, rows: care.all, now, who, afterSave }),
    more = useLogFlow<string>(undefined, afterSave),
    listed = trackersFor(stage),
    form = more.panel ? trackerById(more.panel) : undefined,
    panel = quick.flow.panel ?? more.panel,
    closeAll = () => { quick.flow.close(); more.close(); };
  // A tap on the other baby's name closes what's open: its time and whatever's typed were for this one.
  useEffect(() => closeAll, [child.id]);
  // The panel sits at the top of the page, whichever tile opened it, so she's brought back up to it.
  useEffect(() => { if (panel) scroller.current?.scrollTo({ y: 0, animated: true }); }, [panel]);
  function open(tracker: Tracker) {
    if (tracker.opens === "quick-log") { more.close(); return quick.toggle(tracker.id as Parameters<typeof quick.toggle>[0]); }
    if (tracker.opens === "panel") { quick.flow.close(); return more.toggle(tracker.id); }
    tap();
    router.replace(tracker.opens);
  }
  // A tile elsewhere sent her here for this. It opens once; after that the page is hers.
  useEffect(() => { const tracker = opening ? trackerById(opening) : undefined; if (tracker && listed.includes(tracker)) open(tracker); }, []);
  const on = listed.filter((tracker) => trackerOn(tracker, stage, child.details)),
    rest = listed.filter((tracker) => !on.includes(tracker) && (!otherStage(tracker, stage) || (tracker.id === "sleep" && !!quick.openSleep))),
    tile = (tracker: Tracker, big: boolean) => <TrackerTile key={tracker.id} tracker={tracker} big={big} {...(tracker.opens === "quick-log" ? quickFace(quick, tracker) : {})}
      open={tracker.opens === "quick-log" || tracker.opens === "panel" ? panel === tracker.id : undefined} onPress={() => open(tracker)} />,
    group = (title: string, trackers: Tracker[]) => !!trackers.length && <View style={{ gap: 8 }}>
      <Copy kind="label">{title}</Copy>
      <View style={tileRow}>{trackers.map((tracker) => tile(tracker, false))}</View>
    </View>;
  return <>
    {/* The padding keeps an open panel clear of the sheet's header, where the heading goes when she's brought up to it. */}
    <View style={{ gap: 8, paddingTop: 30 }}>
      <Copy kind="heading">{who ? `Track for ${who}` : "Track"}</Copy>
      <LegacyTimer />
      <QuickPanels quick={quick} />
      {form && <TrackerPanel tracker={form} child={child} now={now} flow={more} />}
      <View style={tileRow}>{on.map((tracker) => tile(tracker, true))}</View>
    </View>
    <Keep />
    {group(`For ${child.name}`, rest.filter((tracker) => tracker.about === "baby"))}
    {group("For you", rest.filter((tracker) => tracker.about === "her"))}
    <Row title="What shows" detail="Choose the buttons on Today and Tracker" icon="options-outline" onPress={() => router.replace({ pathname: "/what-shows", params: { child: child.id } })} />
  </>;
}

function Keep() {
  return <View style={{ gap: 8 }}>
    <Copy kind="heading">Keep</Copy>
    <View style={tileRow}>{keepItems.map((item) => <LogTile key={item.kind} icon={kindIcon[item.kind]} label={item.label} hint={item.detail}
      onPress={() => router.replace({ pathname: "/edit", params: { kind: item.kind } })} />)}</View>
  </View>;
}

export default function Add() {
  const b = useBaby(), now = useMinuteClock(), scroller = useRef<ScrollView>(null), { open } = useLocalSearchParams<{ open?: string }>(),
    today = profileToday(now, b.state.bootstrap!.profile.timezone),
    child = timingChild(b.state, today);
  return (
    <Screen title="Add" close scrollRef={scroller}>
      {child ? <>
        {b.state.bootstrap!.children.length > 1 && <ChildFilter only={child.id} />}
        {todayStage(child, today) === "none" && <Row title={`Is ${child.name.trim()} here yet?`} detail="Add a due date or birth date and Today fills in." icon="person-add-outline"
          onPress={() => router.replace({ pathname: "/child", params: { id: child.id } })} />}
        <Track child={child} now={now} stage={trackerStage(child, today)} scroller={scroller} opening={open} />
      </> : <>
        <Row title="Set up your baby" detail="Tracking starts here, whether you’re expecting or your baby’s here" icon="person-add-outline" onPress={() => router.replace("/child")} />
        <Keep />
      </>}
    </Screen>
  );
}
