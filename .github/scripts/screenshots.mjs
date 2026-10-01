// Captures the README screenshots from a deployed copy of the site. Run by .github/workflows/screenshots.yml:
//   SITE_URL=https://garyzhang1006.github.io/TherapistGPT/ OUT_DIR=screenshots node .github/scripts/screenshots.mjs
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SITE_URL = process.env.SITE_URL || "https://garyzhang1006.github.io/TherapistGPT/";
const OUT_DIR = process.env.OUT_DIR || "screenshots";

// A plain, everyday dump. It must never contain crisis words: the screenshots are public, and a crisis
// card would replace the calm layout they are meant to show. run() below fails if one appears anyway.
const DUMP =
  "idk where to even start. bio exam tmrw and i havent studied, my boss wants me to pick up another shift, " +
  "mom keeps calling and i feel guilty for not picking up. i need to pay the phone bill. im so tired";

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};

try {
  new URL(SITE_URL);
} catch {
  throw new Error(`SITE_URL is not a valid URL: "${SITE_URL}". Pass a full address such as https://garyzhang1006.github.io/TherapistGPT/.`);
}

// Fails with the element's name and the page address, so a renamed id is obvious from the log.
async function need(page, selector, what) {
  // waitFor is strict and throws when a selector matches several elements, as the result cards do.
  const locator = page.locator(selector).first();
  try {
    await locator.waitFor({ state: "visible", timeout: 15000 });
  } catch {
    throw new Error(`Expected ${what} (${selector}) to be visible on ${page.url()}, but it never appeared. Did the id change in web/index.html?`);
  }
  return locator;
}

async function capture(page, name) {
  // Swapped-in web fonts change line breaks, so wait for them; and park the mouse so no hover state shows.
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.mouse.move(0, 0);
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`saved ${file}`);
}

async function shoot(browser, size) {
  // Dark is the app's default when the system asks for it; reduced motion skips the drifting fragments.
  const context = await browser.newContext({ ...VIEWPORTS[size], colorScheme: "dark", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const response = await page.goto(SITE_URL, { waitUntil: "load" });
    if (!response || !response.ok()) throw new Error(`Loading ${SITE_URL} returned HTTP ${response ? response.status() : "no response"}.`);

    const dump = await need(page, "#dump", "the brain dump textarea");
    await need(page, "#organize-btn", 'the "Sort my thoughts" button');
    await dump.fill("");
    await capture(page, `write-${size}.png`);

    await dump.fill(DUMP);
    await page.getByRole("button", { name: "Sort my thoughts" }).click();
    await need(page, "#result-view", "the results view");
    await need(page, "#result-cards .card", "at least one result card");
    if ((await page.locator("#result-cards .crisis").count()) > 0) {
      throw new Error("The sample dump produced a crisis card. Change DUMP in .github/scripts/screenshots.mjs to everyday text.");
    }
    await capture(page, `results-${size}.png`);

    if (size === "phone") {
      const toggle = await need(page, "#theme-toggle", "the theme toggle");
      await toggle.click();
      const theme = await page.evaluate(() => document.documentElement.dataset.theme);
      if (theme !== "light") throw new Error(`Clicking #theme-toggle left data-theme as "${theme}", expected "light".`);
      await capture(page, "results-phone-light.png");
    }
  } finally {
    await context.close();
  }
}

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  for (const size of Object.keys(VIEWPORTS)) await shoot(browser, size);
} finally {
  await browser.close();
}
