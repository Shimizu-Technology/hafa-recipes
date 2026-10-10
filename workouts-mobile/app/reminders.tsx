import { router } from "expo-router";
import { useTraining } from "@/lib/context";
import { useEffect, useState } from "react";
import { Button, Card, Choice, Copy, Field, Notice, Screen } from "@/components/ui";
import { useReminders } from "@/components/reminders-provider";
import { reminderErrors, type ReminderSettings } from "@/lib/reminders";
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export default function Reminders() {
  const { controller, state } = useReminders();
  const { enrollment } = useTraining();
  const [draft, setDraft] = useState<ReminderSettings | null>(null);
  const [time, setTime] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (state.ready && !draft) {
      setDraft(state.settings);
      setTime(`${String(state.settings.hour).padStart(2, "0")}:${String(state.settings.minute).padStart(2, "0")}`);
    }
  }, [state.ready, draft, state.settings]);
  async function save() {
    if (!draft || !controller) return;
    const match = /^(\d{2}):(\d{2})$/.exec(time);
    if (!match) {
      setError("Choose a time in HH:MM format, such as 18:30.");
      return;
    }
    const settings = { ...draft, hour: Number(match[1]), minute: Number(match[2]) };
    const errors = reminderErrors(settings);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await controller.save(settings);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen back title="A helpful nudge." subtitle="Optional device alerts, without changing your training records.">
      {draft ? (
        <>
          <Card>
            <Choice
              label="Rest timer alerts"
              detail="Use the actual saved timer deadline while the app is in the background."
              selected={draft.rest_enabled}
              onPress={() => {
                if (!busy) setDraft({ ...draft, rest_enabled: !draft.rest_enabled });
              }}
            />
            <Choice
              label="Weekly routine reminders"
              detail="Reminders follow the days and time you choose; they do not mark a planned session complete."
              selected={draft.weekly_enabled}
              onPress={() => {
                if (!busy) setDraft({ ...draft, weekly_enabled: !draft.weekly_enabled });
              }}
            />
            {draft.weekly_enabled && (
              <>
                {days.map((day, index) => (
                  <Choice
                    key={day}
                    label={day}
                    selected={draft.days.includes(index)}
                    onPress={() => {
                      if (!busy)
                        setDraft({
                          ...draft,
                          days: draft.days.includes(index)
                            ? draft.days.filter((value) => value !== index)
                            : [...draft.days, index].sort(),
                        });
                    }}
                  />
                ))}
                <Field
                  label="Reminder time · HH:MM"
                  value={time}
                  onChange={(value) => {
                    if (!busy) setTime(value);
                  }}
                />
                <Copy>
                  Device-local time · {Intl.DateTimeFormat().resolvedOptions().timeZone}. Your training plan’s saved
                  timezone remains separate.
                </Copy>
              </>
            )}
            <Button
              title="Save reminder choices"
              busy={busy}
              onPress={() => {
                void save();
              }}
            />
          </Card>
          {saved && <Notice>Reminder choices saved on this device.</Notice>}
          <Notice>
            {state.permission === "granted"
              ? "Device notifications are allowed."
              : state.permission === "denied"
                ? "Device alerts are not allowed. Your saved preferences and in-app timers remain available."
                : state.permission === "unavailable"
                  ? "Device alerts need an installed native build. In-app timers remain available."
                  : "Device permission has not been requested yet."}
          </Notice>
          <Copy>
            Alerts are generic and do not include your measurements, health details or workout prescriptions. The device
            controls delivery; a scheduled alert never completes a set or session.
          </Copy>
          <Button
            title="Manage device notification permission"
            secondary
            disabled={!controller || busy}
            onPress={() => {
              void controller?.openSettings().catch((e) => setError((e as Error).message));
            }}
          />
        </>
      ) : enrollment?.enrolled ? (
        <Copy>Loading your optional reminder choices…</Copy>
      ) : (
        <>
          <Notice>Set up your Workouts account before saving reminder choices.</Notice>
          <Button title="Set up my training" onPress={() => router.push("/onboarding")} />
        </>
      )}
      {!!(error || state.error) && (
        <>
          <Notice error>{error || state.error}</Notice>
          <Button
            title="Retry loading reminder choices"
            secondary
            disabled={!controller || busy}
            onPress={() => {
              void controller?.load().catch(controller.report);
            }}
          />
        </>
      )}
    </Screen>
  );
}
