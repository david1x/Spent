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
/** The login form's own fields: while they're showing, it isn't the code page. */
const LOGIN_FIELDS = ["#userCode", "#password"];
const CODE_INPUTS = [
  'input[autocomplete="one-time-code"]',
  'input[name*="otp" i]',
  'input[id*="otp" i]',
  'input[name*="code" i]:not([name*="user" i])',
  'input[id*="code" i]:not([id*="user" i])',
  'input[inputmode="numeric"]',
  'input[type="tel"]',
  'input[type="password"][maxlength="6"]',
];
const SUBMIT_TEXT = /המשך|אישור|אשר|כניסה|שלח|אמת|התחבר/;
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
    if (await firstVisible(frame, LOGIN_FIELDS)) continue;
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

async function submitCode(frame: Frame, lastInput: ElementHandle<Element>): Promise<void> {
  const clicked = await frame
    // Runs in the page. No named inner functions: some bundlers wrap those in
    // a helper the page doesn't have.
    .evaluate((source: string) => {
      const re = new RegExp(source);
      let byText: HTMLElement | null = null;
      for (const b of Array.from(document.querySelectorAll<HTMLElement>('button, input[type="submit"], [role="button"]'))) {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if ((b as HTMLButtonElement).type === "submit") {
          b.click();
          return true;
        }
        if (!byText && re.test((b.innerText || (b as HTMLInputElement).value || "").trim())) byText = b;
      }
      if (!byText) return false;
      byText.click();
      return true;
    }, SUBMIT_TEXT.source)
    .catch(() => false);
  if (!clicked) await lastInput.press("Enter").catch(() => undefined);
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
      if (!target) return;
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
      await submitCode(target.frame, target.inputs[target.inputs.length - 1]);
      await waitForUrlChange(page, before, AFTER_CODE_MS);
    }
    await settle(page);
  }
}
