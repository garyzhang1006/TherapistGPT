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
    r"\b(and|to) (not|never) wake up\b(?! (on time|early|before|in time|until|till)\b)",
    r"\b(hope|wish) i (don'?t|do not|never) wake up\b",
    r"\b(hurt|hurting|cut|cutting|burn|burning|harm|harming|hang|hanging|starve|starving) my ?self\b",
    r"\b(shoot|shooting) my ?self\b(?! in the foot)",
    r"\b(drown|drowning) my ?self\b(?! in\b)",
    r"\bself[- ]?harm\b",
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
    r"\bstop existing\b",
    r"\b(notice|care|miss me) if i (died|disappeared|was gone|were gone|wasn'?t here|weren'?t here)\b",
    r"\bno point (in )?living\b",
    # "what's the point of this class" stays calm: only living, being alive or existing flags.
    r"\b(what'?s|what is) the point (of|in) (even )?(living|being alive|staying alive|existing|life anymore)\b",
    r"\b(not|isn'?t|is not) worth living\b",
    r"\bnothing (left )?to live for\b",
    r"\btired of (living|being alive|existing)\b",
    r"\b(goodbye|suicide) (note|letter)\b",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in CRISIS_PATTERNS]


def mentions_crisis(text: str) -> bool:
    # Phones and keyboards type apostrophes many ways: ‘ ’ ʼ ` ´ and fullwidth ＇. Same set as safety.js.
    # Whitespace runs collapse too, so "I want to\ndie" reads the same as "I want to die".
    normalized = re.sub(r"\s+", " ", re.sub("[\u2018\u2019\u02bc\u0060\u00b4\uff07]", "'", text))
    return any(p.search(normalized) for p in _COMPILED)
