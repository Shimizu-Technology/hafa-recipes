"""AWAITING CLINICIAN REVIEW (MEDICAL_REVIEW sections A and G). Safety rules that don't depend on a model.

Urgent replies are fixed here, in the words of CDC, HHS, 988 and HRSA where those exist, and are chosen before
anything that could refuse to answer: the AI being off, a limit, a budget, consent. These patterns lean toward
firing, since a false alarm that shows Help is acceptable and a miss isn't. The prompt is a second layer.
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
ENGLISH_ONLY_REFUSAL = "I can only check answers in English for now, so I can't share this one. Please ask your doctor, or try asking in English."
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
    "logged, cite its record and leave the amount out: the app adds a line from the record. To show what her own note says about a "
    "dose or instruction, add {record_id, words} to quotes, with its exact words: the app shows them as the record's. "
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
    r"|\b(don't|do not) want to (be here|live|wake up)\b"
    r"|\bend (my life|it all)\b"
    r"|\bbetter off without me\b"
    r"|\bthoughts? of (harm\w*|hurt\w*|kill\w*)\b",
    re.I,
)
HIGH_TEMPERATURE = r"(?:3[89]|4[0-2]|100\.[4-9]|10[1-9])(?:\.\d)?"
MATERNAL_SIGNS = re.compile(
    r"\bheadache\w*\b[^.!?\n]{0,40}\b(won't go away|not going away|worse|severe|bad|terrible|for days)\b"
    r"|\b(severe|bad|terrible|worst|awful|constant)\b[^.!?\n]{0,12}\bheadache"
    r"|\b(dizz\w+|faint\w*|passed out|pass out|black(ed)? out)\b"
    r"|\b(vision|eyesight)\b[^.!?\n]{0,30}\b(blurr\w*|chang\w*|spots?|double|lost|gone|dark\w*|flash\w*)\b|\b(blurr\w*|double) vision\b|\bseeing (spots|stars|flash\w*)\b"
    rf"|\b(fever|temp|temperature)\b[^.!?\n]{{0,25}}\b{HIGH_TEMPERATURE}|\b{HIGH_TEMPERATURE}\b[^.!?\n]{{0,20}}\bfever\b"
    r"|\b(extreme|severe|really|very|bad)\b[^.!?\n]{0,12}\bswell\w*\b|\bswollen\b[^.!?\n]{0,20}\b(face|hands?)\b|\b(face|hands?)\b[^.!?\n]{0,20}\b(swollen|swelling|swelled)\b"
    r"|\b(trouble|hard|difficulty|can't|cannot|can not|struggling to)\b[^.!?\n]{0,12}\bbreath\w*\b|\bshort(ness)? of breath\b"
    r"|\bchest\b[^.!?\n]{0,20}\b(pain|hurts?|tight\w*|pressure)\b|\bheart\b[^.!?\n]{0,20}\b(racing|pounding|fast)\b|\bpalpitation\w*\b"
    r"|\b(severe|bad|terrible|constant|nonstop|can't stop)\b[^.!?\n]{0,20}\b(nausea|throwing up|vomit\w*)\b"
    r"|\b(severe|bad|terrible|sharp|awful|unbearable)\b[^.!?\n]{0,20}\b(belly|stomach|abdominal|tummy)\b[^.!?\n]{0,12}\bpain\b|\b(belly|stomach|abdominal|tummy) pain\b[^.!?\n]{0,30}\b(severe|won't go away|not going away)\b"
    r"|\b(baby|she|he)\b[^.!?\n]{0,20}\b(hasn't moved|has not moved|isn't moving|not moving|moving less|not moving as much|stopped moving|stopped kicking|not kicking)\b"
    r"|\b(kicks?|kicking|movements?)\b[^.!?\n]{0,25}\b(stopped|slowed|slowing|less|fewer)\b|\b(less|fewer|reduced|decreased)\b[^.!?\n]{0,15}\b(kicks?|kicking|movements?|moving)\b"
    r"|\b(haven't|have not|can't|cannot) (felt|feel)\b[^.!?\n]{0,20}\b(kick\w*|move\w*)\b|\bno (movements?|kicks?|kicking)\b"
    r"|\b(bleeding|bleed|blood(?! pressure| type| test| sugar| work)|clots?|hemorrhag\w*)\b|\bsoak\w*\b[^.!?\n]{0,25}\bpads?\b"
    r"|\b(fluid|water)\b[^.!?\n]{0,15}\b(leak\w*|broke|gush\w*)\b|\bleaking\b[^.!?\n]{0,15}\bfluid\b"
    r"|\b(foul|smell\w*)\b[^.!?\n]{0,15}\bdischarge\b|\bdischarge\b[^.!?\n]{0,15}\b(foul|smell\w*)\b"
    r"|\b(leg|calf|arm)\b[^.!?\n]{0,30}\b(swollen|swell\w*|red|redness|severe)\b"
    r"|\boverwhelming (tired\w*|exhaust\w*|fatigue)\b",
    re.I,
)
BABY_WORDS = re.compile(r"\b(my baby|the baby|baby|newborn|infant|nene|neni|she|he|her|him|daughter|son)\b", re.I)
BABY_UNWELL_WORDS = re.compile(
    r"\b(floppy|limp|lethargic|unresponsive|won't wake|wont wake|hard to wake|not waking|can't wake|turning blue|blue lips|lips? (?:is |are |look |looks )?(?:blue|dusky)|dusky|gasping|"
    r"not breathing|isn't breathing|stopped breathing|breathing\W+not anymore|trouble breathing|struggling to breathe|struggling for (?:air|breath)|"
    r"can't breathe|cannot breathe|can not breathe|breathing problems?|choking|seizure\w*|convuls\w*|"
    r"(?:fell|fall|fallen|falling)(?! asleep)|hit (her|his|their) head|burned|burnt|bleeding|is hurt|got hurt|injur\w*|"
    r"fever\w*|very sick|really sick|seems sick|won't eat|refusing to eat|not eating|not feeding|won't stop crying|inconsolable|"
    r"(?:no|not had a|hasn't had a|without a) wet diapers?|dehydrat\w*|vomiting|throwing up|malangu|malångu)\b"
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
    r"^\W*(?:what|which|where|when|did|does|do|has|have|is there|can you|could you)\b[^?]*"
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
DIAGNOSIS_ASKED = re.compile(
    rf"\bis (?:this|it|that)\b[^.!?\n]{{0,15}}\b{CONDITIONS}\b"
    rf"|\b(?:does|do|could|can|might)\b[^.!?\n]{{0,20}}\bhave\b[^.!?\n]{{0,20}}\b{CONDITIONS}\b"
    r"|\bwhat(?:'s| is) wrong\b|\bdiagnos\w*"
    r"|\b(?:is|are|does|do|was|were)\b[^.!?\n]{0,60}\b(?:normal|too (?:much|little|many|few|low|high)|concerning|worrying|dangerous|serious)\b",
    re.I,
)
DOSE_ASKED = re.compile(r"\b(how much|how many|how often|dose\w*|dosage|mg|milligrams?|safe amount)\b", re.I)
MEDICINE_WORDS = re.compile(
    r"\b(tylenol|acetaminophen|paracetamol|ibuprofen|motrin|advil|aspirin|amoxicillin|antibiotic\w*|benadryl|zofran|unisom|insulin|medicine\w*|meds?|medication\w*|prescri\w*|supplement\w*|vitamin\w*|herb\w*)\b",
    re.I,
)
LOG_LOOKUP = re.compile(r"\b(log|logged|record\w*|wrote|entered|when did|how many times|last time)\b", re.I)
NUMBER = r"(?:\d+(?:[./]\d+)?|[½¼¾⅓⅔]|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|couple|few|several)"
QUANTITY = rf"{NUMBER}(?:\s*(?:-|–|to|or|and a|and)\s*{NUMBER})*(?:\s+(?:of\s+)?(?:an?\s+)?)?\s*-?\s*"
DOSE_UNIT = (
    r"(?:mg|mcg|milligrams?|micrograms?|iu|units?|tablets?|caplets?|capsules?|pills?|gumm(?:y|ies)|drops?|droppers?|puffs?|sprays?|"
    r"sachets?|doses?|teaspoons?|teaspoonfuls?|tsps?|tablespoons?|tbsps?|grams?)"
)
DOSE_AMOUNT = re.compile(rf"\b{QUANTITY}{DOSE_UNIT}\b", re.I)
DOSE_INSTRUCTED = re.compile(rf"\b(?:give|take|administer|use)\b(?:\s+\w+){{0,3}}?\s+an?\s+{DOSE_UNIT}\b", re.I)
LIQUID_AMOUNT = re.compile(rf"\b{QUANTITY}(?:ml|milliliters?|millilitres?|cc|oz|ounces?)\b", re.I)
FREQUENCY = re.compile(
    r"\b(?:every\s+\w+(?:\s+to\s+\w+)?\s+hours?|every\s+hour|(?:once|twice|thrice|\w+\s+times?)\s+(?:a|per)\s+day|(?:once|twice|\w+\s+times?)\s+daily)\b",
    re.I,
)
IMPERATIVE = re.compile(r"\b(give|take|administer)\b", re.I)
NOT_DOING = re.compile(r"\b(?:can't|cannot|can not|won't|will not|don't|do not|never|not)\s+(?:\w+\s+)?$", re.I)
# A refusal only covers what it's a refusal of: "I can't say whether it's eczema", not "I can't diagnose, but it's eczema".
ABOUT_THE_PREDICATE = re.compile(r"\b(?:can't|cannot|can not|won't|unable to|not able to|don't know|not sure)\b[^,;]{0,30}\b(?:if|whether|what|why)\b[^,;]*$", re.I)
DIAGNOSIS_GIVEN = re.compile(
    rf"\b(?:your baby|the baby|baby|she|he|you|it|this|that|everything)(?:'s|\s+has|\s+have|\s+is|\s+are)\s+(?:\w+\s+){{0,3}}(?:{CONDITIONS}|normal|fine|healthy)\b"
    rf"|\b(?:sounds?|looks?|seems?)(?:\s+like)?\b[^.!?\n]{{0,25}}\b(?:{CONDITIONS}|normal|fine|healthy)\b"
    r"|\bprobably\b[^.!?\n]{0,20}\b(?:just|nothing|fine|normal)\b",
    re.I,
)
REASSURANCE = re.compile(
    r"\b(?:no need to|don't need to|do not need to|needn't)\s+(?:call|see|worry|go)\b|\bnothing to worry\b|\bwait until (?:tomorrow|morning)\b",
    re.I,
)
# Enough plain English to tell it from anything else, leaving out words other languages share, like "a", "i", "no" and "me".
COMMON_ENGLISH = frozenset(
    "the an and or but if so as at by for from in of on to with about after before between during into over under up out off "
    "is are was were be been being am do does did done has have had having will would can could should may might must not "
    "you your yours she her hers he him his it its they them their we us our this that these those there here what which who "
    "when where why how all any some more most less other than then now very just only also new good best first last next "
    "one two three four five six seven eight nine ten zero many few each every yes nothing something anything everything "
    "today tonight yesterday tomorrow morning afternoon evening night day days week weeks month months year years hour hours "
    "minutes time times date saved save logged log wrote write said says say see ask asked find found read list steps entry "
    "entries note notes post posts video videos source sources question questions doctor baby babies mom dad parent parents "
    "family child children feed feeds fed feeding feedings sleep slept sleeping nap naps diaper diapers wet dirty bottle bottles "
    "nursing milk pumped appointment visit event calendar checklist journal safe hold help know give take use try make keep put "
    "get go call start stop need want like often usually back side warm skin".split()
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


def instructs(text):
    return any(not NOT_DOING.search(text[:match.start()]) for pattern in (IMPERATIVE, DOSE_INSTRUCTED) for match in pattern.finditer(text))


def states_a_dose(question, message):
    """Across the whole answer, so "Give it now. One and a half teaspoons." counts. Nothing excuses an amount."""
    if DOSE_AMOUNT.search(message) or any(not NOT_DOING.search(message[:match.start()]) for match in DOSE_INSTRUCTED.finditer(message)):
        return True
    about_medicine = MEDICINE_WORDS.search(question) or MEDICINE_WORDS.search(message) or instructs(message)
    return bool(about_medicine and (LIQUID_AMOUNT.search(message) or FREQUENCY.search(message)))


def gives_a_diagnosis(message):
    for sentence in sentences(message):
        for clause in CLAUSE_BREAK.split(sentence):
            if REASSURANCE.search(clause):
                return True
            if any(not ABOUT_THE_PREDICATE.search(clause[:match.start()]) for match in DIAGNOSIS_GIVEN.finditer(clause)):
                return True
    return False


def looks_english(text):
    """The checks here read English. Text they can't read isn't text they've passed."""
    plain = re.sub(r"https?://\S+|\[S?\d+\]", " ", text)
    letters = [char for char in plain if char.isalpha()]
    if letters and sum(not char.isascii() for char in letters) / len(letters) > 0.3:
        return False
    words = re.findall(r"[^\W\d_]+", plain.lower())
    return len(words) < 3 or sum(word in COMMON_ENGLISH for word in words) / len(words) >= 0.25


def unsafe_output(question, message):
    """The fixed line to use instead of this text, or None if the checks pass it."""
    text = normalized(message)
    if states_a_dose(normalized(question), text):
        return DOSE_REFUSAL
    if gives_a_diagnosis(text):
        return DIAGNOSIS_REFUSAL
    return None if looks_english(text) else ENGLISH_ONLY_REFUSAL


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


def must_research_first(question):
    """The vaccine positions are looked up at the time of the question, never recalled."""
    return bool(VACCINE_WORDS.search(question))
