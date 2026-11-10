import "server-only";

import HapoalimScraper from "israeli-bank-scrapers/lib/scrapers/hapoalim";
import type { ElementHandle, Frame, Page } from "puppeteer";

/**
 * Bank Hapoalim, plus its one-time code. After the user code and password,
 * Hapoalim sometimes asks for a code it sends by SMS (a new device, or every
 * so often). The library can't answer that, so a headless sync used to fail
 * and the only way through was a visible browser window, which a server or
 * Docker container doesn't have. Here the code page is recognized by its
 * input, the code is asked for in Spent's sync dialog, and typed into the
 * page in the background.
 *
 * The page is found by what's on it rather than by its address, so a change
 * in Hapoalim's URLs doesn't break it. Codes are never logged.
 */

/** Where a finished login lands (same list as the library's). */
const SIGNED_IN = [/\/portalserver\/HomePage/i, /\/ng-portals(-bt)?\/rb\/he\/homepage/i];
/**
 * The login form's own fields. Hapoalim opens the code box as a popup on top
 * of the login form, so these stay on the page; they're just never the code box.
 */
const NOT_LOGIN = ':not(#userCode):not(#password)';
const CODE_INPUTS = [
  'input[autocomplete="one-time-code"]',
  'input[name*="otp" i]',
  'input[id*="otp" i]',
  'input[name*="code" i]:not([name*="user" i])',
  'input[id*="code" i]:not([id*="user" i])',
  // Hapoalim's popup: a plain text box with a number keypad, no id or name.
  'input[inputmode="decimal"]',
  'input[inputmode="numeric"]',
  'input[type="tel"]',
  'input[type="password"][maxlength="6"]',
].map((s) => `${s}${NOT_LOGIN}`);
/**
 * The button that sends the code. "Continue" or "confirm" first; "sign in"
 * only as a fallback, since the login form's own button is on the page too.
 * Never "שלחו קוד חדש" (send a new code) or "קוד קולי" (voice code).
 */
const SUBMIT_TEXT = /המשך|אישור|אשר|אמת/;
const SUBMIT_FALLBACK_TEXT = /כניסה|התחבר/;
const NEVER_TEXT = /שלח|קולי|חדש/;
const REMEMBER_TEXT = /זכור|לזכור|מכשיר/;

const REDIRECT_MS = 20_000;
/** After the code: Hapoalim checks it, then loads the home page. */
const AFTER_CODE_MS = 45_000;
const URL_STABLE_MS = 2_000;
const MAX_CODE_ROUNDS = 2;

export const CODE_NEEDED_MESSAGE =
  "Bank Hapoalim asked for a one-time code, and nobody was there to type it. Press Sync at the top of the page and enter the code when Spent asks.";

const isSignedIn = (url: string) => SIGNED_IN.some((re) => re.test(url));

async function waitForUrlChange(page: Page, from: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until && page.url() === from) await new Promise((r) => setTimeout(r, 500));
}

/** Waits until the address holds still, so redirects are done before the page is read. */
async function settle(page: Page, maxMs = 15_000): Promise<void> {
  const until = Date.now() + maxMs;
  let last = page.url();
  let since = Date.now();
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 400));
    const now = page.url();
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= URL_STABLE_MS) {
      return;
    }
  }
}

async function isVisible(handle: ElementHandle<Element>): Promise<boolean> {
  return handle
    .evaluate((el) => {
      const input = el as HTMLInputElement;
      const r = input.getBoundingClientRect();
      const style = getComputedStyle(input);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none" && !input.disabled;
    })
    .catch(() => false);
}

async function firstVisible(frame: Frame, selectors: string[]): Promise<ElementHandle<Element> | null> {
  for (const selector of selectors) {
    const handles = await frame.$$(selector).catch(() => [] as ElementHandle<Element>[]);
    for (const h of handles) if (await isVisible(h)) return h;
  }
  return null;
}

interface CodeTarget {
  frame: Frame;
  /** One box for the whole code, or one box per digit. */
  inputs: ElementHandle<Element>[];
}

/** The code input(s) on the page, if it's asking for a code. */
async function findCodeInputs(page: Page): Promise<CodeTarget | null> {
  for (const frame of page.frames()) {
    const first = await firstVisible(frame, CODE_INPUTS);
    if (!first) continue;
    const perDigit = await first.evaluate((el) => (el as HTMLInputElement).maxLength === 1);
    if (!perDigit) return { frame, inputs: [first] };
    const boxes: ElementHandle<Element>[] = [];
    for (const h of await frame.$$('input[maxlength="1"]')) if (await isVisible(h)) boxes.push(h);
    return { frame, inputs: boxes.length > 0 ? boxes : [first] };
  }
  return null;
}

/** Ticks "remember this device" when the page offers it, so Hapoalim asks less often. */
async function rememberDevice(frame: Frame): Promise<void> {
  await frame
    .evaluate((source: string) => {
      const re = new RegExp(source);
      for (const box of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
        const label = (box.labels?.[0]?.innerText ?? box.closest("label")?.innerText ?? box.parentElement?.innerText ?? "").trim();
        if (re.test(label) && !box.checked) box.click();
      }
    }, REMEMBER_TEXT.source)
    .catch(() => undefined);
}

/**
 * Clicks the button that belongs to the code box: walking out from the box,
 * the first container with a matching button wins, so the popup's
 * "המשך" is found before the login form's "כניסה" underneath it.
 */
