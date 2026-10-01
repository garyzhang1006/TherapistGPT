// On-device organizer: a rule-based stand-in for the model. It returns the same JSON shape
// the model is trained to produce (compute/therapistgpt/schema.py), so the UI renders either.
// No network, no storage. Pure functions only, so it runs under `node --test` as well.

import { mentionsCrisis, fixTypos, CRISIS_PATTERNS, CRISIS_SUMMARY, CRISIS_STEP } from "./safety.js?v=6";

const LIMITS = { threads: 5, points: 6, todos: 6, reframes: 3, feelings: 6 };

// Each topic lists the common words for it, course names and test names included, because people
// write "calc" or "the GRE" far more often than "school".
const TOPICS = [
  { title: "School", words: /\b(class|classes|school|exams?|tests|test|quiz|quizzes|homework|essays?|professors?|prof|teachers?|grade|grades|lab|lecture|lectures|assignments?|college|study|studying|semester|course|courses|thesis|advisor|midterms?|finals|papers?|program|tutor|tutoring|syllabus|degree|calc|calculus|chem|chemistry|bio|biology|physics|math|stats|statistics|english|history|econ|psych|orgo|gre|gmat|lsat|mcat)\b/i },
  { title: "Work", words: /\b(work|job|jobs|boss|manager|shifts?|coworkers?|colleagues?|meetings?|office|fired|client|clients|interviews?|career|promotion|deadline|spreadsheets?|deck|contracts?|job search|applications?|applied|resume|recruiters?|commute|overtime|salary|slack)\b/i },
  { title: "Money", words: /\b(money|rent|bills?|pay|paid|bank|debt|afford|loan|broke|budget|paycheck|credit card|overdraft\w*|fees?|tuition|insurance|taxes)\b/i },
  // "she" and "pay kira back" name a person as surely as "mom" does.
  { title: "People", words: /\b(mom|mum|dad|mother|father|sister|brother|friends?|partner|boyfriend|girlfriend|husband|wife|hubby|ex|family|fam|parents|roommates?|kids?|baby|son|daughter|grandma|grandpa|cousins?|aunt|uncle|everyone|nobody|people|bf|gf|bff|bffs|bestie|besties|ppl|she|he|she'?s|he'?s|shes|texted|text back|miss(ing)? (you|him|her|them|[a-z]+ so much)|(pay|paid|call|called|text|texted|write|hear from|heard from) (?!(the|a|an|my|your|his|her|their|our|it|this|that|them|him|me|you|us|everyone|someone|anyone|money|bills?|rent)\b)[a-z]+ back)\b/i },
  { title: "Rest and body", words: /\b(sleep|slept|asleep|insomnia|tired|exhausted|eat|ate|eaten|eating|food|hungry|meals?|breakfast|lunch|dinner|shower|showered|sick|pain|headache|meds|medication|pills?|doctor|dentist|therapy|therapist|bed|body|weight|nap|naps)\b/i },
  { title: "Home", words: /\b(room|dishes|laundry|clean|cleaning|mess|messy|apartment|house|home|groceries|move|moving|boxes|kitchen|trash|heat|heater|heating|landlord|lease|leak\w*|mold|chores)\b/i },
];
// Words that point at someone without naming a topic. Harsh self-talk that only mentions
// "everyone" stays about the person.
const GENERIC_PEOPLE = /^(?:everyone|nobody|people|ppl|she|he|she'?s|he'?s|shes)$/i;
const FALLBACK_TOPIC = "Inside your head";
const OVERFLOW_TOPIC = "Everything else";

