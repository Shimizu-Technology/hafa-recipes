"""AWAITING CLINICIAN REVIEW (MEDICAL_REVIEW sections A and G). The free floor under Ask's safety check.

Word lists can't be the safety layer: ask_check.py, a model call before and after each answer, is. These patterns run first,
free, with the AI off and on the old path, and they lean toward firing. Urgent replies are fixed here, in the words of CDC,
HHS, 988 and HRSA where those exist. They come before anything that could refuse to answer: the AI being off, a limit, a
budget, consent. Don't try to make these cover everything.
"""

import re
from difflib import get_close_matches
from typing import NamedTuple

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
    # The packet's G2 wording, the one fixed line here with no published source behind it.
    BABY_UNWELL: "Call your baby's doctor now, or call 911 if it may be an emergency.",
}
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
SAFETY_RULES = (
    "Add \"safety\" to your JSON: null, or 'urgent_maternal' if the parent describes an urgent maternal warning sign, 'harm' if "
    "they mention harming themselves or the baby, or 'baby_unwell' if they describe a baby who seems sick or hurt. Those three "
    "get a fixed reply from the app. Do not diagnose. Do not say what a symptom, log entry or reading means for this "
    "person or baby. Always write in English. Never write an amount, strength, timing or duration for any medicine, supplement or "
    "herb, in any form, even one she logged, a source gave or a doctor wrote. If asked, say you can't give a dose, share what "
    "trusted sources say in general with links, and tell the user to ask their doctor or pharmacist. To report a medicine she "
    "logged, cite its record and leave the amount out: the app adds it from the record. To show what her own note says about a "
    "dose or instruction, add {record_id, words} to quotes, with one complete sentence or the whole note, exactly as written. "
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
    r"|\bbetter off without me\b"
    r"|\bthoughts? of (harm\w*|hurt\w*|kill\w*)\b"
    # Losing touch with reality is an emergency after birth, and gets the same numbers.
    r"|\b(hearing voices|voices (telling|saying|say|tell)|seeing things)\b|\bcan't tell what's real\b|\bbaby (isn't|is not) (mine|real)\b|\bnot my (real )?baby\b",
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
    r"|\b(kicks?|kicking|movements?)\b[^.!?\n]{0,25}\b(stopped|slowed|slowing|less|fewer)\b|\b(less|fewer|reduced|decreased)\b[^.!?\n]{0,15}\b(kicks?|kicking|movements?|moving)\b"
    r"|\b(haven't|have not|can't|cannot) (felt|feel)\b[^.!?\n]{0,20}\b(kick\w*|move\w*)\b|\bno (movements?|kicks?|kicking)\b|\bhaven't felt (her|him|the baby|baby)\b"
    r"|\b(not breathing|isn't breathing|stopped breathing|unresponsive)\b"
    r"|\b(bleeding|bleed|blood(?! pressure| type| test| sugar| work)|clots?|hemorrhag\w*)\b|\bsoak\w*\b[^.!?\n]{0,25}\bpads?\b"
    r"|\b(fluid|water)\b[^.!?\n]{0,15}\b(leak\w*|broke|gush\w*|trickl\w*)\b|\bleaking\b[^.!?\n]{0,15}\bfluid\b"
    r"|\b(foul|smell\w*)\b[^.!?\n]{0,15}\bdischarge\b|\bdischarge\b[^.!?\n]{0,15}\b(foul|smell\w*)\b"
    r"|\b(leg|calf|arm)\b[^.!?\n]{0,30}\b(swollen|swell\w*|red|redness|severe)\b"
    r"|\boverwhelming (tired\w*|exhaust\w*|fatigue)\b",
    re.I,
)
BABY_WORDS = re.compile(r"\b(my baby|the baby|baby|newborn|infant|nene|neni|she|shes|he|hes|her|him|daughter|son)\b", re.I)
BABY_UNWELL_WORDS = re.compile(
    r"\b(floppy|limp|lethargic|unresponsive|won't wake|wont wake|hard to wake|not waking|can't wake|turning blue|blue lips|lips? (?:is |are |look |looks )?(?:blue|dusky)|dusky|gasping|"
    r"lips? (?:look |looks )?(?:grey|gray)|breathing funny|grunting|sucking in|barely breathing|can't get \w+ ?\w* to wake|went stiff|jerking|"
    r"rolled off|fell off|chocking|"
    r"not breathing|isn't breathing|stopped breathing|breathing\W+not anymore|trouble breathing|struggling to breathe|struggling for (?:air|breath)|"
    r"can't breathe|cannot breathe|can not breathe|breathing problems?|choking|seizure\w*|convuls\w*|"
    r"(?:fell|fall|fallen|falling)(?! asleep)|hit (her|his|their) head|burned|burnt|bleeding|is hurt|got hurt|injur\w*|"
    r"fever\w*|very sick|really sick|seems sick|won't eat|refusing to eat|not eating|not feeding|won't stop crying|inconsolable|"
    r"(?:no|not had a|hasn't had a|hasn't had any|without a) (?:wet|pee) diapers?|hasn't peed|dehydrat\w*|vomiting|throwing up|malangu|malångu)\b"
    rf"|\b(temp|temperature)\b[^.!?\n]{{0,25}}\b{HIGH_TEMPERATURE}",
    re.I,
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
    rf"\b(?:your baby|the baby|baby|she|he|you|it|this|that|everything)(?:'s|\s+has|\s+have|\s+is|\s+are)\s+(?:\w+\s+){{0,3}}(?:{CONDITIONS}|{ON_HER_NORMAL}|fine|healthy)\b"
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


def classify(message, child_names=()):
    """What a person's own words call for before anything else happens. None for everything else."""
    text = normalized(message)
    if HARM_WORDS.search(text):
        return Safety(HARM, MESSAGES[HARM])
    names = [re.escape(name) for child in child_names for name in re.findall(r"[\w'-]{2,}", child or "")]
    kept = [without_lookups(sentence) for sentence in sentences(text)]
    # Each sentence, then each pair, so "My newborn has a temperature. 38.5 C." reads as one thing.
    pairs = [" ".join(part.rstrip(".!?; ") for part in pair) for pair in zip(kept, kept[1:], strict=False)]
    found = None
    for part in [*kept, *pairs]:
        about_baby = BABY_WORDS.search(part) or (names and re.search(rf"\b({'|'.join(names)})\b", part, re.I))
        if about_baby and BABY_UNWELL_WORDS.search(part):
            return Safety(BABY_UNWELL, MESSAGES[BABY_UNWELL])
        if MATERNAL_SIGNS.search(part):
            found = found or Safety(URGENT_MATERNAL, MESSAGES[URGENT_MATERNAL])
    return found


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
    if states_a_dose(normalized(question), text):
        return DOSE_REFUSAL
    return DIAGNOSIS_REFUSAL if gives_a_diagnosis(text) else None


def cant_answer(message):
    return f"{message}\n\n{CANT_ANSWER_LINE}"


def answer_checks(question, answer):
    """A finished answer, with the rules code can enforce. Returns (message, safety_kind, extra_sources)."""
    if answer.safety in MESSAGES:
        return MESSAGES[answer.safety], answer.safety, []
    refusal = unsafe_output(question, answer.message)
    if refusal:
        return refusal, None, []
    question = normalized(question)
    message, kind, extra = answer.message, None, []
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
    if len(re.findall(r"[^\W\d_]+", text)) >= 5 and not looks_english(text):
        return True
    if kind == "question":
        return False
    return bool(TIMED_FEEDING.search(text) or TIMED_MEDICINE.search(text) or (kind == "event" and (MEDICINE_WORDS.search(text) or FREQUENCY.search(text))))


def must_research_first(question):
    """The vaccine positions are looked up at the time of the question, never recalled."""
    return bool(VACCINE_WORDS.search(question))
