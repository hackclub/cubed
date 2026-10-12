// Free text that users type ends up in Airtable (and from there in reviewers'
// exports and spreadsheets) and on shared pages. This strips what has no
// business in a name or a sentence: control characters, invisible/bidi-override
// characters, private-use code points, and runaway stacks of combining marks.
// Emoji keep working (ZWJ and variation selectors are left alone).

import { z } from "zod";

// Controls (tab/CR are folded into spaces/newlines first), surrogates and private use.
const BAD_CHARS = /[\p{Cc}\p{Cs}\p{Co}]/gu;
// More than 3 combining marks in a row ("zalgo").
const ZALGO = /(\p{M}{3})\p{M}+/gu;

// Invisible or direction-changing code points: soft hyphen, Arabic letter mark,
// Mongolian vowel separator, zero-width space, LRM/RLM, bidi embeddings/overrides,
// word joiner and invisible operators, bidi isolates, BOM, and the "tag" block.
const INVISIBLE: [number, number][] = [
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200b],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
];

function stripInvisible(value: string): string {
  let out = "";
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (!INVISIBLE.some(([from, to]) => cp >= from && cp <= to)) out += ch;
  }
  return out;
}

export function cleanText(input: string, multiline = false): string {
  let value = input.normalize("NFC").replace(/\r\n?/g, "\n");
  value = multiline ? value.replace(/[^\S\n]+/g, " ") : value.replace(/\s+/g, " ");
  value = stripInvisible(value);
  // Newlines were normalised above; every other control character goes.
  value = value.replace(BAD_CHARS, (ch) => (ch === "\n" && multiline ? ch : ""));
  value = value.replace(ZALGO, "$1");
  if (multiline) {
    value = value
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }
  return value.trim();
}

// zod field: cleaned first, then length-checked on the cleaned text.
export function text(min: number, max: number, multiline = false) {
  return z
    .string()
    .transform((value) => cleanText(value, multiline))
    .pipe(z.string().min(min).max(max));
}

// A cell that starts with = + - @ (or a tab/CR) is run as a formula by Excel and
// Google Sheets when someone exports the data. A leading apostrophe makes it plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

// A phone-style number (optional leading + or -, then only digits, spaces, dots, hyphens and
// parentheses) can't run anything as a formula, so it is left exactly as typed: an international
// "+1 (555) 010-0100" must not gain a visible apostrophe.
const PLAIN_NUMBER = /^[+-]?[0-9][0-9 ().-]*$/;

export function neutralizeFormula(value: string): string {
  if (PLAIN_NUMBER.test(value)) return value;
  return FORMULA_START.test(value) ? `'${value}` : value;
}

export function neutralizeFormulas(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = typeof value === "string" ? neutralizeFormula(value) : value;
  }
  return out;
}
