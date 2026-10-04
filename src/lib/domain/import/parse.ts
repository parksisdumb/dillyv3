// CSV / pasted-spreadsheet parsing. Papa Parse auto-detects the delimiter, so a paste from Excel or Google Sheets
// (tab-separated) and a .csv file both work.
import Papa from "papaparse";

export const MAX_ROWS = 10_000;

export type Sheet = { headers: string[]; rows: string[][]; truncated: boolean };

export function parseSheet(text: string): Sheet {
  const clean = text.replace(/^﻿/, ""); // Excel's UTF-8 BOM
  const res = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy", delimiter: "" });
  const all = (res.data ?? []).filter((r) => Array.isArray(r));
  if (all.length === 0) return { headers: [], rows: [], truncated: false };
  // Header = first row; blank header cells get a column letter so they can still be mapped.
  const width = Math.max(...all.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => (all[0]![i] ?? "").trim() || `Column ${colLetter(i)}`);
  const body = all.slice(1).map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()));
  return { headers, rows: body.slice(0, MAX_ROWS), truncated: body.length > MAX_ROWS };
}

export function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** RFC 4180 cell: quote when it contains a delimiter, quote or newline; neutralize spreadsheet formulas. */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = Array.isArray(v) ? v.join("; ") : String(v);
  // CSV injection guard: a leading = + - @ (or tab / CR) is executed by Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(",") + "\r\n";
}
