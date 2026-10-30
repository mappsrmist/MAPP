/**
 * Excel-only import boundary. Reads whatever layout the admin has (title rows, extra columns, formulas, hyperlinks,
 * merged cells, several sheets), finds the header row, maps columns by name and normalises values.
 * The API independently validates every resulting row.
 */
import { normalizeCadre } from "./validators";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
const MAX_EXPANDED_BYTES = 60 * 1024 * 1024;
const MAX_SHEET_ROWS = 20000;
const MAX_COLUMNS = 100;
const HEADER_SCAN_ROWS = 30;

export type ImportKind = "students" | "faculty" | "advisors";

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  /** Canonical header phrases (see canon()); a header equal to one scores highest, one containing it scores lower. */
  aliases: string[];
  /** Header words that rule a column out for this field (e.g. "Faculty Advisor Name" is not the student's name). */
  avoid?: string[];
  /** Several columns may feed this field (their values are joined). */
  multi?: boolean;
  /** Value used for every row when the file has no such column. */
  fallback?: string;
}

const STUDENT_AVOID = ["advisor", "fa", "guide", "faculty", "father", "mother", "parent", "guardian", "staff", "mentor"];
const EMAIL = ["email", "email id", "mail", "mail id", "srm email", "srm mail", "official email", "official mail", "srmist email", "srmist mail", "college email", "institute email"];
const EMAIL_AVOID = ["personal", "alternate", "alt", "parent", "father", "mother", "gmail"];
const EMP = ["emp id", "emp no", "emp code", "staff id", "staff no", "staff code", "faculty id", "faculty code", "id no", "id"];

export const IMPORT_FIELDS: Record<ImportKind, ImportField[]> = {
  students: [
    { key: "reg_no", label: "Reg No", required: true, aliases: ["reg no", "reg", "reg id", "roll no", "enrollment no", "enrolment no", "university reg no", "student id", "admission no"], avoid: STUDENT_AVOID },
    { key: "name", label: "Name", required: true, aliases: ["name", "student name", "name of student", "full name", "student full name", "candidate name"], avoid: STUDENT_AVOID },
    { key: "dept", label: "Dept", required: true, aliases: ["dept", "department", "branch", "programme", "program", "course", "discipline", "degree"], avoid: STUDENT_AVOID, fallback: "CSE" },
    { key: "section", label: "Section", required: true, aliases: ["section", "sec", "class", "class section", "section name"], avoid: STUDENT_AVOID },
    { key: "email", label: "Email", required: false, aliases: [...EMAIL, "student email", "student mail"], avoid: [...STUDENT_AVOID, ...EMAIL_AVOID] },
  ],
  faculty: [
    { key: "emp_id", label: "Emp ID", required: true, aliases: EMP, avoid: ["student"] },
    { key: "name", label: "Name", required: true, aliases: ["name", "faculty name", "name of faculty", "staff name", "name of staff", "full name", "guide name"], avoid: ["student"] },
    { key: "srm_email", label: "SRM Email", required: true, aliases: [...EMAIL, "faculty email", "faculty mail"], avoid: ["student", ...EMAIL_AVOID] },
    { key: "phone", label: "Phone", required: false, aliases: ["phone", "phone no", "mobile", "mobile no", "contact", "contact no", "cell", "cell no", "whatsapp", "whatsapp no", "contact details"], avoid: ["student"] },
    { key: "venue", label: "Venue", required: false, aliases: ["venue", "cabin", "cabin no", "room", "room no", "location", "office", "seating", "seating location", "block"] },
    { key: "domains", label: "Domains", required: false, multi: true, aliases: ["domain", "domains", "area of interest", "areas of interest", "research area", "research areas", "research interest", "research interests", "research domain", "specialization", "specialisation", "area of specialization", "area of specialisation", "expertise", "area of expertise", "interest", "interests"] },
    { key: "cadre", label: "Cadre", required: true, aliases: ["cadre", "designation", "position", "role", "post", "category"], fallback: "OTHER" },
  ],
  advisors: [
    { key: "emp_id", label: "Emp ID", required: true, aliases: [...EMP, "fa emp id", "advisor emp id", "faculty advisor emp id", "fa id"], avoid: ["student"] },
    { key: "section", label: "Section", required: true, aliases: ["section", "sec", "class", "class section", "section name"] },
  ],
};

/** Template column titles (any of the aliases above work too). */
export const IMPORT_HEADERS: Record<ImportKind, string[]> = {
  students: IMPORT_FIELDS.students.map((f) => f.label),
  faculty: IMPORT_FIELDS.faculty.map((f) => f.label),
  advisors: IMPORT_FIELDS.advisors.map((f) => f.label),
};

