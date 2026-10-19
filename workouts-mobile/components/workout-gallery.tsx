import { Children, type PropsWithChildren } from "react";
import { View, useWindowDimensions } from "react-native";
import { contentWidth, spacing } from "@/constants/theme";

/** Keep phone cards readable; use the extra width on tablets and desktop. */
export function WorkoutGallery({ children }: PropsWithChildren) {
  const { width, fontScale } = useWindowDimensions();
  const columns = Math.min(width, contentWidth) - 40 >= 560 && fontScale < 1.3 ? 2 : 1;
  return <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.md }}>
    {Children.map(children, child => child == null ? null : <View style={{ width: columns === 2 ? "48.5%" : "100%" }}>{child}</View>)}
  </View>;
}
