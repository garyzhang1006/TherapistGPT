// On-device organizer: a rule-based stand-in for the model. It returns the same JSON shape
// the model is trained to produce (compute/therapistgpt/schema.py), so the UI renders either.
// No network, no storage. Pure functions only, so it runs under `node --test` as well.

import { mentionsCrisis, CRISIS_SUMMARY, CRISIS_STEP } from "./safety.js";

const LIMITS = { threads: 5, points: 6, todos: 6, reframes: 3, feelings: 6 };

const TOPICS = [
  { title: "School", words: /\b(class|classes|school|exam|exams|test|quiz|homework|essay|professor|teacher|grade|grades|lab|lecture|assignment|college|study|studying|semester|course|thesis)\b/i },
  { title: "Work", words: /\b(work|job|boss|manager|shift|coworkers?|meeting|office|fired|client|clients|interview|career|promotion|deadline)\b/i },
  { title: "Money", words: /\b(money|rent|bills?|pay|paid|bank|debt|afford|loan|broke|budget|paycheck|credit card)\b/i },
  { title: "People", words: /\b(mom|dad|mother|father|sister|brother|friends?|partner|boyfriend|girlfriend|husband|wife|ex|family|parents|roommate|kids?|son|daughter|grandma|grandpa|everyone|nobody|people|texted|text back)\b/i },
  { title: "Rest and body", words: /\b(sleep|slept|asleep|insomnia|tired|exhausted|eat|ate|eating|food|hungry|shower|showered|sick|pain|headache|meds|medication|pills?|doctor|dentist|therapy|therapist|bed|body|weight)\b/i },
  { title: "Home", words: /\b(room|dishes|laundry|clean|cleaning|mess|messy|apartment|house|home|groceries|move|moving|boxes|kitchen|trash)\b/i },
];
const FALLBACK_TOPIC = "Inside your head";

