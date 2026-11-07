import "server-only";

import IsracardScraper from "israeli-bank-scrapers/lib/scrapers/isracard";
import {
  BaseScraperWithBrowser,
  type LoginOptions,
} from "israeli-bank-scrapers/lib/scrapers/base-scraper-with-browser";
import type { ScraperScrapingResult } from "israeli-bank-scrapers/lib/scrapers/interface";
import { interceptionPriorities } from "israeli-bank-scrapers/lib/helpers/browser";
import { fetchDigitalV3Accounts, type IsracardAccount } from "./isracard-digital-v3";
import type { Page } from "puppeteer";

/**
 * Isracard login through the real form instead of the library's direct API
 * calls. The page now protects login with reCAPTCHA, which the form handles
 * on its own; the bare API requests get answered with "Block Automation".
 *
 * Transactions are still fetched by the library's Isracard API code, which
 * runs inside the logged-in page and reuses the session the form created.
 */
const BASE_URL = "https://digital.isracard.co.il";
const LOGIN_URL = `${BASE_URL}/personalarea/Login`;
/** Isracard's new personal area, where accounts land after login and the data API lives. */
const WEB_BASE_URL = "https://web.isracard.co.il";
const COMPANY_CODE = "11";

// The form's own ids (set by hand in Isracard's Angular templates), far
// steadier than positional paths.
const ID_INPUT = "#otpLoginId_ID";
const CARD_INPUT = "#cardnum";
const PASSWORD_INPUT = "#otpLoginPwd";
const FIELD_ERRORS = ["#otpLoginIdErrorMsg", "#cardnumErrorMsg", "#otpLoginPwdErrorMsg"];

/**
 * The page opens on the SMS login. "או כניסה עם סיסמה קבועה" flips the card
 * over to the password form. The password inputs exist (rotated away) before
 * the flip, so their visibility can't tell us which side is showing; always
 * click the link when it's there.
 */
const SWITCH_TO_PASSWORD = "#flip";
/** The flip is a CSS animation; typing during it can land in the wrong side. */
const FLIP_SETTLE_MS = 1_200;

const FORM_WAIT_MS = 20_000;
/** Headless runs fail fast; with a visible browser the user may need time for a captcha or SMS code. */
const RESULT_WAIT_HEADLESS_MS = 30_000;
const RESULT_WAIT_VISIBLE_MS = 120_000;
/** Upper bound for Isracard's post-login redirect chain. */
const POST_LOGIN_REDIRECT_MS = 30_000;
/** How long the URL must hold still before the redirects count as done. */
const URL_STABLE_MS = 3_000;

interface IsracardCredentials {
  id: string;
  card6Digits: string;
  password: string;
}

function isOnLoginPage(page: Page): boolean {
  return /\/personalarea\/login/i.test(new URL(page.url()).pathname);
}

async function visibleFieldError(page: Page): Promise<boolean> {
  return page.evaluate((selectors: string[]) => {
    return selectors.some((selector) => {
      const el = document.querySelector<HTMLElement>(selector);
      return Boolean(el && el.offsetParent !== null && el.innerText.trim().length > 0);
    });
  }, FIELD_ERRORS);
}

