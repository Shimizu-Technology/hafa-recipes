"""AWAITING CLINICIAN REVIEW (MEDICAL_REVIEW sections A and G). Safety rules that don't depend on a model.

Words are the packet's. Urgent replies are fixed here rather than left to a model's wording, and when
one applies the model is never called. These patterns lean toward firing; the prompt is a second layer.
"""

import re
from typing import NamedTuple

URGENT_MATERNAL, HARM, BABY_UNWELL, MENTAL_HEALTH = "urgent_maternal", "harm", "baby_unwell", "mental_health"

CALL_911 = "Please call 911 or go to the nearest emergency room if you are experiencing a medical emergency."
CALL_988 = "Thoughts of harming yourself or your baby, or in crisis? Call or text 988, the Suicide & Crisis Lifeline, any time. It's free and confidential."
CALL_MAMA = (
    "National Maternal Mental Health Hotline. Call or text 1-833-TLC-MAMA (1-833-852-6262). Free, confidential, 24/7, "
    "for pregnant people and new parents."
)
MESSAGES = {
    URGENT_MATERNAL: (
        "This can be a sign of something serious. Seek medical care now. If it's an emergency, call 911.\n\n"
        "When you can, I can help you write down what to tell the doctor."
    ),
    HARM: f"{CALL_911}\n\n{CALL_988}\n\n{CALL_MAMA}",
    BABY_UNWELL: "Call your baby's doctor now, or call 911 if it may be an emergency.",
}
DOSE_REFUSAL = "I can't give a dose. Please ask your doctor or pharmacist."
VACCINE_CLOSING = "Your baby's doctor can tell you what's due."
VACCINE_SOURCES = (
    {"url": "https://www.healthychildren.org/English/safety-prevention/immunizations/Pages/Recommended-Immunization-Schedules.aspx",
     "title": "AAP's immunization schedules for families", "domain": "www.healthychildren.org", "kind": "trusted"},
    {"url": "https://www.cdc.gov/vaccines/hcp/imz-schedules/child-adolescent-age.html",
     "title": "CDC's child immunization schedule", "domain": "www.cdc.gov", "kind": "trusted"},
)
SAFETY_RULES = (
    "Add \"safety\" to your JSON: null, or 'urgent_maternal' if the parent describes an urgent maternal warning sign, 'harm' if "
    "they mention harming themselves or the baby, or 'baby_unwell' if they describe a baby who seems sick or hurt. Those three "
    "get a fixed reply from the app. Do not diagnose. Do not say what a symptom, log entry or reading means for this "
    "person or baby. Do not give a dose, amount, timing or duration for any medicine, supplement or herb, including "
    "weight-based doses. If asked, say you can't give a dose, share what trusted sources say in general with links, and tell "
    "the user to ask their doctor or pharmacist. Treat medicine questions as information, not decisions: say which source says "
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
    r"|\bthoughts? of (harm\w*|hurt\w*|kill\w*)\b",
    re.I,
)
MATERNAL_SIGNS = re.compile(
    r"\bheadache\w*\b[^.!?\n]{0,40}\b(won't go away|won’t go away|not going away|worse|severe|bad|terrible|for days)\b"
    r"|\b(severe|bad|terrible|worst|awful|constant)\b[^.!?\n]{0,12}\bheadache"
    r"|\b(dizz\w+|faint\w*|passed out|pass out|black(ed)? out)\b"
    r"|\b(vision|eyesight)\b[^.!?\n]{0,30}\b(blurr\w*|chang\w*|spots?|double|lost|gone|dark\w*|flash\w*)\b|\b(blurr\w*|double) vision\b|\bseeing (spots|stars|flash\w*)\b"
    r"|\bfever\b[^.!?\n]{0,20}\b(100\.[4-9]|10[1-9])|\b(100\.[4-9]|10[1-9])(\.\d)?\b[^.!?\n]{0,20}\bfever\b"
    r"|\b(extreme|severe|really|very|bad)\b[^.!?\n]{0,12}\bswell\w*\b|\bswollen\b[^.!?\n]{0,20}\b(face|hands?)\b|\b(face|hands?)\b[^.!?\n]{0,20}\b(swollen|swelling|swelled)\b"
    r"|\b(trouble|hard|difficulty|can't|cannot|can not|struggling to)\b[^.!?\n]{0,12}\bbreath\w*\b|\bshort(ness)? of breath\b"
    r"|\bchest\b[^.!?\n]{0,20}\b(pain|hurts?|tight\w*|pressure)\b|\bheart\b[^.!?\n]{0,20}\b(racing|pounding|fast)\b|\bpalpitation\w*\b"
    r"|\b(severe|bad|terrible|constant|nonstop|can't stop)\b[^.!?\n]{0,20}\b(nausea|throwing up|vomit\w*)\b"
    r"|\b(severe|bad|terrible|sharp|awful|unbearable)\b[^.!?\n]{0,20}\b(belly|stomach|abdominal|tummy)\b[^.!?\n]{0,12}\bpain\b|\b(belly|stomach|abdominal|tummy) pain\b[^.!?\n]{0,30}\b(severe|won't go away|won’t go away|not going away)\b"
    r"|\b(baby|she|he)\b[^.!?\n]{0,20}\b(hasn't moved|has not moved|isn't moving|not moving|moving less|stopped moving|stopped kicking)\b"
    r"|\b(kicks?|kicking|movements?)\b[^.!?\n]{0,25}\b(stopped|slowed|slowing|less|fewer)\b|\b(haven't|have not|can't|cannot) (felt|feel)\b[^.!?\n]{0,20}\b(kick\w*|move\w*)\b"
    r"|\b(bleeding|bleed|blood(?! pressure| type| test| sugar| work)|clots?|hemorrhag\w*)\b|\b(fluid|water)\b[^.!?\n]{0,15}\b(leak\w*|broke|gush\w*)\b|\bleaking\b[^.!?\n]{0,15}\bfluid\b"
    r"|\b(foul|smell\w*)\b[^.!?\n]{0,15}\bdischarge\b|\bdischarge\b[^.!?\n]{0,15}\b(foul|smell\w*)\b"
    r"|\b(leg|calf|arm)\b[^.!?\n]{0,30}\b(swollen|swell\w*|red|redness|severe)\b"
    r"|\boverwhelming (tired\w*|exhaust\w*|fatigue)\b",
    re.I,
)
BABY_WORDS = re.compile(r"\b(my baby|the baby|baby|newborn|infant|she|he|her|him|daughter|son)\b", re.I)
BABY_UNWELL_WORDS = re.compile(
    r"\b(floppy|limp|lethargic|unresponsive|won't wake|wont wake|hard to wake|not waking|can't wake|turning blue|blue lips|lips? (?:is |are |look |looks )?blue|"
    r"not breathing|stopped breathing|trouble breathing|struggling to breathe|choking|seizure\w*|convuls\w*|"
    r"(?:fell|fall|fallen|falling)(?! asleep)|hit (her|his|their) head|burned|burnt|bleeding|is hurt|got hurt|injur\w*|"
    r"fever\w*|very sick|really sick|seems sick|won't eat|refusing to eat|not eating|not feeding|won't stop crying|inconsolable|"
    r"no wet diapers?|dehydrat\w*|vomiting|throwing up)\b",
    re.I,
)
MENTAL_HEALTH_WORDS = re.compile(
    r"\b(postpartum depression|postpartum anxiety|ppd|depress\w*|hopeless\w*|panic attacks?|can't stop crying|cannot stop crying|"
    r"crying all the time|so anxious|really anxious|can't cope|cannot cope|can't do this|numb)\b",
    re.I,
)
# Looking something up isn't describing it, unless the person says it is happening to them.
LOOKUP_WORDS = re.compile(
    r"\b(saved?|video\w*|post\w*|article\w*|journal|logged?|summar\w+|warning signs?|what are|list|find|show me|remind|"
    r"sources?|aap|cdc|guidance|says?|recommend\w*)\b",
    re.I,
)
HAPPENING_NOW = re.compile(
    r"\b(i have|i've|ive|i'm|im|i am|i feel|i can't|i cannot|i haven't|i keep|my \w+ (?:is|are|has|hurts?)|she is|she's|he is|he's)\b",
    re.I,
)
DOSE_ASKED = re.compile(r"\b(how much|how many|dose\w*|dosage|mg|milligrams?|take|give|safe amount)\b", re.I)
MEDICINE_WORDS = re.compile(
    r"\b(tylenol|acetaminophen|paracetamol|ibuprofen|motrin|advil|aspirin|benadryl|zofran|unisom|medicine\w*|medication\w*|supplement\w*|vitamin\w*|herb\w*)\b",
    re.I,
)
LOG_LOOKUP = re.compile(r"\b(logged?|record\w*|wrote|entered|when did|how many times|last time)\b", re.I)
DOSE_GIVEN = re.compile(
    r"\b\d+(?:\.\d+)?\s?(?:mg|mcg|milligrams?|micrograms?|iu|tablets?|capsules?|pills?|drops?|ml|teaspoons?|tsp)\b(?:\s?(?:every|per|a day|daily|/))?",
    re.I,
)
VACCINE_WORDS = re.compile(r"\b(vaccin\w*|immuni[sz]\w*|shots?|hep(?:atitis)? b|mmr|rotavirus)\b", re.I)
DOCTOR_WORDS = re.compile(r"\b(pediatrician|paediatrician|baby's doctor|baby’s doctor|your doctor|her doctor|his doctor)\b", re.I)


