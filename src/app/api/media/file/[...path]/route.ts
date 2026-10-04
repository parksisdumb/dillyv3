import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { storageDriverName, storageFor } from "@/lib/storage";
import { pathInTenants } from "@/lib/storage/paths";

/**
 * GET /api/media/file/<tenant>/<yyyy>/<mm>/<uuid>.jpg — the local driver's "signed URL" (STORAGE_DRIVER=local only).
 * Authenticated: the first segment must be one of the viewer's tenants. Supabase deployments use real signed URLs
 * and this route 404s.
 */
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (storageDriverName() !== "local") return new NextResponse("Not found", { status: 404 });
  const key = (await params).path.join("/");
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return new NextResponse("Sign in", { status: 401 });
  const s = await getSession();
  if (!pathInTenants(key, s.tenants.map((t) => t.id))) return new NextResponse("Not found", { status: 404 });
  const file = await storageFor(sb).get(key);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(file.bytes), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