async function submitCode(lastInput: ElementHandle<Element>): Promise<void> {
  const clicked = await lastInput
    // Runs in the page. No named inner functions: some bundlers wrap those in
    // a helper the page doesn't have.
    .evaluate(
      (el, sources: string[], neverSource: string) => {
        const never = new RegExp(neverSource);
        for (const source of sources) {
          const re = new RegExp(source);
          for (let node = el.parentElement; node; node = node.parentElement) {
            for (const b of Array.from(node.querySelectorAll<HTMLElement>('button, input[type="submit"], [role="button"]'))) {
              const r = b.getBoundingClientRect();
              if (r.width === 0 || r.height === 0 || (b as HTMLButtonElement).disabled) continue;
              const text = (b.innerText || (b as HTMLInputElement).value || "").trim();
              if (re.test(text) && !never.test(text)) {
                b.click();
                return true;
              }
            }
          }
        }
        return false;
      },
      [SUBMIT_TEXT.source, SUBMIT_FALLBACK_TEXT.source],
      NEVER_TEXT.source
    )
    .catch(() => false);
  if (!clicked) await lastInput.press("Enter").catch(() => undefined);
}

/**
 * What a page shows, for the log when the login doesn't finish: its path,
 * title, headings and the visible inputs and buttons. Never input values,
 * and every digit is masked, so no codes, account or phone numbers.
 */
async function describePage(page: Page): Promise<string> {
  let path = "";
  try {
    path = new URL(page.url()).pathname;
  } catch {
    path = "?";
  }
  const parts = [`path=${path}`];
  for (const frame of page.frames()) {
    // Runs in the page; no named inner functions (see submitCode).
    const info = await frame
      .evaluate(() => {
        const out: string[] = [];
        const seen = new Set<string>();
        const els = Array.from(document.querySelectorAll<HTMLElement>("input, button, [role=button], h1, h2, h3, [role=alert], label"));
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          let text: string;
          if (el.tagName === "INPUT") {
            const i = el as HTMLInputElement;
            text = `input[type=${i.type}${i.id ? ` id=${i.id}` : ""}${i.name ? ` name=${i.name}` : ""}${i.autocomplete ? ` autocomplete=${i.autocomplete}` : ""}${i.inputMode ? ` inputmode=${i.inputMode}` : ""}${i.maxLength > 0 ? ` maxlength=${i.maxLength}` : ""}${i.placeholder ? ` placeholder="${i.placeholder}"` : ""}]`.replace(/\d/g, "#");
          } else {
            text = `${el.tagName.toLowerCase()}"${(el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60).replace(/\d/g, "#")}"`;
          }
          if (seen.has(text) || text.endsWith('""')) continue;
          seen.add(text);
          out.push(text);
          if (out.length >= 14) break;
        }
        return { title: document.title.replace(/\d/g, "#").slice(0, 60), out };
      })
      .catch(() => null);
    if (!info || info.out.length === 0) continue;
    const where = frame === page.mainFrame() ? `title="${info.title}"` : "frame";
    parts.push(`${where}: ${info.out.join(" | ")}`);
  }
  return parts.join(" ; ");
}

export class SpentHapoalimScraper extends HapoalimScraper {
  /** Asks the user for the code; unset when nobody is watching (scheduled sync). */
  askForCode?: () => Promise<string>;
  onCodeSubmitted?: () => void;
  /** A visible browser: the user types the code there, so don't ask for it. */
  visible = false;

  override getLoginOptions(
    credentials: Parameters<HapoalimScraper["getLoginOptions"]>[0]
  ): ReturnType<HapoalimScraper["getLoginOptions"]> {
    const base = super.getLoginOptions(credentials);
    return {
      ...base,
      postAction: async () => {
        const page = this.page;
        // Wait for the form to go away, unless it already has.
        if (page.url() === base.loginUrl) {
          await waitForUrlChange(page, base.loginUrl, this.visible ? 120_000 : REDIRECT_MS);
        }
        if (!this.visible) await this.codeStep(page);
      },
    };
  }

  private async codeStep(page: Page): Promise<void> {
    for (let round = 0; round < MAX_CODE_ROUNDS; round++) {
      await settle(page);
      if (isSignedIn(page.url())) return;
      const target = await findCodeInputs(page);
      if (!target) {
        console.log(`[scraper] Hapoalim login stopped on a page Spent doesn't know: ${await describePage(page)}`);
        return;
      }
      if (!this.askForCode) throw new Error(CODE_NEEDED_MESSAGE);
      console.log("[scraper] Bank Hapoalim asked for a one-time code");
      const code = (await this.askForCode()).replace(/\s+/g, "");
      this.onCodeSubmitted?.();

      await rememberDevice(target.frame);
      if (target.inputs.length > 1) {
        for (let i = 0; i < target.inputs.length && i < code.length; i++) await target.inputs[i].type(code[i]);
      } else {
        const input = target.inputs[0];
        await input.click({ clickCount: 3 });
        await input.type(code, { delay: 40 });
      }
      const before = page.url();
      await submitCode(target.inputs[target.inputs.length - 1]);
      await waitForUrlChange(page, before, AFTER_CODE_MS);
    }
    await settle(page);
    if (!isSignedIn(page.url())) {
      console.log(`[scraper] Hapoalim login didn't finish after the code: ${await describePage(page)}`);
    }
  }
}
