import { WorkoutInstructions } from "@/components/workout-instructions";
import { useState } from "react";
import { Share, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Choice,
  Copy,
  Empty,
  Field,
  IconButton,
  ListGroup,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionHeader,
  Sheet,
  Skeleton,
  SkeletonCard,
  Stack,
  useToast,
} from "@/components/ui";
import { CreditLine, SourceArtwork } from "@/components/discover-card";
import { SourceImage } from "@/components/source-image";
import { radii } from "@/constants/theme";
import { useTraining } from "@/lib/context";
import {
  DISCOVER_STALE_MS,
  creatorCredit,
  discoverKeys,
  prescriptionLine,
  formatSeconds,
  type DiscoverDetail,
  type ReportCategory,
} from "@/lib/discover";
import type { Workout } from "@/lib/models";
import { blockSummary } from "@/lib/amrap-editor";
import { workoutMeta } from "@/lib/plan-presentation";
import { blockedContributorsKey, contributorName } from "@/lib/safety";
import { discoverShareText } from "@/lib/discover-share";
import { SourcePlayback } from "@/components/source-playback";

const reportCategories: Array<{ value: ReportCategory; label: string; detail: string }> = [
  { value: "unsafe", label: "Unsafe exercise advice", detail: "Could hurt someone who follows it" },
  { value: "inappropriate", label: "Inappropriate content", detail: "Offensive title, notes or source" },
  { value: "spam", label: "Spam or advertising", detail: "Not a real workout" },
  { value: "copyright", label: "Copyright", detail: "Shared without the creator’s permission" },
  { value: "impersonation", label: "Impersonation", detail: "Pretends to be someone else" },
  { value: "other", label: "Something else", detail: "Tell us what’s wrong" },
];
type SheetMode = "menu" | "report" | "block" | "saved" | null;

