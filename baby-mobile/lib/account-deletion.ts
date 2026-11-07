import { Alert } from "react-native";

export function confirmAccountDeletion(remove: () => void, alsoRemoved?: string) {
  Alert.alert(
    "Delete your entire Håfa account?",
    `This also deletes your Recipes and Workouts information. This is permanent. Export anything you need first.${alsoRemoved ? ` ${alsoRemoved}` : ""}`,
    [
      { text: "Keep account", style: "cancel" },
      {
        text: "Delete entire account",
        style: "destructive",
        onPress: () =>
          Alert.alert("Confirm permanent account deletion", "This affects every Håfa app linked to this account.", [
            { text: "Cancel", style: "cancel" },
            { text: "Permanently delete account", style: "destructive", onPress: remove },
          ]),
      },
    ]
  );
}