export function validateImportFile(file: { name: string; size: number }) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose an Excel .xlsx file (in Excel: File → Save As → Excel Workbook).");
  if (!file.size || file.size > MAX_IMPORT_BYTES) throw new Error("Excel files must be nonempty and no larger than 5 MiB.");
}

/** Bound actual ZIP expansion before passing XML to ExcelJS; metadata alone is untrusted. */
async function inspectArchive(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes.length > MAX_IMPORT_BYTES) throw new Error("Invalid or oversized Excel workbook.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error("This is not a valid Excel .xlsx file.");
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count > 4000 || !count) throw new Error("Unsupported Excel archive.");
  let offset = view.getUint32(end + 16, true);
  let expanded = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Invalid Excel archive.");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const packed = view.getUint32(offset + 20, true);
    const unpacked = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > end) throw new Error("Invalid Excel archive.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (names.has(name) || /(?:^|\/)\.\.(?:\/|$)|\\/.test(name)) throw new Error("Invalid Excel archive.");
    // Excel never saves macros or ActiveX controls in a .xlsx; anything else (images, external-link caches) is ignored.
    if (/vbaproject|activex/i.test(name)) throw new Error("Workbooks with macros are not accepted. Save it as a normal .xlsx workbook.");
    names.add(name);
    if (flags & 1) throw new Error("Password-protected workbooks are not accepted. Remove the password and try again.");
    if (![0, 8].includes(method) || unpacked > MAX_EXPANDED_BYTES) throw new Error("Unsupported or oversized Excel content.");
    const local = view.getUint32(offset + 42, true);
    if (local + 30 > offset || view.getUint32(local, true) !== 0x04034b50) throw new Error("Invalid Excel entry.");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > offset) throw new Error("Invalid Excel entry.");
    const isXml = /\.xml$|\.rels$/i.test(name);
    if (method === 0) {
      expanded += packed;
      if (packed !== unpacked) throw new Error("Invalid Excel entry size.");
      if (isXml) checkXml(name, await new Blob([bytes.slice(start, start + packed)]).text());
    } else {
      const reader = new Blob([bytes.slice(start, start + packed)]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          expanded += value.byteLength;
          if (expanded > MAX_EXPANDED_BYTES || size > unpacked) {
            await reader.cancel();
            throw new Error("Excel content is too large.");
          }
          if (isXml) chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      if (size !== unpacked) throw new Error("Invalid Excel entry size.");
      if (isXml) checkXml(name, await new Blob(chunks as BlobPart[]).text());
    }
    if (expanded > MAX_EXPANDED_BYTES) throw new Error("Excel content is too large.");
    offset = next;
  }
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) throw new Error("Choose a valid Excel .xlsx workbook.");
}

function checkXml(name: string, xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XML entities are not allowed in imports.");
  if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) return;
  // Reject absurd sparse dimensions before ExcelJS allocates rows or expands ranges.
  for (const match of xml.matchAll(/<(?:\w+:)?(?:c|row)\b[^>]*?\br="([A-Z]*)([0-9]+)"/g)) {
    const col = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    if (Number(match[2]) > MAX_SHEET_ROWS) throw new Error("The worksheet is too long. Import at most 5,000 rows at a time.");
    if (col > 16384) throw new Error("Invalid Excel cell reference.");
  }
}

// ------------------------------------------------------------------ reading

export interface SheetRow { n: number; cells: string[] }
export interface ImportSheet { name: string; hidden: boolean; rows: SheetRow[] }

/** Plain text of any cell value: formulas give their result, hyperlinks their text, dates an ISO date. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) return v.richText.map((r) => cellText((r as { text?: unknown }).text)).join("");
    if ("text" in v) return cellText(v.text);
    if ("result" in v) return cellText(v.result);
  }
  return ""; // errors (#N/A), formulas without a cached result
}

const clean = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/[  -​  　﻿]/g, " ").trim().slice(0, 500);

export async function readImportWorkbook(bytes: Uint8Array): Promise<ImportSheet[]> {
  await inspectArchive(bytes);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch {
    throw new Error("Could not read this Excel workbook. Open it in Excel, save it as .xlsx and try again.");
  }
  const sheets: ImportSheet[] = [];
  for (const ws of wb.worksheets) {
    const width = Math.min(ws.columnCount, MAX_COLUMNS);
    const rows: SheetRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const cells = Array.from({ length: width }, (_, c) => clean(cellText(row.getCell(c + 1).value)));
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.length) rows.push({ n, cells });
    });
    sheets.push({ name: ws.name, hidden: ws.state !== "visible" && ws.state !== undefined, rows });
  }
  if (!sheets.some((s) => s.rows.length)) throw new Error("The workbook is empty.");
  return sheets;
}

// ------------------------------------------------------------------ mapping

const WORD_CANON: Record<string, string> = {
  number: "no", num: "no", nos: "no", nbr: "no",
  registration: "reg", register: "reg", regn: "reg", regd: "reg", regno: "reg no", registerno: "reg no",
  employee: "emp", empid: "emp id", empno: "emp no", empcode: "emp code",
  email: "email", mailid: "mail id", emailid: "email id", mobileno: "mobile no", phoneno: "phone no",
  dept: "dept", dep: "dept", depts: "dept", sect: "sec", sections: "section",
  of: "", the: "", s: "",
};

/** Lower-case words with punctuation dropped and common spellings merged ("E-Mail ID" → "email id", "Register Number" → "reg no"). */
export function canon(header: string): string {
  return header
    .toLowerCase()
    .replace(/\be[\s.-]*mail/g, "email")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .flatMap((w) => (w in WORD_CANON ? WORD_CANON[w].split(" ") : [w]))
    .filter(Boolean)
    .join(" ");
}

