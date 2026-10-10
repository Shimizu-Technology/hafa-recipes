import { router } from "expo-router";
import { Linking, Platform } from "react-native";
import { useState } from "react";
import { Button, Card, Copy, Notice, Screen, useColors } from "@/components/ui";
export default function HafaApps() {
  const c = useColors();
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
      title="Two apps.
One Håfa account."
      subtitle="Cook well. Train your way."
    >
      <Card tone="hero">
        <Copy kind="label" color="#DDEBCB">
          THE HÅFA FAMILY
        </Copy>
        <Copy kind="heading" color="#FFFFFF">
          Useful routines for everyday life.
        </Copy>
        <Copy color="#E1EDD9">
          Recipes organizes your cooking inspiration. Workouts turns training inspiration into a routine you can follow.
        </Copy>
      </Card>
      <Card>
        <Copy kind="heading">Håfa Recipes</Copy>
        <Copy color={c.muted}>
          Keep recipes, plan meals, and organize your groceries. Use the same sign-in method as Workouts.
        </Copy>
        <Button
          title="Open Håfa Recipes"
          secondary
          icon="arrow-up-right-box"
          onPress={() => {
            void openRecipes();
          }}
        />
      </Card>
      <Notice>
        Sharing an account does not share your training profile, health information, or recipe library. Any data
        connection needs your separate permission.
      </Notice>
      <Button
        title="Choose Recipes connection permissions"
        secondary
        onPress={() => router.push("/recipes-connection")}
      />
      <Button title="Export or remove account data" secondary onPress={() => router.push("/account-data")} />
      <Copy kind="heading">You're in control</Copy>
      <Copy>
        Deleting the whole Håfa account erases both apps’ data. Removing only one product’s data preserves your login
        and the other product.
      </Copy>
      {!!error && <Notice error>{error}</Notice>}
    </Screen>
  );
}
