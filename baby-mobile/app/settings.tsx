import { deviceWorkCount, recoverySummary } from "@/lib/outbox";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking, ScrollView, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
import { useBaby } from "@/lib/context";
import { messageFor } from "@/lib/models";
import { Button, Copy, Grouped, Notice, Row, Screen, useColors } from "@/components/ui";
import { SettingsGroup } from "@/components/settings-group";
import { initials } from "@/components/tab-stack";
import { removedWarning, waitingShareCount, useWaitingShareCount } from "@/lib/waiting-shares";
import { babyDetailLine } from "@/lib/child-setup";
import { babyLabel, canAddBaby, canChangeBaby, familyOpen, familySpaces, remindersOn } from "../lib/spaces";

/** Her initials, in the same blush tile as the icons on the rows under it. */
function InitialsTile({ text }: { text: string }) {
  const c = useColors();
  return <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
    <View style={{ minWidth: 40, minHeight: 40, paddingHorizontal: 4, borderRadius: 20, backgroundColor: c.placeholder, alignItems: "center", justifyContent: "center" }}>
      <Copy kind="label" tone="accent" limit={1.4}>{text}</Copy>
    </View>
  </View>;
}
export default function Settings() {
  const b = useBaby(), waiting = useWaitingShareCount(),
    profile = b.state.bootstrap!.profile,
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    working = useRef(false),
    scroller = useRef<ScrollView>(null);
  const { section } = useLocalSearchParams<{ section?: string }>();
  // What went wrong shows at the top, and the button that failed may be far below it.
  useEffect(() => { if (error) scroller.current?.scrollTo({ y: 0 }); }, [error]);
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  // Ask's "Review AI permission" and any older link. Replaced, so Back returns to where it came from.
  if (section === "ai") return <Redirect href="/privacy-data" />;
  const name = profile.display_name.trim(), letters = initials(name),
    babies = b.state.bootstrap!.children.filter((child) => canChangeBaby(b.state.bootstrap, child)),
    addable = canAddBaby(b.state.bootstrap);
  return (
    <Screen scrollRef={scroller} title="Settings" back>
      {!!error && <Notice error>{error}</Notice>}
      <Grouped>
        {name ? <Row title={name} detail="Your details" {...(letters ? { leading: <InitialsTile text={letters} /> } : { icon: "person-outline" as const })} onPress={() => router.push("/profile")} />
          : <Row title="Add your name" detail={familyOpen(b.state.bootstrap) ? "So your family can see who logged what" : "It puts your initials at the top of the app"} icon="person-add-outline" onPress={() => router.push("/profile")} />}
        <Row title="Help" detail="Urgent warning signs and numbers to call" icon="medkit-outline" onPress={() => router.push("/help")} />
      </Grouped>
      {(addable || babies.length > 0) && <SettingsGroup title="Your little ones">
        {babies.map((child) => (
          <Row
            key={child.id}
            title={babyLabel(child, b.state.bootstrap)}
            numericDetail
            detail={babyDetailLine(child)}
            icon="person-outline"
            onPress={() => router.push({ pathname: "/child", params: { id: child.id } })}
          />
        ))}
        {addable && <Row title="Add a baby profile" icon="add" onPress={() => router.push("/child")} />}
      </SettingsGroup>}
      <Grouped>
        {familyOpen(b.state.bootstrap) && <Row title="Family" detail={familySpaces(b.state.bootstrap)[0]?.role === "caregiver" ? "You’re helping as a caregiver" : familySpaces(b.state.bootstrap).length ? "Who’s here, and invites" : "Share with another parent or caregiver"} icon="people-outline" onPress={() => router.push("/family")} />}
        {remindersOn(b.state.bootstrap) && <Row title="Reminders" detail="Feed, calendar and timers, and quiet hours" icon="alarm-outline" onPress={() => router.push("/reminders")} />}
        <Row
          title="Notifications"
          detail="Opens your phone’s Settings"
          icon="notifications-outline"
          onPress={() =>
            void Linking.openSettings().catch(() =>
              setError("Open your phone’s Settings to change notification permissions.")
            )
          }
        />
        {/* Waiting changes shouldn't need finding. Otherwise this lives on Privacy & data. */}
        {(deviceWorkCount(b.state) > 0 || waiting > 0) && <Row
          title="Saved changes & recovery"
          numericDetail
          detail={`${recoverySummary(b.state)}${waiting ? ` · ${waiting} ${waiting === 1 ? "share" : "shares"} waiting` : ""} · ${b.online ? "Online" : "Offline"}`}
          icon="cloud-upload-outline"
          onPress={() => router.push("/sync")}
        />}
        <Row title="Privacy & data" detail={`AI is ${profile.ai_consent ? "on" : "off"} · Export · Recovery · Delete`} icon="shield-checkmark-outline" onPress={() => router.push("/privacy-data")} />
      </Grouped>
      <Button
        secondary
        title="Sign out"
        busy={busy}
        onPress={async () => {
          const waiting = await waitingShareCount(), work = deviceWorkCount(b.state);
          if (work > 0 || waiting)
            Alert.alert(
              waiting ? "Sign out and clear this phone?" : "You have changes on this device",
              `${waiting ? removedWarning(waiting) + " " : ""}Signing out removes unsynced entries and unfinished drafts from this phone. Review them first to save or keep what you need.`,
              [
                { text: "Keep working", style: "cancel" },
                { text: "Review changes", onPress: () => router.push("/sync") },
                { text: "Sign out and clear device", style: "destructive", onPress: () => void run(b.signOut) },
              ]
            );
          else void run(b.signOut);
        }}
      />
      <Copy align="center" kind="small" tone="muted">
        Håfa Baby · {Constants.expoConfig?.version ?? "1.0.0"}
        {Constants.nativeBuildVersion ? " (" + Constants.nativeBuildVersion + ")" : ""}
        {"\n"}A private space for your growing family.
      </Copy>
    </Screen>
  );
}
