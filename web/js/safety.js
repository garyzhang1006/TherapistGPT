// Crisis phrase detection. Mirrors compute/therapistgpt/safety.py; keep both pairs of lists in sync.
// Runs on every brain dump before any engine, so the helpline card never depends on a model.

export const CRISIS_PATTERNS = [
  /\bkill(ing)? my ?self\b/i,
  /\bsuicid(e|es|al|ality)\b/i,
  // "i want to die my hair blue" means dye. Only a color, "again", "back" or the end of the text
  // after "hair" counts as dye, because a line break collapses to a space and "die\nmy hair's
  // falling out" must still flag; a false alarm is cheap. "die. my hair" flags on the period.
  /\b(want(ed|s)? to|wanna|wish i could) die\b(?! (my|your|his|her|their) hair( (blue|red|pink|purple|green|black|blonde|blond|brown|silver|white|orange|grey|gray|again|back)\b|$))/i,
  // A filler or two ("i want to just die", "been wanting to fucking die") must not hide the wish. The
  // pattern above keeps every plain form, so this one can leave idioms like "literally die of embarrassment" calm.
  /\b(want(ed|s|ing)? to|wanna|wish i could) ((just|really|honestly|literally|fucking|fkn|actually|simply|finally) ){0,2}die\b(?! (my|your|his|her|their) hair( (blue|red|pink|purple|green|black|blonde|blond|brown|silver|white|orange|grey|gray|again|back)\b|$)| on (this|that) hill\b| trying\b| laughing\b| of (embarrassment|boredom|shame|laughter|old age|cringe)\b)/i,
  // The same wish said as hope, deserving or readiness ("i hope i die in my sleep", "maybe i should
  // just die", "im ready to die"). "ready to die on this hill" and "i hope i die laughing" are idioms,
  // and a phone that is ready to die has no "i'm" before it, so those stay calm.
  /\b(hope i|deserve to|i should|(i'?m|i am|feel(ing)?) ((so|really|just) )?ready to) ((just|really|honestly|literally|fucking|fkn|actually|simply|finally) ){0,2}die\b(?! (my|your|his|her|their) hair( (blue|red|pink|purple|green|black|blonde|blond|brown|silver|white|orange|grey|gray|again|back)\b|$)| on (this|that) hill\b| trying\b| laughing\b| of (embarrassment|boredom|shame|laughter|old age|cringe)\b)/i,
  // Wanting to be dead. "i'd rather be dead tired" and "don't want to be dead weight" are calm.
  /\b(want(ed|s|ing)? to|wanna|rather|i should|wish i could|i'?d like to) ((just|really|honestly|literally|fucking|actually|simply) ){0,2}be dead\b(?! (tired|serious|honest|wrong|last|set|sure|certain|asleep|quiet|silent|even|weight|broke|center|centre|ahead|ringer|on (time|arrival))\b)/i,
  /\bwish i (was|were) (dead|gone|never born)\b/i,
  /\bwish i('d| had)? never (been born|existed|woken up)\b/i,
  /\bend(ing)? (it all|my life|my own life)\b/i,
  // "thinking about ending it" or "i want to end it tonight" without "all". Ending it with someone,
  // ending a call early or there, or ending a subscription before it renews, stays calm.
  /\b(want(ed|s|ing)? to|wanna|going to|gonna|think(s|ing)? (about|abt|of)|thought (about|abt|of)|plan(s|ned|ning)? to|ready to|should|could|urges? to|tempted to) ((just|finally|really|honestly) )?end(ing)? it\b(?! (with|between|off|early|there|here|on|at|by|for (the|this|now|today|tonight|a)|before (it|they|the|my) (renews?|charges?|bills?|expires?|starts?))\b)/i,
  // "off myself" as a verb. "took the pressure off myself" has no wish before it and stays calm.
  /\b(want(ed|s|ing)? to|wanna|gonna|going to|think(s|ing)? (about|abt|of)|thought (about|abt|of)|should|could|urges? to|tempted to) ((just|finally|really|honestly) )?off(ing)? my ?self\b/i,
  /\btak(e|ing) my own life\b/i,
  // "take my life and turn it around" is calm, but "take my life and nobody will stop me" is not.
  /\btak(e|ing) my life\b(?! (back|seriously|in|into|one|more|a|to|for|over|and (turn|make|start|change|get|put|fix|move))\b)/i,
  /\b(don'?t|do not) (want to|wanna) (be here|exist|live|wake up|be alive)\b/i,
  // The same wish softened by an adverb ("i don't really want to be here") or said as "no longer".
  // In these new forms, living with someone or waking up early stays calm.
  /\b((don'?t|do not) ((really|even|honestly|just|actually) ){1,2}|no longer ((really|even|honestly|just|actually) ){0,2})(want to|wanna) (be here|exist|be alive|keep living|live\b(?! (in|with|here|there|at|near|on|off|together)\b)|wake up\b(?! (early|on time|in time|at|for|before)\b))\b/i,
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
  /\bself[- ]?(harm(s|ed|ing|er|ers)?|injur(y|ies|e|ed|es|ing|ious))\b/i,
  // Relapse is often said without "myself" ("cut again last night"). "my hours got cut again" and
  // "they cut the budget again" are calm, so the cut must open the text or a clause, or follow
  // "i" or "been". The anchor sits in the match because Safari before 16.4 can't parse lookbehind.
  // "i cut today's meeting short" is a possessive, so an apostrophe after the time word stays calm.
  /(^|[.!?;:,] |\bi |\bi'?m |\bi'?ve |\b(been|started|start|keep|kept|back to) )(cut|cutting) (again|last night|tonight|today|yesterday|this morning|this week|last week)\b(?!')/i,
  // "want to cut my hair" or "cut back" names what gets cut. Anything else after it ("so much",
  // "but i wont", ":(") or nothing at all means the cut is the person.
  /\b(want(ed|s|ing)? to|wanna|urges? to|tempted to) (cut|burn)\b(?! (my|the|a|an|your|his|her|him|their|them|it|this|that|these|those|some|back|down|off|out|up|in|into|through|loose|ahead|class|school|ties|costs?|corners|carbs|sugar|calories|fat|weight|hair|bridges|everything)\b)/i,
  /\b(burned|burnt) my ?self\b(?! out\b| (on|with) (the|a|my) (stove|stovetop|oven|pan|pot|kettle|iron|curling iron|straightener|grill|toaster|tea|coffee)\b| (while|making|cooking|ironing|baking)\b)/i,
  /\brelaps(e|ed|es|ing) (on |into |with )?(sh|self[- ]?harm(ing)?|cutting|burning)\b/i,
  /\b(sh|cutting) relaps(e|ed|es|ing)\b/i,
  /\b(cut|cutting|slit|slitting) (my |both )?(wrists?|thighs|forearms)\b/i,
  // The same cut on another part of the body. "cut my leg shaving", "playing soccer" or "on the fence"
  // is an accident, and "leg day" or "skin care" is not a cut, so a tail that names one stays calm.
  /\b(cut|cutting|slit|slitting|carve|carving|carved) (my|both my) (wrists?|thighs?|forearms?|arms?|legs?|stomach|hips?|ankles?|skin|shoulders?)\b(?! (shaving|while|when|by accident|accidentally|playing|during|climbing|falling|opening|hiking|running|biking|gardening|cooking|day|days|workout|routine|care|fat|on (a|an|the|some|my)|at (practice|work|school|the gym)|with (a|the) (knife|can|lid|paper))\b)/i,
  /\bscratch(ing)? my (arms|legs|skin)\b/i,
  /\boverdos(e|ed|es|ing)\b/i,
  /\b(saving|saved|stockpiling|stockpiled|hoarding) (up )?(my |the )?(pills|meds)\b/i,
  /\b(pills|meds) (saved|stockpiled|hoarded)\b/i,
  /\bgiving (my|all my) (stuff|things) away\b/i,
  /\b(been|started|start) saying goodbye\b/i,
  /\bwon'?t be (around|here) (much |for )?(longer|long|anymore)\b/i,
  /\bkms\b/i,
  /\bunaliv(e|ed|es|ing)\b/i,
  // "sewer slide" is how people say suicide on apps that hide the word.
  /\bsewer[- ]?slid(e|ed|es|ing)\b/i,
  /\bcan'?t (go on|do this anymore|take (it|this) anymore)\b/i,
  // "cannot" and "can not", "do it", and "any more". A trip or a stage after "cannot go on" stays calm.
  /\b((can'?t|cannot|can not) (do (it|this)|take (it|this)) any ?more|(cannot|can not) go on\b(?! (the|a|an|this|that|my|vacation|holiday|trips?|dates?|stage|leave)\b))\b/i,
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
  // "die on this hill" and "gone for the weekend" are calm, so those tails stay out. So do waking up
  // "with a hangover" or "to my alarm", while "to see tomorrow" or "to this life" still flag.
  /\b((wouldn'?t|would not|won'?t|will not|don'?t|do not) (really |even |honestly )?(mind|care)|(would|i'?d|it'?d) (honestly |really |probably |just )?be (fine|okay|ok|alright|all right|happy|relieved)) if i (just |simply )?((didn'?t|did not|don'?t|do not|never) (wake|woke) up\b(?! (on time|early|before|in time|until|till|at|with (a|an|my)|to (my|the|a|an) (alarm|alarm clock|alarms|phone|kids?|baby|dog|cat|neighbou?rs?|noise|sound|texts?|calls?|emails?|messages?))\b)|(died|die)\b(?! (my|your|his|her|their) hair| on (this|that) hill| trying| laughing| of (embarrassment|boredom|shame|laughter))|(was|were) (dead|gone)\b(?! (for|by|on|till|until|before|from|over|this|next|all|a|tomorrow|tonight|today|tired|last|wrong|serious)\b)|(wasn'?t|weren'?t) (alive|(here|around) anymore)|stopped existing|didn'?t exist)/i,
  // "no point going on" alone means life. "going on about it", "going on and on", "going on a trip" and "living in
  // the city" name something else, so a following object keeps those calm.
  /\b(no|(don'?t|do not|can'?t|cannot|can not|didn'?t|did not) ((really|even|honestly|just|truly) )?see (the|a|any|much)) point (in |of |to )?((going on|carrying on|keep going|keeping going)\b(?! (and on|about|with|to|at|a|an|the|this|that|these|those|my|our|your|his|her|their|vacation|holiday|trips?|dates?|tour|strike|leave|stage|air|online)\b)|living\b(?! (in|here|there|with|at|off|on|near|together)\b)|being alive|staying alive|existing|life\b(?! (insurance|admin|drawing|coaching|skills?|lessons?|hacks?)\b))/i,
  /\b(i'?m|i am|just|so|honestly|completely|totally|really) (so |just |really |completely |totally |honestly )?(done|finished) with (my |this )?(life|living|being alive|existing)\b(?! (admin|insurance|drawing|science|sciences|coaching|lessons?|skills?|story|stories|situation|arrangements?|room|space|expenses|costs?|in|with|at|here|there|on|for)\b)/i,
  // An older person saying they have lived long enough. "lived long enough to know better" is an
  // everyday idiom, so a word that carries the idiom on keeps it calm, even after "now" or "by now".
  // "and i'm ready to go" carries on too but means the wish, so only the idiom's own words are listed.
  /\b(i'?ve|i have) (already )?lived (long )?enough\b(?! (now |by now |already )?(to|in|here|there|with|at|on|life|lives|years|that|for|of|as (a|an))\b)/i,
  // Researching a method. "how many pills to take a day" and "how many advil i can take" are dosing
  // questions, so only "it would take" or "would kill" counts, and a per-day or kick-in tail stays calm.
  // So does "to fall asleep" or "to see results", unless "forever" or "for good" follows.
  /\bhow (many|much) (of (my|the|these|those|her|his) )?([^ .!?,;]+ )?(pills|tablets|meds|medication|medicine|capsules|painkillers|tylenol|advil|ibuprofen|acetaminophen|paracetamol|aspirin|xanax|benadryl) (it would|it'?d|would it|it will|it'?ll|will it|does it|it does|would|it) (takes?|kills?)\b(?! to (work|kick in|help|feel|start)\b| to (get to sleep|get some sleep|fall asleep|see (results|a difference|any difference|an effect)|take effect)\b(?! forever| for good| permanently)| effect\b| for (a|an|the|my|your|his|her|their|cramps|pain)\b| (a|per) day\b| daily\b)/i,
  // "a lethal amount of coffee" is a joke. Caffeine stays in, since caffeine pills are a real method.
  /\b(lethal|fatal|deadly) (dose|doses|dosage|amount|amounts|quantity)\b(?! of (coffee|espresso|sugar|homework|work|cringe|sarcasm)\b)/i,
  /\bhow long (does it|would it|will it|it'?d|it would|it will|it does|it|to|(until|till|before) (you|i|someone|a person|people)) (take |takes )?(to )?(die|dies|bleed out|bleeds out|drown|drowns|suffocate)\b(?! (my|your|his|her|their) hair| of (boredom|embarrassment|laughter|old age)\b)/i,
  // "dumb ways to die in minecraft" and "how to die my hair" are calm, so a place or hair after it stays out.
  /\b((look(s|ed|ing)? up|search(es|ed|ing)?( for| up)?|googl(e|es|ed|ing)|research(es|ed|ing)?|read(ing)? up on) ([^ .!?,;]+ ){0,2}(ways?|methods?|how) to|(painless|easiest|quickest|fastest|least painful|surest) (ways?|methods?) to) (die|bleed out|overdose)\b(?! (in|on|from|of|my hair|your hair|her hair|his hair|their hair)\b)/i,
  // An urge to step or jump off somewhere. "stepping off the train at my stop" and "jumping off the
  // diving board" name a calm place, so only a height or a bare "off" that ends the clause counts.
  // Texting often runs clauses together, so a word that opens a new clause ends it too.
  /\b(think(s|ing)? (about|abt|of)|thought (about|abt|of)|urges? to|tempted to|want(s|ed|ing)? to|wanna|gonna|going to|wish i could|could just|feel like) (just )?(step(ping)?|jump(ing)?|leap(ing)?|throw(ing)? my ?self) off( (the|a|an|that|this|my) (top of (the|a|an|that|this) )?([^ .!?,;]+ )?(platform|ledge|roof|rooftop|bridge|balcony|building|cliff|edge|overpass|tower|parking garage)\b|[.!?,;]|$| (then|and|but|so|i|i'?m|it|until|when|every|again)\b)/i,
  // The same urge toward a vehicle, traffic or a wall. "driving into the city" and "the bus stop" stay calm.
  /\b(think(s|ing)? (about|abt|of)|thought (about|abt|of)|urges? to|tempted to|want(s|ed|ing)? to|wanna|gonna|going to|wish i could|could just|feel like) (just )?((step(ping)?|jump(ing)?|throw(ing)? my ?self|walk(ing)?|run(ning)?|lie|lying|lay(ing)?) (down |out )?(in front of (a|an|the|some|that|this|oncoming)( [^ .!?,;]+)? (train|subway|bus|car|truck|lorry|tram)|into (the |oncoming |the oncoming )?traffic)|(driv(e|ing)|crash(ing)?|swerv(e|ing)|steer(ing)?) (my car |the car )?(into|off) (a|an|the|oncoming)( [^ .!?,;]+)? (wall|tree|pole|barrier|guardrail|bridge|cliff|overpass|river|lake|truck|traffic))\b(?! (stop|stops|station|line|schedule|lights?|court|house|driver|ride)\b)/i,
  // The wish not to wake, softened by a filler ("i hope i just dont wake up"). Waking late, sick or
  // to an alarm is a calm worry, so those stay quiet.
  /\b(hope|hoping|wish|wishing|pray|praying) (that )?i ((just|simply|honestly|really|maybe|finally|somehow) ){0,2}(don'?t|do not|never|won'?t|will not|wouldn'?t|would not|didn'?t|did not) (ever )?wake up\b(?! (on time|early|late|before|in time|until|till|at|with|to|sick|hungover|sore|groggy|tired|cranky)\b)/i,
  // Weighing how easy a way out would be ("how easy it would be to pull over and climb the railing").
  /\bhow easy (it( would|'?d| could| might) be|it is|it'?s) to (([^ .!?,;]+ ){1,4}(and|then) )?((climb|step|jump|lean) ((over|off|up on|onto|past|out over) )?(the|a|that) (railing|rail|ledge|parapet|guardrail|edge|barrier)|(just )?(end it all|die|disappear forever|not wake up|take them all|swallow them all|take all of them|step in front of))\b/i,
  // The same pull toward a railing said as a thought or urge. Reaching over one for something stays calm.
  /\b(think(s|ing)? (about|abt|of)|thought (about|abt|of)|urges? to|tempted to|want(s|ed|ing)? to|wanna|gonna|going to) (just )?(climb(ing)?|lean(ing)?) (over|past|onto|up on) (the|a|that) (railing|parapet|guardrail|ledge)\b(?! (to (get|grab|reach|take|see|fix)|for)\b)/i,
  // Non-native and plain phrasings of ending one's life ("i think to finish my life"). A life story,
  // a life coach or stopping my life from falling apart stay calm.
  /\b(finish|finishing|finished|stop|stopping|quit|quitting) my (own )?life\b(?! (story|stories|insurance|admin|plan|planning|coach|coaching|goals?|lessons?|skills?|drawings?|class|classes|course|sketch|sketches|painting|model|book|essay|update|chapter|from|falling|getting|being|going)\b)/i,
  // Stopping medication on purpose. Without "on purpose" it is usually a side effect or a doctor's call.
  /\b(stopped|stopping|stop|quit|quitting|skipping|skipped|skip|not taking|haven'?t been taking|been skipping) (taking )?my ([^ .!?,;]+ ){0,2}(pills|meds|medication|medications|medicine|insulin|tablets)\b( [^ .!?,;]+){0,4} on purpose\b/i,
  // The people closest would be fine without me. "the team will be fine without me for a week" names
  // a stretch of time or a place, so those stay calm.
  /\b(everyone|everybody|they|the kids|my kids|my children|my family|my (wife|husband|partner|boyfriend|girlfriend|parents|mom|dad|mum|son|daughter)|the world|people)('?d|'?ll| would| will| are| were)( (honestly|probably|really|all|just|actually|totally))?( (honestly|probably|really|all|just|actually|totally))?( be)? (fine|okay|ok|alright|all right|better|better off|happier|good) without me\b(?! (there|at|for|on|in|this|today|tonight|tomorrow|while|until|till|when|during|next|once)\b)/i,
  // Asking whether insurance pays when a death is not an accident.
  /\b(life insurance|insurance|the policy|my policy) ([^ .!?,;]+ ){0,5}(if|when|even if) (it'?s|its|it is|it was|the death is|the death was|death is) (not an accident|not accidental|not natural|suicide|self[- ]inflicted|on purpose|intentional|deliberate)\b/i,
];

// Someone who has decided often says nothing direct: they give things away, write letters, feel a
// sudden calm and stop planning ahead. Each sign alone is everyday ("gave my old notes to sam",
// "wrote letters to colleges"), so only two different ones together flag. One pattern per sign.
export const WARNING_SIGNS = [
  // Giving away belongings. "gave my keys to the landlord" hands something over, so "to" needs a belonging.
  /\b(gave|give|giving|given|gifted|gifting) (away (my|all my|most of my)\b|(my|all my|most of my|some of my)( [^ .!?,;]+){0,2} away\b|(my|all my|most of my|some of my) ([^ .!?,;]+ )?(guitar|piano|books?|clothes|stuff|things|belongings|possessions|cat|dog|pets?|plants?|games|console|records|vinyl|jewelry|necklace|ring|watch|car|bike|laptop|camera|art|paintings?|journals?|collection) to\b)/i,
  // Goodbye letters or notes. Plain "notes" are class notes, so a note needs a goodbye word.
  /\b(wrote|write|writing|written|left|leaving) (a |some |the |my )?((goodbye|farewell|final|last) (letters?|notes?)|letters (to|for))\b/i,
  // A sudden calm, often after a decision.
  /\b((feel|feels|feeling|felt) (so |really |weirdly |strangely |oddly |kind of )?(calm|peaceful|at peace) (finally|now)|finally (feel |feels |feeling )?(calm|at peace)|(calm|peace|peaceful|relieved) now that i('ve| have)? (decided|made))\b/i,
  // No longer needing things or plans that only matter for a future.
  /\b((won'?t|will not|not gonna|not going to) (need|be needing) (it|this|that|them|these|those|any of (it|this|that|them|these|those)|my ([^ .!?,;]+ )?[^ .!?,;]+) (anymore|any more|much longer)|(don'?t|do not|no) (really |even )?(need|point|reason) (to|in) (renew|extend|book|plan|refill|register|enroll|sign up))/i,
  // Saying goodbye to people.
  /\b(said|saying|say) (my )?goodbyes?( to\b|[.!?,;]|$)/i,
  // Hopelessness about everything. "what's the point of this meeting" names one thing and stays calm.
  /\b((what'?s|what is) (even )?the point( (of|in) (any of (it|this)|anything|it all|all of (it|this)|trying|even trying|going on)\b|( anymore| at all)?([.!?,;]|$))|nothing (really )?matters (anymore|any more)\b)/i,
  // Putting affairs in order: rehoming a pet, or paying something off so nobody is left with it.
  // Each is everyday before a trip or a move, which is why this is a sign and not a crisis phrase.
  // Rehoming a pet doesn't count in a text that names a move or a trip anywhere ("moving day. found
  // a new home for my cat"). That check is anchored at the start because lookbehind can't be used.
  /(\b(my affairs (in order|sorted|settled)|(made|making|make) sure (the|my) (cats?|dogs?|pets?|kitten|puppy|birds?|fish|rabbits?|hamsters?)( [^ .!?,;]+)? (has|have|gets?|will have|will get) (somewhere|someone|somebody|a (new |good )?home|a place)|(pay|paid|paying|pays|cancel|cancell?ed|cancell?ing|close|closed|closing|settle|settled|settling) ([^ .!?,;]+ ){0,6}so (nobody|no one|noone|my family|my (mom|dad|parents|kids|wife|husband|partner|sister|brother)) (gets?|is|are|isn'?t|aren'?t|will be|won'?t be|has to|have to|ends? up)( [^ .!?,;]+)? (stuck|left|saddled|burdened) with)|^(?!.*\b(mov(e|ed|es|ing) (day|out|in|into|house|home|abroad|away|across|to)|relocat(e|ed|es|ing|ion)|trip|vacation|abroad|deploy(ed|ing|ment)?)\b).*\b(rehom(e|ed|ing)|(found|finding|find) (a )?(new |good )?homes? for) (the|my) (cats?|dogs?|pets?|kitten|puppy|birds?|fish|rabbits?|hamsters?))\b/i,
  // Looking down from a height. Everyday on a hike or a balcony, so it counts only beside another sign.
  /\b(look(s|ed|ing)?|star(e|es|ed|ing)|peer(s|ed|ing)?|lean(s|ed|ing)?|gaz(e|es|ed|ing)) (out )?(over|down over|off|down from|down off) (the|a|that) (edge|ledge|railing|rail|parapet)\b/i,
  // Believing nobody would notice I was gone. Leaving a party early or skipping a class stays calm.
  /\b(nobody|no one|noone|no-one) (would|'?d|will|'?ll|is going to|is gonna) (even |really |probably |ever |actually |honestly )?(notice|realize|realise|miss me|care)\b(?! (if|when) i (left|leave|skipped?|skip|took|take|missed|miss|came|come|showed|show|wore|wear|didn'?t (come|show|go))\b| (the|my|a|an|it|that|this|anything|what|how|whether)\b)/i,
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
  myslef: "myself", mysefl: "myself", mysself: "myself", sucide: "suicide", suicde: "suicide", suicied: "suicide",
  sucidal: "suicidal", suicdal: "suicidal", kil: "kill",
};
const TYPO_WORDS = new RegExp(`\\b(${Object.keys(TYPOS).join("|")})\\b`, "gi");

export function fixTypos(text) {
  return String(text).replace(TYPO_WORDS, (word) => TYPOS[word.toLowerCase()]);
}

function normalize(text) {
  // Phones and keyboards type apostrophes many ways: ‘ ’ ʼ ` ´ and fullwidth ＇. Line breaks and
  // double spaces are collapsed too, so "I want to\ndie" reads the same as "I want to die".
  // Python's re.IGNORECASE reads Turkish İ and ı, long ſ and the Kelvin sign as i, s and k, and /i does not,
  // so both detectors swap them first. The space class is the union of \s in JS and in Python.
  return fixTypos(
    String(text)
      .replace(/[\u2018\u2019\u02BC\u0060\u00B4\uFF07]/g, "'")
      .replace(/[\u0130\u0131]/g, "i")
      .replace(/\u017F/g, "s")
      .replace(/\u212A/g, "k")
      .replace(/[\s\u0085\u001C-\u001F]+/g, " "),
  );
}

const ELONGATED = /([a-z])\1{2,}/gi;

function readings(text) {
  const normalized = normalize(text);
  // A line break also often ends a clause ("thinking about stepping off\nthen the train comes"), so
  // the text is read a second time with each break as a full stop.
  const broken = normalize(String(text).replace(/\s*[\r\n]+\s*/g, ". "));
  // Texting stretches words ("i wanna dieee", "kmsss"), so each reading is read again with every run
  // of three or more of one letter squeezed to one and to two, since "killl" squeezed to one is "kil".
  return [normalized, broken].flatMap((t) => [t, fixTypos(t.replace(ELONGATED, "$1")), fixTypos(t.replace(ELONGATED, "$1$1"))]);
}

export function mentionsCrisis(text) {
  // A hit in any reading counts, so an extra reading can only add a flag, never hide one.
  const texts = readings(text);
  const hits = (pattern) => texts.some((t) => pattern.test(t));
  if (CRISIS_PATTERNS.some(hits)) return true;
  // Each sign counts once, so the same sign said twice is still one.
  return WARNING_SIGNS.filter(hits).length >= 2;
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
