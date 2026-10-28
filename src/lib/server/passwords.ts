import "server-only";
import { randomInt } from "node:crypto";

// No look-alike characters (0/O, 1/l/I) so passwords read out of a printed sheet are typed correctly.
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALL = LOWER + UPPER + DIGITS;
const LENGTH = 12; // ~68 bits of entropy

const pick = (set: string) => set[randomInt(set.length)];

/** Random one-time password (CSPRNG). Always has a lower-case, an upper-case letter and a digit. */
export function generatePassword(): string {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS)];
  while (chars.length < LENGTH) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
