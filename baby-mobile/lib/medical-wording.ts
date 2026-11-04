/**
 * AWAITING CLINICIAN REVIEW. Nothing in this file is approved. See output/hafa-baby-kami-2026-11-04/medical/MEDICAL_REVIEW.md.
 * Until a batch is approved, the plan's medical gate allows only CDC's own words, with attribution and a link.
 * Never add wording of our own here.
 */
export const cdcWarningSignsUrl = "https://www.cdc.gov/hearher/maternal-warning-signs/index.html";
export const cdcWarningSignsSource = "CDC, Hear Her: Urgent Maternal Warning Signs";
/** CDC's words (MEDICAL_REVIEW A1). Read from the 2026-10-26 archive of its page. */
export const cdcWarningSignsLine = "Urgent maternal warning signs, during pregnancy and in the year after delivery.";

/** CDC's words and nothing added (MEDICAL_REVIEW A1, A2 sign 11, E2). E1 and the last sentence of E3 are ours, so they don't ship. */
export const cdcMovementOpening = "Urgent maternal warning signs, during pregnancy and in the year after delivery. Seek medical care immediately if you experience any signs or symptoms that are listed below.";
export const cdcMovementSign = "Baby's movement stopping or slowing during pregnancy";
export const cdcMovementDetail = "You feel that your baby has stopped moving or your baby is moving less than before. There is no specific number of movements that is considered normal. A change in your baby's movement is what is important.";

/**
 * SLOT, deliberately empty. MEDICAL_REVIEW F1, F3 and F4 are ACOG-based or our own wording, not approved, and must not
 * ship. F4 replaces F3 under 37 weeks, which is why a slot takes the week. When a clinician approves them, return the
 * approved text from here; the contraction screen already shows whatever this returns. There is no go-to-hospital rule.
 */
export function contractionGuidance(_pregnancyWeek: number | undefined): string | null {
  return null;
}
