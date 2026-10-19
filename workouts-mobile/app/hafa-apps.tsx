import { router } from "expo-router";
import { Image, Linking, Platform } from "react-native";
import { useState } from "react";
import { Card, Copy, ListGroup, ListRow, Notice, Row, Screen, Stack } from "@/components/ui";
import { radii } from "@/constants/theme";

const recipesIcon = require("@/assets/brand/hafa-recipes-icon-240.png");
const workoutsIcon = require("@/assets/brand/hafa-workouts-icon-240.png");
const icon = { width: 76, height: 76, borderRadius: radii.lg - 2 };
export default function HafaApps() {
  const [error, setError] = useState("");
  async function openRecipes() {
    try {
      await Linking.openURL("hafarecipes://");
    } catch {
      try {
        await Linking.openURL(
          Platform.OS === "ios" ? "https://apps.apple.com/app/id6755892896" : "https://hafa-recipes.com"
        );
      } catch {
        setError("Could not open Recipes. Visit hafa-recipes.com to find the available app.");
      }
    }
  }
  return (
    <Screen
      back
      title="Håfa apps"
      subtitle="One account for Recipes and Workouts."
    >
      <Card tone="sunken">
        <Row gap={20} justify="center">
          <Stack gap={8} align="center">
            <Image source={recipesIcon} style={icon} accessibilityLabel="Håfa Recipes icon" />
            <Copy kind="label">Recipes</Copy>
          </Stack>
          <Stack gap={8} align="center">
            <Image source={workoutsIcon} style={icon} accessibilityLabel="Håfa Workouts icon" />
            <Copy kind="label">Workouts</Copy>
          </Stack>
        </Row>
        <Copy kind="heading" align="center">
          Useful routines for everyday life.
        </Copy>
        <Copy tone="muted" align="center">
          Recipes organizes your cooking inspiration. Workouts turns training inspiration into a routine you can follow.
        </Copy>
      </Card>
      <ListGroup>
        <ListRow
          icon="restaurant-outline"
          title="Open Håfa Recipes"
          detail="Keep recipes, plan meals, and organize your groceries. Use the same sign-in method as Workouts."
          trailing="external"
          onPress={() => {
            void openRecipes();
          }}
        />
        <ListRow
          icon="git-compare-outline"
          title="Choose Recipes connection permissions"
          onPress={() => router.push("/recipes-connection")}
        />
        <ListRow icon="download-outline" title="Export or remove account data" onPress={() => router.push("/account-data")} />
      </ListGroup>
      <Notice>
        Sharing an account does not share your training profile, health information, or recipe library. Any data
        connection needs your separate permission.
      </Notice>
      <Copy kind="subheading">You're in control</Copy>
      <Copy tone="muted">
        Deleting the whole Håfa account erases both apps’ data. Removing only one product’s data preserves your login
        and the other product.
      </Copy>
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}
