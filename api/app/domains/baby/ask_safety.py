"""Agent-reviewed 2026-11-07 for private family use at Leon's direction; not clinician-reviewed.

Word lists can't be the safety layer: ask_check.py, a model call before and after each answer, is. These patterns run first,
free, with the AI off and on the old path, and they lean toward firing. Urgent replies are fixed here, in the words of CDC,
HHS, 988 and HRSA where those exist. They come before anything that could refuse to answer: the AI being off, a limit, a
budget, consent. Don't try to make these cover everything.
"""

import re
from difflib import get_close_matches
from typing import NamedTuple

BABY_EMERGENCY, BABY_ER, POISONING = "baby_emergency", "baby_er", "poisoning"
URGENT_MATERNAL, HARM, BABY_UNWELL, MENTAL_HEALTH = "urgent_maternal", "harm", "baby_unwell", "mental_health"

CALL_911 = "Please call 911 or go to the nearest emergency room if you are experiencing a medical emergency."
CALL_988 = "Thoughts of harming yourself or your baby, or in crisis? Call or text 988, the Suicide & Crisis Lifeline, any time. It's free and confidential."
CALL_MAMA = (
    "National Maternal Mental Health Hotline. Call or text 1-833-TLC-MAMA (1-833-852-6262). Free, confidential, 24/7, "
    "for pregnant people and new parents."
)
MESSAGES = {
    URGENT_MATERNAL: f"Seek medical care immediately. {CALL_911}",
    HARM: f"{CALL_911}\n\n{CALL_988}\n\n{CALL_MAMA}",
    # AAP-hosted Newborn Illness / Breathing Trouble, rechecked 2026-11-07.
    # https://www.healthychildren.org/English/tips-tools/symptom-checker/Pages/symptomviewer.aspx?symptom=Newborn+Illness+-+How+to+Recognize
    # https://www.healthychildren.org/English/tips-tools/symptom-checker/Pages/symptomviewer.aspx?symptom=Breathing+Trouble
    BABY_EMERGENCY: "Call 911 now. Your baby may be having a life-threatening emergency.",
    BABY_ER: "Go to the emergency room now for your baby.",
    # Poison.org, accessed 2026-11-07. No home treatment or dose calculation.
    POISONING: "If someone collapsed, is having a seizure, has trouble breathing or can’t be woken, call 911 now. For suspected poisoning or an accidental overdose, call US Poison Control now at 1-800-222-1222. Don’t wait for Ask.",
    BABY_UNWELL: "Call your baby's doctor now or seek urgent care. If you think your baby has a life-threatening emergency, call 911.",
}
# Keep both existing sourced replies. These are internal labels; mobile Help values stay unchanged.
MIXED_BABY = {BABY_EMERGENCY: "maternal_baby_emergency", BABY_ER: "maternal_baby_er", BABY_UNWELL: "maternal_baby_unwell"}
for _baby, _mixed in MIXED_BABY.items():
    _ordered = (_baby, URGENT_MATERNAL) if _baby == BABY_EMERGENCY else (URGENT_MATERNAL, _baby)
    MESSAGES[_mixed] = "\n\n".join(MESSAGES[kind] for kind in _ordered)
# Poisoning may coexist with either patient's warning signs; no route replaces another.
for _baby in (None, BABY_EMERGENCY, BABY_ER, BABY_UNWELL):
    for _maternal in (False, True):
        if not _baby and not _maternal:
            continue
        _base = MIXED_BABY[_baby] if _maternal and _baby else URGENT_MATERNAL if _maternal else _baby
        _label = "maternal_poisoning" if _base == URGENT_MATERNAL else _base + "_poisoning"
        MESSAGES[_label] = MESSAGES[_base] + "\n\n" + MESSAGES[POISONING]
POISON_MIXED_RULE = (
    "For poisoning with a maternal urgent sign, use maternal_poisoning. If an infant tier coexists with poisoning, "
    "append _poisoning to the baby or maternal_baby tier. Preserve every person's guidance. "
)
MIXED_RULE = (
    "When both a maternal urgent sign and an infant sign are present, preserve both: "
    "use maternal_baby_emergency, maternal_baby_er or maternal_baby_unwell for the infant's highest tier. "
    "This includes I, Im, I'm, or no stated subject for the maternal sign. "
    "Baby 911 comes first; otherwise maternal immediate-care/911 comes before baby ER or doctor. "
)

