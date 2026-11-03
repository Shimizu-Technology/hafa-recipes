/** Horizontal room a segment label has: the track's 2pt padding, 2pt gaps, and each segment's 4pt side padding. */
export const SEGMENT_TRACK_PADDING = 2;
export const SEGMENT_GAP = 2;
export const SEGMENT_SIDE_PADDING = 4;
/** Labels never shrink below this share of their normal size. */
export const SEGMENT_MIN_SCALE = 0.5;
/** A hair of slack so a label sized to the exact width does not wrap or get cut by rounding. */
const SEGMENT_SLACK = 0.98;

/**
 * One shared size for every label in a segmented control: the largest scale (at most 1) at which the
 * widest label still fits its equal-width segment. `naturalWidths` are label widths measured at the
 * unshrunk size; returns 1 until the track and every label have been measured.
 */
export function segmentLabelScale(trackWidth: number, naturalWidths: readonly (number | undefined)[]): number {
  const count = naturalWidths.length;
  if (!count || !(trackWidth > 0) || naturalWidths.some(width => !(typeof width === "number" && width > 0))) return 1;
  const segment = (trackWidth - 2 * SEGMENT_TRACK_PADDING - SEGMENT_GAP * (count - 1)) / count;
  const room = segment - 2 * SEGMENT_SIDE_PADDING;
  const widest = Math.max(...(naturalWidths as number[]));
  if (!(room > 0)) return SEGMENT_MIN_SCALE;
  if (widest <= room) return 1;
  return Math.max(SEGMENT_MIN_SCALE, Math.floor((room / widest) * SEGMENT_SLACK * 100) / 100);
}
