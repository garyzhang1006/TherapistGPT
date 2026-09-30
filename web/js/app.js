import { organizeText, loadSettings, saveSettings, testConnection } from "./engine.js";
import { renderResult, resultToText } from "./render.js";
import { splitClauses } from "./organizer.js";
import { mentionsCrisis } from "./safety.js";

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
    dump.value = removed;
    write(DRAFT_KEY, removed);
    writeStatus.textContent = "";
    dump.focus();
  });
  writeStatus.append(undo);
  undoTimer = setTimeout(() => (writeStatus.textContent = ""), 12000);
}

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

$("theme-toggle").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  prefs.theme = next;
  write(PREFS_KEY, prefs);
});

sizeToggle.addEventListener("click", () => {
  prefs.large = !prefs.large;
  if (prefs.large) document.documentElement.dataset.size = "large";
  else delete document.documentElement.dataset.size;
  sizeToggle.setAttribute("aria-pressed", String(prefs.large));
  write(PREFS_KEY, prefs);
});

// ---------- dialogs ----------

document.querySelectorAll("[data-open]").forEach((button) => {
  button.addEventListener("click", () => {
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
const endpointStatus = $("endpoint-status");

function fillSettings() {
  const settings = loadSettings();
  settingsForm.elements.engine.value = settings.engine;
  endpointInput.value = settings.endpoint;
  endpointStatus.textContent = "";
}

function updatePrivacyNote() {
  const settings = loadSettings();
  $("privacy-text").textContent =
    settings.engine === "model" && settings.endpoint
      ? "Sent only to your own model's address, and never saved there."
      : "Stays on this device. Nothing is sent anywhere.";
}

$("save-settings").addEventListener("click", (event) => {
  const engine = settingsForm.elements.engine.value || "device";
  const endpoint = endpointInput.value.trim();
  if (engine === "model" && !endpoint) {
    event.preventDefault();
    endpointStatus.textContent = "Add your model's address first, or choose This device.";
    endpointInput.focus();
    return;
  }
  saveSettings({ engine, endpoint });
  updatePrivacyNote();
});

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
// never drift across the screen.
function settle(text) {
  if (reduceMotion.matches || mentionsCrisis(text)) return Promise.resolve();
  const stage = $("settle");
  const box = dump.getBoundingClientRect();
  const fragments = splitClauses(text).slice(0, 12);
  const motes = fragments.map((fragment, i) => {
    const mote = document.createElement("span");
    mote.className = "mote";
    mote.textContent = fragment.split(/\s+/).slice(0, 5).join(" ");
    mote.style.left = `${box.left + Math.random() * Math.max(box.width - 180, 40)}px`;
    mote.style.top = `${box.top + Math.random() * Math.max(box.height - 40, 40)}px`;
    mote.style.transitionDelay = `${i * 45}ms`;
    stage.append(mote);
    return mote;
  });
  requestAnimationFrame(() => {
    motes.forEach((mote, i) => {
      mote.style.opacity = "0.9";
      const row = i % 4;
      mote.style.transform = `translate(${(row - 1.5) * 12}px, ${-40 - (i % 3) * 18}px)`;
    });
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
  const text = dump.value.trim();
  if (!text) {
    writeStatus.textContent = "Even one word is enough to start.";
    dump.focus();
    return;
  }
  writeStatus.textContent = "";
  organizeBtn.disabled = true;
  organizeBtn.textContent = "Sorting...";
  try {
    const [outcome] = await Promise.all([organizeText(text), settle(text)]);
    lastResult = outcome.result;
    renderResult($("result-cards"), outcome.result);
    $("engine-note").textContent =
      outcome.notice ||
      (outcome.engine === "model" ? "Sorted by your TherapistGPT model." : "Sorted on this device. Nothing left your browser.");
    status.textContent = "";
    writeView.hidden = true;
    resultView.hidden = false;
    window.scrollTo({ top: 0 });
    // Land on the crisis card when there is one, so screen readers announce it first.
    const crisisHeading = document.querySelector(".crisis .card-label");
    (crisisHeading || $("result-title")).focus();
  } finally {
    organizeBtn.disabled = false;
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

$("back-btn").addEventListener("click", showWrite);

$("new-btn").addEventListener("click", () => {
  clearWithUndo();
  lastResult = null;
  showWrite();
});

$("copy-btn").addEventListener("click", async () => {
  if (!lastResult) return;
  try {
    await navigator.clipboard.writeText(resultToText(lastResult));
    status.textContent = "Copied.";
  } catch {
    status.textContent = "Your browser blocked copying. Try Save as a file instead.";
  }
});

$("download-btn").addEventListener("click", () => {
  if (!lastResult) return;
  const blob = new Blob([resultToText(lastResult)], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `therapistgpt-${date}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = "Saved to your downloads.";
});
