import { contentWidth, spacing } from "@/constants/theme";
export const WORKOUT_GRID_GAP = 12;
export const largeText = (fontScale: number) => fontScale >= 1.3;
export function workoutGridColumns(width: number, fontScale: number, discover = false) {
  return largeText(fontScale) ? 1 : discover && Math.min(width, contentWidth) - (spacing.lg - 4) * 2 >= 560 ? 3 : 2;
}
export function workoutGridWidth(width: number, fontScale: number, discover = false) {
  const columns = workoutGridColumns(width, fontScale, discover);
  return ((Math.min(width, contentWidth) - (spacing.lg - 4) * 2 - WORKOUT_GRID_GAP * (columns - 1)) / columns);
}

/** Width of one cell in a two-column footer: the screen less the footer's side padding and the gap between cells. */
export function footerCellWidth(width: number, gap = 12) {
  return (Math.min(width, contentWidth) - spacing.md * 2 - gap) / 2;
}
/** Side padding a large footer button keeps around its label (22pt each side; the icon is dropped in the grid). */
const BUTTON_LABEL_PADDING = 44;
/** A semibold capital-led word is about this many ems per character. */
const EM_PER_CHARACTER = 0.6;
/**
 * The most a two-column footer button's label may grow with the text-size setting so its longest word
 * still fits on one line: the label wraps between words but never breaks inside one. Never below 1×.
 */
export function footerLabelScale(title: string, cellWidth: number, fontScale: number, fontSize = 17) {
  const longest = Math.max(1, ...title.split(/\s+/).map((word) => word.length));
  const fits = (cellWidth - BUTTON_LABEL_PADDING) / (longest * EM_PER_CHARACTER * fontSize);
  return Math.max(1, Math.min(fontScale, fits));
}
