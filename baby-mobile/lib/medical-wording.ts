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

/**
 * The Help screen. AWAITING CLINICIAN REVIEW (MEDICAL_REVIEW A1 to A3, A5, A6). Everything below is CDC's own words,
 * word for word, or a service's own name and number. A1's "Get help now" and A4's 911 sentence aren't CDC's, so they
 * don't ship until a clinician approves them. The packet read these from the 2026-10-26 archive of CDC's page and
 * checked the headings on the live page on 2026-11-04. Whether 1-833-TLC-MAMA connects from Guam is not confirmed.
 */
export const cdcUrgentOpening = "Urgent maternal warning signs, during pregnancy and in the year after delivery. Seek medical care immediately if you experience any signs or symptoms that are listed below. The symptoms below can be a sign of a life-threatening condition.";
export const cdcUrgentSigns: readonly { title: string; detail: string }[] = [
  { title: "Headache that won't go away or gets worse over time", detail: "Feels like the worst headache of your life. Lasts even after treatment with medication and fluid intake. Starts suddenly with severe pain—like a clap of thunder. Throbs and is on one side of your head above your ear. Comes with blurred vision or dizziness." },
  { title: "Dizziness or fainting", detail: "You faint or pass out. You have dizziness and lightheadedness that's ongoing, or comes and goes over many days. You experience a gap in time of which you have no memory." },
  { title: "Changes in your vision", detail: "You see flashes of light or bright spots. You have blind spots or you can't see at all for a short time. Your vision is blurry, you can't focus, or you're seeing double." },
  { title: "Fever of 100.4°F or higher", detail: "You have a temperature of 100.4°F (38°C) or higher." },
  { title: "Extreme swelling of your hands or face", detail: "Swelling in your hands makes it hard to bend your fingers or wear rings. Swelling in your face makes it hard to open your eyes all the way—they feel and look puffy. Your lips and mouth feel swollen or you have a loss of feeling. This swelling is not like the usual slight swelling that most moms have during pregnancy, especially during the last few months of pregnancy." },
  { title: "Thoughts about harming yourself or your baby", detail: "You may think about hurting yourself because you: Feel very sad, hopeless, or not good enough. Don't feel that you have control over your life. Feel extremely worried all the time. You may think about hurting your baby and/or you may have scary thoughts that come when you don't want or that are hard to get rid of." },
  { title: "Trouble Breathing", detail: "You feel short of breath suddenly or over time, as if you can't breathe deeply enough to get enough air in your lungs. Your throat and/or chest feel tight. You have trouble breathing when you're laying down flat, such as needing to prop your head up with pillows to sleep." },
  { title: "Chest pain or fast-beating heart", detail: "You have chest pain, such as: A feeling of tightness or pressure in the center of your chest. Pain that travels to your back, neck, or arm. You have a change in your heartbeat, such as: A fast heartbeat or a pounding in your chest. An irregular heart rate or skipped heartbeats. You feel dizzy, faint, or disoriented. You have trouble catching your breath (talking and breathing are difficult). These symptoms can happen at any time and anywhere or may be triggered by a specific event." },
  { title: "Severe nausea and throwing up", detail: "You feel severely sick to your stomach (nauseous) beyond the normal queasy feeling and throwing up that many moms have in early pregnancy. You are unable to drink for more than 8 hours or eat for more than 24 hours. You throw up and can't keep water or other fluids in your stomach. You have: A dry mouth. Headaches. Confusion. Fever. Dizziness or lightheadedness." },
  { title: "Severe belly pain that doesn't go away", detail: "You have a sharp, stabbing, or cramp-like belly pain that doesn't go away. Your belly pain starts suddenly and is severe, or gets worse over time. You have severe chest, shoulder, or back pain." },
  { title: "Baby's movement stopping or slowing during pregnancy", detail: "You feel that your baby has stopped moving or your baby is moving less than before. There is no specific number of movements that is considered normal. A change in your baby's movement is what is important." },
  { title: "Vaginal bleeding or fluid leaking during pregnancy", detail: "You have any bleeding from your vagina that is more than spotting—like a period. You have fluid leaking out of your vagina. You have vaginal discharge that smells bad." },
  { title: "Vaginal bleeding or discharge after pregnancy", detail: "You have heavy bleeding—soaking through one or more pads in an hour. You pass clots bigger than an egg or you pass tissue. You have vaginal discharge that smells bad." },
  { title: "Severe swelling, redness, or pain of your leg or arm", detail: "Anytime during pregnancy or up to 6 weeks after birth. You have swelling, pain, or tenderness in your leg—usually your calf or in one leg. It may or may not hurt when you touch it. It may hurt when you flex your foot to stand or walk. The painful area can also be red, swollen, and warm to the touch. You have pain, tenderness or swelling in your arm, usually on just one side of your body." },
  { title: "Overwhelming tiredness", detail: "You are suddenly very tired and weak, not like chronic fatigue. You don't have enough energy to go about your day. No matter how much you sleep, you don't feel refreshed. You feel so tired that you don't get up to take care of your baby. You feel sad after having your baby." },
];
export const cdcUrgentClosing = "This list is not meant to cover every symptom you might have. If you feel like something just isn't right, or you aren't sure if it's serious, talk to your health care provider. Be sure to tell them if you are pregnant or were pregnant within the last year.";

/** Numbers to reach someone, with each service's own name. `sms` where the service says it takes texts. */
export const helpLines: readonly { name: string; source?: { name: string; url: string }; note?: string; actions: readonly { label: string; url: string }[] }[] = [
  { name: "911", actions: [{ label: "Call 911", url: "tel:911" }] },
  { name: "988 Suicide & Crisis Lifeline", source: { name: "988lifeline.org", url: "https://988lifeline.org/" },
    actions: [{ label: "Call 988", url: "tel:988" }, { label: "Text 988", url: "sms:988" }] },
  // Remove the note once a call and a text from a Guam phone are recorded.
  { name: "National Maternal Mental Health Hotline", source: { name: "HRSA", url: "https://mchb.hrsa.gov/national-maternal-mental-health-hotline" },
    note: "We haven’t confirmed this number connects from Guam yet. If it doesn’t, call or text 988.",
    actions: [{ label: "Call 1-833-TLC-MAMA (1-833-852-6262)", url: "tel:18338526262" }, { label: "Text 1-833-TLC-MAMA (1-833-852-6262)", url: "sms:18338526262" }] },
];
