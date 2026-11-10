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
/** After the code: Hapoalim checks it, then loads the home page. A box still showing after this was turned down. */
const AFTER_CODE_MS = 25_000;
const URL_STABLE_MS = 2_000;

export const CODE_NEEDED_MESSAGE =
  "Bank Hapoalim asked for a one-time code, and nobody was there to type it. Press Sync at the top of the page and enter the code when Spent asks.";
/**
 * Hapoalim blocks the login after a second wrong code, so a turned-down code
 * ends the sync instead of asking again. A new sync gets a fresh code.
 */
export const CODE_REJECTED_MESSAGE =
  "Bank Hapoalim didn't accept the code. Spent stopped instead of trying again, because another wrong code would block the login. Sync again to get a new code, and type it exactly as it arrives.";
/** The page didn't take the digits. Nothing was sent, so no attempt was used up. */
export const CODE_NOT_TYPED_MESSAGE =
  "Spent couldn't type the code into Bank Hapoalim's page, so it didn't send it and no attempt was used up. Please let the Spent maintainers know; the sync log has the details.";
/** Hapoalim stopped taking codes for this login. Only the bank can release it. */
export const CODE_LOCKED_MESSAGE =
  "Bank Hapoalim locked code entry after too many wrong codes. Unlock it on Hapoalim's website or app, then sync again.";

/**
 * Hapoalim's notice that code entry is locked: "מצטערים, לא ניתן להמשיך
 * בפעולה בגלל טעויות בהקלדת קוד האימות", or wording about a block that has
 * happened. Not the earlier warning ("ייחסמו", will be blocked), which still
 * allows one more try.
 */
const LOCKED_TEXT = /לא ניתן להמשיך|נחסמ/;

/** True when an alert or error on the page says code entry is locked. */
async function isLocked(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const text = await frame
      .evaluate(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>('[role=alert], [aria-live], kite-alert, [class*="error" i]')
        )
          .map((el) => el.innerText || "")
          .join(" ")
      )
      .catch(() => "");
    if (LOCKED_TEXT.test(text)) return true;
  }
  return false;
}

/**
 * How a row of digit boxes runs on screen, for the log (no values): page
 * order left to right or right to left, and the row's text direction. The
 * code goes in page order, the way the boxes move from one to the next as a
 * person types.
 */
async function describeBoxes(inputs: ElementHandle<Element>[]): Promise<string> {
  if (inputs.length < 2) return "one box";
  const xs: number[] = [];
  for (const box of inputs) xs.push(await box.evaluate((el) => el.getBoundingClientRect().left).catch(() => 0));
  const ltr = xs.every((x, i) => i === 0 || x > xs[i - 1]);
  const rtl = xs.every((x, i) => i === 0 || x < xs[i - 1]);
  const dir = await inputs[0]
    .evaluate((el) => (el.parentElement ? getComputedStyle(el.parentElement).direction : "?"))
    .catch(() => "?");
  const order = ltr ? "left to right" : rtl ? "right to left" : "mixed";
  return `${inputs.length} boxes, page order runs ${order} on screen, row direction ${dir}`;
}

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


interface CodeTarget {
  frame: Frame;
  /** One box for the whole code, or one box per digit. */
  inputs: ElementHandle<Element>[];
}

/** Fewer boxes than this in a row is a single field (and something else beside it). */
const MIN_DIGIT_BOXES = 4;

/**
 * The code input(s) on the page, if it's asking for a code: one field for
 * the whole code, or a row of boxes with one digit each. Hapoalim uses the
 * row, five plain text boxes without a maxlength, so several visible matches
 * of the same kind count as a row too.
 */
async function findCodeInputs(page: Page): Promise<CodeTarget | null> {
  for (const frame of page.frames()) {
    for (const selector of CODE_INPUTS) {
      const visible: ElementHandle<Element>[] = [];
      for (const h of await frame.$$(selector).catch(() => [] as ElementHandle<Element>[])) {
        if (await isVisible(h)) visible.push(h);
      }
      if (visible.length === 0) continue;
      if (visible.length >= MIN_DIGIT_BOXES) return { frame, inputs: visible };
      const perDigit = await visible[0].evaluate((el) => (el as HTMLInputElement).maxLength === 1);
      if (!perDigit) return { frame, inputs: [visible[0]] };
      const boxes: ElementHandle<Element>[] = [];
      for (const h of await frame.$$('input[maxlength="1"]')) if (await isVisible(h)) boxes.push(h);
      return { frame, inputs: boxes.length > 0 ? boxes : [visible[0]] };
    }
  }
  return null;
}

