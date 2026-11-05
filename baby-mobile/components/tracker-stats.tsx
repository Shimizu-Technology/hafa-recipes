import { useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { useBaby } from "@/lib/context";
import { summaryMaxDays } from "@/lib/doctor-summary";
import { basedOn, blankStats, customProblem, nothingYet, ownLatest, statsNote, statsRanges, waitingEntries, type CareStats, type StatsChoice, type StatsDay } from "@/lib/care-stats";
import { duration } from "@/lib/care-format";
import { secondsWords } from "@/lib/contractions";
import { addDays, clockIn, keyDate } from "@/lib/tracker";
import { Button, Card, Copy, Empty, FilterChips, Notice, QuietRow, Section, fonts, useColors } from "./ui";
import { DateField } from "./date-field";
import { trackers } from "../lib/trackers";
import { Legend, SplitBar, StatBars, useSeriesColors, type Bar } from "./stat-bars";

const words = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
/** "7.5h" or "40m", short enough for a bar's cap. */
const shortHours = (minutes: number) => (minutes < 60 ? `${Math.round(minutes)}m` : `${(minutes / 60).toFixed(1).replace(/\.0$/, "")}h`);
const nothing = "–";

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <View accessible accessibilityLabel={[`${label}: ${value}`, note].filter(Boolean).join(", ")} style={{ flexGrow: 1, flexBasis: "40%", minWidth: 124 * Math.min(fontScale, 2), gap: 1 }}>
    <Copy kind="small" tone="muted">{label}</Copy>
    <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 24, lineHeight: 30, color: c.text, fontVariant: ["tabular-nums"] }}>{value}</Text>
    {!!note && <Copy numeric kind="small" tone="muted">{note}</Copy>}
  </View>;
}
/** What an average rests on. Before any finished day has a log, there's nothing yet to rest it on. */
const averageNote = (logged: number, total: number) => (logged ? basedOn(logged, total) : "starts after a full day is logged");
const Tiles = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>{children}</View>;

