#!/usr/bin/env bash
# Downloads PostgREST + Supabase Auth (GoTrue) binaries for the local Supabase-equivalent stack used by e2e tests.
set -euo pipefail
DIR=${STACK_BIN:-"$HOME/.dilly-stack"}
mkdir -p "$DIR" && cd "$DIR"
[ -x postgrest ] || { curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar xJ; }
[ -x auth ] || { curl -sSL https://github.com/supabase/auth/releases/download/v2.177.0/auth-v2.177.0-x86.tar.gz | tar xz; }
echo "binaries in $DIR"
