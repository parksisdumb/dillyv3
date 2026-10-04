# Local Supabase-equivalent stack

Runs the real Supabase Auth (GoTrue) and PostgREST binaries against local Postgres, behind a tiny gateway that
mimics Supabase's URL layout. Used for end-to-end tests; no Docker needed.

```bash
./scripts/local/stack/download.sh        # once: binaries into ~/.dilly-stack (or $STACK_BIN)
./scripts/local/stack/up.sh --fresh      # creates dilly_e2e, runs auth + app migrations, starts services
# NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321, keys in /tmp/dilly-stack/keys.env
```
Email is auto-confirmed and sign-up is open — local only.