DOSE_REFUSAL = "I can't give a dose. Please ask your doctor or pharmacist."
DIAGNOSIS_REFUSAL = (
    "I can't say what this is or what it means. Please ask your doctor or your baby's doctor. "
    "If you're worried, that's reason enough to call."
)
CHECK_FAILED = "Ask can't answer this right now."
CANT_ANSWER, CANT_ANSWER_LINE = "cant_answer", "If this might be urgent, open Help or call 911."
TRUSTED_SITES_ONLY = "Ask only searches trusted health sources for now, so it can't look up products or books."
PRODUCT_QUESTION = re.compile(r"\b(books?|storybooks?|toys?|gifts?|strollers?|car seats?|brands?|products?|buy|shop\w*|clothes|outfits?|lullab\w+|songs?)\b", re.I)
VACCINE_CLOSING = "Your baby's doctor can tell you what's due."
VACCINE_SOURCES = (
    {"url": "https://www.healthychildren.org/English/safety-prevention/immunizations/Pages/Recommended-Immunization-Schedules.aspx",
     "title": "AAP's immunization schedules for families", "domain": "www.healthychildren.org"},
    {"url": "https://www.cdc.gov/vaccines/hcp/imz-schedules/child-adolescent-age.html",
     "title": "CDC's child immunization schedule", "domain": "www.cdc.gov"},
)
REDUCED_MOVEMENT_RULE = "Never reassure about reduced fetal movement or suggest waiting to finish a count; direct to medical care immediately."
GENERAL_MOVEMENT_RULE = (
    "A general question about whether kicks slow down near the end of pregnancy is education, not evidence of a current symptom. "
    "Unless the message describes actual reduced movement, answer the general question with a sourced explanation and conditional warning; "
    "do not mark it urgent_maternal merely because the answer mentions warning signs. "
    "Never say fewer movements are normal or caused by less room."
)
MOVEMENT_WARNING = "Baby moving less or stopped? Seek medical care immediately. Don’t wait to finish a count."
# Match speech and common texting forms; "move" alone does not stem to "moving".
MOVEMENT_WORD = r"(?:mov(?:e[sd]?|ing|in'?|ements?|emnts?)|mvmts?|kicks?|kickin(?:g)?)"
FETAL_MOVEMENT_TOPIC = re.compile(
    rf"\b(kicks?|movements?|mvmts?|fetal|pregnan\w*|womb|trimester|unborn)\b"
    rf"|\b(?:baby|babies)\b[^.!?\n]{{0,35}}\b{MOVEMENT_WORD}\b", re.I,
)
MOVEMENT_DROP = re.compile(
    rf"\b(?:{MOVEMENT_WORD}|they|he|she|it|baby|babies)\b[^.!?\n]{{0,45}}"
    r"\b(?:less|fewer|slow\w*|decreas\w*|reduc\w*|not as much)\b"
    rf"|\b(?:less|fewer|reduc\w*|decreas\w*)\b[^.!?\n]{{0,25}}\b{MOVEMENT_WORD}\b", re.I,
)
MOVEMENT_REASSURANCE = re.compile(
    r"\b(normal(?:ly)?|expected|common|often|typical|fine|ok(?:ay)?|harmless|nbd)\b"
    r"|\b(?:nothing to worry|don'?t worry|do not worry|no need to worry|no big deal|not unusual|not concerning)\b", re.I,
)
MOVEMENT_ROOM = re.compile(r"\bless\s*(?:room|space)\b|\b(crowded|cramped)\b", re.I)
MOVEMENT_LATE = re.compile(
    r"\b(?:near|at|towards?|by) (?:the )?end\b|\blate (?:in )?pregnancy\b"
    r"|\b(?:due date|term|third trimester|last trimester)\b", re.I,
)
MOVEMENT_CONDITIONAL = re.compile(r"^\s*(?:if|when|should)\b", re.I)
MOVEMENT_ANAPHORIC_REASSURANCE = re.compile(
    r"^\s*(?:(?:that|this|it)(?:'s| is)|thats|its|which is) (?:quite |completely |totally )?"
    r"(?:normal|expected|common|fine|ok(?:ay)?|typical|harmless)\b"
    r"|^\s*(?:don'?t worry|do not worry|nothing to worry about|no big deal)(?: about (?:it|that|this))?[.!?]*$", re.I,
)
MOVEMENT_NEGATED_CLAIM = re.compile(
    r"\b(?:do not|don't|does not|doesn't|should not|shouldn't|never) (?:\w+ )?(?:move|slow|decreas\w*|reduc\w*)\b"
    r"|\bnot (?:true|normal|expected) (?:that|for)\b"
    r"|\bnot because(?: of)?[^.!?\n]{0,25}\b(?:room|space)\b"
    r"|\b(?:room|space) (?:doesn't|does not) (?:mean|cause|justify)\b", re.I,
)

