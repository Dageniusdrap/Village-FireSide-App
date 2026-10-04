#!/usr/bin/env bash
# scripts/check-migration-drift.sh
# Fails if the live project's applied migrations differ from the repo's
# migration files. Read-only: `supabase migration list --linked` lists, it
# never applies anything.
set -euo pipefail

supabase link --project-ref "${SUPABASE_PROJECT_REF}" --password "${SUPABASE_DB_PASSWORD}" > /dev/null

supabase migration list --linked --output-format json > /tmp/migrations.json

python3 - <<'PY'
import json, sys
data = json.load(open("/tmp/migrations.json"))
rows = data.get("migrations", data)
local_only = [r["local"] for r in rows if r.get("local") and not r.get("remote")]
remote_only = [r["remote"] for r in rows if r.get("remote") and not r.get("local")]
if local_only or remote_only:
    print("Migration drift detected.")
    print("In the repo but not applied to the live project:", local_only or "none")
    print("Applied to the live project but not in the repo:", remote_only or "none")
    sys.exit(1)
print(f"No drift: {len(rows)} migrations match.")
PY