function scoreHeader(header: string, field: ImportField): number {
  const h = canon(header);
  if (!h) return 0;
  const words = h.split(" ");
  if (field.avoid?.some((a) => words.includes(a))) return 0;
  let best = 0;
  for (const alias of field.aliases.map(canon)) {
    if (h === alias) return 100;
    // "Student Reg No" contains "reg no"; long titles ("List of students of Section A") are not headers
    if (words.length <= 6 && ` ${h} `.includes(` ${alias} `)) best = Math.max(best, 10 + alias.length);
  }
  return best;
}

export interface ImportLayout {
  sheetIndex: number;
  /** index into sheet.rows of the header row */
  headerIndex: number;
  /** field key → column indexes (0-based) */
  mapping: Record<string, number[]>;
}

function mapHeaders(headers: string[], kind: ImportKind) {
  const fields = IMPORT_FIELDS[kind];
  const candidates: { field: ImportField; col: number; score: number }[] = [];
  headers.forEach((h, col) => fields.forEach((field) => {
    const score = scoreHeader(h, field);
    if (score) candidates.push({ field, col, score });
  }));
  candidates.sort((a, b) => b.score - a.score || a.col - b.col);
  const mapping: Record<string, number[]> = Object.fromEntries(fields.map((f) => [f.key, []]));
  const used = new Set<number>();
  let score = 0;
  for (const c of candidates) {
    if (used.has(c.col)) continue;
    const taken = mapping[c.field.key];
    if (taken.length && !c.field.multi) continue;
    if (taken.length && c.score < 20) continue; // extra domain columns need a clear name
    taken.push(c.col);
    used.add(c.col);
    score += c.score * (c.field.required ? 2 : 1);
  }
  return { mapping, score, matched: Object.values(mapping).filter((v) => v.length).length };
}

/** Finds the sheet and header row whose column titles best match the import type. */
export function detectLayout(sheets: ImportSheet[], kind: ImportKind, sheetIndex?: number): ImportLayout {
  let best: (ImportLayout & { score: number; matched: number }) | null = null;
  sheets.forEach((sheet, s) => {
    if (sheetIndex !== undefined ? s !== sheetIndex : sheet.hidden && sheets.some((x) => !x.hidden && x.rows.length)) return;
    sheet.rows.slice(0, HEADER_SCAN_ROWS).forEach((row, headerIndex) => {
      const m = mapHeaders(row.cells, kind);
      if (!best || m.matched > best.matched || (m.matched === best.matched && m.score > best.score)) {
        best = { sheetIndex: s, headerIndex, mapping: m.mapping, score: m.score, matched: m.matched };
      }
    });
  });
  const found = best as (ImportLayout & { matched: number }) | null;
  if (!found || found.matched < Math.min(2, IMPORT_FIELDS[kind].length)) {
    throw new Error(`Could not find the column titles. Make sure the sheet has a header row such as ${IMPORT_HEADERS[kind].join(", ")}.`);
  }
  return { sheetIndex: found.sheetIndex, headerIndex: found.headerIndex, mapping: found.mapping };
}

// --------------------------------------------------------------- normalising

const firstOf = (v: string, pick?: (part: string) => boolean) => {
  const parts = v.split(/[\s,;/|]+/).filter(Boolean);
  return parts.find((p) => pick?.(p)) ?? parts[0] ?? "";
};
const intText = (v: string) => v.replace(/^(\d+)\.0+$/, "$1");

