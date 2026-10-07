// Every local import carries the same ?v= as index.html. Bump them all together on each release, with
// VERSION in sw.js, or a returning visitor can get a new app.js paired with a stale cached module that
// lacks an export.
import { organizeText, loadSettings, saveSettings, testConnection, normalizeEndpoint } from "./engine.js?v=12";
import { renderResult, resultToText } from "./render.js?v=12";
import { splitClauses, isSelfCritical } from "./organizer.js?v=12";
import { mentionsCrisis } from "./safety.js?v=12";

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = "therapistgpt.draft";
const PREFS_KEY = "therapistgpt.prefs";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const dump = $("dump");
const form = $("dump-form");
const writeView = $("write-view");
const resultView = $("result-view");
const organizeBtn = $("organize-btn");
const status = $("status");
let lastResult = null;

// ---------- small storage helpers (storage can be blocked; the page must work without it) ----------

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore: the draft just won't survive a reload
  }
}

// Ticked to-dos, keyed by task text, live only in this page's memory: they survive "Back to my words",
// and nothing about them is ever written to storage. They belong to the words that were sorted, so a
// later, different dump that yields the same task text does not arrive already ticked. A reload has
// already erased the sorted draft, so keeping ticks across one would save nothing anyone could see.
let sortedText = "";
let ticked = new Set();

// Releases before v11 stored the sorted words with the ticks in session storage. Clear what a tab
// left open across the update still holds.
try {
  sessionStorage.removeItem("therapistgpt.ticks");
} catch {
  // storage blocked: nothing was stored either
}

// Mac keyboards send Cmd+Enter; the handler below accepts both, the hint should say the right one.
if (/mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || "")) $("mod-key").textContent = "⌘";

// ---------- draft autosave ----------

dump.value = read(DRAFT_KEY, "");
let saveTimer;
dump.addEventListener("input", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => write(DRAFT_KEY, dump.value || null), 400);
});

// Clearing a whole vent by accident would hurt, so every clear can be undone for a while.
const writeStatus = $("write-status");
let undoTimer;

function clearWithUndo() {
  const removed = dump.value;
  dump.value = "";
  write(DRAFT_KEY, null);
  if (!removed.trim()) return;
  clearTimeout(undoTimer);
  writeStatus.replaceChildren("Cleared. ");
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "link";
  undo.textContent = "Undo";
  undo.addEventListener("click", () => {
    clearTimeout(undoTimer);
    dump.value = removed;
    write(DRAFT_KEY, removed);
    writeStatus.textContent = "";
    dump.focus();
  });
  writeStatus.append(undo);
  undoTimer = setTimeout(() => (writeStatus.textContent = ""), 12000);
}

// Once the person starts writing again, Undo would overwrite the new words, so it goes away.
dump.addEventListener("input", () => {
  if (!writeStatus.querySelector("button")) return;
  clearTimeout(undoTimer);
  writeStatus.textContent = "";
});

$("clear-btn").addEventListener("click", () => {
  clearWithUndo();
  dump.focus();
});

// ---------- preferences: theme and text size ----------

const prefs = read(PREFS_KEY, {});
const sizeToggle = $("size-toggle");
sizeToggle.setAttribute("aria-pressed", String(Boolean(prefs.large)));

function currentTheme() {
  if (document.documentElement.dataset.theme) return document.documentElement.dataset.theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

// The browser bar color follows the chosen theme, not only the system one.
const THEME_COLORS = { dark: "#16151d", light: "#f3eee6" };

function syncThemeColor() {
  const chosen = document.documentElement.dataset.theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const system = meta.media.includes("dark") ? "dark" : "light";
    meta.content = THEME_COLORS[chosen || system];
  });
}

// The button's name says what pressing it will do, so screen readers hear the current state too.
function labelThemeButton() {
  const label = currentTheme() === "dark" ? "Switch to light theme" : "Switch to dark theme";
  $("theme-label").textContent = label;
  $("theme-toggle").title = label;
}

syncThemeColor();
labelThemeButton();

$("theme-toggle").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  prefs.theme = next;
  write(PREFS_KEY, prefs);
  syncThemeColor();
  labelThemeButton();
});

sizeToggle.addEventListener("click", () => {
  prefs.large = !prefs.large;
  if (prefs.large) document.documentElement.dataset.size = "large";
  else delete document.documentElement.dataset.size;
  sizeToggle.setAttribute("aria-pressed", String(prefs.large));
  write(PREFS_KEY, prefs);
});