/** What the boxes hold now, digits only, in page order. */
async function boxDigits(inputs: ElementHandle<Element>[]): Promise<string> {
  let out = "";
  for (const box of inputs) {
    out += await box.evaluate((el) => ((el as HTMLInputElement).value.match(/\d/g) ?? []).join("")).catch(() => "");
  }
  return out;
}

/** Sets a box the way a framework (Angular here) notices: the native setter, then input and change events. */
async function setBox(box: ElementHandle<Element>, value: string): Promise<void> {
  await box
    .evaluate((el, v: string) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      input.focus();
      if (setter) setter.call(input, v);
      else input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value)
    .catch(() => undefined);
}

/**
 * Puts the code in the box(es) and checks it's all there. Keys first (what
 * a person does), then setting the value directly if the keys didn't take.
 * True only when the boxes hold exactly the code.
 */
async function enterCode(target: CodeTarget, code: string): Promise<boolean> {
  const { inputs } = target;
  const perBox = inputs.length > 1;
  if (perBox && code.length !== inputs.length) return false;

  // Backspace only in a box that has something: in an empty digit box, many
  // widgets take it as "delete the previous digit".
  const clear = async (box: ElementHandle<Element>) => {
    const filled = await box.evaluate((el) => {
      const i = el as HTMLInputElement;
      i.focus();
      i.select();
      return i.value.length > 0;
    });
    if (filled) await box.press("Backspace");
  };

  if (perBox) {
    for (let i = 0; i < inputs.length; i++) {
      await clear(inputs[i]);
      await inputs[i].type(code[i], { delay: 60 });
    }
  } else {
    await clear(inputs[0]);
    await inputs[0].type(code, { delay: 60 });
  }
  if ((await boxDigits(inputs)) === code) return true;

  if (perBox) {
    for (let i = 0; i < inputs.length; i++) await setBox(inputs[i], code[i]);
  } else {
    await setBox(inputs[0], code);
  }
  return (await boxDigits(inputs)) === code;
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
/** How long to wait for the code's button to enable after typing (it checks the code first). */
const BUTTON_ENABLE_MS = 5_000;

/**
 * Clicks the button that belongs to the code box: walking out from the box,
 * the first container with a matching button wins, so the popup's
 * "המשך" is found before the login form's "כניסה" underneath it. A button
 * that's still disabled is waited for, not skipped. "כניסה" is a fallback
 * only when the login form isn't on the page, since that one signs in again
 * and sends a new code. Returns what was pressed, for the log.
 */
async function submitCode(lastInput: ElementHandle<Element>): Promise<string> {
  const until = Date.now() + BUTTON_ENABLE_MS;
  for (;;) {
    const result = await lastInput
      // Runs in the page. No named inner functions: some bundlers wrap those in
      // a helper the page doesn't have.
      .evaluate(
        (el, preferred: string, fallback: string, neverSource: string) => {
          const never = new RegExp(neverSource);
          const loginField = document.querySelector<HTMLElement>("#userCode, #password");
          const loginShowing = Boolean(loginField && loginField.getBoundingClientRect().width > 0);
          const sources = loginShowing ? [preferred] : [preferred, fallback];
          let waiting = "";
          for (const source of sources) {
            const re = new RegExp(source);
            for (let node = el.parentElement; node; node = node.parentElement) {
              for (const b of Array.from(node.querySelectorAll<HTMLElement>('button, input[type="submit"], [role="button"]'))) {
                const r = b.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                const text = (b.innerText || (b as HTMLInputElement).value || "").trim();
                if (!re.test(text) || never.test(text)) continue;
                if ((b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true") {
                  waiting = waiting || text;
                  continue;
                }
                b.click();
                return `clicked "${text.replace(/\d/g, "#").slice(0, 30)}"`;
              }
            }
          }
          return waiting ? "disabled" : "none";
        },
        SUBMIT_TEXT.source,
        SUBMIT_FALLBACK_TEXT.source,
        NEVER_TEXT.source
      )
      .catch(() => "none");
    if (result.startsWith("clicked")) return result;
    if (result === "disabled" && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    await lastInput.press("Enter").catch(() => undefined);
    return result === "disabled" ? "pressed Enter (the button stayed disabled)" : "pressed Enter (no button found)";
  }
}

/** Until the address changes or the code box goes away (the code was taken), up to `ms`. */
async function waitForCodeTaken(page: Page, from: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 700));
    if (page.url() !== from) return;
    if (!(await findCodeInputs(page))) return;
  }
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
        const counts: number[] = [];
        const els = Array.from(document.querySelectorAll<HTMLElement>(
            'input, button, [role=button], h1, h2, h3, [role=alert], [aria-live], kite-alert, label, [class*="error" i], [class*="invalid" i]'
          ));
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
          if (text.endsWith('""')) continue;
          if (seen.has(text)) {
            const at = out.indexOf(text);
            counts[at] = (counts[at] ?? 1) + 1;
            continue;
          }
          seen.add(text);
          out.push(text);
          if (out.length >= 14) break;
        }
        return {
          title: document.title.replace(/\d/g, "#").slice(0, 60),
          out: out.map((t, i) => (counts[i] ? `${t} x${counts[i]}` : t)),
        };
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

  /**
   * One code, one try. Hapoalim blocks the login after a second wrong code,
   * so a code is sent only when every digit is in place, and a turned-down
   * code ends the sync.
   */
  private async codeStep(page: Page): Promise<void> {
    await settle(page);
    if (isSignedIn(page.url())) return;
    const target = await findCodeInputs(page);
    if (!target) {
      console.log(`[scraper] Hapoalim login stopped on a page Spent doesn't know: ${await describePage(page)}`);
      return;
    }
    // Already locked: asking for a code would only waste one.
    if (await isLocked(page)) {
      console.log(`[scraper] Hapoalim has locked code entry: ${await describePage(page)}`);
      throw new Error(CODE_LOCKED_MESSAGE);
    }
    if (!this.askForCode) throw new Error(CODE_NEEDED_MESSAGE);
    console.log(`[scraper] Bank Hapoalim asked for a one-time code (${await describeBoxes(target.inputs)})`);
    const code = (await this.askForCode()).replace(/\D/g, "");
    this.onCodeSubmitted?.();

    if (target.inputs.length > 1 && code.length !== target.inputs.length) {
      throw new Error(
        `Bank Hapoalim's code has ${target.inputs.length} digits, and ${code.length} were entered. Nothing was sent, so no attempt was used up. Sync again and type the whole code.`
      );
    }
    await rememberDevice(target.frame);
    const entered = await enterCode(target, code);
    // Only counts, never the code itself.
    const landed = (await boxDigits(target.inputs)).length;
    if (!entered) {
      console.log(
        `[scraper] Hapoalim code not sent: ${landed} of ${code.length} digits in ${target.inputs.length} box(es). ${await describePage(page)}`
      );
      throw new Error(CODE_NOT_TYPED_MESSAGE);
    }
    const before = page.url();
    const pressed = await submitCode(target.inputs[target.inputs.length - 1]);
    console.log(`[scraper] Hapoalim code: all ${code.length} digits in place, ${pressed}`);
    await waitForCodeTaken(page, before, AFTER_CODE_MS);
    if (page.url() === before && (await isLocked(page))) {
      console.log(`[scraper] Hapoalim locked code entry after the code: ${await describePage(page)}`);
      throw new Error(CODE_LOCKED_MESSAGE);
    }
    if (page.url() === before && (await findCodeInputs(page))) {
      console.log(`[scraper] Hapoalim turned the code down: ${await describePage(page)}`);
      throw new Error(CODE_REJECTED_MESSAGE);
    }
    await settle(page);
    if (!isSignedIn(page.url())) {
      console.log(`[scraper] Hapoalim login didn't finish after the code: ${await describePage(page)}`);
    }
  }
}
