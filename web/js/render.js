// Turns organizer output into the results view. Every string goes in through textContent,
// never innerHTML, because the text can come from a remote model.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(label, className) {
  const wrap = el("section", `card ${className || ""}`.trim());
  wrap.append(el("h2", "card-label", label));
  return wrap;
}

function crisisCard() {
  const card = el("section", "card crisis");
  card.setAttribute("role", "alert");
  const heading = el("h2", "card-label", "You don't have to hold this alone");
  heading.tabIndex = -1;
  card.append(heading);
  card.append(
    el("p", "crisis-lead", "Thoughts like these deserve real support. You can talk or text with a person right now, free and confidential, any time.")
  );
  const actions = el("div", "crisis-actions");
  const links = [
    ["tel:988", "Call 988", "Suicide & Crisis Lifeline (US and Canada)"],
    ["sms:988", "Text 988", "if talking feels like too much"],
    ["sms:741741?&body=HOME", "Text HOME to 741741", "Crisis Text Line"],
    ["https://findahelpline.com", "Outside the US", "findahelpline.com lists local lines"],
  ];
  for (const [href, title, sub] of links) {
    const a = el("a", "crisis-link");
    a.href = href;
    if (href.startsWith("http")) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    a.append(el("strong", "", title), el("span", "", sub));
    actions.append(a);
  }
  card.append(actions);
  card.append(el("p", "crisis-foot", "On a computer? Call or text 988 from any phone. If you're in immediate danger, call your local emergency number."));
  return card;
}

export function renderResult(container, result) {
  container.replaceChildren();
  const cards = [];

  if (result.needs_support) cards.push(crisisCard());

  const summary = section("What I'm hearing", "summary");
  summary.append(el("p", "summary-text", result.summary));
  if (result.feelings.length) {
    const chips = el("ul", "chips");
    chips.setAttribute("aria-label", "Feelings you named");
    for (const feeling of result.feelings) chips.append(el("li", "chip", feeling));
    summary.append(chips);
  }
  cards.push(summary);

  const threads = section("The threads in it", "threads");
  const grid = el("div", "thread-grid");
  for (const thread of result.threads) {
    const box = el("article", "thread");
    box.append(el("h3", "thread-title", thread.title));
    const list = el("ul", "thread-points");
    for (const point of thread.points) list.append(el("li", "", point));
    box.append(list);
    grid.append(box);
  }
  threads.append(grid);
  cards.push(threads);

  if (result.to_dos.length) {
    const todos = section("Things on your plate", "todos");
    todos.append(el("p", "card-hint", "No order, no deadline from us. Each one has a first step small enough to try."));
    const list = el("ul", "todo-list");
    result.to_dos.forEach((todo, i) => {
      const item = el("li", "todo");
      const id = `todo-${i}`;
      const box = el("input");
      box.type = "checkbox";
      box.id = id;
      const label = el("label");
      label.htmlFor = id;
      label.append(el("span", "todo-task", todo.task), el("span", "todo-step", `Start with: ${todo.first_step}`));
      item.append(box, label);
      list.append(item);
    });
    todos.append(list);
    cards.push(todos);
  }

  if (result.kinder_view.length) {
    const kind = section("A kinder way to hear it", "kinder");
    for (const item of result.kinder_view) {
      const pair = el("div", "reframe");
      pair.append(el("p", "reframe-thought", `“${item.thought}”`), el("p", "reframe-text", item.reframe));
      kind.append(pair);
    }
    cards.push(kind);
  }

  const step = section("One small step", "small-step");
  step.append(el("p", "small-step-text", result.one_small_step));
  cards.push(step);

  cards.forEach((card, i) => {
    card.style.setProperty("--i", String(i));
    container.append(card);
  });
}

export function resultToText(result) {
  const lines = [];
  if (result.needs_support) {
    lines.push("Real support, any time: call or text 988 (US and Canada), text HOME to 741741, or visit findahelpline.com.", "");
  }
  lines.push("WHAT I'M HEARING", result.summary);
  if (result.feelings.length) lines.push(`Feelings: ${result.feelings.join(", ")}`);
  lines.push("", "THE THREADS");
  for (const thread of result.threads) {
    lines.push(thread.title);
    for (const point of thread.points) lines.push(`  - ${point}`);
  }
  if (result.to_dos.length) {
    lines.push("", "THINGS ON YOUR PLATE");
    for (const todo of result.to_dos) lines.push(`[ ] ${todo.task}`, `    start with: ${todo.first_step}`);
  }
  if (result.kinder_view.length) {
    lines.push("", "A KINDER WAY TO HEAR IT");
    for (const item of result.kinder_view) lines.push(`"${item.thought}"`, `  ${item.reframe}`);
  }
  lines.push("", "ONE SMALL STEP", result.one_small_step);
  return lines.join("\n");
}
