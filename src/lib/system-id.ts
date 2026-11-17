// System IDs are what the QR label carries: "LRS-" plus ten characters.
// The alphabet leaves out I, L, O and U so an ID read aloud or typed from a
// worn label cannot be confused with 1 or 0.

import { randomInt } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PREFIX = "LRS-";
const LENGTH = 10;

export const SYSTEM_ID_PATTERN = /^LRS-[0-9A-HJKMNP-TV-Z]{10}$/;

export function newSystemId(): string {
  let body = "";
  for (let i = 0; i < LENGTH; i++) {
    body += ALPHABET[randomInt(ALPHABET.length)];
  }
  return PREFIX + body;
}

/**
 * Cleans up an ID that was typed by hand: trims, upper-cases, restores a missing
 * prefix or dash, and maps look-alike letters to the digit that was meant.
 * Returns null if the result is still not a valid ID.
 */
export function normalizeSystemId(input: string): string | null {
  let s = input.trim().toUpperCase().replace(/\s+/g, "");
  s = s.replace(/^LRS-?/, "");
  s = s.replace(/[IL]/g, "1").replace(/O/g, "0").replace(/U/g, "V");
  const candidate = PREFIX + s;
  return SYSTEM_ID_PATTERN.test(candidate) ? candidate : null;
}