BABY_ROUTING_RULE = (
    "baby_emergency: not breathing, severe trouble breathing (struggling for each breath or barely able to cry), "
    "blue/gray/purple lips, tongue or face, passed out, unconscious, not responding, unable to wake, very weak/not moving, "
    "moaning/grunting with each breath, choking or choked on an object that could be stuck in the throat, "
    "purple or blood-colored spots with fever, or a seizure lasting 5 minutes or longer. "
    "Emergency signs always win, including with jerking or seizure. "
    "baby_er: any trouble breathing in a baby under 1 year (use this conservative route if baby's age is unknown), "
    "ribs pulling in, loud wheezing or stridor, green vomit including threw up green, floppy tone, decreased movement, "
    "weak suck or weak/strange cry, or fever with a seizure, stiff neck, swollen soft spot or not alert when awake. "
    "baby_unwell: other illness needing the doctor now, including fever, injury, suspected seizure without the emergency/ER signs, "
    "or not feeding. These are routing signs, not diagnoses. "
)
SAFETY_RULES = (
    MIXED_RULE + POISON_MIXED_RULE + BABY_ROUTING_RULE +
    "Add \"safety\" to your JSON: null, 'urgent_maternal' for an urgent maternal warning sign, 'harm' for "
    "thoughts of harming themselves or the baby, poisoning for suspected poisoning or accidental overdose, or the baby/mixed tier above. These "
    + REDUCED_MOVEMENT_RULE + " " + GENERAL_MOVEMENT_RULE + " " +
    "get a fixed reply from the app. Do not diagnose. Do not say what a symptom, log entry or reading means for this "
    "person or baby. Always write in English. Never write an amount, strength, timing or duration for any medicine, supplement or "
    "herb, in any form, even one she logged, a source gave or a doctor wrote. If asked, say you can't give a dose, share what "
    "trusted sources say in general with links, and tell the user to ask their doctor or pharmacist. To report a medicine she "
    "logged, cite its record and leave the amount out: the app adds it from the record. To show what her own note says about a "
    "dose or instruction, add {record_id} to quotes: the app shows the whole note, exactly as written. "
    "Treat medicine questions as information, not decisions: say which source says "
    "what, with its date; never say safe or unsafe in your own voice; never tell the user to start, stop or change a "
    "medicine, and if they're considering stopping a prescribed medicine, tell them to talk to their provider first. "
    "When trusted sources disagree, name each source, say what it says and when, don't pick a winner, and tell the user to ask "
    "their provider. Never recite your own vaccine schedule. Look up the American Academy of Pediatrics and CDC positions with "
    "research_trusted, state any differences only as those sources state them, naming and dating each, without choosing "
    "one, and say this may change. If asked which to follow, say to ask the pediatrician. You can report counts and dates "
    "from the logs, but do not call them normal, low, high, good or concerning, even if asked: say the logs may be incomplete, "
    "share what sources say in general with links, and suggest asking the baby's doctor. If the user is worried, say that's "
    "reason enough to call. "
)
# Harm is checked first and nothing excuses it: a person's own words about harm always get the numbers.
HARM_WORDS = re.compile(
    r"\b(hurt|hurting|harm|harming|kill|killing)\s+myself\b"
    r"|\b(want|going|thoughts?|thinking|afraid|scared|might|could|urges?)\b[^.!?\n]{0,25}"
    r"\b(hurt|hurting|harm|harming|kill|killing|shake|shaking|smother\w*)\b[^.!?\n]{0,15}\b(baby|son|daughter|him|her|them)\b"
    r"|\b(shake|shaking|smother\w*)\s+(the|my)\s+baby\b"
    r"|\b(suicid\w*|self[- ]harm\w*)\b"
    r"|\b(want|wish)\b[^.!?\n]{0,12}\b(to die|i was dead|i were dead|i wasn't here|i weren't here)\b"
    r"|\bbetter (off )?if i (disappeared|was gone|were gone|wasn't here|weren't here|died)\b"
    r"|\b(scared|afraid)\b[^.!?\n]{0,25}\b(lose control|hit (her|him|the baby))\b"
    r"|\b(don't|do not) want to (be here|live|wake up)\b"
    r"|\bend (my life|it all)\b"
    r"|\bbetter (?:off )?without me\b"
    r"|\bshook (?:him|her|them|the baby|my baby|baby|my son|my daughter)\b"
    r"|\bthoughts? of (harm\w*|hurt\w*|kill\w*)\b"
    # Losing touch with reality is an emergency after birth, and gets the same numbers.
    r"|\b(hearing (a )?voices?|voices? (telling|saying|say|tell)|seeing things)\b|\bbaby is (evil|possessed|cursed|the devil)\b|\bcan't tell what's real\b|\bbaby (isn't|is not) (mine|real)\b|\bnot my (real )?baby\b",
    re.I,
)
HIGH_TEMPERATURE = r"(?:3[89]|4[0-2]|100\.[4-9]|10[1-9])(?:\.\d)?"
MATERNAL_SIGNS = re.compile(
    r"\bheadache\w*\b[^.!?\n]{0,40}\b(won't go away|not going away|worse|severe|bad|terrible|for days)\b"
    r"|\b(severe|bad|terrible|worst|awful|constant)\b[^.!?\n]{0,12}\bheadache"
    r"|\b(dizz\w+|faint\w*|passed out|pass out|black(ed)? out)\b"
    r"|\bhead is pounding\b|\bseeing\b[^.!?\n]{0,10}\blights\b|\b(barely|can't) catch my breath\w*"
    r"|\bincision\b[^.!?\n]{0,30}\b(opened|open|pus|red\w*|bleed\w*)\b|\bpus\b"
    r"|\b(vision|eyesight)\b[^.!?\n]{0,30}\b(blurr\w*|chang\w*|spots?|double|lost|gone|dark\w*|flash\w*)\b|\b(blurr\w*|double) vision\b|\bseeing (spots|stars|flash\w*)\b"
    rf"|\b(fever|temp|temperature)\b[^.!?\n]{{0,25}}\b{HIGH_TEMPERATURE}|\b{HIGH_TEMPERATURE}\b[^.!?\n]{{0,20}}\bfever\b"
    r"|\b(extreme|severe|really|very|bad)\b[^.!?\n]{0,12}\bswell\w*\b|\bswollen\b[^.!?\n]{0,20}\b(face|hands?)\b|\b(face|hands?)\b[^.!?\n]{0,20}\b(swollen|swelling|swelled)\b"
    r"|\b(trouble|hard|difficulty|can't|cannot|can not|struggling to)\b[^.!?\n]{0,12}\bbreath\w*\b|\bshort(ness)? of breath\b"
    r"|\bchest\b[^.!?\n]{0,20}\b(pain|hurts?|tight\w*|pressure)\b|\bheart\b[^.!?\n]{0,20}\b(racing|pounding|fast)\b|\bpalpitation\w*\b"
    r"|\b(severe|bad|terrible|constant|nonstop|can't stop)\b[^.!?\n]{0,20}\b(nausea|throwing up|vomit\w*)\b"
    r"|\b(severe|bad|terrible|sharp|awful|unbearable)\b[^.!?\n]{0,20}\b(belly|stomach|abdominal|tummy)\b[^.!?\n]{0,12}\bpain\b|\b(belly|stomach|abdominal|tummy) pain\b[^.!?\n]{0,30}\b(severe|won't go away|not going away)\b"
    r"|\b(baby|she|he)\b[^.!?\n]{0,20}\b(hasn't moved|has not moved|isn't moving|not moving|moving less|not moving as much|stopped moving|stopped kicking|not kicking)\b"
    r"|\b(kicks?|kicking|movements?)\b[^.!?\n]{0,25}\b(stopped|slowed|slowing|slower|less|fewer)\b|\b(less|fewer|reduced|decreased)\b[^.!?\n]{0,15}\b(kicks?|kicking|movements?|moving)\b"
    r"|\b(haven't|have not|can't|cannot) (felt|feel)\b[^.!?\n]{0,20}\b(kick\w*|move\w*)\b|\bno (movements?|kicks?|kicking)\b|\bhaven't felt (her|him|the baby|baby)\b"
    r"|\b(not breathing|isn't breathing|stopped breathing|unresponsive)\b"
    r"|\b(bleeding|bleed|blood(?! pressure| type| test| sugar| work)|clots?|hemorrhag\w*)\b|\bsoak\w*\b[^.!?\n]{0,25}\bpads?\b"
    r"|\b(fluid|water)\b[^.!?\n]{0,15}\b(leak\w*|broke|gush\w*|trickl\w*)\b|\bleaking\b[^.!?\n]{0,15}\bfluid\b"
    r"|\b(foul|smell\w*)\b[^.!?\n]{0,15}\bdischarge\b|\bdischarge\b[^.!?\n]{0,15}\b(foul|smell\w*)\b"
    r"|\b(leg|calf|arm)\b[^.!?\n]{0,30}\b(swollen|swell\w*|red|redness|severe)\b"
    r"|\boverwhelming (tired\w*|exhaust\w*|fatigue)\b"
    # Forms that got past this list on the old path. Waters, preeclampsia, early labor, and fever with a stiff neck.
    r"|\b(undies|underwear|panties|pants|leggings)\b[^.!?\n]{0,25}\bwet\b[^.!?\n]{0,25}\b(water|fluid)\b"
    r"|\b(face|hands?)\b[^.!?\n]{0,20}\bpuffy\b|\bpain\b[^.!?\n]{0,15}\b(under|below)\b[^.!?\n]{0,10}\bribs?\b"
    r"|\b(tighten\w*|contractions?)\b[^.!?\n]{0,25}\bevery\s+\d+\s*min"
    r"|\bfever\b[^.!?\n]{0,25}\bstiff neck\b|\bstiff neck\b[^.!?\n]{0,25}\bfever\b|\b(i'm|im) not making sense\b",
    re.I,
)
BABY_WORDS = re.compile(
    r"\b(my baby|the baby|babys|baby|newborn|infant|toddler|little one|lo|nene|neni|she|shes|he|hes|her|him|his|daughter|son)\b"
    r"|\b\d+\s*-?\s*(?:days?|wks?|weeks?|mos?|months?|yrs?|years?)\s*-?\s*old\b|\bmy\s+\d+\s*-?\s*(?:wks?|w|mos?|m)\b",
    re.I,
)
BORN_CHILD = re.compile(
    r"\b(newborn|infant|toddler|born)\b|\b\d+\s*-?\s*(?:days?|wks?|weeks?|mos?|months?|yrs?|years?)\s*-?\s*old\b", re.I,
)
FUTURE_BIRTH = re.compile(
    # Future/negated birth wording is pregnancy context, not evidence of a born child.
    r"\b(?:(?:due|expected|scheduled|set|yet) to be|(?:will|would|should|may|might|could) (?:soon )?be|"
    r"(?:going|about) to be|(?:isn't|is not|not)(?: yet)?|(?:hasn't|has not)(?: yet)? been|to be) born\b", re.I,
)
BABY_PRONOUN_SUBJECT = re.compile(r"^\W*(?:(?:now|also|then)\s+)*(?:she|he|her|his|they|their|shes|hes)\b", re.I)
# These are routing signs, not diagnoses. The emergency tier always wins within the whole message.
BABY_EMERGENCY_WORDS = re.compile(
    r"\b(not breath(?:ing|e)|isn't breathing|is not breathing|stopped breathing|no longer breathing|breathing\W+(?:and\W+)?not anymore|"
    r"won't breathe|can't (?:breathe|catch (?:her|his|their) breath\w*)|cannot breathe|"
    r"struggling (?:to breathe|for (?:each )?breath\w*|for air)|gasping|barely breathing|"
    r"breathing(?: really hard)?(?: and| but)?(?: really)? struggling|"
    r"won't wake(?: up)?|wont wake(?: up)?|can't (?:be )?woken|cannot (?:be )?woken|can't wake|not waking|"
    r"unresponsive|(?:not|isn't) responding|not responsive|won't respond|wont respond|unconscious|lifeless|collapsed|fainted|passed out|"
    r"can't get \w+ ?\w* to wake|very weak|not moving|isn't moving|grunting|moaning with (?:each|every) breath\w*|turning blue|"
    r"(?:baby|newborn|infant|she|he|shes|hes|lo) (?:is |looks? |turned |turning |'s )?(?:blue|bluish|gray|grey|dusky|purple)|"
    r"(?:blue|bluish|gray|grey|dusky|purple) (?:lips|tongue|face)|"
    r"(?:lips|tongue|face|skin) (?:are |is |r |look |looks |look kinda |looks kinda |went )?(?:blue|bluish|gray|grey|dusky|purple)|"
    r"(?:she|he)'s (?:blue|gray|grey|purple)|blue around (?:her|his|their) mouth|looks purple|pale and gr[ae]y|cho(?:king|cking)|"
    r"choked on (?:a |an |the )?(?:small |little )?(?:toy|object|grape|coin|food|piece)|"
    r"something stuck in (?:baby'?s|her|his|their|the) throat|swallowed a coin.*gagging)\b"
    r"|\b(?:purple|blood[- ]colou?red) (?:spots|dots)\b[^.!?\n]{0,35}\bfever\b"
    r"|\bfever\b[^.!?\n]{0,35}\b(?:purple|blood[- ]colou?red) (?:spots|dots)\b"
    r"|\b(?:seizure|seizing|convuls\w*)\b[^.!?\n]{0,45}\b(?:[5-9]|[1-9]\d+|five|six|seven|eight|nine|ten)\s*(?:mins?|minutes?)\b",
    re.I,
)
# AAP: any trouble breathing under one year goes to ER. For an unspecified baby
# age, choose the conservative infant route; do not make an age guess to downgrade it.
BABY_ER_WORDS = re.compile(
    r"\b(floppy|limp|green vomit|vomit(?:ing)? (?:bile|green)|(?:throwing|threw) up (?:bright )?green|"
    r"hard to wake(?: up)?|weak suck|weak cry|strange cry|weird high pitched cry|isn't sucking well|"
    r"ribs? (?:are )?pull(?:ing)? in|chest is caving in|sucking in|"
    r"trouble breathing|breathing problems?|breathing funny|breathing fast|wheezing|stridor|"
    r"moving less(?: than usual)?|decreased movement|stiff neck|soft spot is (?:bulging|swollen)|not alert when awake)\b"
    r"|\b(?:seizure|seizing)\b[^.!?\n]{0,35}\bfever\b|\bfever\b[^.!?\n]{0,35}\b(?:seizure|seizing)\b",
    re.I,
)