// ---------- dialogs ----------

// The help openers are links to #help-dialog so they work even if this script never runs. Here the
// modal opens instead, and the address keeps no #help-dialog that would show the fallback copy after close.
document.querySelectorAll("[data-open]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    const dialog = $(button.dataset.open);
    if (dialog.id === "settings-dialog") fillSettings();
    dialog.showModal();
  });
});

// Click on the dimmed backdrop closes a dialog, like most people expect.
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

// ---------- settings ----------

const settingsForm = $("settings-form");
const endpointInput = $("endpoint");
const apiKeyInput = $("api-key");
const endpointStatus = $("endpoint-status");
const modelFields = $("model-fields");

// The address fields only matter for the model engine, so they stay out of sight otherwise.
function showModelFields() {
  modelFields.hidden = settingsForm.elements.engine.value !== "model";
  $("test-endpoint").hidden = modelFields.hidden;
}

settingsForm.addEventListener("change", showModelFields);

function fillSettings() {
  const settings = loadSettings();
  settingsForm.elements.engine.value = settings.engine;
  endpointInput.value = settings.endpoint;
  apiKeyInput.value = settings.apiKey;
  endpointStatus.textContent = "";
  showModelFields();
}

function updatePrivacyNote() {
  const settings = loadSettings();
  $("privacy-text").textContent =
    settings.engine === "model" && settings.endpoint
      ? "Sent only to your own model. Your draft is erased once sorted."
      : "Nothing leaves this device. Your draft is erased once sorted.";
}

$("save-settings").addEventListener("click", (event) => {
  const engine = settingsForm.elements.engine.value || "device";
  let endpoint = endpointInput.value.trim();
  if (engine === "model") {
    try {
      if (!endpoint) throw new Error("Add your model's address first, or choose This device.");
      endpoint = normalizeEndpoint(endpoint);
    } catch (error) {
      event.preventDefault();
      endpointStatus.textContent = error.message;
      endpointInput.focus();
      return;
    }
  }
  saveSettings({ engine, endpoint, apiKey: apiKeyInput.value.trim() });
  updatePrivacyNote();
});

// Closing without Save leaves the stored settings alone; the form refills from storage on next open.
$("cancel-settings").addEventListener("click", () => $("settings-dialog").close());

$("test-endpoint").addEventListener("click", async () => {
  const endpoint = endpointInput.value.trim();
  if (!endpoint) {
    endpointStatus.textContent = "Paste your model's address above first.";
    return;
  }
  endpointStatus.textContent = "Checking...";
  try {
    await testConnection(endpoint);
    endpointStatus.textContent = "Connected. Your model is ready.";
  } catch (error) {
    endpointStatus.textContent =
      error.name === "AbortError" ? "No answer after 15 seconds. Is the server running?" : `Couldn't connect: ${error.message}`;
  }
});

updatePrivacyNote();

// ---------- the settling animation ----------

// Fragments of the person's own words drift up and settle before the calm version appears.
// Purely decorative: skipped for reduced-motion users, and for crisis text so painful words
// never drift across the screen. Harsh self-talk is left out for the same reason.
function settle(text) {
  if (reduceMotion.matches || mentionsCrisis(text)) return Promise.resolve();
  const stage = $("settle");
  const box = dump.getBoundingClientRect();
  // The textarea can be partly scrolled away on a phone; keep every fragment on screen.
  const clamp = (value, max) => Math.min(Math.max(value, 8), Math.max(max, 8));
  const fragments = splitClauses(text)
    .filter((fragment) => !isSelfCritical(fragment))
    .slice(0, 12);
  const motes = fragments.map((fragment, i) => {
    const mote = document.createElement("span");
    mote.className = "mote";
    mote.textContent = fragment.split(/\s+/).slice(0, 5).join(" ");
    mote.style.left = `${clamp(box.left + Math.random() * Math.max(box.width - 180, 40), window.innerWidth - 200)}px`;
    mote.style.top = `${clamp(box.top + Math.random() * Math.max(box.height - 40, 40), window.innerHeight - 48)}px`;
    mote.style.transitionDelay = `${i * 45}ms`;
    stage.append(mote);
    return mote;
  });
  // New elements have no earlier style to transition from, so settle their starting style first;
  // otherwise the fade and drift jump straight to the end.
  stage.getBoundingClientRect();
  motes.forEach((mote, i) => {
    mote.style.opacity = "0.9";
    const row = i % 4;
    mote.style.transform = `translate(${(row - 1.5) * 12}px, ${-40 - (i % 3) * 18}px)`;
  });
  return new Promise((resolve) => {
    setTimeout(() => {
      motes.forEach((mote) => {
        mote.style.opacity = "0";
        mote.style.transform += " translateY(-30px)";
      });
      setTimeout(() => {
        stage.replaceChildren();
        resolve();
      }, 700);
    }, 1100);
  });
}

