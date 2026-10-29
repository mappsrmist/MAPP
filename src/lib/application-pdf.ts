/**
 * Browser-side PDF of the SRM "Guide Acceptance Form" (pdf-lib is loaded on demand).
 * The PDF is generated from the saved form data on every download and is never uploaded or stored.
 */
import type { ApplicationForm } from "./types";

// Standard PDF fonts only cover Latin-1 + a few punctuation marks; anything else is replaced so a name can never break the download.
const printable = (v: string | null | undefined) => (v ?? "").replace(/[^\x20-\x7E -ÿ–—‘’“”]/g, "?").replace(/\s+/g, " ").trim();

const NOTE_SDGS = ["Agriculture", "Health Care", "Environment and Green Ecosystem", "Energy", "Mobility Solutions"];

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

export async function buildApplicationPdf(form: ApplicationForm): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("Guide Acceptance Form - 21CSP302L Minor Project");
  let page = doc.addPage([595, 842]);
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  type Font = typeof regular;

  const ink = rgb(0, 0, 0);
  const left = 40;
  const width = 515;
  const c1 = 170;
  const c2 = (width - c1) / 2;
  let y = 810;

  const centered = (text: string, size: number, underline = false) => {
    size += 1;
    const w = bold.widthOfTextAtSize(text, size);
    const x = left + (width - w) / 2;
    page.drawText(text, { x, y, size, font: bold, color: ink });
    if (underline) page.drawLine({ start: { x, y: y - 2 }, end: { x: x + w, y: y - 2 }, thickness: 0.8, color: ink });
    y -= size + 6;
  };

  centered("SRM INSTITUTE OF SCIENCE AND TECHNOLOGY", 12);
  centered("SCHOOL OF COMPUTING", 12);
  centered("DEPARTMENT OF COMPUTING TECHNOLOGIES", 12);
  centered("21CSP302L - MINOR PROJECT", 12);
  centered("VI SEMESTER - (2026 - 2027 Even)", 12);
  centered("GUIDE ACCEPTANCE FORM", 12, true);
  const dateLabel = `Date: ${today()}`;
  page.drawText(dateLabel, { x: left + width - bold.widthOfTextAtSize(dateLabel, 12), y: y + 2, size: 12, font: bold, color: ink });
  y -= 10;

  // Wraps on spaces and hard-breaks any single word wider than the cell (e.g. a long e-mail address).
  const wrap = (text: string, font: Font, size: number, maxWidth: number) => {
    const lines: string[] = [];
    let cur = "";
    const push = () => {
      if (cur) lines.push(cur);
      cur = "";
    };
    for (const word of printable(text).split(" ")) {
      let w = word;
      while (font.widthOfTextAtSize(w, size) > maxWidth) {
        push();
        let n = w.length - 1;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxWidth) n--;
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      const next = cur ? `${cur} ${w}` : w;
      if (!cur || font.widthOfTextAtSize(next, size) <= maxWidth) cur = next;
      else {
        push();
        cur = w;
      }
    }
    push();
    return lines.length ? lines : [""];
  };

  type Cell = { text?: string; sub?: string; font?: Font; size?: number; center?: boolean; w: number };
  const pad = 9;

  // Draws one table row; cells share the row height, which grows to fit the tallest wrapped cell.
  const row = (cells: Cell[], minH = 22) => {
    const laid = cells.map((c) => {
      const font = c.font ?? regular;
      const size = (c.size ?? 11) + 1;
      const lines = c.text ? wrap(c.text, font, size, c.w - pad * 2) : [];
      const subLines = c.sub ? wrap(c.sub, regular, 10, c.w - pad * 2) : [];
      return { c, font, size, lines, subLines, h: lines.length * (size + 3) + subLines.length * 13 + 12 };
    });
    const h = Math.max(minH, ...laid.map((l) => l.h));
    if (y - h < 40) {
      page = doc.addPage([595, 842]);
      y = 800;
    }
    let x = left;
    for (const { c, font, size, lines, subLines } of laid) {
      page.drawRectangle({ x, y: y - h, width: c.w, height: h, borderColor: ink, borderWidth: 0.8 });
      const textH = lines.length * (size + 3) + subLines.length * 13;
      let ty = y - (h - textH) / 2 - size + 2;
      for (const l of lines) {
        const tx = c.center ? x + (c.w - font.widthOfTextAtSize(l, size)) / 2 : x + pad;
        page.drawText(l, { x: tx, y: ty, size, font, color: ink });
        ty -= size + 3;
      }
      for (const l of subLines) {
        page.drawText(l, { x: x + pad, y: ty, size: 10, font: regular, color: ink });
        ty -= 13;
      }
      x += c.w;
    }
    y -= h;
  };

  const val = (v: string | null | undefined) => printable(v);
  const wide = c2 * 2;

  row([{ text: "PROJECT TITLE *", sub: "(21CSP302L - MINOR PROJECT)", font: bold, size: 13, w: c1 }, { text: val(form.project_title), w: wide }], 60);
  row([{ text: "Project Type", w: c1 }, { text: form.project_type ? { research: "Research", product: "Product", multidisciplinary: "Multidisciplinary" }[form.project_type] : "", w: wide }]);
  row([{ text: "Sustainable Development Goal (SDG)", w: c1 }, { text: val(form.sdg_goal), w: wide }]);
  row([
    { text: "Problem Statement by Guide", w: c1 },
    { text: form.problem_by_guide === null ? "YES / NO" : form.problem_by_guide ? "YES" : "NO", font: bold, size: 10, w: wide },
  ]);
  row([
    { text: "Project Team Members Details", font: bold, w: c1 },
    { text: "Student 1", center: true, w: c2 },
    { text: "Student 2", center: true, w: c2 },
  ], 18);
  const pair = (label: string, a: string | null | undefined, b: string | null | undefined, minH = 26) =>
    row([{ text: label, w: c1 }, { text: val(a), w: c2 }, { text: val(b), w: c2 }], minH);
  pair("Student Name", form.s1_name, form.s2_name);
  pair("Student Reg. No.", form.s1_reg, form.s2_reg);
  pair("Section", form.s1_section, form.s2_section);
  pair("SRM Mail ID", form.s1_mail, form.s2_mail);
  pair("Mobile No.", form.s1_mobile, form.s2_mobile);
  pair("Student Signature", "", "", 34);

  row([{ text: "Guide Details", font: bold, center: true, w: width }], 20);
  const guide = (label: string, v: string, minH = 26) => row([{ text: label, w: c1 }, { text: v, w: wide }], minH);
  guide("Guide Name / Emp ID", [val(form.guide_name), val(form.guide_emp_id)].filter(Boolean).join(" / "));
  guide("Department / Designation", [val(form.guide_department), val(form.guide_designation)].filter(Boolean).join(" / "));
  guide("Contact Number", val(form.guide_phone));
  guide("Signature of the Guide", "", 34);

  // notes
  y -= 14;
  const noteSize = 10.5;
  const ensureNoteLine = () => {
    if (y < 40) { page = doc.addPage([595, 842]); y = 800; }
  };
  ensureNoteLine();
  page.drawText("*", { x: left - 12, y, size: 11, font: regular, color: ink });
  const lead = [
    { t: "Note:", f: bold },
    { t: " The project title must align with one of the following ", f: regular },
    { t: "Sustainable Development Goals (SDGs):", f: bold },
  ];
  const richLine = (parts: { t: string; f: Font }[], start: number) => {
    let x = start;
    for (const { t, f } of parts) {
      for (const word of t.match(/\S+\s*|^\s+/g) ?? []) {
        const w = f.widthOfTextAtSize(word, noteSize);
        if (x + w > left + width && x > start) { x = start; y -= 15; }
        ensureNoteLine();
        page.drawText(word, { x, y, size: noteSize, font: f, color: ink });
        x += w;
      }
    }
  };
  richLine(lead, left);
  y -= 15;
  NOTE_SDGS.forEach((s, i) => {
    ensureNoteLine();
    page.drawText(`${i + 1}.   ${s}`, { x: left + 14, y, size: noteSize, font: regular, color: ink });
    y -= 14;
  });
  y -= 4;

  const bullet = (parts: { t: string; f: Font }[]) => {
    ensureNoteLine();
    page.drawCircle({ x: left - 6, y: y + 3, size: 1.8, color: ink });
    richLine(parts, left + 4);
    y -= 15;
  };
  bullet([
    { t: "Purely ", f: regular },
    { t: "application-oriented projects", f: bold },
    { t: ", including ", f: regular },
    { t: "website or mobile app development", f: bold },
    { t: ", will ", f: regular },
    { t: "not be considered", f: bold },
    { t: ".", f: regular },
  ]);
  bullet([
    { t: "The ", f: regular },
    { t: "major project", f: bold },
    { t: " should be a ", f: regular },
    { t: "follow-up or extended version", f: bold },
    { t: " of the ", f: regular },
    { t: "minor project", f: bold },
    { t: ".", f: regular },
  ]);
  bullet([
    { t: "Paper publication", f: bold },
    { t: " is mandatory.", f: regular },
  ]);

  return doc.save();
}

export async function downloadApplicationPdf(form: ApplicationForm) {
  const bytes = await buildApplicationPdf(form);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Guide_Acceptance_Form_${printable(form.s1_reg).replace(/[^A-Za-z0-9]/g, "") || "Form"}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