def help_kind(kind):
    """Keep the existing mobile wire value; emergency/ER are internal routing tiers."""
    if kind == POISONING:
        return CANT_ANSWER
    if kind and kind.endswith("_poisoning"):
        return URGENT_MATERNAL if kind == "maternal_poisoning" else help_kind(kind.removesuffix("_poisoning"))
    if kind in MIXED_BABY.values():
        return BABY_UNWELL if kind == MIXED_BABY[BABY_EMERGENCY] else URGENT_MATERNAL
    return BABY_UNWELL if kind in {BABY_EMERGENCY, BABY_ER} else kind


BABY_UNWELL_WORDS = re.compile(
    r"\b(floppy|limp|lethargic|unresponsive|won't wake|wont wake|hard to wake|not waking|can't wake|turning blue|blue lips|lips? (?:is |are |look |looks )?(?:blue|dusky)|dusky|gasping|"
    r"lips? (?:look |looks )?(?:grey|gray)|breathing funny|grunting|sucking in|barely breathing|can't get \w+ ?\w* to wake|went stiff|jerking|"
    r"rolled off|fell off|chocking|seizing|burning up|feels (?:really )?(?:warm|hot)|is yellow|shaking all over|whole body is shaking|shaking and stiff|twitching|"
    r"not breathing|isn't breathing|stopped breathing|breathing\W+(?:and\W+)?not anymore|trouble breathing|struggling to breathe|struggling for (?:air|breath)|"
    r"can't breathe|cannot breathe|can not breathe|breathing problems?|choking|seizure\w*|convuls\w*|"
    r"(?:fell|fall|fallen|falling)(?! asleep)|hit (her|his|their) head|burned|burnt|bleeding|is hurt|got hurt|injur\w*|"
    r"fever\w*|very sick|really sick|seems sick|won't eat|refusing to eat|not eating|not feeding|won't stop crying|inconsolable|"
    r"(?:no|not had a|hasn't had a|hasn't had any|without a|only one|only 1) (?:wet|pee) (?:diapers?|napp(?:y|ies))|hasn't peed|won't respond|dehydrat\w*|vomiting|throwing up|malangu|malångu)\b"
    rf"|\b(temp|temperature|rectal\w*|forehead|armpit|underarm)\b[^.!?\n]{{0,25}}\b{HIGH_TEMPERATURE}",
    re.I,
)
BABY_OTHER_SIGNS = re.compile(
    rf"\b{HIGH_TEMPERATURE}\b[^.!?\n]{{0,20}}\b(?:forehead|rectal|temp|temperature)\b"
    r"|\btemp(?:erature)?\b[^.!?\n]{0,20}\b(?:9[0-6](?:\.\d)?)\b[^.!?\n]{0,30}\b(?:warm|warming)\w*"
    r"|\bonly (?:had )?(?:[0-5]|one|two|three|four|five) wet diapers?\b", re.I,
)
MENTAL_HEALTH_WORDS = re.compile(
    r"\b(postpartum depression|postpartum anxiety|ppd|depress\w*|hopeless\w*|panic attacks?|can't stop crying|cannot stop crying|"
    r"crying all the time|so anxious|really anxious|can't cope|cannot cope|can't do this|numb)\b",
    re.I,
)
# Looking something up in her records isn't describing it, clause by clause. A separate symptom in the same message still counts.
RECORD = r"post|video|article|journal|logs?|notes?|entry|entries|record|summary|sources?|warning signs?|aap|cdc"
LOOKUP_CLAUSE = re.compile(
    r"^\W*(?:what|which|where|when did|did|does|do|has|have|is there|can you|could you)\b[^?]*"
    rf"\b(?:say|says|said|tell|told|log|logged|save|saved|write|wrote|written|note|noted|recorded|mention\w*|recommend\w*|talks?|{RECORD})\b"
    rf"|^\W*(?:please\s+)?(?:show|find|open|read|summar\w+|pull up|look up|search|list)\b[^?]*\b(?:{RECORD})\b",
    re.I,
)
CLAUSE_BREAK = re.compile(r"\s*[;,]\s*|\s+(?:but|though|although|however)\s+|\s+and\s+(?=(?:she|he|it|i|i'm|my|our|the baby|baby|nene|neni|now|right now)\b)", re.I)
# Close misspellings of the words that matter most at 3 a.m.
URGENT_SPELLINGS = ("fever", "breathing", "breathe", "bleeding", "headache", "blurry", "seizure", "unresponsive", "temperature")
CONDITIONS = (
    r"(?:eczema|rash(?:es)?|colic|reflux|jaundice|thrush|mastitis|infection|allerg\w+|hives|croup|rsv|flu|covid|preeclampsia|"
    r"sepsis|pneumonia|gas|depression|ppd)"
)
SOMEONES = r"(?:her|hers|his|him|she|he|my baby|my baby's|the baby|the baby's|this|that|these|those)"
DIAGNOSIS_ASKED = re.compile(
    rf"\b(?:could|might|may|can) (?:this|that|it) (?:be|mean|indicate)\b[^.!?\n]{{0,25}}\b{CONDITIONS}\b"
    r"|"
    rf"\bis (?:this|it|that)\b[^.!?\n]{{0,15}}\b{CONDITIONS}\b"
    rf"|\b(?:does|do|could|can|might)\b[^.!?\n]{{0,20}}\bhave\b[^.!?\n]{{0,20}}\b{CONDITIONS}\b"
    r"|\bwhat(?:'s| is) wrong\b|\bdiagnos\w*"
    r"|\b(?:is|are|does|do|was|were)\b[^.!?\n]{0,60}\b(?:too (?:much|little|many|few|low|high)|concerning|worrying|dangerous|serious)\b"
    # "Normal" only about something of hers or the baby's. Whether something common is normal gets a sourced answer.
    rf"|\b(?:is|are|does|do|was|were)\b[^.!?\n]{{0,40}}\b{SOMEONES}\b[^.!?\n]{{0,40}}\bnormal\b"
    rf"|\b(?:is|are|does|do|was|were)\b[^.!?\n]{{0,60}}\bnormal\b[^.!?\n]{{0,40}}\b{SOMEONES}\b",
    re.I,
)
DOSE_ASKED = re.compile(r"\b(how much|how many|how often|dose\w*|dosage|mg|milligrams?|safe amount)\b", re.I)
MEDICINE_WORDS = re.compile(
    r"\b(tylenol|acetaminophen|paracetamol|ibuprofen|motrin|advil|aspirin|amoxicillin|antibiotic\w*|benadryl|zofran|unisom|insulin|medicine\w*|meds?|medication\w*|prescri\w*|supplement\w*|vitamin\w*|herb\w*)\b",
    re.I,
)
LOG_LOOKUP = re.compile(r"\b(log|logged|record\w*|wrote|entered|when did|how many times|last time)\b", re.I)
NUMBER = (
    r"(?:\d+(?:[./]\d+)?|[½¼¾⅓⅔]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|"
    r"seventeen|eighteen|nineteen|twenty|half|quarters?|couple|few|several)"
)
QUANTITY = rf"{NUMBER}(?:\s*(?:-|–|to|or|and a|and)?\s*{NUMBER})*(?:\s+(?:of\s+)?(?:an?\s+)?)?\s*-?\s*"
DOSE_UNIT = (
    r"(?:mg|mcg|milligrams?|micrograms?|iu|units?|tablets?|caplets?|capsules?|pills?|gumm(?:y|ies)|drops?|droppers?|puffs?|sprays?|"
    r"sachets?|doses?|teaspoons?|teaspoonfuls?|tsps?|tablespoons?|tbsps?|grams?|мг|мл|مل|ملغ|毫升|毫克)"
)
DOSE_AMOUNT = re.compile(rf"(?<!\w){QUANTITY}{DOSE_UNIT}(?!\w)", re.I)
LIQUID_AMOUNT = re.compile(rf"\b{QUANTITY}(?:mls?|milliliters?|millilitres?|cc|oz|ounces?)\b", re.I)
FREQUENCY = re.compile(
    r"\b(?:every\s+\w+(?:\s+to\s+\w+)?\s+hours?|every\s+hour|(?:once|twice|thrice|\w+\s+times?)\s+(?:a|per)\s+day|(?:once|twice|\w+\s+times?)\s+daily)\b",
    re.I,
)
# Only with a medicine in the question or the answer.
DOSE_FORMS = re.compile(
    rf"\bhalf of the (?:usual )?(?:amount|dose)\b|\bdropperful\b|\bsame as last time\b|\bdouble (?:it|the dose)\b|\b{NUMBER}\s+\w+\s+per (?:kilogram|kg|pound|lb)\b"
    r"|\bper (?:kilogram|kg|pound|lb)\b|\bat bedtime\b|\bpea-sized\b|\bcontinue for \w+ (?:days?|weeks?)\b",
    re.I,
)
# Amounts and timing are how feeding, pumping and sleep are logged, so these aren't a dose unless a medicine is named.
CARE_NOT_MEDICINE = re.compile(r"\b(?:bottles?|milk|formula|breast\w*|nurs\w*|feed\w*|fed|pump\w*|drank|drink\w*|ate|eat\w*|sleep\w*|slept|naps?|diapers?|poo\w*|pee\w*)\b", re.I)
LOGGED_AMOUNT = re.compile(r"^\W*you logged\b(?!.*\b(?:give|take|can|should|every|twice|daily)\b)", re.I)
# A refusal only covers what it's a refusal of: "I can't say whether it's eczema", not "I can't diagnose, but it's eczema".
ABOUT_THE_PREDICATE = re.compile(r"\b(?:can't|cannot|can not|won't|unable to|not able to|don't know|not sure)\b[^,;]{0,30}\b(?:if|whether|what|why)\b[^,;]*$", re.I)
# "It's normal to feel tired" is what's common. "That's normal for her age" is a verdict.
ON_HER_NORMAL = r"normal(?!\s+(?:to|for (?:new\w*|babies|most|many|people|pregnan\w*))\b)"
DIAGNOSIS_GIVEN = re.compile(
    rf"\b(?:your baby|the baby|baby|she|he|you|it|this|that|everything)(?:'s|\s+has|\s+have|\s+is|\s+are)\s+(?:\w+\s+){{0,3}}(?:{CONDITIONS}|{ON_HER_NORMAL}|fine|healthy|harmless)\b"
    rf"|\b(?:sounds?|looks?|seems?)(?:\s+like)?\b[^.!?\n]{{0,25}}\b(?:{CONDITIONS}|{ON_HER_NORMAL}|fine|healthy)\b"
    r"|\bprobably\b[^.!?\n]{0,20}\b(?:just|nothing|fine|normal)\b"
    rf"|\b(?:could|might|may|must|likely|probably|possibly)\s+(?:be\s+|have\s+)?(?:an?\s+)?{CONDITIONS}\b",
    re.I,
)
REASSURANCE = re.compile(
    r"\b(?:no need to|don't need to|do not need to|needn't)\s+(?:call|see|worry|go)\b|\bnothing to worry\b|\b(?:not|isn't|nothing) (?:serious|dangerous|concerning)\b|\bwait until (?:tomorrow|morning)\b",
    re.I,
)
def normalized(message):
    """Curly quotes as straight ones, "cant" as "can't", and close misspellings of the urgent words as those words."""
    text = message.replace("\u2019", "'").replace("\u2018", "'").replace("\u02bc", "'")
    text = re.sub(r"\b(can|won|isn|hasn|doesn|don|haven|couldn|wouldn|didn|wasn|aren)t\b", r"\1't", text, flags=re.I)

    def respell(match):
        word = match.group(0)
        close = get_close_matches(word.lower(), URGENT_SPELLINGS, n=1, cutoff=0.85) if len(word) >= 4 else []
        return close[0] if close else word

    return re.sub(r"[^\W\d_]+", respell, text)


