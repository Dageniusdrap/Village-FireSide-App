import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Best-effort: never throws, never fails the calling action. admin_actions
// is a record-keeping/accountability trail, not data the app depends on
// to function — failing a real content-management operation (e.g. a
// publish) because an unrelated audit-log insert had a transient issue
// would be worse UX for no real integrity benefit. A failed log write is
// a silent gap unless someone is watching server logs; that tradeoff is
// deliberate (see docs/superpowers/specs/2026-09-26-admin-dashboard-core-design.md).
export async function logAdminAction(
  adminId: string,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("admin_actions").insert({
      admin_id: adminId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details: details ?? null,
    });
    if (error) {
      console.error("logAdminAction failed:", error);
    }
  } catch (err) {
    console.error("logAdminAction threw:", err);
  }
}
