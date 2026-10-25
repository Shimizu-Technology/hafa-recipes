import { useRef, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { useAuth, useClerk } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Copy, ListGroup, ListRow, Notice, Screen, SectionHeader, useColors } from "@/components/ui";
import { radii, spacing, typography } from "@/constants/theme";
import { useAccountIdentity } from "@/components/account-identity";
import { suspendNativeSharing } from "@/lib/native-share-session";
import { useTraining } from "@/lib/context";
import { configuration, PRIVACY_POLICY_URL, SUPPORT_URL } from "@/lib/config";
import { logoutBinding } from "@/lib/logout-recovery";

const avatarSize = 56;

/** Who is signed in: photo or initial, name, and email. */
function IdentityCard() {
  const c = useColors();
  const account = useAccountIdentity();
  const identity = { ...account, name: account?.name || account?.email?.split("@")[0] || "Your account" };
  return (
    <View
      accessible
      accessibilityLabel={identity.email ? `Signed in as ${identity.name}, ${identity.email}` : `Signed in as ${identity.name}`}
      style={{
        flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md,
        backgroundColor: c.surface, borderRadius: radii.xl - 4, borderWidth: 1, borderColor: c.border,
      }}
    >
      <View style={{ width: avatarSize, height: avatarSize, borderRadius: radii.full, backgroundColor: c.actionSoft,
        alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {identity.imageUrl ? (
          <Image source={{ uri: identity.imageUrl }} style={{ width: avatarSize, height: avatarSize }} accessibilityIgnoresInvertColors />
        ) : identity.initial ? (
          <Text maxFontSizeMultiplier={1.2} style={[typography.heading, { color: c.onActionSoft }]}>{identity.initial}</Text>
        ) : (
          <Ionicons name="person-outline" size={26} color={c.onActionSoft} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Copy kind="subheading" numberOfLines={1}>{identity.name}</Copy>
        {!!identity.email && <Copy kind="small" tone="muted" numberOfLines={1}>{identity.email}</Copy>}
      </View>
    </View>
  );
}

export default function Settings() {
  const clerk = useClerk();
  const { sessionId, userId } = useAuth();
  const { owner } = useTraining();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signingOut = useRef(false);
  async function openLink(url: string) {
    setError("");
    try {
      await Linking.openURL(url);
    } catch {
      setError(`Could not open ${url}. Try again from a browser.`);
    }
  }
  async function signOut() {
    if (signingOut.current) return;
    if (!sessionId || !userId) { setError("Your sign-in session is still loading. Try signing out again."); return; }
    const originalSession = sessionId;
    const originalBinding = logoutBinding(configuration.clerkEnvironment, configuration.clerkKey, userId);
    signingOut.current = true;
    setBusy(true);
    setError("");
    const sharing = suspendNativeSharing();
    try {
      await sharing.clear;
      await clerk.signOut({ sessionId: originalSession });
      // Clear cached account data only once sign-out succeeded; a failed attempt keeps the screen usable.
      cache.removeQueries({ predicate: query => query.queryKey[0] === owner ||
        (query.queryKey[0] === "identity" && query.queryKey[1] === originalBinding) });
    } catch {
      sharing.resume();
      setError("Could not sign out. Your private drafts remain saved for this account. Try again.");
    } finally {
      signingOut.current = false;
      setBusy(false);
    }
  }
  function confirmSignOut() {
    if (signingOut.current) return;
    Alert.alert(
      "Sign out?",
      "Your private drafts stay on this device for this account. Signing in to another account does not load them.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out", style: "destructive", onPress: () => { void signOut(); } },
      ],
    );
  }
  return (
    <Screen back title="Settings">
      <IdentityCard />
      <SectionHeader title="Training" />
      <ListGroup>
        <ListRow title="Training profile" icon="person-outline" onPress={() => router.push("/profile")} />
        <ListRow title="Measurements" icon="analytics-outline" onPress={() => router.push("/measurements")} />
        <ListRow title="Reminders and rest alerts" icon="notifications-outline" onPress={() => router.push("/reminders")} />
      </ListGroup>
      <SectionHeader title="Connections" />
      <ListGroup>
        <ListRow title="Health connections" icon="heart-outline" onPress={() => router.push("/connections")} />
        <ListRow title="AI preferences" icon="sparkles-outline" onPress={() => router.push("/ai-preferences")} />
        <ListRow title="Håfa apps" icon="apps-outline" detail="Recipes and Workouts, one account" onPress={() => router.push("/hafa-apps")} />
      </ListGroup>
      <SectionHeader title="Privacy" />
      <ListGroup>
        <ListRow title="Safety Center" icon="shield-checkmark-outline" detail="Manage blocked contributors" onPress={() => router.push("/safety")} />
        <ListRow title="Sharing links" icon="link-outline" onPress={() => router.push("/sharing-links")} />
        <ListRow title="Account data and deletion" icon="shield-outline" onPress={() => router.push("/account-data")} />
        <ListRow title="How Workouts uses your data" icon="document-text-outline" onPress={() => router.push("/privacy")} />
        <ListRow title="Privacy policy" icon="open-outline" onPress={() => { void openLink(PRIVACY_POLICY_URL); }} />
        <ListRow title="Help and support" icon="help-circle-outline" onPress={() => { void openLink(SUPPORT_URL); }} />
      </ListGroup>
      {!!error && <Notice error>{error}</Notice>}
      <ListGroup>
        <ListRow title={busy ? "Signing out…" : "Sign out"} icon="log-out-outline" destructive trailing="none"
          disabled={busy} onPress={confirmSignOut} />
      </ListGroup>
      <Copy kind="small" tone="muted" align="center">
        Håfa Workouts {Constants.expoConfig?.version ?? ""}
      </Copy>
    </Screen>
  );
}
