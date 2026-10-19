import { Children, type PropsWithChildren } from "react";
import { View, useWindowDimensions } from "react-native";
import { contentWidth, spacing } from "@/constants/theme";

/** Keep phone cards readable; use the extra width on tablets and desktop. */
export function useWorkoutGalleryColumns() {
  const { width, fontScale } = useWindowDimensions();
  return Math.min(width, contentWidth) - 40 >= 560 && fontScale < 1.3 ? 2 : 1;
}

export function WorkoutGallery({ children }: PropsWithChildren) {
  const columns = useWorkoutGalleryColumns();
  return <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.md }}>
    {Children.map(children, child => child == null ? null : <View style={{ width: columns === 2 ? "48.5%" : "100%" }}>{child}</View>)}
  </View>;
}
