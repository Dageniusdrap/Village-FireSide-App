<!-- docs/testing-database.md -->

# Database tests

Database tests run against a local Supabase stack in Docker, never the
live project.

1. Start Docker Desktop.
2. `supabase start` (the first run downloads about 8.4 GB of images).
3. `pnpm test:db` runs every `supabase/tests/*.test.sql` file with pgTAP.
4. `pnpm test:integration` runs `packages/db-integration-tests` (concurrency,
   the photo function, agreement fingerprints).
5. `bash supabase/tests/upgrade/run.sh` resets the local database to the last
   pre-15A migration, loads live-shaped fixtures, applies the newer
   migrations, and checks nothing was lost.

Each pgTAP file runs in `begin … rollback`, so tests leave no data behind.
Shared fixtures live in `supabase/tests/helpers/fixtures.sql`.

Every `supabase db reset` and `supabase migration up` here uses `--local`.
Never use `--linked` for tests.

One local stack serves every checkout of this repo, so run database tests
from one checkout at a time.
