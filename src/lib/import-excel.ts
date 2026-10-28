/** Excel-only import boundary. The API independently validates every resulting row. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
export type ImportKind = "students" | "faculty";
export const IMPORT_HEADERS: Record<ImportKind, string[]> = {
  students: ["reg_no", "name", "dept", "section", "email"],
  faculty: ["emp_id", "name", "srm_email", "designation", "cadre", "phone", "venue", "domains"],
};
const OPTIONAL_HEADERS = new Set(["email", "phone", "venue", "domains"]);

export function validateImportFile(file: { name: string; size: number }) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose an Excel .xlsx file.");
  if (!file.size || file.size > MAX_IMPORT_BYTES) throw new Error("Excel files must be nonempty and no larger than 2 MiB.");
}

/** Bound actual ZIP expansion before passing XML to ExcelJS; metadata alone is untrusted. */
async function inspectArchive(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes.length > MAX_IMPORT_BYTES) throw new Error("Invalid or oversized Excel workbook.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error("Invalid Excel archive.");
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count > 2000 || !count) throw new Error("Unsupported Excel archive.");
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
    if (names.has(name) || /(?:^|\/)\.\.(?:\/|$)|\\|vbaproject|externallinks|embeddings|activex/i.test(name)) {
      throw new Error("Macros, embedded objects and external links are not allowed.");
    }
    names.add(name);
    if (flags & 1 || ![0, 8].includes(method) || unpacked > MAX_EXPANDED_BYTES) throw new Error("Unsupported or oversized Excel content.");
    const local = view.getUint32(offset + 42, true);
    if (local + 30 > offset || view.getUint32(local, true) !== 0x04034b50) throw new Error("Invalid Excel entry.");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > offset) throw new Error("Invalid Excel entry.");
    const compressed = bytes.slice(start, start + packed);
    const chunks: Uint8Array[] = [];
    if (method === 0) {
      expanded += compressed.length;
      chunks.push(compressed);
      if (compressed.length !== unpacked) throw new Error("Invalid Excel entry size.");
    } else {
      const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
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
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      if (size !== unpacked) throw new Error("Invalid Excel entry size.");
    }
    if (expanded > MAX_EXPANDED_BYTES) throw new Error("Excel content is too large.");
    if (/\.xml(?:\.rels)?$/i.test(name) || /\.rels$/i.test(name)) {
      const xml = await new Blob(chunks as BlobPart[]).text();
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XML entities are not allowed in imports.");
      if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
        if (/<(?:\w+:)?mergeCell\b/i.test(xml)) throw new Error("Merged cells are not allowed in import worksheets.");
        if (/<(?:\w+:)?f\b/i.test(xml)) throw new Error("Formulas are not allowed in import worksheets.");
        // Reject sparse extreme dimensions before ExcelJS allocates rows or expands ranges.
        for (const match of xml.matchAll(/\br="([A-Z]*)([0-9]+)"/g)) {
          const col = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
          if (Number(match[2]) > MAX_IMPORT_ROWS + 1) throw new Error("Import at most 5,000 rows at a time.");
          if (col > 8) throw new Error("Unexpected columns. Use the Excel template.");
        }
      }
    }
    offset = next;
  }
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) throw new Error("Choose a valid Excel .xlsx workbook.");
}

export async function parseImportWorkbook(bytes: Uint8Array, kind: ImportKind): Promise<Record<string, string>[]> {
  await inspectArchive(bytes);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
  if (wb.worksheets.length !== 1) throw new Error("Use one worksheet per import.");
  const sheet = wb.worksheets[0];
  if (sheet.rowCount > MAX_IMPORT_ROWS + 1) throw new Error("Import at most 5,000 rows at a time.");
  if (sheet.columnCount > IMPORT_HEADERS[kind].length) throw new Error("Unexpected columns. Use the Excel template.");
  const text = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (typeof value !== "string" && typeof value !== "number") throw new Error("Use plain text or numbers only; formulas and hyperlinks are not allowed.");
    const result = String(value).trim();
    if (result.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) throw new Error("A cell contains oversized or invalid text.");
    return result;
  };
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell) => headers.push(text(cell.value).toLowerCase()));
  if (new Set(headers).size !== headers.length || headers.some((h) => !IMPORT_HEADERS[kind].includes(h))) throw new Error("Unexpected or duplicate column names.");
  const missing = IMPORT_HEADERS[kind].filter((h) => !OPTIONAL_HEADERS.has(h) && !headers.includes(h));
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(", ")}`);
  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    for (let col = headers.length + 1; col <= row.cellCount; col++) {
      if (row.getCell(col).value !== null) throw new Error("Unexpected data beyond the header columns.");
    }
    const values = headers.map((_, col) => text(row.getCell(col + 1).value));
    if (values.some(Boolean)) rows.push(Object.fromEntries(headers.map((h, col) => [h, values[col]])));
  });
  if (!rows.length) throw new Error("The worksheet has no data rows.");
  return rows;
}
