import { Linking } from "react-native";
import { useState } from "react";
import { router } from "expo-router";
import { Button, Card, Copy, Notice, Screen } from "@/components/ui";
export default function HealthRationale() {
  const [error, setError] = useState("");
  const website = process.env.EXPO_PUBLIC_WORKOUTS_WEBSITE_URL;
  return (
    <Screen back title="Your health. Your choices." subtitle="Why Håfa Workouts asks for exercise access.">
      <Card>
        <Copy kind="heading">Read exercise summaries</Copy>
        <Copy>
          With your permission, the app can read workout type, source, start/end and duration from Apple Health or
          Health Connect. It does not request heart rate, sleep, body measurements, calorie or route access.
        </Copy>
        <Copy kind="heading">Separate account and AI choices</Copy>
        <Copy>
          Device permission does not allow server storage or AI coaching automatically. Choose each separately in
          Connections. Restricted or unreviewed sources remain excluded from AI context.
        </Copy>
        <Copy kind="heading">Optional workout writing</Copy>
        <Copy>
          The app can write actual recorded Håfa sessions when you permit it. Planned sessions and modeled calories are
          never written as completed work. Records that cannot represent pauses faithfully remain in the app.
        </Copy>
      </Card>
      <Notice>
        Refresh happens while you use the app. An initial available window is limited to 30 days, followed by available
        provider changes. Apple does not reveal read denial; no visible records does not mean you did not train.
      </Notice>
      <Copy>
        Disconnecting stops new app access and removes imported server projections. It does not remove other apps’
        original Health records or revoke system permissions. You can also manage Håfa Workouts in the Health app’s
        permissions; on Android, use Health Connect settings.
      </Copy>
      <Button title="Read in-app privacy information" secondary onPress={() => router.push("/privacy")} />
      {!!website && (
        <Button
          title="Open full privacy policy"
          secondary
          onPress={() => {
            void Linking.openURL(new URL("/privacy", website).toString()).catch(() =>
              setError("Could not open the policy. In-app privacy information remains available.")
            );
          }}
        />
      )}
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}
