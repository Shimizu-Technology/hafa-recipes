/**
 * VoiceOver label for a tappable recipe card: the title first, then the short
 * details a sighted user can scan on the card (for example total time).
 */
export function recipeCardAccessibilityLabel(
  title: string,
  details: Array<string | null | undefined | false> = [],
): string {
  const parts = [title.trim() || 'Untitled recipe'];
  for (const detail of details) {
    const value = typeof detail === 'string' ? detail.trim() : '';
    if (value) parts.push(value);
  }
  return parts.join(', ');
}
