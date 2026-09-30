// On-device organizer: a rule-based stand-in for the model. It returns the same JSON shape
// the model is trained to produce (compute/therapistgpt/schema.py), so the UI renders either.
// No network, no storage. Pure functions only, so it runs under `node --test` as well.

import { mentionsCrisis, CRISIS_PATTERNS, CRISIS_SUMMARY, CRISIS_STEP } from "./safety.js?v=4";

const LIMITS = { threads: 5, points: 6, todos: 6, reframes: 3, feelings: 6 };

const TOPICS = [
  { title: "School", words: /\b(class|classes|school|exam|exams|test|quiz|homework|essay|professor|teacher|grade|grades|lab|lecture|assignment|college|study|studying|semester|course|thesis|advisor)\b/i },
  { title: "Work", words: /\b(work|job|boss|manager|shift|coworkers?|meeting|office|fired|client|clients|interview|career|promotion|deadline)\b/i },
  { title: "Money", words: /\b(money|rent|bills?|pay|paid|bank|debt|afford|loan|broke|budget|paycheck|credit card)\b/i },
  { title: "People", words: /\b(mom|mum|dad|mother|father|sister|brother|friends?|partner|boyfriend|girlfriend|husband|wife|hubby|ex|family|fam|parents|roommates?|kids?|son|daughter|grandma|grandpa|cousins?|aunt|uncle|everyone|nobody|people|bf|gf|bff|bffs|bestie|besties|ppl|texted|text back|miss(ing)? (you|him|her|them|[a-z]+ so much))\b/i },
  { title: "Rest and body", words: /\b(sleep|slept|asleep|insomnia|tired|exhausted|eat|ate|eaten|eating|food|hungry|meals?|breakfast|lunch|dinner|shower|showered|sick|pain|headache|meds|medication|pills?|doctor|dentist|therapy|therapist|bed|body|weight)\b/i },
  { title: "Home", words: /\b(room|dishes|laundry|clean|cleaning|mess|messy|apartment|house|home|groceries|move|moving|boxes|kitchen|trash)\b/i },
];
const FALLBACK_TOPIC = "Inside your head";
const OVERFLOW_TOPIC = "Everything else";

