// Chooses who organizes the text: the on-device organizer (default, private) or the user's own
// trained model behind compute/serve.py. Any remote failure falls back to on-device, so the
// person always gets an answer.

import { organize as organizeOnDevice } from "./organizer.js";
import { applySafetyFloor } from "./safety.js";

const SETTINGS_KEY = "therapistgpt.settings";
const REMOTE_TIMEOUT_MS = 60000;
const DEFAULTS = { engine: "device", endpoint: "", apiKey: "" };

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or blocked storage: settings last for this visit only.
  }
}

function isString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

// Light shape check on remote output. The server already validated it, but the browser should
// never render something malformed from a URL the user typed.
export function looksValid(out) {
  if (!out || typeof out !== "object") return false;
  return (
    isString(out.summary) &&
    isString(out.one_small_step) &&
    typeof out.needs_support === "boolean" &&
    Array.isArray(out.feelings) && out.feelings.every(isString) &&
    Array.isArray(out.threads) && out.threads.length > 0 &&
    out.threads.every((t) => isString(t.title) && Array.isArray(t.points) && t.points.every(isString)) &&
    Array.isArray(out.to_dos) && out.to_dos.every((t) => isString(t.task) && isString(t.first_step)) &&
    Array.isArray(out.kinder_view) && out.kinder_view.every((k) => isString(k.thought) && isString(k.reframe))
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
  return url.toString().replace(/\/+$/, "");
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
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
  const response = await fetchWithTimeout(
    `${normalizeEndpoint(endpoint)}/organize`,
    { method: "POST", headers, body: JSON.stringify({ text }) },
    REMOTE_TIMEOUT_MS
  );
  if (!response.ok) throw new Error(STATUS_REASONS[response.status] || `Your model answered with status ${response.status}.`);
  const out = await response.json();
  if (!looksValid(out)) throw new Error("Your model sent back something this page couldn't read.");
  return out;
}

export async function organizeText(text, settings = loadSettings()) {
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

export async function testConnection(endpoint) {
  const response = await fetchWithTimeout(`${normalizeEndpoint(endpoint)}/health`, {}, 15000);
  if (!response.ok) throw new Error(`The server answered with status ${response.status}.`);
  const body = await response.json();
  if (!body.ok) throw new Error("The server is up but the model hasn't finished loading.");
  return true;
}
