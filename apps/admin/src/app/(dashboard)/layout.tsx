import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let adminName = "";
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .single();
    adminName = profile?.display_name ?? user.email ?? "";
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar adminName={adminName} />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
