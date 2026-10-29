import { ADMIN_EMAIL, ADMIN_USERNAME, STUDENT_EMAIL_DOMAIN, type Role } from "./config";

export const normalizeRegNo = (s: string) => s.trim().toUpperCase();
export const normalizeEmail = (s: string) => s.trim().toLowerCase();

export interface LoginTarget {
  /** the account type the credentials must belong to */
  role: "student" | "faculty" | "admin";
  email: string | null;
}

/**
 * Resolves a login form submission. There is no Admin tab: the admin username typed on the Faculty
 * tab selects the admin account. On the Student tab it is just an unknown registration number.
 */
export function resolveLogin(tab: "student" | "faculty", username: string): LoginTarget {
  if (tab === "faculty" && username.trim().toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
    return { role: "admin", email: ADMIN_EMAIL };
  }
  return { role: tab, email: usernameToEmail(tab, username) };
}

/** Maps the username typed on the login tab to the Supabase Auth email. */
export function usernameToEmail(role: Role, username: string): string | null {
  const u = username.trim();
  if (!u) return null;
  if (role === "student") return `${normalizeRegNo(u).toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`;
  if (role === "faculty") return normalizeEmail(u);
  return u.toLowerCase() === ADMIN_USERNAME.toLowerCase() ? ADMIN_EMAIL : null;
}