/** The Tracker's Stats: what was logged, by the API's numbers, and no opinion on any of them. */
export function TrackerStats({ answer, choice, onChoose, today, childId, on, now, growth, onOpen }: {
  answer: { stats?: CareStats; fetchedAt?: Date; error?: string; loading: boolean; refresh: () => void };
  choice: StatsChoice;
  onChoose: (choice: StatsChoice) => void;
  today: string;
  childId: string | null;
  /** The trackers with a button now, for what to say about a blank range. Logs always show, whether it's on or not. */
  on: readonly string[];
  now: Date;
  /** Whether there's a baby to have measurements. */
  growth?: boolean;
  onOpen: (key: string) => void;
}) {
  const b = useBaby(), c = useColors(), colors = useSeriesColors(), timezone = b.state.bootstrap!.profile.timezone, single = [c.progressFill],
    [draft, setDraft] = useState({ from: addDays(today, -13), to: today }),
    problem = choice.range === "custom" ? customProblem(draft.from, draft.to, today) : null,
    stats = answer.stats,
    waiting = stats ? waitingEntries(b.state, childId, stats, timezone) : 0,
    note = stats && answer.fetchedAt ? statsNote(answer.fetchedAt, !!answer.error, waiting, timezone, now) : null,
    rolling = choice.range === "24h",
    pick = (value: string) => onChoose(value === "custom" ? { range: "custom", ...draft } : { range: value as "24h" | "7d" | "30d" }),
    edit = (next: typeof draft) => { setDraft(next); if (!customProblem(next.from, next.to, today)) onChoose({ range: "custom", ...next }); },
    labels = (key: string): [string, string] => [key === today ? "Today" : keyDate(key).toLocaleDateString(undefined, { weekday: "short" }), keyDate(key).toLocaleDateString(undefined, { month: "short", day: "numeric" })],
    bar = (day: StatsDay, values: number[], cap: string, spoken: string): Bar => ({ key: day.date, labels: labels(day.date), values, partial: day.partial && !rolling,
      cap: values.some(Boolean) ? cap : nothing, spoken: `${keyDate(day.date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}. ${values.some(Boolean) ? spoken : "Nothing logged"}.` }),
    days = stats?.days ?? [];
  const logged = stats ? stats.feeding.count + stats.diapers.count + stats.sleep.total_minutes + stats.sleep.open.length + stats.contractions.count + stats.kicks.sessions + (stats.own?.count ?? 0) > 0 : false,
    ownLogs = stats?.own?.logs ?? [], ownOrder = trackers.filter((tracker) => tracker.about === "her").map((tracker) => tracker.dataLabel),
    quiet = stats && logged ? nothingYet(stats, on, rolling) : "",
    averages = !rolling && days.some((day) => !day.partial),
    bothDiapers = days.some((day) => day.diapers.pee + day.diapers.poo + day.diapers.dry > day.diapers.count);
  return <View style={{ gap: 16 }}>
    <FilterChips label="Stats range" value={choice.range} onChange={pick} options={statsRanges} />
    {choice.range === "custom" && <View style={{ gap: 8 }}>
      <DateField dateOnly label="From" value={draft.from} onChange={(from) => edit({ ...draft, from })} />
      <DateField dateOnly label="To" value={draft.to} onChange={(to) => edit({ ...draft, to })} />
      {!!problem && <Notice>{problem}</Notice>}
    </View>}
    {!!answer.error && !stats && <Empty icon="cloud-offline-outline" title="No numbers to show yet" body={`${b.online === false || b.unreachable ? "" : `${answer.error} `}Stats come from Håfa, so they’ll show here once it can be reached.`}
      action={<Button secondary title="Try again" onPress={() => void answer.refresh()} />} />}
    {answer.loading && !stats && <Copy kind="small" tone="muted">Adding it up…</Copy>}
    {!!stats && <>
      <Copy numeric kind="small" tone="muted">{rolling ? `The last 24 hours, up to ${clockIn(new Date(stats.range.end), timezone)}` : `${labels(days[0].date)[1]} to ${labels(days[days.length - 1].date)[1]}`}</Copy>
      {!stats.complete && <Notice>There are more logs in these days than Stats can add up at once, so try fewer days.</Notice>}
      {!!note && <Notice>{note}</Notice>}
      {!logged && (waiting ? <Empty icon="stats-chart-outline" title="Nothing has reached Håfa yet" body="What you’ve logged will add up here once it’s synced." />
        : <Empty icon="stats-chart-outline" title={rolling ? "Nothing logged in the last 24 hours" : "Nothing logged in these days"} body={blankStats(on)} />)}
      {logged && !rolling && days.some((day) => day.partial) && <Copy kind="small" tone="muted">The paler bar is today so far. It isn’t in the averages.</Copy>}
      {stats.feeding.count > 0 && <Section title="Feeding">
          <Card>
            <Tiles>
              <Tile label="Feeds" value={String(stats.feeding.count)} />
              {averages && <Tile label="Per day" value={stats.feeding.average_per_day === null ? nothing : String(stats.feeding.average_per_day)} note={averageNote(stats.feeding.days_logged, stats.feeding.days_total)} />}
              {stats.feeding.average_gap_minutes !== null && <Tile label="Average gap" value={duration(stats.feeding.average_gap_minutes)} note="start to start" />}
            </Tiles>
            <StatBars colors={single} onOpen={onOpen} bars={days.map((day) => bar(day, [day.feeding.count], String(day.feeding.count), words(day.feeding.count, "feed")))} />
            {stats.feeding.left + stats.feeding.right + stats.feeding.both > 0 && <View style={{ gap: 6 }}>
              <Copy kind="label">Sides</Copy>
              <SplitBar colors={colors} values={[stats.feeding.left, stats.feeding.right, stats.feeding.both]} label={`Left ${stats.feeding.left}, right ${stats.feeding.right}, both ${stats.feeding.both}`} />
              <Legend colors={colors} items={[`Left ${stats.feeding.left}`, `Right ${stats.feeding.right}`, `Both ${stats.feeding.both}`]} />
            </View>}
            {stats.feeding.bottle_count > 0 && <Copy numeric kind="small">{[words(stats.feeding.bottle_count, "bottle"), [stats.feeding.bottle_oz && `${stats.feeding.bottle_oz} oz`, stats.feeding.bottle_ml && `${stats.feeding.bottle_ml} mL`].filter(Boolean).join(" and ")].filter(Boolean).join(": ")}</Copy>}
            {stats.feeding.timed_breast_feeds > 0 && <Copy numeric kind="small">{`Breastfeeding: ${duration(stats.feeding.breast_minutes)} over ${words(stats.feeding.timed_breast_feeds, "timed feed")}`}</Copy>}
            {stats.feeding.unknown_end_feeds > 0 && <Copy numeric kind="small" tone="muted">{`${words(stats.feeding.unknown_end_feeds, "feed")} with no end time ${stats.feeding.unknown_end_feeds === 1 ? "isn’t" : "aren’t"} in those minutes.`}</Copy>}
          </Card>
        </Section>}
      {stats.diapers.count > 0 && <Section title="Diapers">
          <Card>
            <Tiles>
              <Tile label="Diapers" value={String(stats.diapers.count)} />
              {averages && <Tile label="Per day" value={stats.diapers.average_per_day === null ? nothing : String(stats.diapers.average_per_day)} note={averageNote(stats.diapers.days_logged, stats.diapers.days_total)} />}
            </Tiles>
            <StatBars colors={colors} onOpen={onOpen} bars={days.map((day) => bar(day, [day.diapers.pee, day.diapers.poo, day.diapers.dry], String(day.diapers.count), `${words(day.diapers.count, "diaper")}: ${day.diapers.pee} pee, ${day.diapers.poo} poo, ${day.diapers.dry} dry`))} />
            <Legend colors={colors} items={[`Pee ${stats.diapers.pee}`, `Poo ${stats.diapers.poo}`, `Dry ${stats.diapers.dry}`]} />
            {bothDiapers && <Copy kind="small" tone="muted">A diaper with both is in pee and in poo. The number on top counts it once.</Copy>}
          </Card>
        </Section>}
      {stats.sleep.total_minutes + stats.sleep.open.length + stats.sleep.unusable > 0 && <Section title="Sleep">
          <Card>
            <Tiles>
              <Tile label={averages ? "Per day" : "Total"} value={averages ? (stats.sleep.average_minutes_per_day === null ? nothing : duration(stats.sleep.average_minutes_per_day)) : duration(stats.sleep.total_minutes)} note={averages ? averageNote(stats.sleep.days_logged, stats.sleep.days_total) : undefined} />
              <Tile label="Longest stretch" value={stats.sleep.longest_minutes ? duration(stats.sleep.longest_minutes) : nothing} />
            </Tiles>
            <StatBars colors={single} onOpen={onOpen} bars={days.map((day) => bar(day, [day.sleep.total_minutes], shortHours(day.sleep.total_minutes), `${duration(day.sleep.total_minutes)} of sleep`))} />
            {stats.sleep.open.length > 0 && <Copy numeric kind="small" tone="muted">{`${words(stats.sleep.open.length, "sleep")} still going will count once ${stats.sleep.open.length === 1 ? "it ends" : "they end"}.`}</Copy>}
            {stats.sleep.unusable > 0 && <Copy numeric kind="small" tone="muted">{`${words(stats.sleep.unusable, "sleep")} with an end before ${stats.sleep.unusable === 1 ? "its" : "their"} start ${stats.sleep.unusable === 1 ? "isn’t" : "aren’t"} counted.`}</Copy>}
          </Card>
        </Section>}
      {stats.contractions.count > 0 && <Section title="Contractions">
        <Card>
          <Tiles>
            <Tile label="Contractions" value={String(stats.contractions.count)} />
            {stats.contractions.average_seconds !== null && <Tile label="Average length" value={secondsWords(stats.contractions.average_seconds)} />}
          </Tiles>
          <StatBars colors={single} onOpen={onOpen} bars={days.map((day) => bar(day, [day.contractions.count], String(day.contractions.count), [words(day.contractions.count, "contraction"), day.contractions.average_seconds !== null ? `about ${secondsWords(day.contractions.average_seconds)} long` : ""].filter(Boolean).join(", ")))} />
        </Card>
      </Section>}
      {stats.kicks.sessions > 0 && <Section title="Kicks">
        <Card>
          <Tiles>
            <Tile label="Sessions" value={String(stats.kicks.sessions)} />
            <Tile label="Movements" value={String(stats.kicks.movements)} />
          </Tiles>
          <StatBars colors={single} onOpen={onOpen} bars={days.map((day) => bar(day, [day.kicks.movements], String(day.kicks.movements), `${words(day.kicks.movements, "movement")} in ${words(day.kicks.sessions, "session")}`))} />
        </Card>
      </Section>}
      {ownLogs.length > 0 && <Section title="Your logs">
        <Card>
          {/* The newest word for word, and how many. Nothing here reads a number or compares it to anything. */}
          {[...ownLogs].sort((x, y) => ownOrder.indexOf(x.label) - ownOrder.indexOf(y.label)).map((log) => {
            const name = trackers.find((tracker) => tracker.dataLabel === log.label)?.label ?? log.label, latest = `Latest: ${ownLatest(log)}, ${labels(log.latest_at.slice(0, 10))[1]}`, count = words(log.count, "entry", "entries");
            return <View key={log.label} accessible accessibilityLabel={`${name}: ${count}. ${latest}`} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 12 }}>
              <View style={{ flexShrink: 1 }}>
                <Copy kind="label">{name}</Copy>
                <Copy numeric kind="small" tone="muted">{latest}</Copy>
              </View>
              <Copy numeric kind="small">{count}</Copy>
            </View>;
          })}
          <StatBars colors={single} onOpen={onOpen} bars={days.map((day) => bar(day, [day.own?.count ?? 0], String(day.own?.count ?? 0), words(day.own?.count ?? 0, "entry", "entries")))} />
        </Card>
      </Section>}
      {!!quiet && <Copy numeric kind="small" tone="muted">{quiet}</Copy>}
    </>}
    {/* It lives here because it's these numbers on paper: it opens on the same days, when they fit on a page. */}
    <View>
      <QuietRow title="Doctor summary" detail="One page to bring to an appointment" onPress={() => router.push({ pathname: "/doctor-summary", params: { child: childId ?? undefined,
        ...(days.length && days.length <= summaryMaxDays ? { from: days[0].date, to: days[days.length - 1].date } : {}) } })} />
      {!!growth && <QuietRow title="Growth" detail="Your measurements on CDC’s WHO charts" onPress={() => router.push("/growth")} />}
    </View>
  </View>;
}