/**
 * Splits a domains cell on , ; | • new lines and " / ", but not inside brackets ("Edge computing (Energy, Design)"),
 * tidies spacing so "(AI)& Machine Learning" and "(AI) & Machine Learning" become one domain, and drops repeats.
 */
export function splitDomains(v: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    const sep = /[,;|\n\r•]/.test(ch) || (ch === "/" && v[i - 1] === " " && v[i + 1] === " ");
    if (sep && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  const seen = new Set<string>();
  return parts
    .map((d) => d
      .replace(/^\s*(?:\d+[.)]|[-*])\s+/, "")
      .replace(/\s*&\s*/g, " & ")
      .replace(/([([])\s+/g, "$1")
      .replace(/\s+([)\]])/g, "$1")
      .replace(/\s+/g, " ")
      .replace(/[\s.]+$/, "")
      .trim())
    .filter((d) => {
      const key = d.toLowerCase();
      if (!d || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const NORMALIZE: Record<string, (v: string) => string> = {
  reg_no: (v) => intText(v).replace(/\s+/g, "").toUpperCase(),
  emp_id: (v) => intText(v).replace(/\s+/g, "").toUpperCase(),
  name: (v) => v.replace(/\s+/g, " "),
  dept: (v) => v.replace(/\s+/g, " "),
  section: (v) => v.replace(/^(?:section|sec)\b\s*[:.\-–]?\s*/i, "").replace(/\s+/g, " ").toUpperCase(),
  email: (v) => firstOf(v.replace(/mailto:/gi, " ").toLowerCase(), (p) => p.includes("@")),
  srm_email: (v) => firstOf(v.replace(/mailto:/gi, " ").toLowerCase(), (p) => p.includes("@srmist")) || firstOf(v.toLowerCase(), (p) => p.includes("@")),
  phone: (v) => {
    const first = intText(v).split(/[,;/|]|\s{2,}/)[0] ?? "";
    return first.replace(/[^\d+]/g, "");
  },
  venue: (v) => v.replace(/\s+/g, " "),
  domains: (v) => splitDomains(v).join("; "),
  cadre: (v) => normalizeCadre(v),
};

export interface BuiltImport {
  rows: Record<string, string>[];
  /** Excel row number of each row, for error reports */
  rowNumbers: number[];
  /** required fields with neither a column nor a value for every row */
  missing: string[];
}

/** Turns the mapped sheet into API rows. `defaults` supplies a value for every row when a field has no column. */
export function buildImportRows(sheets: ImportSheet[], layout: ImportLayout, kind: ImportKind, defaults: Record<string, string> = {}): BuiltImport {
  const fields = IMPORT_FIELDS[kind];
  const sheet = sheets[layout.sheetIndex];
  const header = sheet.rows[layout.headerIndex]?.cells ?? [];
  const value = (key: string) => defaults[key]?.trim() || fields.find((f) => f.key === key)?.fallback || "";
  const missing = fields.filter((f) => f.required && !layout.mapping[f.key]?.length && !value(f.key)).map((f) => f.label);
  const idKey = kind === "students" ? ["reg_no"] : kind === "faculty" ? ["emp_id", "srm_email"] : ["section"];
  const headerCanon = header.map(canon);
  const rows: Record<string, string>[] = [];
  const rowNumbers: number[] = [];
  for (const row of sheet.rows.slice(layout.headerIndex + 1)) {
    // a header repeated further down (one block per section) is not data
    if (row.cells.filter((c, i) => c && canon(c) === headerCanon[i]).length >= 2) continue;
    const out: Record<string, string> = {};
    for (const f of fields) {
      const cols = layout.mapping[f.key] ?? [];
      const raw = cols.length ? cols.map((c) => row.cells[c] ?? "").filter(Boolean).join(f.multi ? "; " : " ") : value(f.key);
      const v = clean(NORMALIZE[f.key]?.(raw) ?? raw);
      if (v || f.required) out[f.key] = v;
    }
    if (!idKey.some((k) => out[k])) continue; // blank, total or title rows
    rows.push(out);
    rowNumbers.push(row.n);
  }
  return { rows, rowNumbers, missing };
}

/** One-shot read with automatic mapping (used by tests and scripts). */
export async function parseImportWorkbook(bytes: Uint8Array, kind: ImportKind): Promise<Record<string, string>[]> {
  const sheets = await readImportWorkbook(bytes);
  const built = buildImportRows(sheets, detectLayout(sheets, kind), kind);
  if (built.missing.length) throw new Error(`Missing column(s): ${built.missing.join(", ")}`);
  if (!built.rows.length) throw new Error("The worksheet has no data rows.");
  if (built.rows.length > MAX_IMPORT_ROWS) throw new Error("Import at most 5,000 rows at a time.");
  return built.rows;
}