class Safety(NamedTuple):
    kind: str
    message: str


def classify(message, child_names=()):
    """What a person's own words call for before any model is asked. None for everything else."""
    if HARM_WORDS.search(message):
        return Safety(HARM, MESSAGES[HARM])
    if LOOKUP_WORDS.search(message) and not HAPPENING_NOW.search(message):
        return None
    names = [re.escape(name) for child in child_names for name in re.findall(r"[\w'-]{2,}", child or "")]
    about_baby = BABY_WORDS.search(message) or (names and re.search(rf"\b({'|'.join(names)})\b", message, re.I))
    if about_baby and BABY_UNWELL_WORDS.search(message):
        return Safety(BABY_UNWELL, MESSAGES[BABY_UNWELL])
    if MATERNAL_SIGNS.search(message):
        return Safety(URGENT_MATERNAL, MESSAGES[URGENT_MATERNAL])
    return None


def answer_checks(question, answer):
    """A finished answer, with the rules code can enforce. Returns (message, safety_kind, extra_sources)."""
    if answer.safety in MESSAGES:
        return MESSAGES[answer.safety], answer.safety, []
    message, kind, extra = answer.message, None, []
    if (
        MEDICINE_WORDS.search(f"{question} {message}") and DOSE_GIVEN.search(message)
        and not (LOG_LOOKUP.search(question) and answer.citation_ids)
    ):
        message = DOSE_REFUSAL
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
