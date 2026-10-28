/** Browser-side PDF of the Minor Project Application Form (pdf-lib is loaded on demand). */
import type { ApplicationForm } from "./types";

// Standard PDF fonts only cover Latin-1 + a few punctuation marks; anything else is replaced so a name can never break the download.
const printable = (v: string | null | undefined) => (v ?? "").replace(/[^\x20-\x7E -ÿ–—‘’“”]/g, "?").replace(/\s+/g, " ").trim();

export async function buildApplicationPdf(form: ApplicationForm): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("Minor Project Application Form");
  const page = doc.addPage([595, 842]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const left = 50;
  const width = 495;
  const ink = rgb(0.1, 0.1, 0.12);
  const line = rgb(0.6, 0.62, 0.66);
  const band = rgb(0.74, 0.84, 0.93);
  let y = 800;

  const centered = (text: string, size: number, font = bold) => {
    page.drawText(text, { x: left + (width - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color: ink });
  };

  centered("Minor Project Application Form", 18);
  y -= 18;
  centered("Minor and Major Project Allocation Portal (MAPP)", 10, regular);
  y -= 12;
  page.drawLine({ start: { x: left, y }, end: { x: left + width, y }, thickness: 1.2, color: ink });
  y -= 24;

  const wrap = (text: string, size: number, maxWidth: number) => {
    const words = printable(text).split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (regular.widthOfTextAtSize(next, size) <= maxWidth || !cur) cur = next;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    lines.push(cur);
    return lines;
  };

  const section = (title: string) => {
    page.drawRectangle({ x: left, y: y - 4, width, height: 18, color: band, borderColor: line, borderWidth: 0.6 });
    page.drawText(title, { x: left + 6, y: y + 1, size: 10.5, font: bold, color: ink });
    y -= 18;
  };

  const labelW = 150;
  const row = (label: string, value: string | null | undefined) => {
    const lines = wrap(value || "—", 10, width - labelW - 12);
    const h = Math.max(20, lines.length * 13 + 8);
    page.drawRectangle({ x: left, y: y - h + 14, width: labelW, height: h, borderColor: line, borderWidth: 0.6 });
    page.drawRectangle({ x: left + labelW, y: y - h + 14, width: width - labelW, height: h, borderColor: line, borderWidth: 0.6 });
    page.drawText(printable(label), { x: left + 6, y: y - 1, size: 9.5, font: bold, color: ink });
    lines.forEach((l, i) => page.drawText(l, { x: left + labelW + 6, y: y - 1 - i * 13, size: 10, font: regular, color: ink }));
    y -= h;
  };

  section("Project details");
  row("Project Title", form.project_title);
  row("SDG Goal", form.sdg_goal);
  row("Problem Statement by Guide", form.problem_by_guide === null ? null : form.problem_by_guide ? "Yes" : "No");
  y -= 14;

  section("Student 1");
  row("Name", form.s1_name);
  row("Registration No.", form.s1_reg);
  row("Section", form.s1_section);
  row("SRM Mail ID", form.s1_mail);
  row("Mobile No.", form.s1_mobile);
  y -= 14;

  section("Student 2");
  row("Name", form.s2_name);
  row("Registration No.", form.s2_reg);
  row("Section", form.s2_section);
  row("SRM Mail ID", form.s2_mail);
  row("Mobile No.", form.s2_mobile);
  y -= 14;

  section("Guide");
  row("Guide Name", form.guide_name);
  row("Guide Emp ID", form.guide_emp_id);
  row("Contact Number", form.guide_phone);

  // signature lines
  const sigY = 120;
  const sigs: [string, number][] = [
    ["Student 1", left],
    ["Student 2", left + 180],
    ["Guide", left + 360],
  ];
  sigs.forEach(([who, x]) => {
    page.drawLine({ start: { x, y: sigY }, end: { x: x + 135, y: sigY }, thickness: 0.8, color: ink });
    page.drawText(`${who} signature`, { x, y: sigY - 13, size: 9, font: regular, color: ink });
  });
  page.drawText(`Status: ${form.status === "submitted" ? "Submitted" : "Draft"}`, { x: left, y: 60, size: 9, font: regular, color: line });

  return doc.save();
}

export async function downloadApplicationPdf(form: ApplicationForm) {
  const bytes = await buildApplicationPdf(form);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MAPP_Application_${printable(form.s1_reg).replace(/[^A-Za-z0-9]/g, "") || "Form"}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
