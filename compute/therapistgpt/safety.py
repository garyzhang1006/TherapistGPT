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
    r"\bwant(ed)? to die\b",
    r"\bwish i (was|were) dead\b",
    r"\bend (it all|my life)\b",
    r"\bdon'?t want to (be here|exist|live|wake up)\b",
    r"\bbetter off without me\b",
    r"\bno reason to live\b",
    r"\bnot wake up\b",
    r"\b(hurt|hurting|cut|cutting|burn|burning) my ?self\b",
    r"\bself[- ]?harm\b",
    r"\bscratch(ing)? my (arms|legs|skin)\b",
    r"\boverdose\b",
    r"\bgiving (my|all my) (stuff|things) away\b",
    r"\bkms\b",
    r"\bunalive\b",
    r"\bcan'?t (go on|do this anymore)\b",
    r"\bdisappear forever\b",
    r"\bno point (in )?living\b",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in CRISIS_PATTERNS]


def mentions_crisis(text: str) -> bool:
    # Normalize curly apostrophes so "don’t" matches the same as "don't".
    normalized = text.replace("’", "'")
    return any(p.search(normalized) for p in _COMPILED)
