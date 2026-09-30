// Crisis phrase detection. Mirrors compute/therapistgpt/safety.py; keep the two lists in sync.
// Runs on every brain dump before any engine, so the helpline card never depends on a model.

export const CRISIS_PATTERNS = [
  /\bkill(ing)? my ?self\b/i,
  /\bsuicid(e|al)\b/i,
  /\b(want(ed|s)? to|wanna|wish i could) die\b/i,
  /\bwish i (was|were) (dead|gone|never born)\b/i,
  /\bwish i('d| had)? never (been born|existed|woken up)\b/i,
  /\bend(ing)? (it all|my life|my own life)\b/i,
  /\btak(e|ing) my own life\b/i,
  /\btak(e|ing) my life\b(?! (back|seriously|in|into|one|more|a|to|and|for|over)\b)/i,
  /\b(don'?t|do not) (want to|wanna) (be here|exist|live|wake up|be alive)\b/i,
  /\bbetter (off )?(dead|without me)\b/i,
  /\bbetter off if i (was|were) (gone|dead)\b/i,
  /\bbetter off if i (wasn'?t|weren'?t) (here|around|alive)\b/i,
  /\bno reason to live\b/i,
  /\b(and|to) (not|never) wake up\b(?! (on time|early|before|in time|until|till)\b)/i,
  /\b(hope|wish) i (don'?t|do not|never) wake up\b/i,
  /\b(hurt|hurting|cut|cutting|burn|burning|harm|harming|hang|hanging|starve|starving) my ?self\b/i,
  /\b(shoot|shooting) my ?self\b(?! in the foot)/i,
  /\b(drown|drowning) my ?self\b(?! in\b)/i,
  /\bself[- ]?harm\b/i,
  /\bscratch(ing)? my (arms|legs|skin)\b/i,
  /\boverdos(e|ed|es|ing)\b/i,
  /\b(saving|saved|stockpiling|stockpiled|hoarding) (up )?(my |the )?(pills|meds)\b/i,
  /\b(pills|meds) (saved|stockpiled|hoarded)\b/i,
  /\bgiving (my|all my) (stuff|things) away\b/i,
  /\b(been|started|start) saying goodbye\b/i,
  /\bwon'?t be (around|here) (much |for )?(longer|long|anymore)\b/i,
  /\bkms\b/i,
  /\bunaliv(e|ed|es|ing)\b/i,
  /\bcan'?t (go on|do this anymore|take (it|this) anymore)\b/i,
  /\bdisappear forever\b/i,
  /\bstop existing\b/i,
  /\b(notice|care|miss me) if i (died|disappeared|was gone|were gone|wasn'?t here|weren'?t here)\b/i,
  /\bno point (in )?living\b/i,
  /\b(not|isn'?t|is not) worth living\b/i,
  /\bnothing (left )?to live for\b/i,
  /\btired of (living|being alive|existing)\b/i,
  /\b(goodbye|suicide) (note|letter)\b/i,
];

export function mentionsCrisis(text) {
  // Phones and keyboards type apostrophes many ways: ‘ ’ ʼ ` ´ and fullwidth ＇. Line breaks and
  // double spaces are collapsed too, so "I want to\ndie" reads the same as "I want to die".
  const normalized = String(text).replace(/[\u2018\u2019\u02BC\u0060\u00B4\uFF07]/g, "'").replace(/\s+/g, " ");
  return CRISIS_PATTERNS.some((pattern) => pattern.test(normalized));
}

export const CRISIS_SUMMARY =
  "What you wrote sounds really heavy, and I'm glad you put it into words. You deserve real support with this right now.";

export const CRISIS_STEP =
  "Call or text 988 (US and Canada) or your local crisis line now, or tell someone near you that you're not safe.";

// Same override the server applies: a keyword hit always wins over the model's judgment.
export function applySafetyFloor(text, output) {
  if (mentionsCrisis(text) && !output.needs_support) {
    return { ...output, needs_support: true, summary: CRISIS_SUMMARY, one_small_step: CRISIS_STEP, kinder_view: [] };
  }
  return output;
}
