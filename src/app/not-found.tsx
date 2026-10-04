import Link from "next/link";
import { btn } from "@/components/ui/styles";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <p className="label text-xs text-muted">Dilly</p>
      <h1 className="mt-1 font-display text-3xl font-bold leading-tight">Nothing here.</h1>
      <p className="mt-2 text-base text-muted">That link is old or the record was removed or merged.</p>
      <Link href="/app/today" className={btn("primary", "lg", "mt-6 w-full")}>
        Go to Today
      </Link>
    </main>
  );
}
