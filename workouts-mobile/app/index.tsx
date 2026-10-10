import { useAuth } from "@clerk/expo";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { configuration } from "../lib/config";

export default function FoundationDiagnostic() {
  const { isLoaded } = useAuth();
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#F6F3EC" }}>
    <ScrollView contentContainerStyle={{ padding: 24, gap: 20, width: "100%", maxWidth: 660, alignSelf: "center" }}>
      <Text style={{ color: "#172820", fontSize: 15 }}>Håfa Workouts · development foundation</Text>
      <Text accessibilityRole="header" style={{ color: "#172820", fontSize: 30, fontWeight: "700" }}>Native foundation diagnostic.</Text>
      <View style={{ backgroundColor: "#FFFFFF", borderRadius: 20, padding: 24, gap: 16 }}>
        <Text style={{ color: "#172820", fontSize: 18 }}>{isLoaded ? "Clerk SDK initialized." : "Clerk SDK initialization is pending."}</Text>
        <Text style={{ color: "#172820", fontSize: 17 }}>Expo Router is mounted.</Text>
        <Text style={{ color: "#172820", fontSize: 17 }}>{configuration.apiBase ? "API configuration supplied." : "API configuration is missing."}</Text>
      </View>
      <Text style={{ color: "#172820", fontSize: 17, lineHeight: 26 }}>
        SDK, domain contracts, private storage, tests and native adapters are staged for review.
        The dependent experience slice supplies the training journeys and account controls.
      </Text>
    </ScrollView>
  </SafeAreaView>;
}
