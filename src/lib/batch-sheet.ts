/** Pure helpers shared by the on-screen preview and the Excel export of the batch sheet. */

export const BATCH_FILLS = ["E2F0D9", "FBE5D6", "DDEBF7", "E4DFEC"]; // green, orange, blue, purple (pastel)
export const HEADER_FILL = "BDD7EE"; // light blue

export const BATCH_COLUMNS = [
  "Batch No.",
  "Name",
  "Registration No.",
  "Section",
  "Faculty Advisor Name",
  "Phone No.",
  "SRM Mail ID",
] as const;

export interface BatchInput {
  batch_no: number;
  section: string;
  advisor_name: string;
  contact_number: string;
  srm_mail: string;
  batch_members: { slot: number; student_id: string }[];
}

export interface SheetRow {
  batchNo: number;
  batchLabel: string;
  name: string;
  regNo: string;
  section: string;
  advisor: string;
  phone: string;
  mail: string;
  /** first row of a 2-row batch (the Batch No. cell is merged over both rows) */
  first: boolean;
}

/** Two rows per grouped batch, ordered by batch number then slot. */
export function buildSheetRows(
  batches: BatchInput[],
  students: Record<string, { name: string; reg_no: string }>,
): SheetRow[] {
  const rows: SheetRow[] = [];
  [...batches]
    .sort((a, b) => a.batch_no - b.batch_no)
    .forEach((b) => {
      const members = [...b.batch_members].sort((x, y) => x.slot - y.slot);
      if (members.length !== 2) return;
      members.forEach((m, i) => {
        const st = students[m.student_id];
        rows.push({
          batchNo: b.batch_no,
          batchLabel: `B${b.batch_no}`,
          name: st?.name ?? "",
          regNo: st?.reg_no ?? "",
          section: b.section,
          advisor: b.advisor_name,
          phone: b.contact_number,
          mail: b.srm_mail,
          first: i === 0,
        });
      });
    });
  return rows;
}

export const fillForBatch = (batchNo: number) => BATCH_FILLS[(batchNo - 1) % BATCH_FILLS.length];
