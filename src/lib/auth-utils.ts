import { ADMIN_EMAIL, ADMIN_USERNAME, DOB_PASSWORD_FORMAT, STUDENT_EMAIL_DOMAIN, type Role } from "./config";

export const normalizeRegNo = (s: string) => s.trim().toUpperCase();
export const normalizeEmail = (s: string) => s.trim().toLowerCase();

/** Maps the username typed on the login tab to the Supabase Auth email. */
export function usernameToEmail(role: Role, username: string): string | null {
  const u = username.trim();
  if (!u) return null;
  if (role === "student") return `${normalizeRegNo(u).toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`;
  if (role === "faculty") return normalizeEmail(u);
  return u.toLowerCase() === ADMIN_USERNAME.toLowerCase() ? ADMIN_EMAIL : null;
}

/** Accepts DDMMYYYY or YYYY-MM-DD; returns ISO date (YYYY-MM-DD) or null. */
export function parseDob(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{2})(\d{2})(\d{4})$/.exec(s);
  if (match) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** ISO date -> initial faculty password according to DOB_PASSWORD_FORMAT. */
export function dobToPassword(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return DOB_PASSWORD_FORMAT.replace("YYYY", y).replace("MM", m).replace("DD", d);
}
