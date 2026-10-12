import { useState } from "react";
import { Button, Card, Choice, Copy, Field, Notice } from "./ui";
import { CalendarDate } from "./calendar-date";
import { OptionalNumber } from "./optional-number";
import { scheduleDate, type DeclaredActivity } from "@/lib/profile-context";
export function ActivityContext({
  activities,
  timezone,
  onChange,
  disabled = false
}: {
  disabled?: boolean;
  activities: DeclaredActivity[];
  timezone: string;
  onChange(value: DeclaredActivity[]): void;
}) {
  const [page, setPage] = useState(0);
  const [remove, setRemove] = useState<number | null>(null);
  const offset = Math.min(page * 10, Math.max(0, Math.floor((activities.length - 1) / 10) * 10));
  function update(index: number, change: Partial<DeclaredActivity>) {
    onChange(activities.map((activity, i) => (i === index ? { ...activity, ...change } : activity)));
  }
  function add() {
    if (activities.length >= 500) return;
    let date = "";
    try {
      date = scheduleDate(timezone);
    } catch {}
    setPage(Math.floor(activities.length / 10));
    onChange([...activities, { date, name: "", strenuous: null, duration_minutes: null }]);
  }
  return (
    <>
      <Copy kind="heading">Other activity in your schedule</Copy>
      <Copy>
        Declare basketball, runs or other activity that your plan should make room for. These entries are schedule
        context; they do not create completed sessions or Health records. Add each activity once. Your completed
        training remains in Progress.
      </Copy>
      <Copy kind="small">Dates use your training timezone · {timezone}</Copy>
      {!activities.length && <Copy>No other activity declared.</Copy>}
      {activities.slice(offset, offset + 10).map((activity, localIndex) => {
        const index = offset + localIndex;
        return (
          <Card key={index}>
            <Copy kind="label">Activity declaration {index + 1}</Copy>
            {activity.origin_id ? (
              <>
                <Copy>
                  {activity.date} · {activity.name}
                </Copy>
                <Notice>
                  This entry has external provenance. Manage its originating connection instead of duplicating it
                  manually.
                </Notice>
              </>
            ) : (
              <>
                <Field
                  disabled={disabled}
                  label={`Activity ${index + 1} name`}
                  value={activity.name}
                  onChange={(name) => update(index, { name })}
                  placeholder="Basketball practice"
                />
                <CalendarDate
                  disabled={disabled}
                  label={`Activity ${index + 1} date`}
                  value={activity.date}
                  onChange={(date) => update(index, { date: date ?? "" })}
                />
                <OptionalNumber
                  disabled={disabled}
                  label={`Activity ${index + 1} duration · minutes`}
                  value={activity.duration_minutes}
                  onChange={(duration_minutes) => update(index, { duration_minutes })}
                />
                <Copy>How demanding do you expect this activity to be?</Copy>
                {(
                  [
                    { value: null, label: "Not sure yet" },
                    { value: false, label: "Light / easy" },
                    { value: true, label: "Strenuous" }
                  ] as const
                ).map((choice) => (
                  <Choice
                    disabled={disabled}
                    key={choice.label}
                    label={`Activity ${index + 1} · ${choice.label}`}
                    selected={(activity.strenuous ?? null) === choice.value}
                    onPress={() => update(index, { strenuous: choice.value })}
                  />
                ))}
                <Button
                  title={`Remove activity ${index + 1} declaration`}
                  secondary
                  onPress={() => setRemove(index)}
                  disabled={disabled}
                />
                {remove === index && (
                  <>
                    <Notice>
                      This removes schedule context. It does not delete any completed workout. Save your profile to
                      apply the change.
                    </Notice>
                    <Button
                      title="Confirm remove declaration"
                      secondary
                      onPress={() => {
                        onChange(activities.filter((_, i) => i !== index));
                        setRemove(null);
                      }}
                      disabled={disabled}
                    />
                    <Button title="Keep declaration" secondary onPress={() => setRemove(null)} disabled={disabled} />
                  </>
                )}
              </>
            )}
          </Card>
        );
      })}
      {offset > 0 && (
        <Button
          title="Previous activity declarations"
          secondary
          onPress={() => {
            setPage(Math.max(0, page - 1));
            setRemove(null);
          }}
          disabled={disabled}
        />
      )}
      {offset + 10 < activities.length && (
        <Button
          title="Next activity declarations"
          secondary
          onPress={() => {
            setPage(page + 1);
            setRemove(null);
          }}
          disabled={disabled}
        />
      )}
      <Button
        title="Add activity declaration"
        secondary
        disabled={disabled || activities.length >= 500}
        onPress={add}
      />
    </>
  );
}
