/** Browser-side Excel export helpers (exceljs is loaded on demand). */
import { BATCH_COLUMNS, GUIDE_EMP_COLUMN, HEADER_FILL, fillForBatch, guideTitle, type GuideInfo, type SheetRow } from "./batch-sheet";

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

const sheetName = (name: string, used: Set<string>) => {
  const base = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 28) || "Sheet";
  let out = base;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${base.slice(0, 28 - String(n).length - 1)} ${n}`;
  used.add(out.toLowerCase());
  return out;
};

export interface BatchWorkbookSheet {
  name: string;
  /** Text of the title row above the table (e.g. the guide line). */
  title: string;
  rows: SheetRow[];
  /** admin sheets: lead each row with the guide's Employee ID */
  leadEmpId?: boolean;
}

/**
 * Batch sheets: a title row, then 2 rows per batch with Batch No. merged and a pastel fill per
 * batch. Every cell goes through safeCell (formula-injection guard).
 */
export async function buildBatchWorkbook(sheets: BatchWorkbookSheet[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  const widths = [12, 28, 20, 12, 28, 16, 32, 16, 36, 28];

  sheets.forEach((sheet) => {
    const ws = wb.addWorksheet(sheetName(sheet.name, used));
    const lead = sheet.leadEmpId ? 1 : 0;
    ws.columns = (lead ? [16, ...widths] : widths).map((width) => ({ width }));
    const colCount = BATCH_COLUMNS.length + lead;
    const batchCol = 1 + lead;
    const titleCol = 1 + lead + BATCH_COLUMNS.indexOf("Project Title");

    ws.mergeCells(1, 1, 1, colCount);
    const title = ws.getCell(1, 1);
    title.value = safeCell(sheet.title);
    title.font = { bold: true, size: 12 };
    title.alignment = { vertical: "middle", horizontal: "left" };

    const header = ws.addRow(lead ? [GUIDE_EMP_COLUMN, ...BATCH_COLUMNS] : [...BATCH_COLUMNS]);
    header.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${HEADER_FILL}` } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = border;
    });

    sheet.rows.forEach((r) => {
      const row = ws.addRow([
        ...(lead ? [safeCell(r.guideEmpId)] : []),
        r.first ? r.batchLabel : "",
        safeCell(r.name),
        safeCell(r.regNo),
        safeCell(r.section),
        safeCell(r.advisor),
        safeCell(r.phone),
        safeCell(r.mail),
        safeCell(r.studentMobile),
        r.first ? safeCell(r.projectTitle) : "",
        safeCell(r.guideName),
      ]);
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.border = border;
        cell.alignment = { vertical: "middle", horizontal: col === batchCol ? "center" : "left", wrapText: col === titleCol };
        if (col === batchCol) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fillForBatch(r.batchNo)}` } };
      });
      if (r.first) {
        row.getCell(batchCol).font = { bold: true };
      } else {
        // merge the Batch No. and Project Title cells over this batch's two rows
        ws.mergeCells(row.number - 1, batchCol, row.number, batchCol);
        ws.mergeCells(row.number - 1, titleCol, row.number, titleCol);
      }
    });
    ws.views = [{ state: "frozen", ySplit: 2 }];
  });
  return wb;
}

export async function exportBatchWorkbook(filename: string, sheets: BatchWorkbookSheet[]) {
  save(await (await buildBatchWorkbook(sheets)).xlsx.writeBuffer(), filename);
}

/** The faculty's own batch sheet. */
export const exportBatchSheet = (filename: string, rows: SheetRow[], guide: GuideInfo) =>
  exportBatchWorkbook(filename, [{ name: "Batches", title: guideTitle(guide), rows }]);
