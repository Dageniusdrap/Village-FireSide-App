#!/usr/bin/env bash
# supabase/tests/upgrade/run.sh
# Migration-on-existing-data test. LOCAL ONLY: every command uses --local.
set -euo pipefail

BASELINE=20260926100000
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Resetting local database to baseline ${BASELINE}…"
supabase db reset --local --version "${BASELINE}" --no-seed

echo "Loading live-shaped fixtures…"
supabase db query --local --file "${DIR}/fixtures.sql" > /dev/null

echo "Applying newer migrations…"
supabase migration up --local

echo "Running upgrade assertions…"
supabase db query --local --file "${DIR}/assertions.sql" > /dev/null

echo "Upgrade test passed."
