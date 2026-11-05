import { useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { useBaby } from "@/lib/context";
import { messageFor, type Child } from "@/lib/models";
import { setTracking } from "@/lib/quick-care";
import { useTodayCare } from "@/lib/today-care";
import { suggestionAnswer, suggestionButtons, suggestionFor, suggestionsOpen, type AskAbout } from "@/lib/tracker-suggestion";
import { Button, Card, Copy, tap, useToast } from "./ui";

function Ask({ child, open, now, onAnswered }: { child: Child; open: AskAbout[]; now: Date; onAnswered: () => void }) {
  const b = useBaby(), toast = useToast(), { fontScale } = useWindowDimensions(),
    diapers = useTodayCare({ kinds: ["diaper"], child: child.id, limit: 5, poll: false }),
    feeds = useTodayCare({ kinds: ["feeding"], child: child.id, limit: 5, poll: false }),
    // A general log from before there were profiles isn't this baby's, and says nothing about them either way.
    own = (rows: typeof diapers.all) => rows.filter((row) => row.child_id === child.id),
    // Only on what the API just said. A log on this phone could be behind what another phone has logged since.
    ask = diapers.read && feeds.read && !diapers.error && !feeds.error ? suggestionFor(open, { diaper: own(diapers.all), feed: own(feeds.all) }, now) : null;
  if (!ask) return null;
  const names = suggestionButtons(ask.id, child).map((tracker) => tracker.label).join(" and "), many = ask.id === "feed" && names.includes(" and ");
  async function answer(keep: boolean) {
    tap();
    onAnswered();
    try {
      await setTracking(b, child, suggestionAnswer(ask!.id, keep));
      if (!keep) toast(`${many ? "They’re" : "It’s"} off. Everything logged stays, and What shows brings ${many ? "them" : "it"} back.`);
    } catch (e) { toast(messageFor(e)); }
  }
  return <Card style={{ gap: 12 }}>
    <View style={{ gap: 4 }}>
      <Copy numeric kind="label">{`No ${ask.id === "diaper" ? "diapers" : "feeds"} logged in ${ask.days} days`}</Copy>
      <Copy kind="small" tone="muted">{`Keep the ${names} button${many ? "s" : ""}, or turn ${many ? "them" : "it"} off? Off only hides ${many ? "them" : "it"}, and you won’t be asked again.`}</Copy>
    </View>
    <View style={{ flexDirection: fontScale >= 1.5 ? "column" : "row", gap: 8 }}>
      <View style={{ flex: fontScale >= 1.5 ? undefined : 1 }}><Button secondary size="lg" title="Keep" onPress={() => void answer(true)} /></View>
      <View style={{ flex: fontScale >= 1.5 ? undefined : 1 }}><Button secondary size="lg" title="Turn off" onPress={() => void answer(false)} /></View>
    </View>
  </Card>;
}

/** One card, once per baby per tracker, from what's logged. It reads nothing at all until the baby's past 12 months. */
export function TrackerSuggestion({ child, today, now }: { child: Child; today: Date; now: Date }) {
  const [answered, setAnswered] = useState<string | null>(null), open = suggestionsOpen(child, today);
  // One a visit: a second question straight after the first would be nagging.
  return open.length && answered !== child.id ? <Ask key={child.id} child={child} open={open} now={now} onAnswered={() => setAnswered(child.id)} /> : null;
}
