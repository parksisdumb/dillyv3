// CSV export, streamed: the header goes out at once and rows follow 1,000 at a time, so big books don't time out or
// sit in memory. Managers and up; RLS scopes every read to what the user can see. Filters = the list page's query.
import { ctx } from "@/lib/server/ctx";
import { buildExport, EXPORT_KINDS, type ExportKind } from "@/lib/server/export";
import { csvLine } from "@/lib/domain/import/parse";
import { log } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return new Response("Not found", { status: 404 });
  const c = await ctx();
  if (!c.s.isManager) return new Response("Not found", { status: 404 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const spec = await buildExport(c, kind as ExportKind, sp);
  const enc = new TextEncoder();
  const pages = spec.pages();
  let started = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        // BOM so Excel opens UTF-8 (names with accents) correctly.
        controller.enqueue(enc.encode("﻿" + csvLine(spec.header)));
        return;
      }
      try {
        const next = await pages.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(enc.encode(next.value.map(csvLine).join("")));
      } catch (err) {
        log.error("export:failed", { kind, tenant: c.tenantId, err });
        controller.enqueue(enc.encode(csvLine(["# Export stopped early: a page failed to load. Try again."])));
        controller.close();
      }
    },
    async cancel() {
      await pages.return(undefined);
    },
  });

  const slug = c.s.tenant.slug;
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}-${kind}-${c.today}.csv"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
