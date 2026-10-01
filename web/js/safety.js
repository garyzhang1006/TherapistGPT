// Crisis phrase detection. Mirrors compute/therapistgpt/safety.py; keep both pairs of lists in sync.
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
  // Relapse is often said without "myself" ("cut again last night"). "my hours got cut again" and
  // "they cut the budget again" are calm, so the cut must open the text or a clause, or follow
  // "i" or "been". The anchor sits in the match because Safari before 16.4 can't parse lookbehind.
  // "i cut today's meeting short" is a possessive, so an apostrophe after the time word stays calm.
  /(^|[.!?;:,] |\bi |\bi'?m |\bi'?ve |\b(been|started|start|keep|kept|back to) )(cut|cutting) (again|last night|tonight|today|yesterday|this morning|this week|last week)\b(?!')/i,
  // "want to cut my hair" or "cut back" names what gets cut. Anything else after it ("so much",
  // "but i wont", ":(") or nothing at all means the cut is the person.
  /\b(want(ed|s|ing)? to|wanna|urges? to|tempted to) (cut|burn)\b(?! (my|the|a|an|your|his|her|him|their|them|it|this|that|these|those|some|back|down|off|out|up|in|into|through|loose|ahead|class|school|ties|costs?|corners|carbs|sugar|calories|fat|weight|hair|bridges|everything)\b)/i,
  /\b(burned|burnt) my ?self\b(?! out\b| (on|with) (the|a|my) (stove|stovetop|oven|pan|pot|kettle|iron|curling iron|straightener|grill|toaster|tea|coffee)\b| (while|making|cooking|ironing|baking)\b)/i,
  /\brelaps(e|ed|es|ing) (on |into |with )?(sh|self[- ]?harm|cutting|burning)\b/i,
  /\b(sh|cutting) relaps(e|ed|es|ing)\b/i,
  /\b(cut|cutting|slit|slitting) (my |both )?(wrists?|thighs|forearms)\b/i,
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
  // A passive wish shrugged off as indifference ("wouldnt mind if i didnt wake up"). Sleeping in,
  // "die on this hill" and "gone for the weekend" are calm, so those tails stay out.
  /\b((wouldn'?t|would not|won'?t|will not|don'?t|do not) (really |even |honestly )?(mind|care)|(would|i'?d|it'?d) (honestly |really |probably |just )?be (fine|okay|ok|alright|all right|happy|relieved)) if i (just |simply )?((didn'?t|did not|don'?t|do not|never) (wake|woke) up\b(?! (on time|early|before|in time|until|till|at)\b)|(died|die)\b(?! (my|your|his|her|their) hair| on (this|that) hill| trying| laughing| of (embarrassment|boredom|shame|laughter))|(was|were) (dead|gone)\b(?! (for|by|on|till|until|before|from|over|this|next|all|a|tomorrow|tonight|today|tired|last|wrong|serious)\b)|(wasn'?t|weren'?t) (alive|(here|around) anymore)|stopped existing|didn'?t exist)/i,
  // "no point going on" alone means life. "going on about it", "going on a trip" and "living in
  // the city" name something else, so a following object keeps those calm.
  /\b(no|(don'?t|do not|can'?t|cannot|can not|didn'?t|did not) see (the|a|any|much)) point (in |of |to )?((going on|carrying on|keep going|keeping going)\b(?! (about|with|to|at|a|an|the|this|that|these|those|my|our|your|his|her|their|vacation|holiday|trips?|dates?|tour|strike|leave|stage|air|online)\b)|living\b(?! (in|here|there|with|at|off|on|near|together)\b)|being alive|staying alive|existing|life\b(?! (insurance|admin|drawing|coaching|skills?|lessons?|hacks?)\b))/i,
  /\b(i'?m|i am|just|so|honestly|completely|totally|really) (so |just |really |completely |totally |honestly )?(done|finished) with (my |this )?(life|living|being alive|existing)\b(?! (admin|insurance|drawing|science|sciences|coaching|lessons?|skills?|story|stories|situation|arrangements?|room|space|expenses|costs?|in|with|at|here|there|on|for)\b)/i,
  // An older person saying they have lived long enough. "lived long enough to know better" is an
  // everyday idiom, so anything that carries on the sentence keeps it calm.
  /\b(i'?ve|i have) (already )?lived (long )?enough\b(?! (to|in|here|there|with|at|on|life|lives|years|that|for|of)\b)/i,
  // Researching a method. "how many pills to take a day" and "how many advil i can take" are dosing
  // questions, so only "it would take" or "would kill" counts, and a per-day or kick-in tail stays calm.
  /\bhow (many|much) (of (my|the|these|those|her|his) )?(\w+ )?(pills|tablets|meds|medication|medicine|capsules|painkillers|tylenol|advil|ibuprofen|acetaminophen|paracetamol|aspirin|xanax|benadryl) (it would|it'?d|would it|it will|it'?ll|will it|does it|it does|would|it) (takes?|kills?)\b(?! to (work|kick in|help|feel|start)\b| effect\b| for (a|an|the|my|your|his|her|their|cramps|pain)\b| (a|per) day\b| daily\b)/i,
  /\b(lethal|fatal|deadly) (dose|doses|dosage|amount|amounts|quantity)\b/i,
  /\bhow long (does it|would it|will it|it'?d|it would|it will|it does|it|to|(until|till|before) (you|i|someone|a person|people)) (take |takes )?(to )?(die|dies|bleed out|bleeds out|drown|drowns|suffocate)\b(?! (my|your|his|her|their) hair| of (boredom|embarrassment|laughter|old age)\b)/i,
  // "dumb ways to die in minecraft" and "how to die my hair" are calm, so a place or hair after it stays out.
  /\b((look(s|ed|ing)? up|search(es|ed|ing)?( for| up)?|googl(e|es|ed|ing)|research(es|ed|ing)?|read(ing)? up on) (\w+ ){0,2}(ways?|methods?|how) to|(painless|easiest|quickest|fastest|least painful|surest) (ways?|methods?) to) (die|bleed out|overdose)\b(?! (in|on|from|of|my hair|your hair|her hair|his hair|their hair)\b)/i,
  // An urge to step or jump off somewhere. "stepping off the train at my stop" and "jumping off the
  // diving board" name a calm place, so only a height or a bare "off" that ends the clause counts.
  /\b(think(s|ing)? (about|of)|thought (about|of)|urges? to|tempted to|want(s|ed)? to|wanna|wish i could|could just|feel like) (just )?(step(ping)?|jump(ing)?|leap(ing)?|throw(ing)? my ?self) off( (the|a|an|that|this|my) (top of (the|a|an|that|this) )?(\w+ )?(platform|ledge|roof|rooftop|bridge|balcony|building|cliff|edge|overpass|tower|parking garage)\b|[.!?,;]|$)/i,
  // The same urge toward a vehicle, traffic or a wall. "driving into the city" and "the bus stop" stay calm.
  /\b(think(s|ing)? (about|of)|thought (about|of)|urges? to|tempted to|want(s|ed)? to|wanna|wish i could|could just|feel like) (just )?((step(ping)?|jump(ing)?|throw(ing)? my ?self|walk(ing)?|run(ning)?|lie|lying|lay(ing)?) (down |out )?(in front of (a|an|the|some|that|this|oncoming)( \w+)? (train|subway|bus|car|truck|lorry|tram)|into (the |oncoming |the oncoming )?traffic)|(driv(e|ing)|crash(ing)?|swerv(e|ing)|steer(ing)?) (my car |the car )?(into|off) (a|an|the|oncoming)( \w+)? (wall|tree|pole|barrier|guardrail|bridge|cliff|overpass|river|lake|truck|traffic))\b(?! (stop|stops|station|line|schedule|lights?|court|house|driver|ride)\b)/i,
];

// Someone who has decided often says nothing direct: they give things away, write letters, feel a
// sudden calm and stop planning ahead. Each sign alone is everyday ("gave my old notes to sam",
// "wrote letters to colleges"), so only two different ones together flag. One pattern per sign.
export const WARNING_SIGNS = [
  // Giving away belongings. "gave my keys to the landlord" hands something over, so "to" needs a belonging.
  /\b(gave|give|giving|given|gifted|gifting) (away (my|all my|most of my)\b|(my|all my|most of my|some of my)( \w+){0,2} away\b|(my|all my|most of my|some of my) (\w+ )?(guitar|piano|books?|clothes|stuff|things|belongings|possessions|cat|dog|pets?|plants?|games|console|records|vinyl|jewelry|necklace|ring|watch|car|bike|laptop|camera|art|paintings?|journals?|collection) to\b)/i,
  // Goodbye letters or notes. Plain "notes" are class notes, so a note needs a goodbye word.
  /\b(wrote|write|writing|written|left|leaving) (a |some |the |my )?((goodbye|farewell|final|last) (letters?|notes?)|letters (to|for))\b/i,
  // A sudden calm, often after a decision.
  /\b((feel|feels|feeling|felt) (so |really |weirdly |strangely |oddly |kind of )?(calm|peaceful|at peace) (finally|now)|finally (feel |feels |feeling )?(calm|at peace)|(calm|peace|peaceful|relieved) now that i('ve| have)? (decided|made))\b/i,
  // No longer needing things or plans that only matter for a future.
  /\b((won'?t|will not|not gonna|not going to) (need|be needing) (it|this|that|them|these|those|any of (it|this|that|them|these|those)|my (\w+ )?\w+) (anymore|any more|much longer)|(don'?t|do not|no) (really |even )?(need|point|reason) (to|in) (renew|extend|book|plan|refill|register|enroll|sign up))/i,
  // Saying goodbye to people.
  /\b(said|saying|say) (my )?goodbyes?( to\b|[.!?,;]|$)/i,
  // Hopelessness about everything. "what's the point of this meeting" names one thing and stays calm.
  /\b((what'?s|what is) (even )?the point( (of|in) (any of (it|this)|anything|it all|all of (it|this)|trying|even trying|going on)\b|( anymore| at all)?([.!?,;]|$))|nothing (really )?matters (anymore|any more)\b)/i,
  // Putting affairs in order: rehoming a pet, or paying something off so nobody is left with it.
  // Each is everyday before a trip or a move, which is why this is a sign and not a crisis phrase.
  /\b(my affairs (in order|sorted|settled)|(made|making|make) sure (the|my) (cats?|dogs?|pets?|kitten|puppy|birds?|fish|rabbits?|hamsters?)( \w+)? (has|have|gets?|will have|will get) (somewhere|someone|somebody|a (new |good )?home|a place)|(rehom(e|ed|ing)|(found|finding|find) (a )?(new |good )?homes? for) (the|my) (cats?|dogs?|pets?|kitten|puppy|birds?|fish|rabbits?|hamsters?)|(pay|paid|paying|pays|cancel|cancell?ed|cancell?ing|close|closed|closing|settle|settled|settling) ([\w$]+ ){0,6}so (nobody|no one|noone|my family|my (mom|dad|parents|kids|wife|husband|partner|sister|brother)) (gets?|is|are|isn'?t|aren'?t|will be|won'?t be|has to|have to|ends? up)( \w+)? (stuck|left|saddled|burdened) with)\b/i,
];

// Fast typing swaps letters, and a word spelled wrong should still count: "i wnat to die" must flag
// whichever engine organizes the text, so the fixes live here and in safety.py, not in one engine.
// Only slips that are never real words are listed.
export const TYPOS = {
  ahve: "have", hvae: "have", haev: "have", teh: "the", adn: "and", dealine: "deadline", deadine: "deadline",
  becuase: "because", becasue: "because", beacuse: "because", shoudl: "should", shuold: "should", woudl: "would",
  nede: "need", emial: "email", eamil: "email", apointment: "appointment", appointmnet: "appointment",
  tommorow: "tomorrow", tomorow: "tomorrow", tommorrow: "tomorrow", wierd: "weird", thier: "their",
  freind: "friend", freinds: "friends", wnat: "want", waht: "what", jsut: "just", taht: "that", alot: "a lot",
};
const TYPO_WORDS = new RegExp(`\\b(${Object.keys(TYPOS).join("|")})\\b`, "gi");

export function fixTypos(text) {
  return String(text).replace(TYPO_WORDS, (word) => TYPOS[word.toLowerCase()]);
}

export function mentionsCrisis(text) {
  // Phones and keyboards type apostrophes many ways: ‘ ’ ʼ ` ´ and fullwidth ＇. Line breaks and
  // double spaces are collapsed too, so "I want to\ndie" reads the same as "I want to die".
  const normalized = fixTypos(String(text).replace(/[\u2018\u2019\u02BC\u0060\u00B4\uFF07]/g, "'").replace(/\s+/g, " "));
  if (CRISIS_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  // Each sign counts once, so the same sign said twice is still one.
  return WARNING_SIGNS.filter((pattern) => pattern.test(normalized)).length >= 2;
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
