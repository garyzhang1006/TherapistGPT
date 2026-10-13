// Chooses who organizes the text: the on-device organizer (default, private) or the user's own
// trained model behind compute/serve.py. Any remote failure falls back to on-device, so the
// person always gets an answer.

import { organize as organizeOnDevice } from "./organizer.js?v=14";
import { applySafetyFloor, mentionsCrisis } from "./safety.js?v=14";

const SETTINGS_KEY = "therapistgpt.settings";
const REMOTE_TIMEOUT_MS = 60000;
const DEFAULTS = { engine: "device", endpoint: "", apiKey: "" };

// Private mode, blocked or full storage: when a save fails, settings live here for this visit instead
// of being dropped, and they win over any older stored copy, which would undo the person's last choice.
let visitSettings = null;

export function loadSettings() {
  if (visitSettings) return { ...DEFAULTS, ...visitSettings };
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved !== null) return { ...DEFAULTS, ...JSON.parse(saved) };
  } catch {
    // fall through to the defaults
  }
  return { ...DEFAULTS };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    visitSettings = null;
  } catch {
    visitSettings = { ...settings };
  }
}

function isString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isObject(v) {
  return v !== null && typeof v === "object";
}

// Light shape check on remote output. The server already validated it, but the browser should
// never render something malformed from a URL the user typed. A thread with no points fails here, as
// in schema.py, because the safety floor would turn a reply with only empty threads into its crisis thread.
export function looksValid(out) {
  if (!isObject(out)) return false;
  return (
    isString(out.summary) &&
    isString(out.one_small_step) &&
    typeof out.needs_support === "boolean" &&
    Array.isArray(out.feelings) && out.feelings.every(isString) &&
    Array.isArray(out.threads) && out.threads.length > 0 &&
    out.threads.every((t) => isObject(t) && isString(t.title) && Array.isArray(t.points) && t.points.length > 0 && t.points.every(isString)) &&
    Array.isArray(out.to_dos) && out.to_dos.every((t) => isObject(t) && isString(t.task) && isString(t.first_step)) &&
    Array.isArray(out.kinder_view) && out.kinder_view.every((k) => isObject(k) && isString(k.thought) && isString(k.reframe))
  );
}

export function normalizeEndpoint(endpoint) {
  const raw = endpoint.trim();
  // People often paste "name.hf.space" without the scheme; https is the only sensible guess.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url = null;
  try {
    url = new URL(withScheme);
  } catch {
    // handled below
  }
  // Browsers disagree on odd hosts (Chrome turns spaces into %20 instead of failing), so check the shape directly.
  if (!url || !/^(localhost|\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i.test(url.hostname)) {
    throw new Error(`"${raw}" isn't a web address. It should look like https://your-space.hf.space.`);
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Use an https address for your model (http is only allowed for localhost).");
  }
  // A Space address copied from the browser can carry "?logs=container" or "#app", and the routes
  // are appended to this string, so they would land inside the query or fragment.
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

// The deadline covers reading the body too: a server or tunnel can send its headers and then stall,
// and response.json() has no deadline of its own. The body is read only from a 2xx answer.
async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return { response, body: response.ok ? await response.json() : null };
  } finally {
    clearTimeout(timer);
  }
}

const STATUS_REASONS = {
  401: "Your model needs the right access key (see Settings).",
  503: "Your model is busy with another request right now.",
};

async function organizeRemote(text, endpoint, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;
  const { response, body } = await fetchJsonWithTimeout(
    `${normalizeEndpoint(endpoint)}/organize`,
    { method: "POST", headers, body: JSON.stringify({ text }) },
    REMOTE_TIMEOUT_MS
  );
  if (!response.ok) throw new Error(STATUS_REASONS[response.status] || `Your model answered with status ${response.status}.`);
  if (!looksValid(body)) throw new Error("Your model sent back something this page couldn't read.");
  return body;
}

export async function organizeText(text, settings = loadSettings()) {
  // A model can take up to a minute to answer, and someone who just wrote crisis words should see the
  // help card at once, not a spinner. Those words are sorted here and never sent.
  if (settings.engine === "model" && settings.endpoint && mentionsCrisis(text)) {
    return {
      result: applySafetyFloor(text, organizeOnDevice(text)),
      engine: "device",
      notice: "Sorted on this device so support could show right away. These words were not sent to your model.",
    };
  }
  if (settings.engine === "model" && settings.endpoint) {
    try {
      const out = await organizeRemote(text, settings.endpoint, settings.apiKey);
      return { result: applySafetyFloor(text, out), engine: "model", notice: "" };
    } catch (error) {
      // Browser errors like "Failed to fetch" or a JSON SyntaxError mean nothing to someone having a hard day.
      const reason =
        error.name === "AbortError"
          ? "Your model took too long to answer."
          : error.name === "TypeError" || error.name === "SyntaxError"
            ? "Couldn't reach your model."
            : error.message;
      return {
        result: applySafetyFloor(text, organizeOnDevice(text)),
        engine: "device",
        notice: `${reason} This was organized on your device instead.`,
      };
    }
  }
  return { result: applySafetyFloor(text, organizeOnDevice(text)), engine: "device", notice: "" };
}

const NOT_A_MODEL = "Something answered at that address, but it isn't a TherapistGPT model. Check the address.";

export async function testConnection(endpoint) {
  // A sleeping Space or a wrong host can answer 200 with a web page, and the parse error would be shown as is.
  const { response, body } = await fetchJsonWithTimeout(`${normalizeEndpoint(endpoint)}/health`, {}, 15000).catch((error) => {
    throw error.name === "SyntaxError" ? new Error(NOT_A_MODEL) : error;
  });
  if (!response.ok) throw new Error(`The server answered with status ${response.status}.`);
  if (!body || typeof body !== "object") throw new Error(NOT_A_MODEL);
  if (!body.ok) throw new Error("The server is up but the model hasn't finished loading.");
  return true;
}