// Each feeling also lists the everyday ways people say it without naming it: "idk where to even
// start" is overwhelm, "everyone probably thinks im annoying" is anxiety, "my dog died" is sadness.
const FEELINGS = [
  ["exhausted", /\b(tired|exhausted|drained|worn out|no energy|sleepy|fatigue)\b/i],
  ["overwhelmed", /\b((overwhelm\w*|too much|drowning|so much to do|can'?t keep up|falling behind|behind on everything|(idk|don'?t know|dont know|no idea) where (to|do i) (even )?(start|begin)|where do i (even )?(start|begin)|can'?t (do|deal with|handle|cope with) (this|it|any of this|all of this|everything)|can'?t cope|too many things)\b|i just can'?t\b(?!\s+\w))/i],
  ["anxious", /\b(anxious|anxiety|worried|worry|scared|afraid|nervous|panic\w*|terrified|what if|overthink\w*|replay\w*|keep thinking about|can'?t stop thinking about|(gonna|going to) (be (so )?(mad|pissed|angry|upset|furious|disappointed)|hate me|fire me)|(everyone|they|people|he|she) (probably |prob |must )?(thinks?|hates?) (i'?m|im|me))\b/i],
  ["sad", /\b(sad|crying|cried|cry|tears|heartbroken|grief|miss(ing)? (you|him|her|them|[a-z]+ so much)|miss my (mom|dad|mother|father|friends?|family|home|ex|dog|cat|grandma|grandpa|sister|brother|partner)|(dog|cat|pet|puppy|kitten|bird|hamster|horse|grandma|grandpa|grandmother|grandfather|nana|mom|mum|dad|mother|father|brother|sister|friend|uncle|aunt|cousin|husband|wife|partner) (just |recently )?(died|passed away)|passed away|funeral|lost my (dog|cat|pet|mom|mum|dad|mother|father|grandma|grandpa|brother|sister|friend|best friend|husband|wife|partner|baby))\b/i],
  ["lonely", /\b(lonely|(so|all|feel|feeling|completely|totally) alone|isolated|nobody|no one|no friends|(only|never) (hangs? out|hanging out|talks?|texts?|invites?)( with| to)? me|left out|(don'?t|dont|do not) have anyone)\b/i],
  ["guilty", /\b(guilty|guilt|my fault|should have|shouldn'?t have|feel bad|(snapped|yelled|lashed out|blew up) at|was (so )?(mean|rude|harsh) to|feel (so )?(awful|terrible|horrible)|should (apologize|say sorry)|(mad|upset|angry|annoyed) (at|with) me)\b/i],
  ["ashamed", /\b(ashamed|shame|embarrass\w*|humiliat\w*|pathetic|why can'?t i (just )?(be|act|feel) (normal|okay|ok|like everyone)|everyone else (can|has|is|seems|gets|manages)|(not|never) (good|smart) enough)\b/i],
  ["numb", /\b(numb|empty|nothing matters|feel nothing|feel flat|hollow)\b/i],
  ["hopeless", /\b(hopeless|pointless|what'?s the point|no point|never get better|give up|(tired|sick) of (existing|living|being alive|life|everything|it all|trying)|never (going to|gonna) get better|nothing (will|is going to|ever) change|nothing ever changes)\b/i],
  ["angry", /\b(angry|mad|furious|pissed|rage|annoyed|irritated)\b/i],
  ["stuck", /\b(stuck|(can'?t|cannot|couldn'?t|could not) (do|start|move|get up|get out of bed|make myself|bring myself|get myself|get over|move on|let go)|frozen|froze|paralyzed|should (be over|have gotten over|have moved on)|still not over|(haven'?t|havent) (gotten over|moved on))\b/i],
  ["disappointed", /\b(disappoint\w*|let (him|her|them|everyone|myself) down|failed)\b/i],
  ["frustrated", /\b(frustrat\w*|fed up|sick of|keeps (leaving|forgetting|ignoring|interrupting|borrowing|taking|eating|using|making|yelling|breaking|asking|bugging))\b/i],
  ["scattered", /\b(can'?t (focus|concentrate|think straight)|brain fog|foggy|scattered|all over the place)\b/i],
];

// Only explicit intentions and concrete chores count as to-dos. "I didn't pick up" is a memory, not a task.
const TASK_CUE = /\b(need to|needs to|have to|has to|gotta|got to|should(?! have| be)|supposed to(?! be)|must(?! be)|forgot to|due(?! to)|deadline|appointments?|appts?|refill|reschedul\w*|laundry|dishes|groceries|bills?|rent)\b/i;
// A clause that starts with a chore verb is a task even without "need to": "call mom", "pay rent".
const IMPERATIVE = /^(call|email|text|pay|finish|book|clean|buy|send|submit|schedule|refill|reply to|write|return|cancel|pick up|fill out|study|read|print|prep|prepare|practice|apply|renew|register|order|wash|fold|take out)\b(?!\s+(from|with|was|is|went|that)\b)/i;
// Explicit intent found anywhere in a clause; what follows it is the task.
const INTENT = /\b(need to|needs to|have to|has to|gotta|got to|should|must|supposed to|forgot to)\b/i;
const INTENT_AT = /\b(?:need to|needs to|have to|has to|gotta|got to|should(?: really)?|supposed to|must|forgot to)\s+(.+)$/i;
// Things that already happened are memories unless an intent is stated: "I finally did laundry".
const PAST = /\b(did|finally|already|yesterday|last (night|week|month|year)|missed|went|was|were)\b/i;
// Crisis words never become chores: "I should just kill myself" is not a to-do.
const NOT_A_TASK = /\b(disappear|exist|existing|die|dead|kill|hurt|end it|stop being)\b/i;
// "I was supposed to go to Jess's party but I didn't" is a plan that already fell through: it goes
// with the feelings, not on the plate. A long run-on may split the "but I didn't" into the next clause.
const PAST_PLAN = /\b(?:was|were) supposed to\b/i;
const FELL_THROUGH = /\b(?:but|and)\s+(?:I|we)\s+(?:didn'?t|couldn'?t|did not|could not|never|wasn'?t able to|weren'?t able to)\b/i;
const FELL_THROUGH_LEAD = /^(?:I|we)\s+(?:didn'?t|couldn'?t|did not|could not|never|wasn'?t able to|weren'?t able to)\b/i;
const TASK_LEAD = /^(and |so |but |also |i |im |i'?m |i am |really |still )*(need to|needs to|have to|has to|gotta|got to|should( really)?|am supposed to|supposed to|must|forgot to|want to|also need to)\s+/i;
// "I still haven't emailed my advisor" is an obligation still open, so it is a to-do without any
// "need to". Only the writer's own (I, we, or no subject): "she hasn't paid me back" is hers.
const UNMET = /(?:^|\b(?:I|we)\s+)(?:still\s+|just\s+|really\s+)?(?:haven'?t|havent|have not)(?:\s+(?:even|yet|still|actually))?\s+(emailed|called|texted|messaged|paid|studied|started|replied|answered|sent|submitted|finished|booked|scheduled|responded|returned|filed|mailed|applied|renewed|done|written|cleaned|picked|gotten|reached|checked|opened|read|signed|registered|made|eaten)\b(.*)$/i;
// "I can't even answer one email" names the thing that is waiting.
const CANT_EVEN = /(?:^|\b(?:I|we)\s+)(?:still\s+|just\s+)?(?:can'?t|cant|cannot)\s+even\s+(answer|reply|respond|call|text|email|open|pay|finish|start|send|return|read|do)\b(.*)$/i;
const BASE_VERB = {
  emailed: "email", called: "call", texted: "text", messaged: "message", paid: "pay", studied: "study",
  started: "start", replied: "reply", answered: "answer", sent: "send", submitted: "submit", finished: "finish",
  booked: "book", scheduled: "schedule", responded: "respond", returned: "return", filed: "file", mailed: "mail",
  applied: "apply", renewed: "renew", done: "do", written: "write", cleaned: "clean", picked: "pick", gotten: "get",
  reached: "reach", checked: "check", opened: "open", read: "read", signed: "sign", registered: "register",
  made: "make", eaten: "eat",
};
// With nothing after the verb, the thing it is about was usually named first:
// "I have a bio exam tmrw and I haven't studied at all".
const HAVE_THING = /\b(?:I have|I've got|I got|there'?s) (?:a|an|my|the|this|that) ((?:\w+ ){0,2}?(?:exam|test|quiz|midterm|final|essay|paper|report|assignment|project|presentation|interview|form|application|homework|reading))\b/i;
const NO_OBJECT = /^(?:(?:at|all|yet|anything|a|thing|much|any|of|it|them|that|this|either|still|even|lately|really)\b\s*)*$/i;
// "I have 3 chapters left to read" names its own verb.
const LEFT_TO = /\b(?:I|we)(?:'ve| have)?\s+(?:still\s+)?(?:have|got)\s+((?:\d+|a few|a couple(?: of)?|two|three|four|five|six|so many|some|a bunch of|like \d+)\s+(?:\w+\s+)?\w+)\s+left\s+to\s+(\w+)/i;
// "Roommate keeps leaving her dishes everywhere" is a complaint about someone else's chore.
const SOMEONE_ELSES = /^(?:my |the |our )?(?:roommates?|flatmates?|housemates?|partner|husband|wife|bf|gf|boyfriend|girlfriend|mom|mum|dad|mother|father|sister|brother|kids?|son|daughter|boss|coworkers?|landlord|he|she|they|someone|somebody|everyone|nobody|no one)\s+(?:\w+\s+)?(?:keeps?|never|always|won'?t|doesn'?t|refuses? to|left|leaves|leaving|forgot|forgets)\b/i;
const MY_INTENT = /\b(?:I|we)\s+(?:really\s+|still\s+)?(?:need|have|gotta|got|should|must)\b/i;
// "Rent is late" means pay it.
const DUE_LATE = /^(?:my |the )?(rent|(?:\w+ )?bills?|tuition|credit card(?: bill)?|loan|car payment)(?: payment)? (?:is|are) (?:late|overdue|past due)\b.*$/i;
// "Send it" or "Prob should" leans on the sentence before it and says nothing on its own.
const HEDGE_ONLY = /^(?:(?:prob|probably|maybe|def|definitely|really|actually|honestly|just|so|i|should|must|need|needs|to|have|has|gotta|got|do|it|too|now|yeah|ok|okay)\b\s*)+$/i;
const PRONOUN_ONLY = /^\w+(?: up| out| back| in| off| over)? (?:it|that|this|those|these)(?: (?:up|out|back|in|off|over|now|already|too|asap|today|tonight|tomorrow|soon))?$/i;

const SELF_CRITIC = /\b(feel like (a|an|the) (worst|failure|burden|fraud|mess|loser|bad \w+)|(i'?m|im|i am) (so |such an? |just |literally |a )?(stupid|lazy|useless|worthless|pathetic|failure|mess|terrible|the worst|burden|disgusting|weak|broken|idiot|loser|disappointment|not good enough|not smart enough|too much)|i (always|never) (mess|ruin|screw|fail|forget|let|disappoint|say the wrong|do anything right|get anything right)|i feel (so |really |completely )?(useless|worthless|stupid|pathetic|like such an? \w+)|i suck\b|i can'?t (even )?do anything|what'?s wrong with me|hate myself|i ruin|i mess (everything|it all) up|i'?m bad at)/i;

// True for the harsh self-talk that gets a kinder view, so other views can keep it out of sight too.
export function isSelfCritical(text) {
  return SELF_CRITIC.test(normalize(text));
}

const REFRAMES = [
  [/lazy/i, "Struggling to start things is common when you're running low. That's heaviness, not laziness."],
  [/stupid|idiot|dumb|not smart/i, "One moment of getting something wrong doesn't measure how capable you are."],
  [/burden|too much/i, "People who care about you usually want to know when you're struggling. Needing support isn't the same as being a burden."],
  [/worthless|useless|pathetic|failure|loser|disappointment/i, "A hard stretch changes how you see yourself. It doesn't change what you're worth."],
  [/hate myself/i, "Being this hard on yourself shows how much pain you're in. It isn't a verdict on who you are."],
  [/can'?t (even )?do anything/i,"Days where nothing feels doable say how heavy things are, not how hard you try."],
  [/always|never/i, "Words like always and never make a hard day feel permanent. It can feel true right now without being the whole story."],
  [/worst|terrible|mess|ruin/i, "One hard moment is not the whole of you."],
];
const DEFAULT_REFRAME = "You'd likely speak more gently to a friend who said this about themselves. You deserve that gentleness too.";

const FIRST_STEPS = [
  [/\bemail/i, "Open a new email and write only the subject line"],
  [/\b(call|phone)/i, "Find the number and save it where you'll see it"],
  [/\btext/i, "Type one short line, even just \"hey, thinking of you\""],
  [/\b(essay|report|paper|homework|assignment|thesis|slides|project)/i, "Open the file and write one sentence, any sentence"],
  [/\bform\b/i, "Put the form and a pen on the table"],
  [/\b(exam|test|quiz|study)/i, "Put your notes on the table, open to the first page"],
  [/\b(read|chapters?)\b/i, "Open to the page and read one paragraph"],
  [/\bdishes/i, "Carry one dish to the sink"],
  [/\blaundry/i, "Gather the clothes into one pile"],
  [/\b(clean|room|mess|tidy)/i, "Pick up five things, then stop if you want"],
  [/\bgroceries|shopping/i, "Write down the three things you need most"],
  [/\b(bill|rent|pay|bank|money)/i, "Open the bill or app and look at the number, nothing else"],
  [/\b(meds|medication|pharmacy|refill|prescription)/i, "Find the pharmacy's number or app"],
  [/\b(appointment|doctor|dentist|therapist)/i, "Look up the number and save it in your phone"],
  [/\bshower/i, "Turn on the water and let it warm up"],
  [/\b(eat|food|lunch|dinner|breakfast)/i, "Grab the easiest food within reach"],
  [/\b(lock|car|stove|door)/i, "Check it once, then let yourself stop checking"],
  [/\b(unpack|boxes)/i, "Open one box and put away three things"],
];
const DEFAULT_FIRST_STEP = "Spend two minutes on only the very first part";

// Body basics first: when everything is heavy, water and food make every other step easier.
const STEP_PRIORITY = [/\b(meds|medication|refill|prescription)/i, /\b(eat|food|lunch|dinner)/i, /\b(text|call|email)/i];

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normalize(text) {
  return String(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\r/g, "")
    .trim();
}

// "idk" is filler, except in "idk why im like this" or "idk where to start", where it is the point.
const FILLER_LEAD = /^(and|so|but|also|like|ok so|okay so|ok|okay|idk(?![,\s]+(?:where|why|how|what|if|whether)\b)|anyway|anyways|plus|then|oh and|um|uh)[,\s]+/i;

function cleanClause(raw) {
  let s = raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(?:[-*•·–—>]+\s*|\d+[.)]\s+)/, "")
    .replace(/^(things to do|to-?do( list)?)\s*:\s*/i, "");
  let prev;
  do {
    prev = s;
    s = s.replace(FILLER_LEAD, "");
  } while (s !== prev);
  s = s.replace(/^[,;:\-\s]+|[,;:\-\s.!?]+$/g, "");
  // Lowercase " i " reads as a typo in a tidied list; fix the common forms only.
  s = s.replace(/\bi\b/g, "I").replace(/\bim\b(?=\s+(so|not|just|really|still|always|never|literally|such|a|an|the|in|on|at|gonna|going|fine|ok|okay|tired|sad|scared|sorry|done|worried|afraid|stuck|lost|broke|sick|\w+ing)\b)/gi, "I'm").replace(/\bi'm\b/g, "I'm").replace(/\bdont\b/gi, "don't").replace(/\bcant\b/gi, "can't").replace(/\bdidnt\b/gi, "didn't").replace(/\bhavent\b/gi, "haven't").replace(/\bwont\b/gi, "won't").replace(/\bits been\b/gi, "it's been").replace(/^its\b/i, "It's").replace(/\btheres\b/gi, "there's");
  return capitalize(s);
}

const RUN_ON = /(,?)\s+(?:and|but|so|also)\s+(?=(?:i|i'm|im|my|we|he|she|they|everyone|nobody|it'?s|its|the)\b)/gi;

// A piece can stand alone when it names something: a topic, a feeling, a task, a harsh thought.
function hasAnchor(s) {
  return (
    TOPICS.some((t) => t.words.test(s)) ||
    FEELINGS.some(([, pattern]) => pattern.test(s)) ||
    TASK_CUE.test(s) ||
    SELF_CRITIC.test(s) ||
    mentionsCrisis(s) ||
    unmetTask(s) !== null ||
    LEFT_TO.test(s)
  );
}

// Long unpunctuated run-ons break before "and/but/so" when a new subject follows, except after a
// comma (", and the trash" ends a list) or when the next piece names nothing on its own
// ("and I haven't even started" belongs with the report it is about). A short "and my credit
// card" continues a list ("pay my phone bill and my credit card"), so it stays too.
function splitRunOn(part) {
  if (part.split(/\s+/).length < 10) return [part];
  const cuts = [...part.matchAll(RUN_ON)].filter((m) => !m[1]);
  const pieces = [];
  let start = 0;
  cuts.forEach((m, k) => {
    const next = part.slice(m.index + m[0].length, k + 1 < cuts.length ? cuts[k + 1].index : part.length);
    if (!hasAnchor(next) || /^(?:my|the)\s+\S+(?:\s+\S+)?$/i.test(next.trim())) return;
    pieces.push(part.slice(start, m.index));
    start = m.index + m[0].length;
  });
  pieces.push(part.slice(start));
  return pieces;
}

const BREAK = /,\s*|\s+(?:and|but|so|because|bc|cuz)\s+/gi;

// Breaks at every comma or conjunction whose next piece names something on its own.
function splitLoose(part) {
  const breaks = [...part.matchAll(BREAK)];
  const pieces = [];
  let start = 0;
  breaks.forEach((m, k) => {
    const next = part.slice(m.index + m[0].length, k + 1 < breaks.length ? breaks[k + 1].index : part.length);
    if (!hasAnchor(next)) return;
    pieces.push(part.slice(start, m.index));
    start = m.index + m[0].length;
  });
  pieces.push(part.slice(start));
  return pieces;
}

function crisisSpan(part) {
  let best = null;
  for (const pattern of CRISIS_PATTERNS) {
    const m = part.match(pattern);
    if (m && (!best || m.index < best.start)) best = { start: m.index, end: m.index + m[0].length };
  }
  return best;
}

// "i have a chem quiz tmrw and rent is late and i dont want to be here anymore": only the crisis
// clause goes under Inside your head, and the quiz and the rent keep their own topics. Breaks that
// fall inside the crisis phrase itself ("sleep and never wake up") are left alone, and so is a
// break whose cleaned clause would lose the phrase: in "sleep, and never wake up" the comma sits
// right before "and", which cleanClause strips as filler, leaving a calm-looking "Never wake up".
function splitAroundCrisis(part) {
  const span = crisisSpan(part);
  if (!span) return [part];
  const breaks = [...part.matchAll(BREAK)];
  const before = breaks
    .filter((m) => m.index + m[0].length <= span.start && mentionsCrisis(cleanClause(part.slice(m.index + m[0].length, span.end))))
    .pop();
  const after = breaks.find((m) => m.index >= span.end);
  return [
    ...(before ? splitLoose(part.slice(0, before.index)) : []),
    part.slice(before ? before.index + before[0].length : 0, after ? after.index : part.length),
    ...(after ? splitPart(part.slice(after.index + after[0].length)) : []),
  ];
}

// "work, school, my mom being sick, the apartment is a disaster" lists separate worries, so each
// keeps its own topic. A list after an intent ("need to do laundry, groceries, the form") stays
// whole so it becomes one to-do per chore.
function splitList(part) {
  if ((part.match(/,/g) || []).length < 2 || INTENT.test(part)) return [part];
  const pieces = part.split(/,\s*(?:and\s+)?/).filter((p) => p.trim());
  const topics = new Set(pieces.filter((p) => TOPICS.some((t) => t.words.test(p))).map(topicFor));
  return topics.size >= 2 ? pieces : [part];
}

// "im such a failure i still havent sent the email" is a harsh thought and then a task, so the
// task is not lost with the thought.
function splitSelfTalk(part) {
  const m = part.match(SELF_CRITIC);
  if (!m) return [part];
  const end = m.index + m[0].length;
  const rest = part.slice(end);
  if (!/^\s+(?:i|i'm|im|i've|ive|my)\b/i.test(rest) || rest.trim().split(/\s+/).length < 3) return [part];
  return [part.slice(0, end), ...splitSelfTalk(rest.trim())];
}

function splitPart(part) {
  if (mentionsCrisis(part)) return splitAroundCrisis(part);
  return splitRunOn(part).flatMap(splitSelfTalk).flatMap(splitList);
}

export function splitClauses(text) {
  const parts = normalize(text)
    // Sentence ends become line breaks first. A lookbehind would do it in one regex, but Safari
    // before 16.4 can't parse lookbehinds, and one bad regex stops the whole page from loading.
    .replace(/([.!?;])\s+/g, "$1\n")
    // Texting ends sentences with "lol" or "tbh" instead of a period, and "idk where to even
    // start" is a thought of its own before whatever follows it.
    .replace(/\s+(lol|lmao|lmfao|haha\w*|tbh|ngl)\s+(?=(?:i|i'm|im|i've|ive|my)\b)/gi, " $1\n")
    .replace(/\b((?:idk|i don'?t know|i dont know) where (?:to|do i) (?:even )?(?:start|begin))\s+(?=(?:i|i'm|im|i've|ive|my)\b)/gi, "$1\n")
    .split(/\n+|\s+(?:and then|but also|and also|oh and|plus|anyway|anyways)\s+/i)
    .flatMap(splitPart);
  const clauses = [];
  const seen = new Set();
  for (const part of parts) {
    const clause = cleanClause(part);
    const key = clause.toLowerCase();
    const oneWordOk = TASK_CUE.test(clause) || TOPICS.some((t) => t.words.test(clause));
    if (!clause || (clause.split(/\s+/).length < 2 && !oneWordOk) || seen.has(key)) continue;
    seen.add(key);
    clauses.push(clause);
  }
  // A one-word dump ("tired") still deserves a response, and punctuation or blank space gets a
  // gentle placeholder instead of an empty thread.
  if (!clauses.length) clauses.push(cleanClause(normalize(text)) || "Something you haven't found words for yet");
  return clauses;
}

// On a tie the topic named first wins: "do laundry or I have nothing to wear to work" is about
// the laundry, and work is only the reason.
function topicFor(clause) {
  let best = null;
  let bestScore = 0;
  let bestAt = Infinity;
  for (const topic of TOPICS) {
    const matches = [...clause.matchAll(new RegExp(topic.words.source, "gi"))];
    const score = matches.length;
    const at = score ? matches[0].index : Infinity;
    if (score > bestScore || (score && score === bestScore && at < bestAt)) {
      best = topic.title;
      bestScore = score;
      bestAt = at;
    }
  }
  return best || FALLBACK_TOPIC;
}

// What follows a task is usually how the person feels about it or why it is late, and the task
// reads kinder without it: "Text Sam back, I've been ignoring them for a week" is "Text Sam back".
function trimTail(task) {
  let s = task
    // "Finish the chapter and I haven't opened it" is one task plus a feeling about it.
    .replace(/\s+(?:and|but|so)\s+(?:I|I'm|I've|I'd)\b.*$/i, "")
    .replace(/,\s*(?:I|I'm|I've|I'd|I'll|it|it's|its|they|they're|she|she's|he|he's|we)\b.*$/i, "")
    .replace(/\s+(?:because|bc|cuz|cause|since|even though|otherwise|or else|or (?:I|I'll|ill|I'm|else))\b.*$/i, "")
    .replace(/\s+(?:that |which )?(?:I|I've|ive)\s+(?:keep|kept|been|have been)\s+\w+ing\b.*$/i, "")
    .replace(/\s+it'?s been\b.*$/i, "")
    .replace(/\s+(?:in|for) (?:a|an|\d+|two|three|four|five|a few|a couple of|several|like \d+) (?:days?|weeks?|months?|years?|ages)\b.*$/i, "");
  const harsh = s.search(SELF_CRITIC);
  if (harsh > 0) s = s.slice(0, harsh);
  return s
    .replace(/\s+(I guess|I think|probably|maybe|lol|idk)$/i, "")
    .replace(/\s+(at some point|asap|soon|today|tomorrow|tonight|this week)$/i, "")
    .replace(/[\s,;:.!?-]+$/, "");
}

// The to-do inside an unmet obligation, or null when it names nothing to do.
function unmetTask(clause) {
  const m = clause.match(UNMET) || clause.match(CANT_EVEN);
  if (!m) return null;
  const verb = BASE_VERB[m[1].toLowerCase()] || m[1].toLowerCase();
  let object = trimTail(m[2]).trim();
  // "I haven't done anything productive" or "can't even do anything right" is a verdict on the
  // day, not a thing waiting to be done, so a quantifier counts as no object at all.
  if (NO_OBJECT.test(object) || /^(?:anything|nothing|much|enough)\b/i.test(object)) {
    const thing = clause.match(HAVE_THING);
    if (verb === "eat") object = "something";
    else if (thing) object = `${/^(study|prepare|practice)$/.test(verb) ? "for " : ""}the ${thing[1]}`;
    else return null;
  }
  const task = capitalize(`${verb} ${object}`);
  return isFragment(task) ? null : task;
}

function toTask(clause) {
  const intent = clause.match(INTENT_AT);
  if (!intent) {
    const unmet = unmetTask(clause);
    if (unmet) return unmet;
    const left = clause.match(LEFT_TO);
    if (left) return capitalize(`${left[2].toLowerCase()} ${left[1]}`);
  }
  const task = trimTail(intent ? intent[1] : clause.replace(TASK_LEAD, ""))
    .replace(/^(?:I|I've|we) (?:have|got) (?=(?:the|a|an|my|this|that)\b)/i, "")
    .replace(DUE_LATE, (_, bill) => `Pay ${bill.toLowerCase()}`);
  return capitalize(task);
}

function isFragment(task) {
  return HEDGE_ONLY.test(task) || PRONOUN_ONLY.test(task);
}

// "Laundry, groceries, the school form" is three chores, not one.
function splitTaskList(task) {
  const verbJoin = /\s+and\s+(?=(?:call|book|email|text|pay|clean|do|finish|get|buy|make|send|check|refill|start|reply|submit|schedule)\b)/i;
  if (verbJoin.test(task)) return task.split(verbJoin).map((t) => capitalize(t.trim().replace(/[,;]+$/, "")));
  if ((task.match(/,/g) || []).length < 2) return [task];
  const parts = task
    .split(/,\s*(?:and\s+)?|\s+and\s+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
  // "Do the dishes, the laundry" means do both: carry the first verb onto bare nouns.
  const verb = (parts[0] || "").match(/^(do|clean|buy|get|pay|finish|wash|fold|pick up|take out)\b/i);
  return parts.map((t, k) => capitalize(k && verb && /^(the|my|a|an|some|our)\b/i.test(t) ? `${verb[1].toLowerCase()} ${t}` : t));
}

function firstStepFor(task) {
  for (const [pattern, step] of FIRST_STEPS) if (pattern.test(task)) return step;
  return DEFAULT_FIRST_STEP;
}

function reframeFor(thought) {
  for (const [pattern, reframe] of REFRAMES) if (pattern.test(thought)) return reframe;
  return DEFAULT_REFRAME;
}

function joinList(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function buildSummary(threadTitles, feelings, hasCritic, clauseCount) {
  if (clauseCount <= 1 && !feelings.length) {
    return "Thanks for putting this into words. Here it is, laid out a little more gently.";
  }
  // "with school and rest on your mind" reads better than "rest and body".
  const topics = threadTitles
    .filter((t) => t !== FALLBACK_TOPIC && t !== OVERFLOW_TOPIC)
    .map((t) => (t === "Rest and body" ? "rest" : t.toLowerCase()));
  const feelingPart = feelings.length ? `It sounds like you're feeling ${joinList(feelings.slice(0, 2))}` : "A lot is going on for you";
  const topicPart = topics.length ? `, with ${joinList(topics.slice(0, 3))} on your mind` : "";
  const criticPart = hasCritic ? ", and some harsh thoughts are pointed at yourself" : "";
  return `${feelingPart}${topicPart}${criticPart}.`;
}

const NOT_EATEN = /\b(haven'?t|havent|didn'?t|didnt|forgot to|not) (eaten|eat|had (any )?(food|breakfast|lunch|dinner))\b|\bskipp(ed|ing) (meals?|breakfast|lunch|dinner)\b/i;

// Names the task, so "Text Sam back: type one short line" still makes sense read on its own.
function stepFor(todo) {
  return `${todo.task}: ${todo.first_step.charAt(0).toLowerCase()}${todo.first_step.slice(1)}.`;
}

function pickSmallStep(todos, feelings, lower) {
  const meds = todos.find((t) => STEP_PRIORITY[0].test(t.task));
  if (!meds && NOT_EATEN.test(lower)) return "Only this, for now: grab the easiest food within reach, even a few crackers.";
  for (const pattern of STEP_PRIORITY) {
    const hit = todos.find((t) => pattern.test(t.task));
    if (hit) return stepFor(hit);
  }
  if (todos.length) return stepFor(todos[0]);
  if (feelings.includes("exhausted")) return "Rest your eyes for five minutes with your phone face down.";
  return "Drink a glass of water and take three slow breaths.";
}

export function organize(text) {
  const clauses = splitClauses(text);
  const lower = normalize(text).toLowerCase();

  const feelings = FEELINGS.filter(([, pattern]) => pattern.test(lower))
    .map(([label]) => label)
    .slice(0, LIMITS.feelings);

  const todos = [];
  const reframes = [];
  const groups = new Map();
  for (const [i, clause] of clauses.entries()) {
    // Self-talk ("I feel like a burden to everyone") and crisis words ("sleep and never wake up")
    // are about the person, not the topic they happen to name.
    const topic = SELF_CRITIC.test(clause) || mentionsCrisis(clause) ? FALLBACK_TOPIC : topicFor(clause);
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(clause);

    if (SELF_CRITIC.test(clause) && reframes.length < LIMITS.reframes) {
      reframes.push({ thought: clause, reframe: reframeFor(clause) });
    }
    // "haven't sent it" says the thing is still waiting, whatever else in the clause is past.
    const unmet = unmetTask(clause) !== null;
    const isTask =
      (TASK_CUE.test(clause) || IMPERATIVE.test(clause) || unmet || LEFT_TO.test(clause)) &&
      !(PAST.test(clause) && !INTENT.test(clause) && !unmet) &&
      !(PAST_PLAN.test(clause) && (FELL_THROUGH.test(clause) || FELL_THROUGH_LEAD.test(clauses[i + 1] || ""))) &&
      !(SOMEONE_ELSES.test(clause) && !MY_INTENT.test(clause)) &&
      !SELF_CRITIC.test(clause) &&
      !NOT_A_TASK.test(clause) &&
      !mentionsCrisis(clause);
    if (isTask && todos.length < LIMITS.todos) {
      for (const task of splitTaskList(toTask(clause))) {
        if (!task.trim() || isFragment(task)) continue;
        if (todos.length < LIMITS.todos && !todos.some((t) => t.task.toLowerCase() === task.toLowerCase())) {
          todos.push({ task, first_step: firstStepFor(task) });
        }
      }
    }
  }

  // Biggest groups first. Past the limit, the smallest groups share one "Everything else" thread
  // instead of being tucked under an unrelated title, and each keeps at least one point.
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const keep = ordered.length > LIMITS.threads ? LIMITS.threads - 1 : LIMITS.threads;
  const threads = ordered.slice(0, keep).map(([title, points]) => ({ title, points: points.slice(0, LIMITS.points) }));
  const rest = ordered.slice(keep);
  if (rest.length) {
    const points = [...rest.map(([, p]) => p[0]), ...rest.flatMap(([, p]) => p.slice(1))];
    threads.push({ title: OVERFLOW_TOPIC, points: points.slice(0, LIMITS.points) });
  }

  const needsSupport = mentionsCrisis(text);
  return {
    summary: needsSupport ? CRISIS_SUMMARY : buildSummary(threads.map((t) => t.title), feelings, reframes.length > 0, clauses.length),
    feelings,
    threads,
    to_dos: todos,
    kinder_view: needsSupport ? [] : reframes,
    one_small_step: needsSupport ? CRISIS_STEP : pickSmallStep(todos, feelings, lower),
    needs_support: needsSupport,
  };
}
