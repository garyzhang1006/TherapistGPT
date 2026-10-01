// Crisis phrase detection. Mirrors compute/therapistgpt/safety.py; keep the two lists in sync.
// Runs on every brain dump before any engine, so the helpline card never depends on a model.

export const CRISIS_PATTERNS = [
  /\bkill(ing)? my ?self\b/i,
  /\bsuicid(e|al)\b/i,
  // "i want to die my hair blue" means dye. Only a color, "again", "back" or the end of the text
  // after "hair" counts as dye, because a line break collapses to a space and "die\nmy hair's
  // falling out" must still flag; a false alarm is cheap. "die. my hair" flags on the period.
  /\b(want(ed|s)? to|wanna|wish i could) die\b(?! (my|your|his|her|their) hair( (blue|red|pink|purple|green|black|blonde|blond|brown|silver|white|orange|grey|gray|again|back)\b|$))/i,
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
  // People soften the wish with a filler or two ("and just not wake up"), which must not hide it.
  /\b(and|to) ((just|simply|ever|really|finally|then|maybe|honestly) ){0,2}(not|never)( ever)? wake up\b(?! (on time|early|before|in time|until|till)\b)/i,
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
  // "the stain should disappear for good" is calm, so "for good" needs the person to want it.
  /\b(want(ed|s)? to|wanna|wish i could|i could|rather|i'?m going to|i'?m gonna|i need to) (just )?(disappear|vanish) (for good|permanently|and never come back)\b/i,
  /\bstop existing\b/i,
  // "the file does not exist" is calm: only a wish ("to", "and", "just", "rather") before it flags.
  /\b(to|and|just|simply|rather|wanna) not exist\b/i,
  /\bwish(ed)? i (didn'?t|did not|don'?t|do not) exist\b/i,
  /\b(notice|care|miss me) if i (died|disappeared|was gone|were gone|wasn'?t here|weren'?t here)\b/i,
  /\bno point (in )?living\b/i,
  // "what's the point of this class" stays calm: only living, being alive or existing flags.
  /\b(what'?s|what is) the point (of|in) (even )?(living|being alive|staying alive|existing|life anymore)\b/i,
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

// Stands in when every thread point was a crisis sentence, since the results need at least one thread.
export const CRISIS_THREAD = { title: "Inside your head", points: ["Something very heavy, and it deserves real support."] };

// Same override the server applies: a keyword hit always wins over the model's judgment, and
// a crisis phrase never comes back as a to-do, whatever the model decided. Thread points that
// mention a crisis go too: the crisis card already answers those words, and printing someone's
// worst sentence back to them is unkind.
export function applySafetyFloor(text, output) {
  const to_dos = output.to_dos.filter((todo) => !mentionsCrisis(`${todo.task} ${todo.first_step}`));
  let threads = output.threads
    .map((thread) => ({ ...thread, points: thread.points.filter((point) => !mentionsCrisis(point)) }))
    .filter((thread) => thread.points.length);
  if (!threads.length && output.threads.length) threads = [{ ...CRISIS_THREAD, points: [...CRISIS_THREAD.points] }];
  if (mentionsCrisis(text) && !output.needs_support) {
    return { ...output, threads, to_dos, needs_support: true, summary: CRISIS_SUMMARY, one_small_step: CRISIS_STEP, kinder_view: [] };
  }
  return { ...output, threads, to_dos };
}
