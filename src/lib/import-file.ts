/**
 * Reads a bank's exported transactions file in the browser and turns it into
 * rows of date / description / amount. Handles CSV (UTF-8 or Windows-1255, the
 * Hebrew code page older bank exports use), Excel .xlsx, and the HTML tables
 * several Israeli banks save with an .xls extension.
 */

import { unzipSync, strFromU8 } from "fflate";
import type { ImportRow } from "./types";

export type Cell = string | number | null;
export type Table = Cell[][];

export class FileReadError extends Error {}

// ---------------------------------------------------------------------------
// Reading files into a table

export async function readTable(file: File): Promise<Table> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) throw new FileReadError("The file is empty.");

  // Zip signature: .xlsx (and .ods, which we don't read).
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  // OLE compound file: the pre-2007 binary .xls format.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new FileReadError(
      "This is an old-style .xls file, which Spent can't read. Open it in Excel or Google Sheets and save it as .xlsx or .csv."
    );
  }
  const text = decodeText(bytes);
  if (/^\s*</.test(text) && /<table/i.test(text)) return readHtmlTable(text);
  return readCsv(text);
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1255").decode(bytes);
  }
}

function readCsv(text: string): Table {
  const firstLines = text.split(/\r?\n/, 5).join("\n");
  const delimiter = [",", ";", "\t", "|"]
    .map((d) => ({ d, n: firstLines.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  const rows: Table = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readHtmlTable(text: string): Table {
  const doc = new DOMParser().parseFromString(text, "text/html");
  // The transactions table is the biggest one; the others are headers and totals.
  const tables = [...doc.querySelectorAll("table")];
  const table = tables.sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!table) throw new FileReadError("Couldn't find a table in this file.");
  return [...table.rows].map((tr) =>
    [...tr.cells].map((td) => td.textContent?.replace(/\s+/g, " ").trim() ?? "")
  );
}

/** Built-in Excel number formats that are dates. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function readXlsx(bytes: Uint8Array): Table {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) =>
        f.name === "xl/workbook.xml" ||
        f.name === "xl/_rels/workbook.xml.rels" ||
        f.name === "xl/sharedStrings.xml" ||
        f.name === "xl/styles.xml" ||
        f.name.startsWith("xl/worksheets/sheet"),
    });
  } catch {
    throw new FileReadError("This file looks like Excel but couldn't be opened. Is it damaged?");
  }
  const xml = (name: string) => {
    const f = files[name];
    return f ? new DOMParser().parseFromString(strFromU8(f), "application/xml") : null;
  };

  const workbook = xml("xl/workbook.xml");
  const rels = xml("xl/_rels/workbook.xml.rels");
  if (!workbook) throw new FileReadError("This Excel file has no sheets.");

  // First sheet in tab order, resolved through the workbook relationships.
  const firstSheet = workbook.getElementsByTagName("sheet")[0];
  const relId =
    firstSheet?.getAttribute("r:id") ??
    firstSheet?.getAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "id"
    );
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (rels && relId) {
    for (const rel of [...rels.getElementsByTagName("Relationship")]) {
      if (rel.getAttribute("Id") === relId) {
        const target = rel.getAttribute("Target") ?? "";
        sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      }
    }
  }
  const sheet = xml(sheetPath);
  if (!sheet) throw new FileReadError("Couldn't read the first sheet of this Excel file.");

  const shared = [...(xml("xl/sharedStrings.xml")?.getElementsByTagName("si") ?? [])].map((si) =>
    [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("")
  );

  // Which cell styles display a number as a date.
  const dateStyles = new Set<number>();
  const styles = xml("xl/styles.xml");
  if (styles) {
    const customDate = new Set<number>();
    for (const fmt of [...styles.getElementsByTagName("numFmt")]) {
      const code = (fmt.getAttribute("formatCode") ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, "");
      if (/[dmy]/i.test(code) && !/^[#0.,%\s]*$/.test(code)) {
        customDate.add(Number(fmt.getAttribute("numFmtId")));
      }
    }
    const cellXfs = styles.getElementsByTagName("cellXfs")[0];
    [...(cellXfs?.getElementsByTagName("xf") ?? [])].forEach((xf, i) => {
      const id = Number(xf.getAttribute("numFmtId"));
      if (BUILTIN_DATE_FORMATS.has(id) || customDate.has(id)) dateStyles.add(i);
    });
  }

  const table: Table = [];
  for (const rowEl of [...sheet.getElementsByTagName("row")]) {
    const r = Number(rowEl.getAttribute("r")) - 1;
    const out: Cell[] = [];
    for (const c of [...rowEl.getElementsByTagName("c")]) {
      const col = columnIndex(c.getAttribute("r") ?? "");
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? null;
      let value: Cell = null;
      if (type === "s" && v != null) value = shared[Number(v)] ?? "";
      else if (type === "inlineStr")
        value = [...c.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("");
      else if (type === "str" || type === "e") value = v;
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v != null) {
        const n = Number(v);
        value = dateStyles.has(Number(c.getAttribute("s"))) ? excelSerialToDay(n) : n;
      }
      out[col >= 0 ? col : out.length] = value;
    }
    table[r >= 0 ? r : table.length] = Array.from(out, (x) => x ?? null);
  }
  return Array.from(table, (row) => row ?? []);
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function excelSerialToDay(serial: number): string {
  // Day 0 is 1899-12-30 once Excel's fictional 1900-02-29 is accounted for.
  const ms = Math.round(serial) * 86_400_000 + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Finding the header and guessing columns

export interface ColumnMapping {
  /** Index of the header row; data starts on the next row. */
  headerRow: number;
  date: number | null;
  description: number | null;
  /** "single": one signed amount column. "split": separate money-out and money-in columns. */
  amountMode: "single" | "split";
  amount: number | null;
  debit: number | null;
  credit: number | null;
  memo: number | null;
  dateOrder: "dmy" | "mdy";
  /**
   * Single-column mode: how money out is told apart from money in. "negative"
   * for signed amounts, "positive" for card statements that list charges as
   * positive numbers, "column" when another column says debit or credit
   * (One Zero's חיוב/זיכוי).
   */
  moneyOut: "negative" | "positive" | "column";
  signColumn: number | null;
  /** Rows in another currency are skipped, since amounts are stored in shekels. */
  currency: number | null;
  /** The description column stores Hebrew in visual (backwards) order, as One Zero's export does. */
  reversedHebrew: boolean;
}

const HINTS: Record<"date" | "description" | "amount" | "debit" | "credit" | "memo", RegExp[]> = {
  date: [/^תאריך( ה?עסקה| ה?פעולה| ה?רכישה| ה?תנועה)?$/, /^(transaction |posting )?date$/i, /תאריך/, /date/i],
  description: [
    /שם בית ה?עסק|בית ה?עסק/,
    /^(תיאור|פירוט|תאור)/,
    /description|merchant|payee|details|narrative/i,
    /פעולה|תנועה/,
  ],
  amount: [/^סכום( ה?חיוב| ה?עסקה)?/, /^(amount|sum|total)/i, /סכום|amount/i],
  debit: [/^חובה|^חיוב$|^יציאה|^משיכה/, /debit|withdrawal|money out|paid out/i],
  credit: [/^זכות|^זיכוי$|^כניסה|^הפקדה/, /credit|deposit|money in|paid in/i],
  // Notes first, then the kind of operation (it helps categorizing), then a reference number.
  memo: [
    /הערות|^הערה|פרטים נוספים/,
    /^(memo|notes?)$/i,
    /^סוג (ה?פעולה|ה?תנועה)$/,
    /אסמכתא/,
    /reference/i,
  ],
};

/** Balance columns look like amounts but must never be picked. */
const BALANCE = /יתרה|balance/i;

const SIGN_OUT = /^(חיוב|חובה|הוצאה|משיכה|debit|dr|withdrawal)$/i;
const SIGN_IN = /^(זיכוי|זכות|הכנסה|הפקדה|credit|cr|deposit)$/i;
const SIGN_HEADER =
  /^(חיוב\s*\/\s*זיכוי|זיכוי\s*\/\s*חיוב|חובה\s*\/\s*זכות|זכות\s*\/\s*חובה|debit\s*\/\s*credit|credit\s*\/\s*debit)$/i;
const CURRENCY_HEADER = /^(מטבע|currency|ccy)$/i;
const SHEKEL = /^(ILS|NIS|₪|ש"ח|ש״ח|שקל|שקלים|שקל חדש)$/i;
const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const HEBREW = /[\u05D0-\u05EA]/;

function text(cell: Cell): string {
  return cell == null ? "" : String(cell).replace(BIDI_MARKS, "").trim();
}

const MIRROR: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
};

/**
 * Turns Hebrew stored in display order back into reading order: reverse the
 * whole string, then put runs of digits and Latin letters (which display left
 * to right either way) back the right way round.
 */
export function visualToLogical(cell: Cell): string {
  const reversed = [...text(cell)]
    .reverse()
    .map((c) => MIRROR[c] ?? c)
    .join("");
  return reversed
    .replace(/[A-Za-z0-9]+(?:[ .,/:'&+\-]+[A-Za-z0-9]+)*/g, (run) => [...run].reverse().join(""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a column's Hebrew is stored backwards. Final letter forms (ך ם ן ף ץ)
 * only ever end a word, so words that start with one give it away. Without
 * any, a left-to-right override mark around Hebrew is the tell.
 */
function looksReversed(cells: Cell[]): boolean {
  let backwards = 0;
  let forwards = 0;
  let overridden = 0;
  let hebrew = 0;
  for (const cell of cells) {
    const raw = cell == null ? "" : String(cell);
    if (!HEBREW.test(raw)) continue;
    hebrew++;
    if (/[\u202D\u202E]/.test(raw)) overridden++;
    for (const word of raw.match(/[\u05D0-\u05EA]{2,}/g) ?? []) {
      if (/[ךםןףץ]/.test(word[0])) backwards++;
      if (/[ךםןףץ]/.test(word[word.length - 1])) forwards++;
      else if (/[כמנפצ]/.test(word[word.length - 1])) backwards++;
    }
  }
  if (hebrew === 0) return false;
  if (backwards !== forwards) return backwards > forwards;
  return overridden > 0;
}

export function hasHebrew(cells: Cell[]): boolean {
  return cells.some((c) => c != null && HEBREW.test(String(c)));
}

/** A column where (nearly) every value says debit or credit, in Hebrew or English. */
function findSignColumn(headers: string[], body: Cell[][], taken: Set<number>): number | null {
  const sample = body.slice(0, 200);
  const width = Math.max(headers.length, ...sample.map((r) => r.length));
  for (let i = 0; i < width; i++) {
    if (taken.has(i)) continue;
    const values = sample.map((r) => text(r[i] ?? null)).filter(Boolean);
    if (values.length === 0) {
      if (SIGN_HEADER.test(headers[i] ?? "")) return i;
      continue;
    }
    const signs = values.filter((v) => SIGN_OUT.test(v) || SIGN_IN.test(v)).length;
    if (signs / values.length >= 0.8) return i;
  }
  return null;
}

function matchColumn(headers: string[], hints: RegExp[], taken: Set<number>): number | null {
  for (const re of hints) {
    const i = headers.findIndex((h, idx) => !taken.has(idx) && h && !BALANCE.test(h) && re.test(h));
    if (i >= 0) return i;
  }
  return null;
}

/** Guesses every column. Pass `fixedHeaderRow` when the user picked the header row. */
export function guessMapping(table: Table, fixedHeaderRow?: number): ColumnMapping {
  // The header is the row among the first 30 that matches the most hints;
  // exports often start with a few lines of account details.
  let headerRow = fixedHeaderRow ?? 0;
  let best = -1;
  for (let r = 0; fixedHeaderRow == null && r < Math.min(30, table.length); r++) {
    const cells = (table[r] ?? []).map(text);
    const filled = cells.filter(Boolean).length;
    if (filled < 2) continue;
    let score = 0;
    for (const hints of Object.values(HINTS)) {
      if (cells.some((c) => c && hints.some((re) => re.test(c)))) score++;
    }
    if (score > best) {
      best = score;
      headerRow = r;
    }
  }

  const headers = (table[headerRow] ?? []).map(text);
  const taken = new Set<number>();
  const pick = (key: keyof typeof HINTS) => {
    const i = matchColumn(headers, HINTS[key], taken);
    if (i != null) taken.add(i);
    return i;
  };
  const date = pick("date");
  const body = dataRows(table, headerRow);
  // Claimed before debit/credit so a "חיוב/זיכוי" column isn't read as money out.
  const signColumn = findSignColumn(headers, body, taken);
  if (signColumn != null) taken.add(signColumn);
  const currencyIdx = headers.findIndex((h, i) => !taken.has(i) && CURRENCY_HEADER.test(h));
  const currency = currencyIdx >= 0 ? currencyIdx : null;
  if (currency != null) taken.add(currency);
  const debit = pick("debit");
  const credit = pick("credit");
  const amount = pick("amount");
  const description = pick("description");
  const memo = pick("memo");
  const amountMode = debit != null && credit != null ? "split" : "single";

  const mapping: ColumnMapping = {
    headerRow,
    date,
    description,
    amountMode,
    amount: amountMode === "single" ? (amount ?? debit ?? credit) : amount,
    debit,
    credit,
    memo,
    dateOrder: "dmy",
    moneyOut: "negative",
    signColumn,
    currency,
    reversedHebrew: description != null && looksReversed(body.map((r) => r[description] ?? null)),
  };

  mapping.dateOrder = guessDateOrder(body.map((r) => (date != null ? r[date] : null)));
  if (mapping.amountMode === "single" && signColumn != null) {
    mapping.moneyOut = "column";
  } else if (mapping.amountMode === "single" && mapping.amount != null) {
    const nums = body
      .map((r) => parseAmount(r[mapping.amount!]))
      .filter((n): n is number => n != null && n !== 0);
    // Spending rows outnumber refunds and deposits, so when most amounts are
    // positive the file lists charges as positive numbers (card statements).
    const mostlyPositive = nums.length > 0 && nums.filter((n) => n > 0).length / nums.length > 0.5;
    mapping.moneyOut = mostlyPositive ? "positive" : "negative";
  }
  return mapping;
}

export function dataRows(table: Table, headerRow: number): Cell[][] {
  return table.slice(headerRow + 1).filter((r) => r.some((c) => text(c) !== ""));
}

export function headerLabels(table: Table, headerRow: number): string[] {
  const width = Math.max(0, ...table.slice(headerRow, headerRow + 50).map((r) => r.length));
  const headers = (table[headerRow] ?? []).map(text);
  return Array.from({ length: width }, (_, i) => headers[i] || `Column ${i + 1}`);
}

// ---------------------------------------------------------------------------
// Parsing values

function guessDateOrder(cells: Cell[]): "dmy" | "mdy" {
  for (const c of cells) {
    const m = /^(\d{1,2})[./-](\d{1,2})[./-]\d{2,4}/.exec(text(c));
    if (!m) continue;
    if (Number(m[1]) > 12) return "dmy";
    if (Number(m[2]) > 12) return "mdy";
  }
  return "dmy";
}

/** To YYYY-MM-DD, or null when the cell isn't a date. */
export function parseDate(cell: Cell, order: "dmy" | "mdy"): string | null {
  if (typeof cell === "number") {
    // An unformatted Excel date serial (1982 to 2064).
    return cell > 30000 && cell < 60000 ? excelSerialToDay(cell) : null;
  }
  const s = text(cell);
  let y: number, mo: number, d: number;
  let m = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/.exec(s);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?!\d)/.exec(s);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    [d, mo] = order === "dmy" ? [a, b] : [b, a];
    y = Number(m[3]);
    if (y < 100) y += 2000;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const check = new Date(y, mo - 1, d);
  if (check.getMonth() !== mo - 1) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** "1,234.50", "(12.00)", "12.00-", "₪ -5" and friends to a number. */
export function parseAmount(cell: Cell): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  let s = text(cell).replace(/[₪$€£]|ILS|NIS|ש"ח|ש״ח/gi, "").replace(/\s/g, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\u2212\u2013]/g, "-");
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  // "1.234,50" (European) vs "1,234.50": the last separator is the decimal one.
  if (/,\d{1,2}$/.test(s) && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

export interface MappedPreview {
  rows: ImportRow[];
  /** Data rows that couldn't become a transaction (summary lines, blanks, bad dates). */
  skipped: number;
  /** Of the skipped rows, how many were in a currency other than shekels. */
  otherCurrency: number;
}

export function applyMapping(table: Table, mapping: ColumnMapping): MappedPreview {
  const rows: ImportRow[] = [];
  let skipped = 0;
  let otherCurrency = 0;
  for (const r of dataRows(table, mapping.headerRow)) {
    if (mapping.currency != null) {
      const code = text(r[mapping.currency] ?? null);
      if (code && !SHEKEL.test(code)) {
        skipped++;
        otherCurrency++;
        continue;
      }
    }
    const date = mapping.date != null ? parseDate(r[mapping.date] ?? null, mapping.dateOrder) : null;
    const rawDescription = mapping.description != null ? (r[mapping.description] ?? null) : null;
    const description =
      mapping.reversedHebrew && HEBREW.test(String(rawDescription ?? ""))
        ? visualToLogical(rawDescription)
        : text(rawDescription);
    let amount: number | null = null;
    if (mapping.amountMode === "split") {
      const out = mapping.debit != null ? parseAmount(r[mapping.debit] ?? null) : null;
      const inn = mapping.credit != null ? parseAmount(r[mapping.credit] ?? null) : null;
      if (out != null || inn != null) amount = Math.abs(inn ?? 0) - Math.abs(out ?? 0);
    } else if (mapping.amount != null) {
      const n = parseAmount(r[mapping.amount] ?? null);
      if (n != null && mapping.moneyOut === "column") {
        const sign = mapping.signColumn != null ? text(r[mapping.signColumn] ?? null) : "";
        if (SIGN_OUT.test(sign)) amount = -Math.abs(n);
        else if (SIGN_IN.test(sign)) amount = Math.abs(n);
      } else if (n != null) {
        amount = mapping.moneyOut === "positive" ? -n : n;
      }
    }
    if (!date || !description || amount == null || amount === 0) {
      skipped++;
      continue;
    }
    const memo = mapping.memo != null ? text(r[mapping.memo] ?? null) : "";
    rows.push({ date, description, amount, ...(memo ? { memo } : {}) });
  }
  return { rows, skipped, otherCurrency };
}