export default function DiscoverWorkout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, owner, enrollment } = useTraining();
  const cache = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: discoverKeys.detail(owner, enrollment?.generation, id),
    queryFn: ({ signal }) => api.discoverWorkout(id, signal),
    staleTime: DISCOVER_STALE_MS,
    retry: (count, error) => ![404, 503].includes((error as { status?: number }).status ?? 0) && count < 1,
  });
  const item = q.data;
  const [sheet, setSheet] = useState<SheetMode>(null);
  const [busy, setBusy] = useState<"save" | "coach" | "unpublish" | "report" | "block" | null>(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState<ReportCategory>();
  const [details, setDetails] = useState("");
  const status = (q.error as { status?: number } | null)?.status;
  const generation = enrollment?.enrolled ? enrollment.generation : null;

  async function saveCopy(): Promise<Workout | null> {
    if (!item || generation == null) return null;
    const saved = await api.saveDiscovered(item.id, generation);
    cache.setQueryData<DiscoverDetail>(discoverKeys.detail(owner, enrollment?.generation, id), (old) =>
      old ? { ...old, saved_workout_id: saved.id } : old
    );
    void cache.invalidateQueries({ queryKey: [owner, "discover", "feed"] });
    void cache.invalidateQueries({ queryKey: [owner, "library"] });
    return saved;
  }
  async function save() {
    setBusy("save");
    setError("");
    try {
      if (await saveCopy()) {
        toast("Saved to your library");
        setSheet("saved");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function schedule() {
    if (!item || generation == null || busy) return;
    setBusy("save"); setError("");
    try {
      const id = item.is_owner ? item.id : item.saved_workout_id ?? (await saveCopy())?.id;
      if (id) { setSheet(null); router.push({ pathname: "/schedule-once", params: { workout_id: id } }); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function askCoach() {
    if (!item) return;
    setBusy("coach");
    setError("");
    try {
      // The coach talks about workouts in your library, so save a private copy first.
      const workout = item.saved_workout_id ? await api.workout(item.saved_workout_id) : await saveCopy();
      if (!workout) return;
      if (!item.saved_workout_id) toast("Saved a private copy to your library");
      router.push({ pathname: "/coach", params: { workout_id: workout.id, revision: String(workout.revision) } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function unpublish() {
    if (!item || generation == null) return;
    setBusy("unpublish");
    setError("");
    try {
      await api.unpublishWorkout(item.id, generation);
      void cache.invalidateQueries({ queryKey: discoverKeys.all(owner) });
      void cache.invalidateQueries({ queryKey: [owner, "workout", item.id] });
      toast("Removed from Discover");
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function report() {
    if (!item || !category) return;
    setBusy("report");
    try {
      await api.reportDiscovered(item.id, category, details);
      setSheet(null);
      setCategory(undefined);
      setDetails("");
      toast("Thanks. We’ll review this workout.");
    } catch (e) {
      setError((e as Error).message);
      setSheet(null);
    } finally {
      setBusy(null);
    }
  }
  async function block() {
    if (!item) return;
    setBusy("block");
    try {
      const blocked = await api.blockDiscoverContributor(item.id);
      setSheet(null);
      toast(`Blocked ${contributorName(blocked.display_name)}`);
      void cache.invalidateQueries({ queryKey: blockedContributorsKey(owner, enrollment?.generation) });
      router.back();
      // Refetch the mounted feed so the contributor's cards disappear; drop the stale detail.
      cache.removeQueries({ queryKey: discoverKeys.detail(owner, enrollment?.generation, id) });
      void cache.resetQueries({ queryKey: [owner, "discover", "feed"] });
      void cache.invalidateQueries({ queryKey: [owner, "discover", "contributors"] });
    } catch (e) {
      setError((e as Error).message);
      setSheet(null);
    } finally {
      setBusy(null);
    }
  }
  async function share() {
    if (!item) return;
    try {
      await Share.share({ message: discoverShareText(item) });
    } catch {
      setError("Couldn’t open sharing. Try again.");
    }
  }
  const workout = item?.workout;
  const credit = item ? creatorCredit(item) : null;
  const savedId = item?.saved_workout_id;
  const hero = q.isPending ? (
    <Skeleton height={220} radius={radii.xl - 4} />
  ) : item && workout ? (
    <View style={{ borderRadius: radii.xl - 4, overflow: "hidden" }}>
      {item.thumbnail_url ? <SourceImage uri={item.thumbnail_url} label={item.title} cover
        fallback={<SourceArtwork platform={item.source_platform} height={220} />} />
        : <SourceArtwork platform={item.source_platform} height={220} />}
    </View>
  ) : undefined;
  const title = item?.title ?? (q.isPending ? "Loading workout…" : "Discover");
  const meta = item ? workoutMeta({ minutes: item.estimated_minutes, exercises: item.exercise_count,
    equipment: item.equipment_required.length ? item.equipment_required : ["No equipment"] }) : undefined;
  return (
    <Screen
      back
      title={title}
      // The cover leads; the title and meta line follow it in the page body.
      hideTitle
      action={
        item ? (
          <Row gap={8}>
            {!item.is_owner && (
              <IconButton
                icon="chatbubble-ellipses-outline"
                label={savedId ? "Ask the coach about this workout" : "Ask the coach about this workout. Saves a private copy first"}
                disabled={generation == null || !!busy}
                onPress={() => void askCoach()}
              />
            )}
            <IconButton icon="share-outline" label="Share this workout" onPress={() => void share()} />
            {!item.is_owner && (
              <IconButton icon="ellipsis-horizontal" label="More options" onPress={() => setSheet("menu")} />
            )}
          </Row>
        ) : undefined
      }
    >
      {hero}
      <Stack gap={6}>
        <Copy kind="title">{title}</Copy>
        {!!meta && <Copy tone="muted">{meta}</Copy>}
      </Stack>
      {q.isPending ? (
        <SkeletonCard lines={3} label="Loading workout" />
      ) : status === 503 ? (
        <Empty
          mark
          icon="compass-outline"
          title="Discover is getting ready"
          description="Shared workouts will show up here soon. Your library isn’t affected."
          action={<Button title="Open your library" variant="secondary" onPress={() => router.navigate("/(tabs)/library")} />}
        />
      ) : status === 404 ? (
        <Empty
          icon="eye-off-outline"
          title="This workout isn’t in Discover anymore"
          description="Its owner may have removed it. Copies already saved to libraries are still there."
          action={<Button title="Back to Discover" variant="secondary" onPress={() => router.navigate("/(tabs)/discover")} />}
        />
      ) : q.error || !item || !workout ? (
        <>
          <Notice>{q.error?.message ?? "Couldn’t load this workout."}</Notice>
          <Button title="Try again" variant="secondary" onPress={() => void q.refetch()} />
        </>
      ) : (
        <>
          {(credit || item.contributor) && (
            <View style={{ gap: 6 }}>
              {!!credit && <CreditLine platform={item.source_platform} text={`Original by ${credit}`} />}
              <Copy kind="small" tone="muted">
                {item.is_owner ? "You shared this to Discover" : `Shared by ${item.contributor.display_name}`}
              </Copy>
            </View>
          )}
          {!!item.equipment_optional.length && (
            <Copy kind="small" tone="muted">Optional · {item.equipment_optional.join(", ")}</Copy>
          )}

          {item.is_owner ? (
            <>
              <Button
                title="Open in your library"
                icon="albums-outline"
                size="lg"
                onPress={() => router.push({ pathname: "/workout/[id]", params: { id: item.id } })}
              />
              <ListGroup>
                <ListRow
                  icon="eye-off-outline"
                  title="Remove from Discover"
                  detail="People who already saved it keep their copy. Your notes and training stay private."
                  value={busy === "unpublish" ? "Removing…" : undefined}
                  disabled={generation == null || busy === "unpublish"}
                  onPress={() => void unpublish()}
                />
              </ListGroup>
            </>
          ) : savedId ? (
            <Button
              title="Open in your library"
              icon="checkmark-circle"
              size="lg"
              onPress={() => router.push({ pathname: "/workout/[id]", params: { id: savedId } })}
            />
          ) : (
            <Button
              title="Save to library"
              icon="bookmark-outline"
              size="lg"
              haptic="success"
              busy={busy === "save"}
              disabled={generation == null || !!busy}
              accessibilityHint="Saves a private copy you can train with, edit and add to a plan"
              onPress={() => void save()}
            />
          )}
          {generation == null && !item.is_owner && (
            <Notice>Finish setting up Håfa Workouts to save workouts from Discover.</Notice>
          )}
          {!!error && <Notice error>{error}</Notice>}

          {generation != null && <ListGroup><ListRow icon="calendar-outline" title="Schedule" detail={item.is_owner ? "Choose a date for this workout" : savedId ? "Choose a date for your saved copy" : "Save a private copy and choose a date"} disabled={!!busy} onPress={() => void schedule()} /></ListGroup>}
          <SourcePlayback key={item.source_url} url={item.source_url} title={item.title} />

          <SectionHeader title="The workout" />
          <WorkoutInstructions instructions={workout.instructions} />
          {workout.blocks.map((block, index) => (
            <Card key={block.id ?? index}>
              <Copy kind="caption" tone="accent">
                {[
                  block.label || `Block ${index + 1}`,
                  blockSummary(block, block.label),
                  block.rest_between_rounds_seconds ? `${formatSeconds(block.rest_between_rounds_seconds)} between rounds` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Copy>
              {block.exercises.map((exercise, i) => (
                <Row key={i} gap={14} align="flex-start">
                  <Copy kind="numericSmall" tone="muted" style={{ width: 24 }}>
                    {i + 1}
                  </Copy>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Copy kind="label">{exercise.name}</Copy>
                    <Copy kind="small" tone="muted">
                      {prescriptionLine(exercise)}
                      {exercise.instructions ? `\n${exercise.instructions}` : ""}
                    </Copy>
                  </View>
                </Row>
              ))}
            </Card>
          ))}
          <Copy kind="small" tone="muted">
            Shared from {credit ?? "a Håfa member"}. Watch the original for form cues, and adjust anything that doesn’t
            feel right for your body.
          </Copy>
        </>
      )}

      <Sheet visible={sheet === "menu"} onClose={() => setSheet(null)} title="Workout options">
        <ListRow icon="flag-outline" title="Report this workout" onPress={() => setSheet("report")} />
        <ListRow
          icon="ban-outline"
          title={`Block ${item?.contributor.display_name ?? "this member"}`}
          destructive
          onPress={() => setSheet("block")}
        />
      </Sheet>
      <Sheet visible={sheet === "report"} onClose={() => setSheet(null)} title="Report this workout">
        <Copy tone="muted">Reports go to the Håfa team. The person who shared it isn’t told who reported it.</Copy>
        {reportCategories.map((option) => (
          <Choice role="radio"
            key={option.value}
            label={option.label}
            detail={option.detail}
            selected={category === option.value}
            onPress={() => setCategory(option.value)}
          />
        ))}
        <Field label="Anything else?" optional value={details} onChange={setDetails} multiline placeholder="What should we look at?" />
        <Button
          title="Send report"
          variant="destructive"
          busy={busy === "report"}
          disabled={!category}
          onPress={() => void report()}
        />
      </Sheet>
      <Sheet visible={sheet === "block"} onClose={() => setSheet(null)} title={`Block ${item?.contributor.display_name ?? "this member"}?`}>
        <Copy>
          You won’t see their workouts in Discover or their recipes in Håfa Recipes. They aren’t told. You can unblock them
          later in Settings → Safety Center in either app.
        </Copy>
        <Button title="Block" variant="destructive" busy={busy === "block"} onPress={() => void block()} />
        <Button title="Cancel" variant="ghost" onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet visible={sheet === "saved"} onClose={() => setSheet(null)} title="Saved to your library">
        <Copy tone="muted">It’s a private copy now. Train with it, change it, or build it into your week.</Copy>
        {!!savedId && (
          <>
            <Button
              title="Open saved workout"
              icon="albums-outline"
              onPress={() => {
                setSheet(null);
                router.push({ pathname: "/workout/[id]", params: { id: savedId } });
              }}
            />
            <Button
              title="Schedule"
              icon="calendar-outline"
              variant="secondary"
              onPress={() => {
                setSheet(null);
                router.push({ pathname: "/schedule-once", params: { workout_id: savedId } });
              }}
            />
          </>
        )}
      </Sheet>
    </Screen>
  );
}
