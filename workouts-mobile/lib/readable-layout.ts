import { contentWidth, spacing } from "@/constants/theme";
export const largeText = (fontScale: number) => fontScale >= 1.3;
export function workoutGridColumns(width: number, fontScale: number, discover = false) {
  return largeText(fontScale) ? 1 : discover && Math.min(width, contentWidth) - (spacing.lg - 4) * 2 >= 560 ? 3 : 2;
}
export function workoutGridWidth(width: number, fontScale: number, discover = false) {
  const columns = workoutGridColumns(width, fontScale, discover);
  return Math.floor((Math.min(width, contentWidth) - (spacing.lg - 4) * 2 - spacing.sm * (columns - 1)) / columns);
}
