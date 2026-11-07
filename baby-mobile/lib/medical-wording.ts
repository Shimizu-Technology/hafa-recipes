/** Agent-reviewed 2026-11-07 for private family use by Leon’s decision.
 * Not clinician-reviewed. Public/paid release needs clinician review and WHO permission.
 * See medical/AGENT_REVIEW_2026-11-07.md for item verdicts and current sources.
 */
export const cdcWarningSignsUrl = "https://www.cdc.gov/hearher/maternal-warning-signs/index.html";
export const cdcWarningSignsSource = "CDC, Hear Her: Urgent Maternal Warning Signs";
/** CDC, Hear Her; rechecked live 2026-11-07. */
export const cdcWarningSignsLine = "Urgent maternal warning signs, during pregnancy and in the year after delivery.";

/** CDC wording retained alongside agent-reviewed E1/E3. */
export const cdcMovementOpening = "Urgent maternal warning signs, during pregnancy and in the year after delivery. Seek medical care immediately if you experience any signs or symptoms that are listed below.";
export const cdcMovementSign = "Baby's movement stopping or slowing during pregnancy";
export const cdcMovementDetail = "You feel that your baby has stopped moving or your baby is moving less than before. There is no specific number of movements that is considered normal. A change in your baby's movement is what is important.";

/** Reviewed F3/F4. No timing rule or “okay” result. Unknown week retains the preterm warning. */
export function contractionGuidance(pregnancyWeek: number | undefined): string {
  return pregnancyWeek === undefined || pregnancyWeek < 37
    ? "Before 37 weeks, don’t wait if you have any signs of preterm labor. Call your care team right away or go to the hospital. Signs include regular or frequent contractions or tightening, often painless; mild abdominal cramps with or without diarrhea; watery, bloody or mucus discharge, or more discharge; pelvic or lower belly pressure; a constant low, dull backache; or your water breaking with a gush or trickle."
    : "If you think you’re in labor or aren’t sure, call your care team. Go to the hospital if your water breaks without contractions, you bleed heavily, have constant severe pain, or your baby moves less.";
}
export const contractionSourceUrl = "https://www.acog.org/womens-health/faqs/how-to-tell-when-labor-begins";
export const pretermSourceUrl = "https://www.acog.org/womens-health/faqs/preterm-labor-and-birth";
export const medlinePretermSourceUrl = "https://medlineplus.gov/ency/patientinstructions/000486.htm";
export const babyFeverUrl = "https://www.healthychildren.org/English/health-issues/conditions/fever/Pages/Fever-and-Your-Baby.aspx";
export const babyFeverLine = "For a baby 3 months or younger, call the doctor immediately at 100.4°F (38°C) or higher, even without other symptoms. AAP uses this fever cutoff for rectal, mouth, ear and forehead readings; underarm fever may have a lower cutoff.";


export const babyIllnessUrl = "https://www.healthychildren.org/English/tips-tools/symptom-checker/Pages/symptomviewer.aspx?symptom=Newborn+Illness+-+How+to+Recognize";
export const babyBreathingUrl = "https://www.healthychildren.org/English/tips-tools/symptom-checker/Pages/symptomviewer.aspx?symptom=Breathing+Trouble";
export const babyTemperatureNote = "Rectal readings are most reliable for infants. AAP advises against ear thermometers under 6 months. For fever under 12 weeks, do not give fever medicine before being seen.";
export const babyEmergencySigns = [
  "Not breathing or severe trouble breathing: struggling for each breath, or barely able to cry.",
  "Blue or gray lips, tongue or face.",
  "Can’t be woken, not moving or very weak.",
  "New moaning or grunting with each breath.",
  "Choked on something that could be stuck in the throat.",
  "Passed out.",
] as const;
export const newbornErSigns = [
  "Any trouble breathing in a baby under 1 year.",
  "Green vomit (bile).",
  "Floppy or decreased muscle tone.",
  "A weak suck or difficulty keeping up sucking.",
  "A weak or strange cry.",
] as const;
export const feedingWarningSigns = [
  "Breastfeeding fewer than 8 times in 24 hours most days.",
  "Not seeing or hearing swallowing, trouble staying latched, clicking sounds, or fussiness after breastfeeding.",
  "Continued weight loss after day 5.",
  "Fewer than 6 wet diapers and fewer than 3 stools per day by 5 days old.",
  "Skin that looks yellow.",
] as const;
export const postpartumBloodPressureUrl = "https://www.acog.org/womens-health/experts-and-stories/the-latest/3-conditions-to-watch-for-after-childbirth";
export const postpartumBloodPressureLine = "Call your doctor right away if you check your blood pressure and get a systolic reading of 140 mm Hg or higher and/or a diastolic reading of 90 mm Hg or higher.";
export const postpartumBloodPressureRoute = "If you can’t reach your ob-gyn, or if you feel you need immediate care, call 911 or go to the hospital.";

/** CDC’s warning signs were rechecked live on 2026-11-07. Urgent actions stay before any disclosure. */
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
    note: "We haven’t confirmed this number connects from Guam yet. If it doesn’t, call or text 988 for crisis support. In an emergency, call 911.",
    actions: [{ label: "Call 1-833-TLC-MAMA (1-833-852-6262)", url: "tel:18338526262" }, { label: "Text 1-833-TLC-MAMA (1-833-852-6262)", url: "sms:18338526262" }] },
];

export const cdcReuseNote = "CDC material is available free on CDC’s website. Its use does not imply CDC, HHS or US Government endorsement of Håfa Baby or Shimizu Technology.";
