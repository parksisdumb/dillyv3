/**
 * Builds the REAL Dilly V2 schema from the discovery output Parks ran on the V2 project
 * (migration/discover-sql-editor.sql -> tests/migration/fixtures/v2-schema-snippet.csv): every table, column, type,
 * NOT NULL, DEFAULT, primary key, unique, foreign key and CHECK exactly as V2 has them. Functions/triggers are not
 * reproduced (the migration only reads tables).
 */
import fs from "node:fs";
import path from "node:path";

export const V2_SCHEMA_CSV = path.join(__dirname, "fixtures", "v2-schema-snippet.csv");

export type V2Schema = { tables: Map<string, { rows: number; columns: string[] }>; ddl: string };

function csvLines(file: string): string[] {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.replace(/^"/, "").replace(/"$/, "").replace(/""/g, '"'))
    .filter((l) => l.trim().length > 0);
}

export function loadV2Schema(file = V2_SCHEMA_CSV): V2Schema {
  const tables = new Map<string, { rows: number; columns: string[] }>();
  const cols = new Map<string, string[]>();
  const constraints: { table: string; name: string; def: string; kind: number }[] = [];
  const seen = new Set<string>();
  for (const line of csvLines(file)) {
    let m = /^TABLE (\w+) — (\d+) rows$/.exec(line);
    if (m) {
      tables.set(m[1], { rows: Number(m[2]), columns: [] });
      continue;
    }
    m = /^\s+CONSTRAINT (\w+) (\w+): (.+)$/.exec(line);
    if (m) {
      const key = `${m[1]}.${m[2]}`;
      if (seen.has(key)) continue; // the export lists email_connections_pkey twice
      seen.add(key);
      const def = m[3];
      const kind = def.startsWith("PRIMARY KEY") ? 0 : def.startsWith("UNIQUE") ? 1 : def.startsWith("FOREIGN KEY") ? 2 : 3;
      constraints.push({ table: m[1], name: m[2], def, kind });
      continue;
    }
    m = /^\s+(\w+)\.(\w+) (.*?)( NOT NULL)?(?: DEFAULT (.*))?$/.exec(line);
    if (m && !/^\s+(FUNCTION|TRIGGER|ENUM) /.test(line)) {
      const [, table, column, type, notNull, dflt] = m;
      const list = cols.get(table) ?? [];
      list.push(`${quote(column)} ${type}${notNull ? " not null" : ""}${dflt ? ` default ${dflt}` : ""}`);
      cols.set(table, list);
      tables.get(table)?.columns.push(column);
    }
  }
  const parts: string[] = [];
  for (const [table, list] of cols) parts.push(`create table public.${quote(table)} (\n  ${list.join(",\n  ")}\n);`);
  for (const c of constraints.sort((a, b) => a.kind - b.kind)) {
    const def = c.def.replace(/REFERENCES (?!auth\.)(\w+)\(/g, "REFERENCES public.$1(");
    parts.push(`alter table public.${quote(c.table)} add constraint ${quote(c.name)} ${def};`);
  }
  return { tables, ddl: parts.join("\n") };
}

function quote(id: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(id) && !["user", "order", "role", "key"].includes(id) ? id : `"${id.replace(/"/g, '""')}"`;
}
