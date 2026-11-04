import { Linking, Text, View, useWindowDimensions } from "react-native";
import { Icon, PressTarget, fonts, useColors } from "./ui";

/** Someone else's published words, always with who said them and a way to read the original. */
export function MedicalSource({ source, url }: { source: string; url: string }) {
  const c = useColors(), { fontScale } = useWindowDimensions();
  return <PressTarget accessibilityRole="link" accessibilityLabel={`Source: ${source}`} accessibilityHint="Opens the original page" onPress={() => void Linking.openURL(url).catch(() => undefined)}
    style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 }}>
    <View style={{ flexShrink: 1 }}>
      <Text key={fontScale} maxFontSizeMultiplier={0} style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, color: c.accentText }}>{source}</Text>
    </View>
    <Icon name="open-outline" size={15} color={c.accentText} />
  </PressTarget>;
}