// ---------- organize ----------

function showWrite() {
  resultView.hidden = true;
  writeView.hidden = false;
  window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
  dump.focus();
}

async function run() {
  // Ctrl+Enter can fire while a request is already in flight. aria-disabled, not disabled, so focus
  // stays on the button instead of dropping to the page.
  if (organizeBtn.getAttribute("aria-disabled") === "true") return;
  const text = dump.value.trim();
  if (!text) {
    writeStatus.textContent = "Even one word is enough to start.";
    dump.focus();
    return;
  }
  writeStatus.textContent = "Sorting your thoughts...";
  organizeBtn.setAttribute("aria-disabled", "true");
  organizeBtn.textContent = "Sorting...";
  try {
    const [outcome] = await Promise.all([organizeText(text), settle(text)]);
    lastResult = outcome.result;
    if (text !== sortedText) ticked = new Set();
    sortedText = text;
    renderResult($("result-cards"), outcome.result);
    restoreTicks();
    // Once sorted, the words should not wait in storage to greet the next reload. They stay in the
    // textarea for "Back to my words", and typing there saves a new draft.
    clearTimeout(saveTimer);
    write(DRAFT_KEY, null);
    // After crisis words, "a little quieter" and a privacy footnote read as cheerful and beside the point.
    // A fallback notice still shows, so nobody thinks their own model wrote this when it was skipped.
    const crisis = outcome.result.needs_support;
    $("result-title").textContent = crisis ? "Thank you for writing this down." : "Here it is, a little quieter.";
    $("engine-note").textContent =
      outcome.notice ||
      (crisis ? "" : outcome.engine === "model" ? "Sorted by your TherapistGPT model." : "Sorted on this device. Nothing left your browser.");
    status.textContent = "";
    writeStatus.textContent = "";
    writeView.hidden = true;
    resultView.hidden = false;
    window.scrollTo({ top: 0 });
    // Land on the crisis card when there is one, so screen readers announce it first.
    const crisisHeading = document.querySelector(".crisis .card-label");
    (crisisHeading || $("result-title")).focus();
  } catch (error) {
    // Should never happen, but if sorting fails the person's words must stay exactly where they were.
    console.error(error);
    writeStatus.textContent = "Something went wrong while sorting. Your words are still here, so you can try again.";
  } finally {
    organizeBtn.removeAttribute("aria-disabled");
    organizeBtn.textContent = "Sort my thoughts";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  run();
});

dump.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    run();
  }
});

// ---------- result actions ----------

const todoTask = (item) => item.querySelector(".todo-task").textContent;

function restoreTicks() {
  $("result-cards").querySelectorAll(".todo").forEach((item) => {
    item.querySelector("input").checked = ticked.has(todoTask(item));
  });
}

$("result-cards").addEventListener("change", (event) => {
  const item = event.target.closest(".todo");
  if (!item) return;
  if (event.target.checked) ticked.add(todoTask(item));
  else ticked.delete(todoTask(item));
});

$("back-btn").addEventListener("click", showWrite);

$("new-btn").addEventListener("click", () => {
  clearWithUndo();
  lastResult = null;
  showWrite();
});

function downloadCopy(text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `therapistgpt-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// One button instead of two: copy when the browser allows it, otherwise save a file.
$("copy-btn").addEventListener("click", async () => {
  if (!lastResult) return;
  const text = resultToText(lastResult);
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Copied. Paste it anywhere you like to keep it.";
  } catch {
    downloadCopy(text);
    status.textContent = "Saved as a text file in your downloads.";
  }
});

// ---------- offline copy ----------

// sw.js keeps this release on the device so the page opens with no signal. Where service workers
// don't exist (plain http, some private modes) or registration fails, the page loads from the
// network as it always has, so a failure here is not worth showing anyone.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