def sentences(text):
    return [part for part in re.split(r"(?<=[.!?;\n])\s+", text) if part.strip()]


VACCINE_WORDS = re.compile(r"\b(vaccin\w*|immuni[sz]\w*|shots?|hep(?:atitis)? b|mmr|rotavirus)\b", re.I)
DOCTOR_WORDS = re.compile(r"\b(pediatrician|paediatrician|baby's doctor|baby’s doctor|your doctor|her doctor|his doctor)\b", re.I)


class Safety(NamedTuple):
    kind: str
    message: str


def without_lookups(sentence):
    return " ".join(clause for clause in CLAUSE_BREAK.split(sentence) if clause and not LOOKUP_CLAUSE.search(clause))


POISONING_WORDS = re.compile(
    rf"\b(overdos\w*|double dos\w*|too (?:much|many) (?:medicine|medication|pills?|tablets?))\b"
    rf"|\b(swallow\w*|drank|ate|took|given|gave)\b[^.!?\n]{{0,45}}\b(bleach|poison\w*|cleaner|button battery|battery|extra (?:dose|pills?|tablets?))\b"
    rf"|\btoo (?:much|many)\s+{MEDICINE_WORDS.pattern}"
    r"|\bdrank\b[^.!?\n]{0,25}\bcleaning (?:stuff|fluid|products?)\b|\bgot into (?:my|the|our) pills\b"
    rf"|\baccidentally\b(?![^.!?\n]{{0,80}}\b(?:forgot\w*|forget\w*|missed|skipped)\b)[^.!?\n]{{0,80}}{MEDICINE_WORDS.pattern}", re.I,
)


