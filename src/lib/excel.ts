/** Browser-side Excel export helpers (exceljs is loaded on demand). */
import { BATCH_COLUMNS, HEADER_FILL, fillForBatch, type SheetRow } from "./batch-sheet";

/** Neutralise spreadsheet formula injection: cells starting with = + - @ (or tab/CR) are prefixed with '. */
export function safeCell<T>(v: T): T | string {
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(v)) return `'${v}`;
  return v;
}

const thin = { style: "thin" as const, color: { argb: "FF9CA3AF" } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

function save(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFilePart = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Faculty";

export interface Col {
  header: string;
  key: string;
  width?: number;
}

export async function exportTable(filename: string, sheetName: string, columns: Col[], rows: Record<string, unknown>[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
  rows.forEach((r) => ws.addRow(Object.fromEntries(columns.map((c) => [c.key, safeCell(r[c.key] ?? "")]))));
  ws.eachRow((row, i) => {
    row.eachCell((cell) => {
      cell.border = border;
      if (i === 1) {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${HEADER_FILL}` } };
      }
    });
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  save(await wb.xlsx.writeBuffer(), filename);
}

/** The faculty's final batch sheet: 2 rows per batch, Batch No. merged, pastel fill per batch. */
export async function exportBatchSheet(filename: string, rows: SheetRow[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Batches");
  const widths = [12, 28, 20, 12, 28, 16, 32];
  ws.columns = BATCH_COLUMNS.map((h, i) => ({ header: h, width: widths[i] }));

  const header = ws.getRow(1);
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${HEADER_FILL}` } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = border;
  });

  rows.forEach((r) => {
    const row = ws.addRow([
      r.first ? r.batchLabel : "",
      safeCell(r.name),
      safeCell(r.regNo),
      safeCell(r.section),
      safeCell(r.advisor),
      safeCell(r.phone),
      safeCell(r.mail),
    ]);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = border;
      cell.alignment = { vertical: "middle", horizontal: col === 1 ? "center" : "left" };
      if (col === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fillForBatch(r.batchNo)}` } };
    });
    if (r.first) {
      row.getCell(1).font = { bold: true };
    } else {
      // merge the Batch No. cell over this batch's two rows
      ws.mergeCells(row.number - 1, 1, row.number, 1);
    }
  });
  save(await wb.xlsx.writeBuffer(), filename);
}
