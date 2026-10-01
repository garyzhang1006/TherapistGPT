"""Crisis phrase detection used as a floor under the model.

A 1.5B model will miss some crisis messages. This keyword check runs on every input, and if it
fires, needs_support is forced to true no matter what the model said. It is deliberately broad:
a false alarm shows a helpline card, a miss can cost a life. Keep web/js/safety.js in sync.
"""

from __future__ import annotations

import re

CRISIS_PATTERNS = [
    r"\bkill(ing)? my ?self\b",
    r"\bsuicid(e|al)\b",
    # "i want to die my hair blue" means dye. Only a color, "again", "back" or the end of the text
    # after "hair" counts as dye, because a line break collapses to a space and "die\nmy hair's
    # falling out" must still flag; a false alarm is cheap. "die. my hair" flags on the period.
    r"\b(want(ed|s)? to|wanna|wish i could) die\b(?! (my|your|his|her|their) hair( (blue|red|pink|purple|green|black|blonde|blond|brown|silver|white|orange|grey|gray|again|back)\b|$))",
    r"\bwish i (was|were) (dead|gone|never born)\b",
    r"\bwish i('d| had)? never (been born|existed|woken up)\b",
    r"\bend(ing)? (it all|my life|my own life)\b",
    r"\btak(e|ing) my own life\b",
    r"\btak(e|ing) my life\b(?! (back|seriously|in|into|one|more|a|to|and|for|over)\b)",
    r"\b(don'?t|do not) (want to|wanna) (be here|exist|live|wake up|be alive)\b",
    r"\bbetter (off )?(dead|without me)\b",
    r"\bbetter off if i (was|were) (gone|dead)\b",
    r"\bbetter off if i (wasn'?t|weren'?t) (here|around|alive)\b",
    r"\bno reason to live\b",
    # People soften the wish with a filler or two ("and just not wake up"), which must not hide it.
    r"\b(and|to) ((just|simply|ever|really|finally|then|maybe|honestly) ){0,2}(not|never)( ever)? wake up\b(?! (on time|early|before|in time|until|till)\b)",
    r"\b(hope|wish) i (don'?t|do not|never) wake up\b",
    r"\b(hurt|hurting|cut|cutting|burn|burning|harm|harming|hang|hanging|starve|starving) my ?self\b",
    r"\b(shoot|shooting) my ?self\b(?! in the foot)",
    r"\b(drown|drowning) my ?self\b(?! in\b)",
    r"\bself[- ]?harm\b",
    # Relapse is often said without "myself" ("cut again last night"). "my hours got cut again" and
    # "they cut the budget again" are calm, so the cut must open the text or a clause, or follow
    # "i" or "been". The anchor sits in the match because Safari before 16.4 can't parse lookbehind.
    # "i cut today's meeting short" is a possessive, so an apostrophe after the time word stays calm.
    r"(^|[.!?;:,] |\bi |\bi'?m |\bi'?ve |\b(been|started|start|keep|kept|back to) )(cut|cutting) (again|last night|tonight|today|yesterday|this morning|this week|last week)\b(?!')",
    # "want to cut my hair" names what gets cut; with nothing after it, the cut is the person.
    r"\b(want(ed|s|ing)? to|wanna|urges? to|tempted to) (cut|burn)( (again|so bad|so badly|really bad|tonight|right now)\b|[.!?,;]|$)",
    r"\b(burned|burnt) my ?self\b(?! out\b| (on|with) (the|a|my) (stove|stovetop|oven|pan|pot|kettle|iron|curling iron|straightener|grill|toaster|tea|coffee)\b| (while|making|cooking|ironing|baking)\b)",
    r"\brelaps(e|ed|es|ing) (on |into |with )?(sh|self[- ]?harm|cutting|burning)\b",
    r"\b(sh|cutting) relaps(e|ed|es|ing)\b",
    r"\b(cut|cutting|slit|slitting) (my |both )?(wrists?|thighs|forearms)\b",
    r"\bscratch(ing)? my (arms|legs|skin)\b",
    r"\boverdos(e|ed|es|ing)\b",
    r"\b(saving|saved|stockpiling|stockpiled|hoarding) (up )?(my |the )?(pills|meds)\b",
    r"\b(pills|meds) (saved|stockpiled|hoarded)\b",
    r"\bgiving (my|all my) (stuff|things) away\b",
    r"\b(been|started|start) saying goodbye\b",
    r"\bwon'?t be (around|here) (much |for )?(longer|long|anymore)\b",
    r"\bkms\b",
    r"\bunaliv(e|ed|es|ing)\b",
    r"\bcan'?t (go on|do this anymore|take (it|this) anymore)\b",
    r"\bdisappear forever\b",
    # "the stain should disappear for good" is calm, so "for good" needs the person to want it.
    r"\b(want(ed|s)? to|wanna|wish i could|i could|rather|i'?m going to|i'?m gonna|i need to) (just )?(disappear|vanish) (for good|permanently|and never come back)\b",
    r"\bstop existing\b",
    # "the file does not exist" is calm: only a wish ("to", "and", "just", "rather") before it flags.
    r"\b(to|and|just|simply|rather|wanna) not exist\b",
    r"\bwish(ed)? i (didn'?t|did not|don'?t|do not) exist\b",
    r"\b(notice|care|miss me) if i (died|disappeared|was gone|were gone|wasn'?t here|weren'?t here)\b",
    r"\bno point (in )?living\b",
    # "what's the point of this class" stays calm: only living, being alive or existing flags.
    r"\b(what'?s|what is) the point (of|in) (even )?(living|being alive|staying alive|existing|life anymore)\b",
    r"\b(not|isn'?t|is not) worth living\b",
    r"\bnothing (left )?to live for\b",
    r"\btired of (living|being alive|existing)\b",
    r"\b(goodbye|suicide) (note|letter)\b",
]