def classify(message, child_names=()):
    """What a person's own words call for before anything else happens. None for everything else."""
    text = normalized(message)
    # These explicit bowel phrases do not describe whole-body immobility or breathing.
    text = re.sub(r"\bnot moving (?:her |his |their |my )?bowels?\b", "bowel concern", text, flags=re.I)
    if not re.search(r"\bbreath\w*\b", text, re.I):
        text = re.sub(r"\bgrunting (?:while|when) (?:pooping|passing stool|having a bowel movement)\b", "bowel concern", text, flags=re.I)
    if HARM_WORDS.search(text) or re.search(r"\bi (?:don't|do not) want to be a (?:mom|mother|parent)(?: anymore)?\b", text, re.I):
        return Safety(HARM, MESSAGES[HARM])
    names = [re.escape(name) for child in child_names for name in re.findall(r"[\w'-]{2,}", child or "")]
    # Keep patient clauses separate: joining a parent's symptom to a baby's symptom
    # before assigning routes can wrongly make the parent's breathing problem the baby's.
    kept = [part for sentence in sentences(text) for clause in CLAUSE_BREAK.split(sentence)
            if clause and not LOOKUP_CLAUSE.search(clause)
            for part in re.split(r"\s+and\s+|\s*&\s*", clause, flags=re.I) if part]
    context = " ".join(kept)
    after_birth = re.search(r"\b(postpartum|postnatal|after (?:giving )?birth|after delivery|gave birth|born|newborn|infant)\b", FUTURE_BIRTH.sub("", context), re.I)
    # A bare week count may be an infant's age or weeks after birth. "Kicked"
    # can also describe a born baby's body; neither establishes pregnancy.
    pregnancy_context = any(
        (re.search(r"\b(pregnan\w*|womb|trimester|unborn|fetal)\b|\bin utero\b", part, re.I) or FUTURE_BIRTH.search(part))
        and not re.search(r"\b(postpartum|postnatal|after (?:giving )?birth|after delivery|gave birth)\b", part, re.I)
        for part in kept
    )
    ambiguous_weeks = not after_birth and not pregnancy_context and re.search(
        r"\b(?:3[0-9]|[12][0-9]) weeks?\b(?!\s*(?:old|-old))", context, re.I,
    )

    def baby_subject(part):
        baby = BABY_WORDS.search(part) or (names and re.search(rf"\b({'|'.join(names)})\b", part, re.I))
        maternal_sign = MATERNAL_SIGNS.search(part)
        # “I'm bleeding while nursing her” describes the parent. A later baby
        # pronoun must not turn an explicit maternal symptom into infant illness.
        if baby and maternal_sign and maternal_sign.start() < baby.start():
            prefix = part[:maternal_sign.start()]
            self_report = re.search(r"^\W*(?:i (?:am|have|feel|can't|cannot)\b|i'm\b|im\b|my (?:water|bleeding|head|vision|chest|leg|calf|hands|face|incision)\b)", part, re.I)
            observation = re.search(r"\b(noticed|noticing|seeing|saw|see|observed|observing|found|heard|watching)\b", prefix, re.I)
            if self_report and not observation:
                return False
        return bool(baby or part.strip().lower() == "seizure")

    # A patient transition can occur without punctuation or “and”. Split only
    # when the preceding symptom belongs to the other patient.
    separated = []
    for part in kept:
        transition = re.search(r"\b(?:my (?:baby|newborn|infant|toddler)|the baby|baby)\b", part, re.I)
        if transition and transition.start() and MATERNAL_SIGNS.search(part[:transition.start()]) and not baby_subject(part[:transition.start()]):
            separated.extend((part[:transition.start()], part[transition.start():]))
            continue
        transition = re.search(r"\b(?:i have|i am|i'm|im|my water|my bleeding)\b", part, re.I)
        if transition and transition.start() and baby_subject(part[:transition.start()]):
            separated.extend((part[:transition.start()], part[transition.start():]))
            continue
        separated.append(part)
    kept = separated

    # A numeric temperature in the next clause can still belong to the baby.
    # An explicit maternal subject starts a different concern.
    def parent_subject(part):
        return bool(re.search(r"\bi\b|\bim\b|\bmy\b", part, re.I) and not baby_subject(part))
    baby_parts = []
    for index, part in enumerate(kept):
        inherits_baby = (index > 0 and baby_parts[index - 1] and not parent_subject(part)
                         and (BABY_EMERGENCY_WORDS.search(part) or BABY_ER_WORDS.search(part)
                              or re.search(r"\b(temp|temperature|fever)\b", part, re.I)))
        baby_parts.append(bool(baby_subject(part) or inherits_baby))
    # A parent's pregnancy does not make a previously identified born child fetal.
    # Carry that identity into "he/she isn't moving"; an explicit new baby subject
    # starts a new concern (which can still be fetal).
    born_parts = []
    born_context = False
    for part, about_baby in zip(kept, baby_parts, strict=True):
        if BORN_CHILD.search(FUTURE_BIRTH.sub("", part)):
            born_context = True
        elif FUTURE_BIRTH.search(part) or (about_baby and not BABY_PRONOUN_SUBJECT.search(part)):
            born_context = False
        born_parts.append(bool(about_baby and born_context))
    maternal_parts = [bool(MATERNAL_SIGNS.search(part) and not baby) for part, baby in zip(kept, baby_parts, strict=True)]

    def fetal_movement_part(part, *, born_child=False):
        emergencies = [match.group(0).lower() for match in BABY_EMERGENCY_WORDS.finditer(part)]
        return bool(pregnancy_context and not born_child and (
            emergencies in (["not moving"], ["isn't moving"])
            or BABY_ER_WORDS.search(part) and re.search(r"\bmoving less|decreased movement\b", part, re.I) and not emergencies
        ) and not BORN_CHILD.search(FUTURE_BIRTH.sub("", part)))

    # Only join fragments when neither belongs to a maternal/fetal concern. This
    # retains “my newborn has a temperature. 38.5 C” without merging a fetal
    # movement concern with a separate born baby's illness.
    pairs = [(" and ".join(part.rstrip(".!?; ") for part in kept[index:index + 2]), any(born_parts[index:index + 2]))
             for index in range(len(kept) - 1) if not any(maternal_parts[index:index + 2])
             and not any(parent_subject(part) or fetal_movement_part(part, born_child=born_parts[position])
                         for position, part in enumerate(kept[index:index + 2], start=index))]
    maternal = any(maternal_parts)
    poison = any(POISONING_WORDS.search(part) for part in kept)
    maternal = maternal or any(POISONING_WORDS.search(part) and parent_subject(part) for part in kept)
    fetal_movement = False
    baby_kind = None
    rank = {BABY_UNWELL: 1, BABY_ER: 2, BABY_EMERGENCY: 3}
    for part, about_baby, born_child in [*zip(kept, baby_parts, born_parts, strict=True),
                                         *((part, baby_subject(part), born) for part, born in pairs)]:
        if fetal_movement_part(part, born_child=born_child):
            fetal_movement = True
            continue
        candidate = (BABY_EMERGENCY if (BABY_EMERGENCY_WORDS.search(part) or (names and re.search(rf"\b(?:{'|'.join(names)}) (?:is |looks? )?(?:blue|gray|grey|purple)\b", part, re.I))) else
                     BABY_ER if BABY_ER_WORDS.search(part) else BABY_UNWELL if (BABY_UNWELL_WORDS.search(part) or BABY_OTHER_SIGNS.search(part)) else None) if about_baby else None
        if candidate:
            if rank[candidate] > rank.get(baby_kind, 0):
                baby_kind = candidate
        elif MATERNAL_SIGNS.search(part):
            if about_baby:
                fetal_movement = True
            else:
                maternal = True
    maternal = maternal or (fetal_movement and (baby_kind != BABY_EMERGENCY or any(born_parts)))
    if ambiguous_weeks and baby_kind == BABY_EMERGENCY and re.search(r"\b(?:not moving|isn't moving)\b", context, re.I):
        maternal = True  # Ambiguity must preserve both routes, never downgrade baby 911.
    if maternal and baby_kind:
        kind = MIXED_BABY[baby_kind]
    else:
        kind = baby_kind or (URGENT_MATERNAL if maternal else None)
    if poison:
        kind = ("maternal_poisoning" if kind == URGENT_MATERNAL else kind + "_poisoning") if kind else POISONING
    return Safety(help_kind(kind), MESSAGES[kind]) if kind else None