const FEELINGS = [
  ["exhausted", /\b(tired|exhausted|drained|worn out|no energy|sleepy|fatigue)\b/i],
  ["overwhelmed", /\b(overwhelm\w*|too much|drowning|so much to do|can'?t keep up)\b/i],
  ["anxious", /\b(anxious|anxiety|worried|worry|scared|afraid|nervous|panic\w*|terrified|what if)\b/i],
  ["sad", /\b(sad|crying|cried|cry|tears|heartbroken|grief|miss (him|her|them))\b/i],
  ["lonely", /\b(lonely|alone|isolated|nobody|no one|no friends)\b/i],
  ["guilty", /\b(guilty|guilt|my fault|should have|shouldn'?t have|feel bad)\b/i],
  ["ashamed", /\b(ashamed|shame|embarrass\w*|humiliat\w*|pathetic)\b/i],
  ["numb", /\b(numb|empty|nothing matters|feel nothing|gray|grey|flat|hollow)\b/i],
  ["hopeless", /\b(hopeless|pointless|what'?s the point|no point|never get better|give up)\b/i],
  ["angry", /\b(angry|mad|furious|pissed|rage|annoyed|irritated)\b/i],
  ["stuck", /\b(stuck|can'?t (do|start|move|get up)|frozen|froze|paralyzed)\b/i],
  ["disappointed", /\b(disappoint\w*|let (him|her|them|everyone|myself) down|failed)\b/i],
  ["frustrated", /\b(frustrat\w*|fed up|sick of)\b/i],
];

// Only explicit intentions and concrete chores count as to-dos. "I didn't pick up" is a memory, not a task.
const TASK_CUE = /\b(need to|needs to|have to|has to|gotta|got to|should(?! have)|supposed to(?! be)|must|forgot to|due|deadline|appointment|refill|reschedul\w*|laundry|dishes|groceries|bills?|rent)\b/i;
// Crisis words never become chores: "I should just kill myself" is not a to-do.
const NOT_A_TASK = /\b(disappear|exist|existing|die|dead|kill|hurt|end it|stop being)\b/i;
const TASK_LEAD = /^(and |so |but |also |i |im |i'?m |i am |really |still )*(need to|needs to|have to|has to|gotta|got to|should( really)?|am supposed to|supposed to|must|forgot to|want to|also need to)\s+/i;

const SELF_CRITIC = /\b(feel like (a|an|the) (worst|failure|burden|fraud|mess|loser|bad \w+)|(i'?m|im|i am) (so |such an? |just |literally |a )?(stupid|lazy|useless|worthless|pathetic|failure|mess|terrible|the worst|burden|disgusting|weak|broken|idiot|loser|disappointment|not good enough|not smart enough|too much)|i (always|never) |i can'?t do anything|what'?s wrong with me|hate myself|i ruin|i mess (everything|it all) up|i'?m bad at)/i;

const REFRAMES = [
  [/lazy/i, "Struggling to start things is common when you're running low. That's heaviness, not laziness."],
  [/stupid|idiot|dumb|not smart/i, "One moment of getting something wrong doesn't measure how capable you are."],
  [/burden|too much/i, "People who care about you usually want to know when you're struggling. Needing support isn't the same as being a burden."],
  [/worthless|useless|pathetic|failure|loser|disappointment/i, "A hard stretch changes how you see yourself. It doesn't change what you're worth."],
  [/hate myself/i, "Being this hard on yourself shows how much pain you're in. It isn't a verdict on who you are."],
  [/can'?t do anything/i, "Days where nothing feels doable say how heavy things are, not how hard you try."],
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

const FILLER_LEAD = /^(and|so|but|also|like|ok so|okay so|ok|okay|idk|anyway|anyways|plus|then|oh and|um|uh)[,\s]+/i;

function cleanClause(raw) {
  let s = raw.trim().replace(/\s+/g, " ");
  let prev;
  do {
    prev = s;
    s = s.replace(FILLER_LEAD, "");
  } while (s !== prev);
  s = s.replace(/^[,;:\-\s]+|[,;:\-\s.!?]+$/g, "");
  // Lowercase " i " reads as a typo in a tidied list; fix the common forms only.
  s = s.replace(/\bi\b/g, "I").replace(/\bim\b/gi, "I'm").replace(/\bi'm\b/g, "I'm").replace(/\bdont\b/gi, "don't").replace(/\bcant\b/gi, "can't").replace(/\bdidnt\b/gi, "didn't").replace(/\bhavent\b/gi, "haven't").replace(/\bwont\b/gi, "won't").replace(/\bits been\b/gi, "it's been").replace(/^its\b/i, "It's").replace(/\btheres\b/gi, "there's");
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
    mentionsCrisis(s)
  );
}

// Long unpunctuated run-ons break before "and/but/so" when a new subject follows, except after a
// comma (", and the trash" ends a list) or when the next piece names nothing on its own
// ("and I haven't even started" belongs with the report it is about).
function splitRunOn(part) {
  if (part.split(/\s+/).length < 10) return [part];
  const cuts = [...part.matchAll(RUN_ON)].filter((m) => !m[1]);
  const pieces = [];
  let start = 0;
  cuts.forEach((m, k) => {
    const next = part.slice(m.index + m[0].length, k + 1 < cuts.length ? cuts[k + 1].index : part.length);
    if (!hasAnchor(next)) return;
    pieces.push(part.slice(start, m.index));
    start = m.index + m[0].length;
  });
  pieces.push(part.slice(start));
  return pieces;
}

export function splitClauses(text) {
  const parts = normalize(text)
    // Sentence ends become line breaks first. A lookbehind would do it in one regex, but Safari
    // before 16.4 can't parse lookbehinds, and one bad regex stops the whole page from loading.
    .replace(/([.!?;])\s+/g, "$1\n")
    .split(/\n+|\s+(?:and then|but also|and also|oh and|plus|anyway|anyways)\s+/i)
    .flatMap(splitRunOn);
  const clauses = [];
  const seen = new Set();
  for (const part of parts) {
    const clause = cleanClause(part);
    const key = clause.toLowerCase();
    if (clause.split(/\s+/).filter(Boolean).length < 2 || seen.has(key)) continue;
    seen.add(key);
    clauses.push(clause);
  }
  // A one-word dump ("tired") still deserves a response, and punctuation alone ("...") gets a
  // gentle placeholder instead of an empty bullet.
  if (!clauses.length && normalize(text)) clauses.push(cleanClause(normalize(text)) || "Something you haven't found words for yet");
  return clauses;
}

function topicFor(clause) {
  let best = null;
  let bestScore = 0;
  for (const topic of TOPICS) {
    const matches = clause.match(new RegExp(topic.words.source, "gi"));
    const score = matches ? matches.length : 0;
    if (score > bestScore) {
      best = topic.title;
      bestScore = score;
    }
  }
  return best || FALLBACK_TOPIC;
}

function toTask(clause) {
  let task = clause.replace(TASK_LEAD, "").replace(/^(I|I'm|I am)\s+(still\s+)?(need|have) to\s+/i, "");
  task = task.replace(/\s+(at some point|asap|soon|today|tomorrow|tonight|this week)$/i, (m) => m);
  return capitalize(task);
}

// "Laundry, groceries, the school form" is three chores, not one.
function splitTaskList(task) {
  const verbJoin = /\s+and\s+(?=(?:call|book|email|text|pay|clean|do|finish|get|buy|make|send|check|refill|start|reply|submit|schedule)\b)/i;
  if (verbJoin.test(task)) return task.split(verbJoin).map((t) => capitalize(t.trim()));
  if ((task.match(/,/g) || []).length < 2) return [task];
  return task
    .split(/,\s*(?:and\s+)?|\s+and\s+/i)
    .map((t) => capitalize(t.trim()))
    .filter((t) => t.length > 2);
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
  const topics = threadTitles.filter((t) => t !== FALLBACK_TOPIC).map((t) => t.toLowerCase());
  const feelingPart = feelings.length ? `It sounds like you're feeling ${joinList(feelings.slice(0, 2))}` : "A lot is going on for you";
  const topicPart = topics.length ? `, with ${joinList(topics.slice(0, 3))} on your mind` : "";
  const criticPart = hasCritic ? ", and some harsh thoughts are pointed at yourself" : "";
  return `${feelingPart}${topicPart}${criticPart}.`;
}

function pickSmallStep(todos, feelings) {
  for (const pattern of STEP_PRIORITY) {
    const hit = todos.find((t) => pattern.test(t.task));
    if (hit) return `Only this, for now: ${hit.first_step.charAt(0).toLowerCase()}${hit.first_step.slice(1)}.`;
  }
  if (todos.length) return `Only this, for now: ${todos[0].first_step.charAt(0).toLowerCase()}${todos[0].first_step.slice(1)}.`;
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
  for (const clause of clauses) {
    const topic = topicFor(clause);
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(clause);

    if (SELF_CRITIC.test(clause) && reframes.length < LIMITS.reframes) {
      reframes.push({ thought: clause, reframe: reframeFor(clause) });
    }
    const isTask = TASK_CUE.test(clause) && !SELF_CRITIC.test(clause) && !NOT_A_TASK.test(clause) && !mentionsCrisis(clause);
    if (isTask && todos.length < LIMITS.todos) {
      for (const task of splitTaskList(toTask(clause))) {
        if (todos.length < LIMITS.todos && !todos.some((t) => t.task.toLowerCase() === task.toLowerCase())) {
          todos.push({ task, first_step: firstStepFor(task) });
        }
      }
    }
  }

  // Biggest groups first; anything past the fifth folds into one catch-all thread.
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const threads = ordered.slice(0, LIMITS.threads).map(([title, points]) => ({ title, points: points.slice(0, LIMITS.points) }));
  const overflow = ordered.slice(LIMITS.threads).flatMap(([, points]) => points);
  if (overflow.length) {
    const last = threads[threads.length - 1];
    last.points = [...last.points, ...overflow].slice(0, LIMITS.points);
  }

  const needsSupport = mentionsCrisis(text);
  return {
    summary: needsSupport ? CRISIS_SUMMARY : buildSummary(threads.map((t) => t.title), feelings, reframes.length > 0, clauses.length),
    feelings,
    threads,
    to_dos: todos,
    kinder_view: needsSupport ? [] : reframes,
    one_small_step: needsSupport ? CRISIS_STEP : pickSmallStep(todos, feelings),
    needs_support: needsSupport,
  };
}
