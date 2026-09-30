// Crisis phrase detection. Mirrors compute/therapistgpt/safety.py; keep the two lists in sync.
// Runs on every brain dump before any engine, so the helpline card never depends on a model.

export const CRISIS_PATTERNS = [
  /\bkill(ing)? my ?self\b/i,
  /\bsuicid(e|al)\b/i,
  /\bwant(ed)? to die\b/i,
  /\bwish i (was|were) dead\b/i,
  /\bend (it all|my life)\b/i,
  /\bdon'?t want to (be here|exist|live|wake up)\b/i,
  /\bbetter off without me\b/i,
  /\bno reason to live\b/i,
  /\bnot wake up\b/i,
  /\b(hurt|hurting|cut|cutting|burn|burning) my ?self\b/i,
  /\bself[- ]?harm\b/i,
  /\bscratch(ing)? my (arms|legs|skin)\b/i,
  /\boverdose\b/i,
  /\bgiving (my|all my) (stuff|things) away\b/i,
  /\bkms\b/i,
  /\bunalive\b/i,
  /\bcan'?t (go on|do this anymore)\b/i,
  /\bdisappear forever\b/i,
  /\bno point (in )?living\b/i,
];

export function mentionsCrisis(text) {
  // Phones and keyboards type apostrophes many ways: ‘ ’ ʼ ` ´ and fullwidth ＇.
  const normalized = String(text).replace(/[\u2018\u2019\u02BC\u0060\u00B4\uFF07]/g, "'");
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
