import { ADMIN_EMAIL, ADMIN_USERNAME, STUDENT_EMAIL_DOMAIN, type Role } from "./config";

export const normalizeRegNo = (s: string) => s.trim().toUpperCase();
export const normalizeEmail = (s: string) => s.trim().toLowerCase();

/** Maps the username typed on the login tab to the Supabase Auth email. */
export function usernameToEmail(role: Role, username: string): string | null {
  const u = username.trim();
  if (!u) return null;
  if (role === "student") return `${normalizeRegNo(u).toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`;
  if (role === "faculty") return normalizeEmail(u);
  if (role === "admin") {
    const low = u.toLowerCase();
    if (low === ADMIN_USERNAME.toLowerCase() || low === ADMIN_EMAIL.toLowerCase() || low === "admin") {
      return ADMIN_EMAIL;
    }
  }
  return null;
}