def boundary(question):
    """A question Ask answers the same way every time, without a model: no doses, no diagnoses, no verdicts."""
    text = normalized(question)
    if LOG_LOOKUP.search(text):
        return None
    if MEDICINE_WORDS.search(text) and DOSE_ASKED.search(text):
        return DOSE_REFUSAL
    return DIAGNOSIS_REFUSAL if DIAGNOSIS_ASKED.search(text) else None


def states_a_dose(question, message):
    """A floor: amounts it recognizes, and what the review found. The model check is what reads the meaning."""
    if DOSE_AMOUNT.search(message):
        return True
    medicine_named = MEDICINE_WORDS.search(question) or MEDICINE_WORDS.search(message)
    if medicine_named and DOSE_FORMS.search(message):
        return True
    for sentence in sentences(message):
        if LIQUID_AMOUNT.search(sentence) or FREQUENCY.search(sentence):
            if MEDICINE_WORDS.search(sentence):
                return True
            if CARE_NOT_MEDICINE.search(sentence) or (LOGGED_AMOUNT.search(sentence) and not medicine_named):
                continue
            if medicine_named or not CARE_NOT_MEDICINE.search(question):
                return True
    return False


def gives_a_diagnosis(message):
    for sentence in sentences(message):
        for clause in CLAUSE_BREAK.split(sentence):
            if REASSURANCE.search(clause):
                return True
            if any(not ABOUT_THE_PREDICATE.search(clause[:match.start()]) for match in DIAGNOSIS_GIVEN.finditer(clause)):
                return True
    return False


