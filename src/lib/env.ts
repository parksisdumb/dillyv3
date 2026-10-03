import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Model ids per tier. Set to the current Claude model ids in Vercel env; the runtime never hardcodes them.
  DILLY_MODEL_OPUS: z.string().min(1).optional(),
  DILLY_MODEL_SONNET: z.string().min(1).optional(),
  DILLY_MODEL_HAIKU: z.string().min(1).optional(),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      "Missing or invalid environment variables: " +
        parsed.error.issues.map((i) => i.path.join(".")).join(", ") +
        ". Copy .env.example to .env.local and fill it in.",
    );
  }
  cached = parsed.data;
  return cached;
}