export class SpentIsracardScraper extends IsracardScraper {
  override getLoginOptions(rawCredentials: unknown): LoginOptions {
    const credentials = rawCredentials as IsracardCredentials;
    const page = this.page;
    // ScraperOptions is a union; only the launch-a-browser variant has showBrowser.
    const visible = "showBrowser" in this.options && this.options.showBrowser === true;
    const resultWaitMs = visible ? RESULT_WAIT_VISIBLE_MS : RESULT_WAIT_HEADLESS_MS;

    return {
      loginUrl: LOGIN_URL,
      checkReadiness: async () => {
        const flip = await page
          .waitForSelector(SWITCH_TO_PASSWORD, { visible: true, timeout: FORM_WAIT_MS })
          .catch(() => null);
        if (flip) {
          await flip.click();
          await new Promise((r) => setTimeout(r, FLIP_SETTLE_MS));
          console.log("[scraper] isracard: switched to the password login form");
        } else {
          console.warn("[scraper] isracard: password login switch not found, trying the form as is");
        }
        await page.waitForSelector(PASSWORD_INPUT, { visible: true, timeout: FORM_WAIT_MS });
      },
      fields: [
        { selector: ID_INPUT, value: credentials.id },
        { selector: CARD_INPUT, value: credentials.card6Digits },
        { selector: PASSWORD_INPUT, value: credentials.password },
      ],
      submitButtonSelector: async () => {
        // The submit button belongs to the same form as the password field.
        // Skip the "login with SMS" button, which is also inside the panel.
        const clicked = await page.evaluate((passwordSelector: string) => {
          const form = document.querySelector(passwordSelector)?.closest("form");
          if (!form) return false;
          const buttons = Array.from(
            form.querySelectorAll<HTMLButtonElement>("button, input[type=submit]")
          ).filter((b) => b.offsetParent !== null && !/sms/i.test(b.innerText || b.value));
          const target =
            buttons.find((b) => b.type === "submit") ??
            buttons.find((b) => /כניסה/.test(b.innerText || b.value));
          if (!target) return false;
          target.click();
          return true;
        }, PASSWORD_INPUT);
        if (!clicked) await page.focus(PASSWORD_INPUT).then(() => page.keyboard.press("Enter"));
      },
      postAction: async () => {
        // Isracard is a single-page app: success is a client-side route
        // change, not a full navigation, so poll for either outcome.
        const deadline = Date.now() + resultWaitMs;
        while (Date.now() < deadline) {
          if (!isOnLoginPage(page)) return;
          if (await visibleFieldError(page)) return;
          await new Promise((r) => setTimeout(r, 500));
        }
      },
      // Checked in order: the failure pages are also "not the login page",
      // so they have to come before SUCCESS.
      possibleResults: {
        INVALID_PASSWORD: [
          async (opts) => (opts?.page ? await visibleFieldError(opts.page) : false),
        ],
        CHANGE_PASSWORD: [/changepassword/i],
        SUCCESS: [async (opts) => (opts?.page ? !isOnLoginPage(opts.page) : false)],
      },
    };
  }

  /**
   * The library's Isracard class replaces the generic form login with API
   * calls. Use the generic form login from the base class instead.
   */
  override async login(credentials: IsracardCredentials): Promise<ScraperScrapingResult> {
    const formLogin = BaseScraperWithBrowser.prototype.login as (
      this: BaseScraperWithBrowser<IsracardCredentials>,
      creds: IsracardCredentials
    ) => Promise<ScraperScrapingResult>;
    await this.skipGlassboxDetector();
    const result = await formLogin.call(this, credentials);
    console.log(
      `[scraper] isracard: form login ${result.success ? "succeeded" : `failed (${result.errorType ?? "unknown"})`}`
    );
    if (result.success) await this.settleAfterLogin();
    return result;
  }

  /**
   * Same as the library's own Isracard login: Isracard's Glassbox script
   * (detector-dom.min.js) wraps window.fetch, and its wrapper fails the
   * library's in-page data requests with "Failed to fetch". Skipping the
   * override above dropped this, so it's restored here unchanged.
   */
  private async skipGlassboxDetector(): Promise<void> {
    const page = this.page;
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url().includes("detector-dom.min.js")) {
        void request.abort(undefined, interceptionPriorities.abort);
      } else {
        void request.continue(undefined, interceptionPriorities.continue);
      }
    });
  }

  /**
   * After login Isracard lands on its new personal area at web.isracard.co.il
   * (via /StatusPage). The data API lives there too, and in-page requests
   * only work same-origin, so settle on that site before fetching.
   */
  private async settleAfterLogin(): Promise<void> {
    const page = this.page;

    // Navigating while the post-login redirects are still running detaches
    // the frame, so let them finish first.
    await this.waitForStableUrl(POST_LOGIN_REDIRECT_MS);
    const landed = new URL(page.url());
    console.log(`[scraper] isracard: after login on ${landed.origin}${landed.pathname}`);

    await page
      .goto(`${WEB_BASE_URL}/transactions`, { waitUntil: "networkidle2", timeout: 30_000 })
      .catch(() => undefined);
    await this.waitForStableUrl(10_000);
    const ready = new URL(page.url());
    console.log(`[scraper] isracard: fetching from ${ready.origin}${ready.pathname}`);
  }

  /** Reads the new site's DigitalV3 API instead of the retired digital.isracard.co.il endpoints. */
  override async fetchData(): Promise<{ success: boolean; accounts: IsracardAccount[] }> {
    const accounts = await fetchDigitalV3Accounts(this.page, {
      webBaseUrl: WEB_BASE_URL,
      companyCode: COMPANY_CODE,
      startDate: this.options.startDate,
      futureMonths: this.options.futureMonthsToScrape,
    });
    return { success: true, accounts };
  }

  /** Resolves once the URL has stopped changing for a few seconds, or at the deadline. */
  private async waitForStableUrl(maxMs: number): Promise<void> {
    const page = this.page;
    const deadline = Date.now() + maxMs;
    let last = page.url();
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const current = page.url();
      if (current !== last) {
        last = current;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= URL_STABLE_MS) {
        return;
      }
    }
  }
}
