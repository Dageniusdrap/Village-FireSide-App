import { createClient } from "@supabase/supabase-js";

// Server-only, service-role privileges. Required, not optional, for
// approving a teacher request: prevent_protected_profile_changes
// (supabase/migrations/20260721150500_rls_policies.sql) rejects any
// write to profiles.role from a request that isn't running as
// auth.role() = 'service_role' — the admin's own cookie-based session
// (apps/admin/src/lib/supabase/server.ts) is 'authenticated', not
// 'service_role', regardless of is_admin() RLS. This client is never
// imported by anything under "use client" — SUPABASE_SERVICE_ROLE_KEY
// must never reach the browser.
export function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