def unsafe_output(question, message):
    """The fixed line to use instead of this text, or None if the checks pass it."""
    text = normalized(message)
    if FETAL_MOVEMENT_TOPIC.search(normalized(question) + " " + text):
        clauses = [clause.strip() for sentence in sentences(text)
                   for clause in re.split(r"\s+(?:and|but|yet|however|so)\s+|[,;]\s*(?:(?:and|but|yet|however|so)\s+)?", sentence, flags=re.I) if clause.strip()]
        for index, clause in enumerate(clauses):
            if MOVEMENT_NEGATED_CLAIM.search(clause):
                continue
            # "Less room" is itself the prohibited explanation in this context.
            # Negation stays local: one safe claim cannot excuse the next claim.
            if MOVEMENT_ROOM.search(clause):
                return MOVEMENT_WARNING
            neighbors = clauses[max(0, index - 1):index] + clauses[index + 1:index + 2]
            reassuring = MOVEMENT_REASSURANCE.search(clause) or any(
                MOVEMENT_ANAPHORIC_REASSURANCE.search(neighbor) for neighbor in neighbors
            )
            # "They slow down near the end" asserts an expected decline even
            # without "normal". A conditional warning makes no such assertion.
            expected_late_drop = MOVEMENT_LATE.search(clause) and not MOVEMENT_CONDITIONAL.search(clause)
            if MOVEMENT_DROP.search(clause) and (reassuring or expected_late_drop):
                return MOVEMENT_WARNING
    if states_a_dose(normalized(question), text):
        return DOSE_REFUSAL
    return DIAGNOSIS_REFUSAL if gives_a_diagnosis(text) else None


def cant_answer(message):
    return f"{message}\n\n{CANT_ANSWER_LINE}"


def answer_checks(question, answer):
    """A finished answer, with the rules code can enforce. Returns (message, safety_kind, extra_sources)."""
    if answer.safety in MESSAGES:
        return MESSAGES[answer.safety], help_kind(answer.safety), []
    refusal = unsafe_output(question, answer.message)
    if refusal:
        return refusal, None, []
    question = normalized(question)
    message, kind, extra = answer.message, None, []
    if re.search(r"\b(i|ask) (can['’]t|cannot|couldn['’]t|am unable to)|\b(not enough|no) (information|records|evidence)|\bi (don['’]t|do not) (know|have enough)", message, re.I):
        message, kind = cant_answer(message), CANT_ANSWER
    if VACCINE_WORDS.search(question):
        extra = list(VACCINE_SOURCES)
        if not DOCTOR_WORDS.search(message):
            message = f"{message}\n\n{VACCINE_CLOSING}"
    if MENTAL_HEALTH_WORDS.search(question):
        kind = MENTAL_HEALTH
        message = f"{message}\n\n{CALL_MAMA}"
    return message, kind, extra


TIMES_OF_DAY = r"(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|midnight|breakfast|lunch|dinner|bedtime|morning|night)"
TIMED_FEEDING = re.compile(rf"\b(?:feed\w*|nurs\w*|bottles?|formula)\b[^.!?\n]{{0,30}}\b{TIMES_OF_DAY}\b", re.I)
TIMED_MEDICINE = re.compile(rf"{MEDICINE_WORDS.pattern}[^.!?\n]{{0,30}}\b{TIMES_OF_DAY}\b", re.I)


def unsafe_suggestion(kind, *texts):
    """Whether what a model wrote for a suggestion fails the checks on its answers, or is a plan for medicine or feeding."""
    parts = [text for text in texts if text]
    text = normalized(". ".join(parts))
    if states_a_dose("", text) or gives_a_diagnosis(text):
        return True
    if kind == "question":
        return False
    return bool(TIMED_FEEDING.search(text) or TIMED_MEDICINE.search(text) or (kind == "event" and (MEDICINE_WORDS.search(text) or FREQUENCY.search(text))))


def must_research_first(question):
    """The vaccine positions are looked up at the time of the question, never recalled."""
    return bool(VACCINE_WORDS.search(question))