// Each feeling also lists the everyday ways people say it without naming it: "idk where to even
// start" is overwhelm, "everyone probably thinks im annoying" is anxiety, "my dog died" is sadness,
// "running on no sleep" is exhaustion, "dont know anyone here" is loneliness, "50 tabs open" is a
// scattered, overloaded head, and a rejection is disappointment.
const FEELINGS = [
  ["exhausted", /\b(tired|exhausted|drained|worn out|burn(ed|t) out|no energy|sleepy|fatigue|running on (no|zero|\d+ hours? of) sleep|running on (empty|fumes)|no sleep|(haven'?t|havent|didn'?t|didnt|barely|hardly|not) (slept|sleeping|gotten (any |much )?sleep)|up all night|(up|awake|waking up) every (\d+|few|couple|hour|night)|(need|could use|kill for|want|wanna) a nap|(want to|wanna|wish i could|need to) (just )?(go to )?sleep|(is|are) killing me|dead on my feet|wiped out)\b/i],
  ["overwhelmed", /\b((overwhelm\w*|too much|drowning|so much to do|can'?t keep up|falling behind|behind on everything|(idk|don'?t know|dont know|no idea) where (to|do i) (even )?(start|begin)|where do i (even )?(start|begin)|can'?t (do|deal with|handle|cope with) (this|it|any of this|all of this|everything)|can'?t cope|too many things|can'?t breathe|tabs open|(\d+|fifty|a hundred|a million|so many|too many) (tabs|things) (open|going on|at once)|(brain|head|mind) is (like )?(\d+|fifty|a hundred|a million|so many|too many) tabs|everything at once|pil(ing|ed) up|(\d{2,}|so many|too many|hundreds of) (unread|emails|messages|msgs))\b|i just can'?t\b(?!\s+\w))/i],
  ["anxious", /\b(anxious|anxiety|worried|worry|scared|afraid|nervous|panic\w*|terrified|what if|overthink\w*|replay\w*|keep thinking about|can'?t stop thinking about|(gonna|going to) (be (so )?(mad|pissed|angry|upset|furious|disappointed)|hate me|fire me)|(everyone|they|people|he|she) (probably |prob |must )?(thinks?|hates?) (i'?m|im|me)|can'?t breathe|dread\w*|freaking out|stomach (is )?in knots|heart (is )?(racing|pounding)|on edge|(won'?t|wont|not gonna|not going to|never gonna) (make|hit|meet) (the |my |this |it )?(\w+ )?deadline|(miss|missed|missing) (the|my) deadline|what (will|would) (she|he|they|people|everyone) think)\b/i],
  ["sad", /\b(sad|crying|cried|cry|tears|heartbroken|grief|miss(ing)? (you|him|her|them|[a-z]+ so much)|miss my (mom|dad|mother|father|friends?|family|home|ex|dog|cat|grandma|grandpa|sister|brother|partner)|(dog|cat|pet|puppy|kitten|bird|hamster|horse|grandma|grandpa|grandmother|grandfather|nana|mom|mum|dad|mother|father|brother|sister|friend|uncle|aunt|cousin|husband|wife|partner) (just |recently )?(died|passed away)|passed away|funeral|lost my (dog|cat|pet|mom|mum|dad|mother|father|grandma|grandpa|brother|sister|friend|best friend|husband|wife|partner|baby)|(asked|asks|asking) (me )?who i (am|was)|(doesn'?t|doesnt|didn'?t|didnt|don'?t|dont) (recognize|remember) me|forg[eo]ts? who i (am|was)|i (really |honestly |actually )?thought (this|it|that) (was|would))\b/i],
  // "Told nobody" is about keeping a secret, not about being alone, so a bare "nobody" is not enough.
  ["lonely", /\b(lonely|(so|all|feel|feeling|completely|totally) alone|isolated|no friends|(only|never) (hangs? out|hanging out|talks?|texts?|invites?)( with| to)? me|left out|(don'?t|dont|do not) have anyone|(nobody|no one) (cares|would (even )?(notice|care|miss)|will (even )?(notice|care|miss)|texts|calls|talks to me|checks on me|gets me|understands|likes me|wants me)|(have|got) (nobody|no one)|(nobody|no one) to (talk|hang)|(don'?t|dont|do not) know (anyone|anybody)|(haven'?t|havent|have not|didn'?t|didnt) (had|talked to|spoken to|seen|hung out with) (anyone|anybody|a soul|(one real|a real|a single) (person|friend|conversation|talk|chat|human being|human))|(a|one) real conversation|eat(ing)? (dinner |lunch |breakfast )?alone|all by myself|miss having (friends|people)|(weekends|nights|evenings) are the (worst|hardest|longest))\b/i],
  ["guilty", /\b(guilty|guilt|my fault|should have|shouldn'?t have|feel bad|(snapped|yelled|lashed out|blew up) at|was (so )?(mean|rude|harsh) to|feel (so )?(awful|terrible|horrible)|(say|said|saying) sorry|apologi[sz]e|(mad|upset|angry|annoyed) (at|with) me|i (just |only )?costs? (her|him|them|everyone|my \w+)|(i'?m|im|i am) (such )?a burden|burden (to|on)|owe (her|him|them)|bailed|flaked|feel (even |so much )?worse|let (her|him|them) down|(supposed|meant) to pay (\w+ )?back)\b/i],
  ["ashamed", /\b(ashamed|shame|embarrass\w*|humiliat\w*|pathetic|mortif\w*|cringe\w*|why can'?t i (just )?(be|act|feel) (normal|okay|ok|like everyone)|everyone else( my age| i know| here| around me)? (can|has|have|is|seems|gets|manages)|(has|have|got) (their|his|her) (life|lives|shit|stuff) together|(not|never) (good|smart) enough|piece of (garbage|trash|shit|crap)|crawl (in|into) a hole|in front of (the whole|everyone|the entire|all)|(told|tell|telling) (nobody|no one|anyone|anybody)|(haven'?t|havent|didn'?t|didnt) told (anyone|anybody|my \w+)|hiding it)\b/i],
  ["numb", /\b(numb|empty|nothing matters|feel nothing|feel flat|hollow|feeling nothing|(can'?t|cant|don'?t|dont) feel (anything|a thing)|going through the motions|on autopilot)\b/i],
  ["hopeless", /\b(hopeless|pointless|what'?s the point|no point|never get better|give up|(tired|sick) of (existing|living|being alive|life|everything|it all|trying)|never (going to|gonna) get better|nothing (will|is going to|ever) change|nothing ever changes|nothing (i do|i try) (matters|works|helps)|(don'?t|dont|can'?t|cant) see (it|things|this|anything) (getting|ever getting|going to get|gonna get) better|(not|never) wake up(?! (on time|early|before|in time|until|till)\b)|what'?s the use|why (even )?bother|no future)\b/i],
  ["angry", /\b(angry|mad|furious|pissed|rage|annoyed|irritated)\b/i],
  ["stuck", /\b(stuck|(can'?t|cannot|couldn'?t|could not) (do|start|move|get up|get out of bed|make myself|bring myself|get myself|get over|move on|let go)|frozen|froze|paralyzed|should (be over|have gotten over|have moved on)|still not over|(haven'?t|havent) (gotten over|moved on)|(just )?sit there|every time i try|staring at (the|my|this|it|that)|putting (it |this |that )?off)\b/i],
  ["disappointed", /\b(disappoint\w*|let (him|her|them|everyone|myself) down|failed|reject\w*|turned (me )?down|(didn'?t|didnt|did not) get (in|into|the (job|offer|role|part|spot|position|apartment|place|internship|scholarship))|no offers?|passed over|fell through)\b/i],
  ["frustrated", /\b(frustrat\w*|fed up|sick of|keeps (leaving|forgetting|ignoring|interrupting|borrowing|taking|eating|using|making|yelling|breaking|asking|bugging)|(just )?shoot me|kill me now|(is|are) killing me|(gonna|going to) be the death of me|one more (\w+ ){0,2}(meeting|email|call|thing|time)|ugh+|so over (it|this))\b/i],
  ["scattered", /\b(can'?t (focus|concentrate|think straight|think)|brain fog|foggy|scattered|all over the place|tabs open|(brain|head|mind) is (like )?(\d+|fifty|a hundred|a million|so many|too many) tabs|(brain|head|mind) is (racing|mush|fried)|keep forgetting|losing track)\b/i],
];

// "I dont even feel scared" names a feeling only to deny it. "I have never felt so lonely" says the
// opposite: the feeling is stronger than ever, so "never" before felt or feel plus so or that stays.
const NOT_FELT = /\b(?:don'?t|dont|do not|didn'?t|didnt|not|never(?!\s+(?:felt|feel)\s+(?:so|that)\b)|no longer|isn'?t|wasn'?t)\s+(?:even\s+|really\s+|actually\s+)?(?:(?:feel|feeling|felt|get|getting|am|be)\s+)?(?:so\s+|that\s+|very\s+|too\s+)?(?:scared|afraid|nervous|anxious|worried|sad|lonely|angry|mad|guilty|upset|annoyed|ashamed|embarrassed)\b/gi;
// "I know she's annoyed" is someone else's anger. It lands on the writer as worry and guilt, so it
// counts as those and not as the writer's own anger. The linking word is required, because "my
// roommate annoyed me" and "she's disappointed me" use the word as a verb, and there the writer is
// the one who is upset.
const OTHERS_UPSET = /\b(?:she|he|they|everyone|my (?:\w+ )?(?:mom|mum|dad|mother|father|sister|brother|partner|boyfriend|girlfriend|husband|wife|bf|gf|roommate|friend|friends|boss|manager|professor|advisor|parents))(?:'s|s|'re| is| are| was| were| seems?| must be| probably| prob)\s+(?:(?:so|really|super|probably|prob|kinda|pretty|totally|definitely|still|def)\s+)?(?:annoyed|mad|pissed|angry|upset|furious|disappointed|frustrated)\b(?!\s+(?:me|us)\b)/i;

function feelingsIn(lower, crisis) {
  const othersUpset = OTHERS_UPSET.test(lower);
  const own = lower.replace(NOT_FELT, " ").replace(new RegExp(OTHERS_UPSET.source, "gi"), " ");
  return FEELINGS.filter(
    ([label, pattern]) =>
      pattern.test(own) ||
      (othersUpset && (label === "anxious" || label === "guilty")) ||
      // Wanting to die or disappear is hopelessness, even when no hopeless word is used.
      (crisis && label === "hopeless")
  )
    .map(([label]) => label)
    .slice(0, LIMITS.feelings);
}

// Only explicit intentions and concrete chores count as to-dos. "I didn't pick up" is a memory, not a task.
const TASK_CUE = /\b(need to|needs to|have to|has to|gotta|got to|should(?! have| be)|supposed to(?! be)|must(?! be)|forgot to|due(?! to)|deadline|appointments?|appts?|refill|reschedul\w*|laundry|dishes|groceries|bills?|rent)\b/i;
// A clause that starts with a chore verb is a task even without "need to": "call mom", "pay rent".
const IMPERATIVE = /^(call|email|text|pay|finish|book|clean|buy|send|submit|schedule|refill|reply to|write|return|cancel|pick up|fill out|study|read|print|prep|prepare|practice|apply|renew|register|order|wash|fold|take out|sign up|sign|update|ask|file|fix)\b(?!\s+(from|with|was|is|went|that)\b)/i;
// Explicit intent found anywhere in a clause; what follows it is the task.
const INTENT = /\b(need to|needs to|have to|has to|gotta|got to|should|must|supposed to|forgot to)\b/i;
const INTENT_AT = /\b(?:need to|needs to|have to|has to|gotta|got to|should(?: really)?|supposed to|must|forgot to)\s+(.+)$/i;
// Things that already happened are memories unless an intent is stated: "I finally did laundry".
const PAST = /\b(did|finally|already|yesterday|last (night|week|month|year)|missed|went|was|were)\b/i;
// "Deck for Marisol by thurs" sets a deadline, and a deadline means there is something to do.
const DEADLINE = /\bby (?:end of (?:the )?(?:day|week|month)|eod|eow|cob|tonight|tomorrow|tmrw|tmr|noon|midnight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu|thurs?|fri|sat|sun|next week|the \d+(?:st|nd|rd|th)?|\d{1,2}(?::\d\d)?\s?(?:am|pm)|\d{1,2}:\d\d)\b/i;
// "My mom gets home by 6pm" is a time in someone's sentence, not a deadline. A clause that opens
// with a subject needs a piece of work in it before its "by" counts.
const SUBJECT_LEAD = /^(?:I|I'm|I'll|we|he|she|they|it|my|our|his|her|their|the)\b/i;

function isDeadline(clause) {
  return DEADLINE.test(clause) && (WORK_THING.test(clause) || !SUBJECT_LEAD.test(clause));
}
// "I said I'd tutor my cousin on Sunday" and "I told my roommate I would clean" are promises, and a
// promise is a to-do.
const PROMISED = /(?:^|\b(?:I|we)\s+(?:\w+\s+)?)(?:said|told (?:my |his |her |our |the )?\w+)(?: that)? (?:I'?d|id|I would|I'll|we'?d|we'll)\s+(?!(?:be|never|not|feel|have been)\b)(.+)$|(?:^|\b(?:I|we)\s+(?:\w+\s+)?)(?:promised|agreed|offered)(?: \w+)? to\s+(.+)$/i;
// "I told Jess I'd come to her party last night" promised something already past. "I told him
// yesterday I'd call" still owes the call, so only a past time inside the promise counts.
const PAST_WHEN = /\b(?:yesterday|last (?:night|week|weekend|month|year)|(?:\d+|a few|a couple of|two|three) (?:days|weeks) ago)\b/i;
// "Gonna file a complaint with the city" is the writer's own plan. "I'm gonna cry", "I'm gonna get
// fired" and "going to miss the deadline" are worries about what will happen to them, and there
// are too many of those to list, so only a chore verb makes a plan.
const MY_PLAN = /(?:^|\b(?:I|I'm|I am|we|we're)\s+)(?:also\s+|really\s+|finally\s+|just\s+|prob\s+|probably\s+|definitely\s+|def\s+)?(?:gonna|going to|planning to|plan to)\s+((?:call|email|text|message|pay|finish|book|clean|buy|send|submit|schedule|refill|reply to|write|return|cancel|pick up|fill out|study|read|print|prep|prepare|practice|apply|renew|register|order|wash|fold|take out|sign up|sign|update|ask|file|fix|start|talk to|tell|reach out|look for|look into)\b.*)$/i;
// "The only things I have to do are laundry and the GRE" lists its chores after "are".
const CHORES_ARE = /\b(?:all|what|the (?:only )?things?|stuff|everything)\s+(?:I|we)\s+(?:have to|need to|gotta|got to|should)\s+do\s+(?:today\s+|this week\s+|tomorrow\s+)?(?:is|are)\s+(.+)$/i;
// A short list line that names a piece of work is a to-do even without a verb: "the vendor
// contract renewal", "club fundraiser forms". A subject or a past-tense verb makes it a sentence.
// Only list items count, because in running prose "worst exam ever" is a complaint.
const WORK_THING = /\b(deck|contracts?|renewal|report|essay|paper|forms?|application|presentation|slides|homework|assignment|midterm|final|exam|test|quiz|project|proposal|invoice|taxes|spreadsheet|draft|resume|cover letter|problem set|pset|reading|paperwork|lab)\b/i;
const SENTENCE_WORD = /\b(?:I|I'm|I've|I'd|me|he|she|they|we|it|it's|you|is|are|was|were|went|got|\w{2,}ed)\b/i;

function isWorkItem(clause) {
  return clause.split(/\s+/).length <= 6 && WORK_THING.test(clause) && !SENTENCE_WORD.test(clause);
}

// Crisis words never become chores: "I should just kill myself" is not a to-do.
const NOT_A_TASK = /\b(disappear|exist|existing|die|dead|kill|hurt|end it|stop being)\b/i;
// "My boss is gonna murder me if I miss the deadline" is a joke about what will happen, so the
// deadline in it is not a task of its own.
const THREAT = /\b(?:gonna|going to|will|would|'ll)\s+(?:literally\s+|actually\s+|absolutely\s+|straight up\s+)?(?:murder|strangle|destroy|skin)\s+me\b|\bhave my head\b/i;
// "I was supposed to go to Jess's party but I didn't" is a plan that already fell through: it goes
// with the feelings, not on the plate. A long run-on may split the "but I didn't" into the next clause.
const PAST_PLAN = /\b(?:was|were) supposed to\b/i;
const FELL_THROUGH = /\b(?:but|and)\s+(?:I|we)\s+(?:didn'?t|couldn'?t|did not|could not|never|wasn'?t able to|weren'?t able to|bailed|cancel+ed|flaked|skipped|missed|forgot|backed out|ditched|overslept|blew (?:it|them|her|him) off)\b/i;
const FELL_THROUGH_LEAD = /^(?:I|we)\s+(?:didn'?t|couldn'?t|did not|could not|never|wasn'?t able to|weren'?t able to|bailed|cancel+ed|flaked|skipped|missed|forgot|backed out|ditched|overslept)\b/i;
// A debt outlives the plan: "I was supposed to pay Kira back last week and I didn't" is still owed.
const STILL_OWED = /\bsupposed to (?:pay|repay|return)\b/i;
// "Don't really need to renew the lease" names a chore only to rule it out.
const NO_NEED = /\b(?:don'?t|do not|doesn'?t|does not|no longer|never)\s+(?:really\s+|even\s+|actually\s+|technically\s+)?(?:need|have|has|got) to\b|\bno need to\b/i;
// "Wear long sleeves so no one sees" hides something, often an injury, and a to-do list should
// never coach hiding.
const CONCEAL = /\bso (?:that )?(?:no one|nobody|noone|no-one) (?:will |can |would |ever )?(?:sees?|knows?|notices?|finds? out|asks?)\b|\bso (?:that )?(?:they|people|he|she|my \w+) (?:won'?t|wont|can'?t|cant|don'?t|dont|doesn'?t|doesnt) (?:see|know|notice|find out|ask)\b|\bto (?:hide|cover) (?:up )?(?:the |my )?(?:cuts|scars|marks|bruises|burns)\b/i;
// Someone settling their affairs before a crisis gives things away, writes goodbye letters and
// pays things off "so nobody gets stuck with it". In a dump like that every errand is part of the
// goodbye, so none of them is listed as a to-do.
const SETTLING_AFFAIRS = /\b(?:goodbye|farewell) (?:letters?|notes?)\b|\bletters (?:to|for) (?:my |everyone|mom|dad)|\b(?:gave|giving|given|gifted) (?:away (?:my|all my)\b|(?:my|all my|most of my)(?: \w+){1,2} (?:to|away)\b)/i;
const STUCK_WITH = /\bso (?:that )?(?:no one|nobody|noone|my \w+|they) (?:gets?|is|are|ends? up|will be|would be|has to|have to) (?:stuck|left) (?:with|holding|paying|dealing)\b/i;
// "Need new shoes for gym" or "the kids need school supplies" is shopping, a to-do without "need to".
// Only things that get bought count, because "I need a break" or "I need the money" is not a chore.
const NEED_THING = /\bneeds? (?:a |an |some |more )?((?:new |more )?(?:\w+ )?(?:supplies|shoes|sneakers|cleats|boots|diapers|wipes|formula|batteries|ink|toner|uniforms?|textbooks?|glasses|tires?))\b/i;
const NO_NEED_THING = /\b(?:don'?t|dont|do not|doesn'?t|doesnt|does not|no longer|never)\s+(?:really\s+|even\s+|actually\s+)?needs?\b/i;
// "Forgot to eat lunch again" is a meal already missed. The one small step answers it with food,
// so it is not also a to-do.
const MISSED_MEAL = /\bforgot to eat\b/i;
// "It's due wednesday" names no thing at all, so on its own it is not a task.
const PRONOUN_DUE = /^(?:it'?s|its|it is|it was|that'?s|that is|they'?re|they are|both are)\s+(?:all\s+|also\s+|still\s+|both\s+)?(?:due|late|overdue)\b/i;
// "Appt got moved to the 14th" is news about a plan, not something to do.
const SCHEDULE_NEWS = /\b(?:got|was|were|been|is|are)\s+(?:moved|pushed(?: back)?|rescheduled|cancel+ed|changed|postponed|bumped|delayed)\b/i;
// "My sister has to drive me everywhere" is her task, not the writer's.
const OTHERS_TASK = /\b(?:he|she|they|my (?:\w+ )?(?:mom|mum|dad|mother|father|sister|brother|partner|boyfriend|girlfriend|husband|wife|bf|gf|roommates?|friends?|son|daughter|kids?|boss|manager|landlord|grandma|grandpa|aunt|uncle|cousin|parents))\s+(?:(?:still|also|really|just|always|now)\s+)?(?:has to|have to|needs to|need to|gotta|must|should|is supposed to|are supposed to|wants to|want to)\b/i;
// "If I have to sit through one more meeting just shoot me" is a what-if, not a plan.
const WHAT_IF = /^if\s+(?:I|we)\s+(?:\w+\s+)?(?:have to|need to|gotta|got to|must)\b/i;
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
// "HR sent another email which I haven't opened" names the thing just before "which".
const WHICH_THING = /\b(?:a|an|the|my|another|this|that|her|his|their)\s+((?:\w+\s+)?\w+)\s+(?:which|that)\s+(?:I|we)\s+(?:still\s+)?(?:haven'?t|havent|have not)\b/i;
// "I have 3 chapters left to read" names its own verb. Only chore verbs count, because "a few days
// left to live" is not a chore.
const LEFT_TO = /\b(?:I|we)(?:'ve| have)?\s+(?:still\s+)?(?:have|got)\s+((?:\d+|a few|a couple(?: of)?|two|three|four|five|six|so many|some|a bunch of|like \d+)\s+(?:\w+\s+)?\w+)\s+left\s+to\s+(read|write|do|finish|study|grade|watch|pay|submit|pack|unpack|clean|review|edit|answer|wash|fold)\b/i;
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

// A cue spelled wrong should still count: "i ahve to" is "i have to". safety.js keeps the list,
// so crisis checks and cue reading fix the same slips.
function normalize(text) {
  return fixTypos(
    String(text)
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\r/g, "")
  ).trim();
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
    // "so nobody sees" is the reason for the task before it, so it stays with that task.
    if (/^\s+so\s+$/i.test(m[0]) && (/^(?:nobody|no one)\b/i.test(next) || CONCEAL.test(`so ${next}`) || STUCK_WITH.test(`so ${next}`))) return;
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
function splitAroundCrisis(part, listed) {
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
    ...(after ? splitPart(part.slice(after.index + after[0].length), listed) : []),
  ];
}

// "work, school, my mom being sick, the apartment is a disaster" lists separate worries, so each
// keeps its own topic, and "chem midterm monday, english paper due wed, club forms" lists separate
// pieces of work. A list after an intent ("need to do laundry, groceries, the form") stays whole
// so it becomes one to-do per chore. Each piece of a split list goes into listed.
function splitList(part, listed) {
  if ((part.match(/,/g) || []).length < 2 || INTENT.test(part)) return [part];
  const pieces = part.split(/,\s*(?:and\s+)?/).filter((p) => p.trim());
  const topics = new Set(pieces.filter((p) => TOPICS.some((t) => t.words.test(p))).map((p) => topicFor(p)));
  const tasks = pieces.map(cleanClause).filter((c) => TASK_CUE.test(c) || IMPERATIVE.test(c) || isWorkItem(c));
  if (topics.size < 2 && tasks.length < 2) return [part];
  for (const piece of pieces) listed.add(piece.trim());
  return pieces;
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

// "The only things I have to do are laundry and sign up for the GRE" holds two chores about two
// different topics, so each goes under its own.
function splitChores(part) {
  for (const m of part.matchAll(/\s+and\s+/gi)) {
    const before = part.slice(0, m.index);
    const after = part.slice(m.index + m[0].length);
    if (!IMPERATIVE.test(after)) continue;
    const first = topicFor(before);
    const second = topicFor(after);
    if (first !== FALLBACK_TOPIC && second !== FALLBACK_TOPIC && first !== second) return [before, ...splitChores(after)];
  }
  return [part];
}

function splitPart(part, listed) {
  if (mentionsCrisis(part)) return splitAroundCrisis(part, listed);
  return splitRunOn(part).flatMap(splitSelfTalk).flatMap((piece) => splitList(piece, listed)).flatMap(splitChores);
}

// Each clause, and whether it was a list item: a line of its own in a dump of several lines, or a
// piece of a comma list. A sentence cut off by a period is not one.
function clauseItems(text) {
  const normalized = normalize(text);
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const listed = new Set(lines.length > 1 ? lines : []);
  const parts = normalized
    // Sentence ends become line breaks first. A lookbehind would do it in one regex, but Safari
    // before 16.4 can't parse lookbehinds, and one bad regex stops the whole page from loading.
    .replace(/([.!?;])\s+/g, "$1\n")
    // Texting ends sentences with "lol" or "tbh" instead of a period, and "idk where to even
    // start" is a thought of its own before whatever follows it.
    .replace(/\s+(lol|lmao|lmfao|haha\w*|tbh|ngl)\s+(?=(?:i|i'm|im|i've|ive|my)\b)/gi, " $1\n")
    .replace(/\b((?:idk|i don'?t know|i dont know) where (?:to|do i) (?:even )?(?:start|begin))\s+(?=(?:i|i'm|im|i've|ive|my)\b)/gi, "$1\n")
    .split(/\n+|\s+(?:and then|but also|and also|oh and|plus|anyway|anyways)\s+/i)
    .flatMap((part) => splitPart(part, listed));
  const items = [];
  const seen = new Set();
  for (const part of parts) {
    const clause = cleanClause(part);
    const key = clause.toLowerCase();
    const oneWordOk = TASK_CUE.test(clause) || TOPICS.some((t) => t.words.test(clause));
    if (!clause || (clause.split(/\s+/).length < 2 && !oneWordOk) || seen.has(key)) continue;
    seen.add(key);
    items.push({ clause, listed: listed.has(part.trim()) });
  }
  // A one-word dump ("tired") still deserves a response, and punctuation or blank space gets a
  // gentle placeholder instead of an empty thread.
  if (!items.length) items.push({ clause: cleanClause(normalized) || "Something you haven't found words for yet", listed: false });
  return items;
}

export function splitClauses(text) {
  return clauseItems(text).map((item) => item.clause);
}

// On a tie the topic named first wins: "do laundry or I have nothing to wear to work" is about
// the laundry, and work is only the reason. In a pair like "budget meeting" the last word names
// the thing, so a topic word right before another topic's word gives way to it.
// With specificOnly, words like "everyone" or "she" do not count as a topic.
function topicFor(clause, specificOnly = false) {
  const hits = TOPICS.flatMap((topic) =>
    [...clause.matchAll(new RegExp(topic.words.source, "gi"))]
      .filter((m) => !(specificOnly && GENERIC_PEOPLE.test(m[0])))
      .map((m) => ({ title: topic.title, start: m.index, end: m.index + m[0].length }))
  );
  const heads = hits.filter((h) => !hits.some((o) => o.title !== h.title && o.start === h.end + 1));
  let best = null;
  let bestScore = 0;
  let bestAt = Infinity;
  for (const topic of TOPICS) {
    const matches = heads.filter((h) => h.title === topic.title);
    const score = matches.length;
    const at = score ? matches[0].start : Infinity;
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
    // Spoken run-ons start the next thought with no "and": "done that either I just feel like I'm drowning".
    .replace(/\s+I\s+(?:just\s+|really\s+|honestly\s+|kinda\s+|still\s+)?(?:feel|felt)\b.*$/i, "")
    .replace(/,\s*(?:I|I'm|I've|I'd|I'll|it|it's|its|they|they're|she|she's|he|he's|we)\b.*$/i, "")
    .replace(/\s+(?:because|bc|cuz|cause|since|even though|otherwise|or else|or (?:I|I'll|ill|I'm|else))\b.*$/i, "")
    .replace(/\s+(?:that |which )?(?:I|I've|ive)\s+(?:keep|kept|been|have been)\s+\w+ing\b.*$/i, "")
    .replace(/\s+it'?s been\b.*$/i, "")
    .replace(/\s+(?:in|for) (?:a|an|\d+|two|three|four|five|a few|a couple of|several|like \d+) (?:days?|weeks?|months?|years?|ages)\b.*$/i, "")
    // "Sit through one more meeting just shoot me" ends in a dark joke that is not part of the task.
    .replace(/\s+(?:just |someone |somebody |please )?(?:shoot|kill) me(?: now)?\b.*$/i, "")
    // "but every time I try I just sit there" is how the task feels, not what it is.
    .replace(/\s+but\b.*$/i, "");
  const harsh = s.search(SELF_CRITIC);
  if (harsh > 0) s = s.slice(0, harsh);
  return s
    .replace(/\s+(I guess|I think|probably|maybe|lol|idk)$/i, "")
    .replace(/\s+(at some point|asap|soon|today|tomorrow|tonight|this week|last week|last night|yesterday)$/i, "")
    .replace(/[\s,;:.!?-]+$/, "");
}

// "Haven't answered texts in days" describes a habit that has slipped, not one thing waiting.
const HABIT_GAP = /\b(?:in|for)\s+(?:days|weeks|months|ages|forever|a while|so long|(?:a|an|\d+|two|three|four|five|a few|a couple of|several|like \d+)\s+(?:days?|weeks?|months?|years?))\b/i;

// The to-do inside an unmet obligation, or null when it names nothing to do.
function unmetTask(clause) {
  const m = clause.match(UNMET) || clause.match(CANT_EVEN);
  if (!m) return null;
  // Only the words right after the verb count, so "and it's been on my mind for weeks" does not.
  if (HABIT_GAP.test(m[2].split(/,|\s+(?:and|but|so|because|bc|cuz|since)\s+/i)[0])) return null;
  const verb = BASE_VERB[m[1].toLowerCase()] || m[1].toLowerCase();
  let object = trimTail(m[2]).trim();
  // "I haven't done anything productive" or "can't even do anything right" is a verdict on the
  // day, not a thing waiting to be done, so a quantifier counts as no object at all.
  if (NO_OBJECT.test(object) || /^(?:anything|nothing|much|enough)\b/i.test(object)) {
    const thing = clause.match(HAVE_THING);
    const which = clause.match(WHICH_THING);
    if (verb === "eat") object = "something";
    else if (which) object = `the ${which[1]}`;
    else if (thing) object = `${/^(study|prepare|practice)$/.test(verb) ? "for " : ""}the ${thing[1]}`;
    else return null;
  }
  const task = capitalize(`${verb} ${object}`);
  return isFragment(task) ? null : task;
}

// "30 problems due at midnight" names the work only by its count, so the to-do says what to do
// with it, and the one course named elsewhere in the dump says which: "Finish 30 calc problems".
const COUNT_LED = /^(\d+|a few|a couple(?: of)?|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|so many|like \d+)\s+(\w+(?:\s+\w+)?)\s+((?:due|by)\b.*)$/i;
const COURSE = /\b(calc|calculus|chem|chemistry|bio|biology|physics|math|stats|statistics|english|history|econ|psych|orgo|spanish|french)\b/i;
// "My manager wants the inventory spreadsheet by end of day" is the writer's to-do.
const WANTS_IT = /^(?:my |the |our )?(?:\w+ )?(?:boss|manager|professor|prof|teacher|client|advisor|supervisor|editor|lead)\s+(?:wants|needs|asked for|expects|is waiting on|is waiting for)\s+(?:me to\s+)?(.+)$/i;
// "I can't type anymore my advisor wants the draft by Monday" says the request after a preamble, and
// the request is the task.
const WANTS_MID = new RegExp(`\\b${WANTS_IT.source.slice(1)}`, "i");
// "Doctor wants me to come in about my blood pressure" is a visit to book, even without "need to".
const MEDICAL_ASK = /\b(?:my |the )?(doctor|doc|dentist|therapist|nurse|pediatrician|specialist|cardiologist|psychiatrist|dermatologist)\s+(?:wants|needs|asked|told)\s+me\s+to\s+(.+)$/i;

function toTask(clause, course) {
  const chores = clause.match(CHORES_ARE);
  if (chores) return capitalize(trimTail(chores[1]));
  const intent = clause.match(INTENT_AT);
  if (!intent) {
    const unmet = unmetTask(clause);
    if (unmet) return unmet;
    const left = clause.match(LEFT_TO);
    if (left) return capitalize(`${left[2].toLowerCase()} ${left[1]}`);
    const plan = clause.match(PROMISED) || clause.match(MY_PLAN);
    if (plan) return capitalize(trimTail(plan[1] || plan[2]));
    const ask = clause.match(MEDICAL_ASK);
    if (ask) return capitalize(trimTail(ask[2].replace(/^(?:come|go)(?: back)?(?: in)?(?=\s+(?:about|for|to|so|and)\b|$)/i, `see the ${ask[1].toLowerCase()}`)));
    const need = clause.match(NEED_THING);
    if (need) return capitalize(trimTail(`get ${need[1]}${clause.slice(need.index + need[0].length)}`));
  }
  const wanted = !intent && clause.match(WANTS_MID);
  const task = trimTail(intent ? intent[1] : wanted ? wanted[0] : clause.replace(TASK_LEAD, ""))
    .replace(intent ? /^(?:I|I've|we) (?:have|got) (?=(?:the|a|an|my|this|that)\b)/i : /^(?:(?:I|I've|we) )?(?:have|got) (?=(?:the|a|an|my|this|that)\b)/i, "")
    .replace(DUE_LATE, (_, bill) => `Pay ${bill.toLowerCase()}`)
    .replace(WANTS_IT, (_, thing) => (/^(?:the|a|an|my|our|this|that)\b/i.test(thing) ? `finish ${thing}` : thing))
    .replace(COUNT_LED, (_, count, thing, rest) => `finish ${count} ${course && !COURSE.test(thing) ? `${course} ` : ""}${thing} ${rest}`);
  return capitalize(task);
}

// "Tell her I won't make the deadline" means the person named before it, "my advisor", and "take
// it out" means the thing the sentence before was about, "the trash has been sitting there".
// "Get him something" for "my brothers birthday" means my brother; "get her meds" is her meds,
// so a gift verb counts only before a gift.
const PERSON = /\bmy\s+(advisor|professor|prof|teacher|tutor|boss|manager|supervisor|coworker|landlord|therapist|doctor|dentist|lawyer|coach|mom|mum|dad|mother|father|sister|brother|friend|roommate|partner|boyfriend|girlfriend|husband|wife|bf|gf|grandma|grandpa|aunt|uncle|cousin)(?:'?s)?\b/i;
const TO_PERSON = /^(?:(?:tell|email|call|text|ask|remind|message|thank|meet|visit|update|reply to|write to)\s+(?:her|him)\b|(?:get|buy|make)\s+(?:her|him)(?=\s+(?:something|anything|a|an|some|flowers|gifts?|presents?)\b))/i;
// The second word is optional and never one of the verbs, so "the trash still hasn't" names "trash".
const THING_SUBJECT = /^(?:the|my|our|this|that)\s+(\w+(?:\s+(?!(?:has|have|is|are|was|were|keeps|still|needs)\b)\w+)??)\s+(?:has|have|is|are|was|were|keeps|still|needs)\b/i;

// "Email her" never means "my brother", so a role that names the other gender is passed over.
const MALE_ROLE = /^(?:dad|father|brother|boyfriend|husband|bf|grandpa|uncle)$/i;
const FEMALE_ROLE = /^(?:mom|mum|mother|sister|girlfriend|wife|gf|grandma|aunt)$/i;

// "Have to book the class" or "reschedule it" says what to do but not what it is for. A short
// "dentist appt thursday" or "cert renewal is due friday" just before it, in the same clause or
// the one before, names the thing: "Reschedule the dentist appt".
const VAGUE_TASK = /^(\w+(?: up| out| in| off| back| for| on)?) (?:(it|that|this)|the (?:book|books|class|course|form|forms|paperwork|appointment|appt|reading|notes))$/i;
const WHEN = "(?:today|tonight|tomorrow|tmrw|tmr|this week|next week|this weekend|(?:this |next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu|thurs?|fri|sat|sun)|at \\d{1,2}(?::\\d\\d)?\\s?(?:am|pm)?|the \\d{1,2}(?:st|nd|rd|th)?)";
const NAMED_THING = new RegExp(`^(?:the |my |our |a |an |this )?((?:\\w+ ){0,2}?\\w+) (?:(?:is |are )?(?:(?:due|on|by) )*${WHEN}|(?:is|are) due)$`, "i");
const THING_NOUN = /\b(?:deck|contracts?|renewal|report|essay|paper|forms?|application|presentation|slides|homework|assignment|midterm|final|exam|test|quiz|project|proposal|invoice|taxes|draft|resume|reading|paperwork|lab|appts?|appointments?|class|course|certs?|certification|meeting)\b/i;

function namedThing(text) {
  const m = text.trim().replace(/[\s,;:.!?-]+$/, "").match(NAMED_THING);
  return m && THING_NOUN.test(m[1]) && !SENTENCE_WORD.test(m[1]) ? m[1].toLowerCase() : null;
}

function resolveVague(task, lead, earlier) {
  const m = task.match(VAGUE_TASK);
  if (!m) return task;
  const thing = namedThing(lead) || namedThing(earlier[earlier.length - 1] || "");
  if (!thing) return task;
  return m[2] ? `${m[1]} the ${thing}` : `${task} for the ${thing}`;
}

function resolveTask(task, earlier, lead = "") {
  if (TO_PERSON.test(task)) {
    const conflicting = /her$/i.test(task.match(TO_PERSON)[0]) ? MALE_ROLE : FEMALE_ROLE;
    for (let k = earlier.length - 1; k >= 0; k--) {
      const people = [...earlier[k].matchAll(new RegExp(PERSON.source, "gi"))].map((m) => m[1]).filter((role) => !conflicting.test(role));
      if (people.length) return task.replace(/\b(?:her|him)\b/i, `my ${people[0].toLowerCase()}`);
    }
  }
  const thing = (earlier[earlier.length - 1] || "").match(THING_SUBJECT);
  if (thing && /^\w+ it\b/i.test(task)) return task.replace(/\bit\b/i, `the ${thing[1].toLowerCase()}`);
  return resolveVague(task, lead, earlier);
}

function isFragment(task) {
  return HEDGE_ONLY.test(task) || PRONOUN_ONLY.test(task);
}

// "Laundry, groceries, the school form" is three chores, not one.
function splitTaskList(task) {
  // "Take it out and actually buy groceries" is two chores even with a word between "and" and the verb.
  const verbJoin = /\s+and\s+(?:(?:actually|also|then|maybe|finally|just|still)\s+)?(?=(?:call|book|email|text|pay|clean|do|finish|get|buy|make|send|check|refill|start|reply|submit|schedule|return|cancel|sign|update|ask|take|pick|fill|file|order|renew|apply|register|print)\b)/i;
  if (verbJoin.test(task)) {
    // "Call the bank and ask them to waive it" is one errand: a part that names nothing but them
    // and it leans on the part before it.
    const parts = [];
    for (const part of task.split(verbJoin).map((t) => t.trim().replace(/[,;]+$/, ""))) {
      const leans = parts.length && /\b(?:it|them|that|this)$/i.test(part) && !/\b(?:the|a|an|my|your|his|their|our|some)\b/i.test(part);
      if (leans) parts[parts.length - 1] += ` and ${part}`;
      else parts.push(part);
    }
    return parts.map(capitalize);
  }
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
  const items = clauseItems(text);
  const clauses = items.map((item) => item.clause);
  const lower = normalize(text).toLowerCase();
  const needsSupport = mentionsCrisis(text);
  const feelings = feelingsIn(lower, needsSupport);
  // One course named anywhere in the dump says which class a bare "30 problems" belongs to.
  const courses = new Set(lower.match(new RegExp(COURSE.source, "gi")) || []);
  const course = courses.size === 1 ? [...courses][0] : null;
  const settling = SETTLING_AFFAIRS.test(lower);
  const affairs = settling && needsSupport;

  const todos = [];
  const reframes = [];
  const groups = new Map();
  for (const [i, clause] of clauses.entries()) {
    // Crisis words ("sleep and never wake up") are about the person, not the topic they happen to
    // name. Self-talk keeps a topic it names outright ("I'm such a failure at work"), but "I feel
    // like a burden to everyone" is about the person.
    const topic = mentionsCrisis(clause) ? FALLBACK_TOPIC : topicFor(clause, SELF_CRITIC.test(clause));
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(clause);

    if (SELF_CRITIC.test(clause) && reframes.length < LIMITS.reframes) {
      reframes.push({ thought: clause, reframe: reframeFor(clause) });
    }
    // "haven't sent it" says the thing is still waiting, whatever else in the clause is past.
    const unmet = unmetTask(clause) !== null;
    const promise = clause.match(PROMISED);
    const promised = promise !== null && !PAST_WHEN.test(promise[1] || promise[2]);
    const isTask =
      (TASK_CUE.test(clause) || IMPERATIVE.test(clause) || unmet || MEDICAL_ASK.test(clause) || (NEED_THING.test(clause) && !NO_NEED_THING.test(clause)) || LEFT_TO.test(clause) || isDeadline(clause) || promised || MY_PLAN.test(clause) || (items[i].listed && isWorkItem(clause))) &&
      !(PAST.test(clause) && !INTENT.test(clause) && !unmet && !promised) &&
      // A promise is a plan made in the past, so "but I bailed" rules it out just as it does "was supposed to".
      !((PAST_PLAN.test(clause) || promised) && !STILL_OWED.test(clause) && (FELL_THROUGH.test(clause) || FELL_THROUGH_LEAD.test(clauses[i + 1] || ""))) &&
      !((SOMEONE_ELSES.test(clause) || OTHERS_TASK.test(clause)) && !MY_INTENT.test(clause)) &&
      !(NO_NEED.test(clause) && !INTENT.test(clause.replace(new RegExp(NO_NEED.source, "gi"), " "))) &&
      !(SCHEDULE_NEWS.test(clause) && !INTENT.test(clause)) &&
      !(PRONOUN_DUE.test(clause) && !INTENT.test(clause)) &&
      !(MISSED_MEAL.test(clause) && !INTENT.test(clause.replace(/\bforgot to\b/gi, " "))) &&
      !WHAT_IF.test(clause) &&
      !SELF_CRITIC.test(clause) &&
      !NOT_A_TASK.test(clause) &&
      !THREAT.test(clause) &&
      !CONCEAL.test(clause) &&
      !affairs &&
      !((settling || needsSupport) && STUCK_WITH.test(clause)) &&
      !mentionsCrisis(clause);
    if (isTask && todos.length < LIMITS.todos) {
      const intentAt = clause.match(INTENT_AT);
      const lead = intentAt ? clause.slice(0, intentAt.index) : "";
      for (const task of splitTaskList(resolveTask(toTask(clause, course), clauses.slice(0, i), lead))) {
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