# Someone who has decided often says nothing direct: they give things away, write letters, feel a
# sudden calm and stop planning ahead. Each sign alone is everyday ("gave my old notes to sam",
# "wrote letters to colleges"), so only two different ones together flag. One pattern per sign.
WARNING_SIGNS = [
    # Giving away belongings.
    r"\b(gave|give|giving|given|gifted|gifting) (away (my|all my|most of my)\b|(my|all my|most of my|some of my)( \w+){0,2} (to|away)\b)",
    # Goodbye letters or notes. Plain "notes" are class notes, so a note needs a goodbye word.
    r"\b(wrote|write|writing|written|left|leaving) (a |some |the |my )?((goodbye|farewell|final|last) (letters?|notes?)|letters (to|for))\b",
    # A sudden calm, often after a decision.
    r"\b((feel|feels|feeling|felt) (so |really |weirdly |strangely |oddly |kind of )?(calm|peaceful|at peace) (finally|now)|finally (feel |feels |feeling )?(calm|at peace)|(calm|peace|peaceful|relieved) now that i('ve| have)? (decided|made))\b",
    # No longer needing things or plans that only matter for a future.
    r"\b((won'?t|will not|not gonna|not going to) (need|be needing) (it|this|that|them|these|those|any of (it|this|that|them|these|those)|my (\w+ )?\w+) (anymore|any more|much longer)|(don'?t|do not|no) (really |even )?(need|point|reason) (to|in) (renew|extend|book|plan|refill|register|enroll|sign up))",
    # Saying goodbye to people.
    r"\b(said|saying|say) (my )?goodbyes?( to\b|[.!?,;]|$)",
    # Hopelessness about everything. "what's the point of this meeting" names one thing and stays calm.
    r"\b((what'?s|what is) (even )?the point( (of|in) (any of (it|this)|anything|it all|all of (it|this)|trying|even trying|going on)\b|( anymore| at all)?([.!?,;]|$))|nothing (really )?matters (anymore|any more)\b)",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in CRISIS_PATTERNS]
_WARNING_SIGNS = [re.compile(p, re.IGNORECASE) for p in WARNING_SIGNS]


def mentions_crisis(text: str) -> bool:
    # Phones and keyboards type apostrophes many ways: ‘ ’ ʼ ` ´ and fullwidth ＇. Same set as safety.js.
    # Whitespace runs collapse too, so "I want to\ndie" reads the same as "I want to die".
    normalized = re.sub(r"\s+", " ", re.sub("[\u2018\u2019\u02bc\u0060\u00b4\uff07]", "'", text))
    if any(p.search(normalized) for p in _COMPILED):
        return True
    # Each sign counts once, so the same sign said twice is still one.
    return sum(1 for p in _WARNING_SIGNS if p.search(normalized)) >= 2
