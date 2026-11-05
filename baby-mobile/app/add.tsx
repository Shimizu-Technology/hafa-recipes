import { useEffect, useRef } from "react";
import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { Copy, Grouped, Row, Screen, tap } from "@/components/ui";
import { ChildFilter } from "@/components/child-filter";
import { useMinuteClock } from "@/components/care-glance";
import { QuickPanels, quickFace, useLogFlow, useQuickLog } from "@/components/quick-log";
import { TrackerTile } from "@/components/more-logs";
import { SavedLog, TrackerPanel } from "@/components/tracker-panel";
import { kindIcon } from "@/components/record-row";
import { useBaby } from "@/lib/context";
import { useTodayCare } from "@/lib/today-care";
import { profileToday, timingChild, trackerStage } from "@/lib/timing";
import type { Child } from "@/lib/models";
import { keepItems, trackerById, trackerOn, trackersFor, type Tracker } from "../lib/trackers";

const tileRow = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;

/** Everything this baby can log. It opens the same panels as Today, right here, so a feed is Breast, then side. */
function Track({ child, now, stage, scroller }: { child: Child; now: Date; stage: ReturnType<typeof trackerStage>; scroller: React.RefObject<ScrollView | null> }) {
  const b = useBaby(), timeZone = b.state.bootstrap!.profile.timezone,
    // With two babies she can log for either from here, so it says which.
    who = b.state.bootstrap!.children.length > 1 ? child.name : undefined,
    care = useTodayCare({ child: child.id }),
    quick = useQuickLog({ child, rows: care.all, now, who }),
    more = useLogFlow<string>(),
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
  // The pregnancy timers are still here after the birth, behind everything she's likelier to want.
  const others = listed.filter((tracker) => !trackerOn(tracker, stage)), later = (tracker: Tracker) => stage === "born" && tracker.defaultOn.includes("expecting") && tracker.about === "baby",
    quieter = [...others.filter((tracker) => !later(tracker)), ...others.filter(later)];
  const tile = (tracker: Tracker, big: boolean) => <TrackerTile key={tracker.id} tracker={tracker} big={big} {...(tracker.opens === "quick-log" ? quickFace(quick, tracker) : {})}
    open={tracker.opens === "quick-log" || tracker.opens === "panel" ? panel === tracker.id : undefined} onPress={() => open(tracker)} />;
  return <View style={{ gap: 12 }}>
    {/* The padding keeps an open panel clear of the sheet's header, where the heading goes when she's brought up to it. */}
    <View style={{ gap: 8, paddingTop: 30 }}>
      <Copy kind="heading">{who ? `Track for ${who}` : "Track"}</Copy>
      <QuickPanels quick={quick} />
      <SavedLog flow={more} now={now} timeZone={timeZone} />
      {form && <TrackerPanel tracker={form} child={child} now={now} flow={more} />}
      <View style={tileRow}>{listed.filter((tracker) => trackerOn(tracker, stage)).map((tracker) => tile(tracker, true))}</View>
    </View>
    <View style={{ gap: 8 }}>
      <Copy kind="small" tone="muted">More to track</Copy>
      <View style={tileRow}>{quieter.map((tracker) => tile(tracker, false))}</View>
    </View>
  </View>;
}

export default function Add() {
  const b = useBaby(), now = useMinuteClock(), scroller = useRef<ScrollView>(null),
    today = profileToday(now, b.state.bootstrap!.profile.timezone),
    child = timingChild(b.state, today);
  return (
    <Screen title="Add" close scrollRef={scroller}>
      {child ? <>
        {b.state.bootstrap!.children.length > 1 && <ChildFilter only={child.id} />}
        <Track child={child} now={now} stage={trackerStage(child, today)} scroller={scroller} />
      </> : <Row title="Set up your baby" detail="Tracking starts here, whether you’re expecting or your baby’s here" icon="person-add-outline" onPress={() => router.replace("/child")} />}
      <View style={{ gap: 8 }}>
        <Copy kind="heading">Keep</Copy>
        <Grouped>{keepItems.map((item) => (
          <Row
            key={item.kind}
            title={item.title}
            detail={item.detail}
            icon={kindIcon[item.kind]}
            onPress={() => router.replace({ pathname: "/edit", params: { kind: item.kind } })}
          />
        ))}</Grouped>
      </View>
    </Screen>
  );
}
