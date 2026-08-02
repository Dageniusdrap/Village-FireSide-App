import { createClient } from "@/lib/supabase/server";
import { ApproveRejectButtons } from "./approve-reject-buttons";

export default async function TeacherRequestsPage() {
  const supabase = await createClient();
  const { data: requests, error } = await supabase
    .from("teacher_requests")
    .select("id, user_id, name, school, district, phone, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    return <main className="p-8">Failed to load requests: {error.message}</main>;
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-8">
      <h1 className="text-xl font-semibold">Teacher Requests</h1>
      {requests.length === 0 ? (
        <p>No pending requests.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b">
              <th className="py-2">Name</th>
              <th className="py-2">School</th>
              <th className="py-2">District</th>
              <th className="py-2">Phone</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id} className="border-b">
                <td className="py-2">{request.name}</td>
                <td className="py-2">{request.school}</td>
                <td className="py-2">{request.district}</td>
                <td className="py-2">{request.phone}</td>
                <td className="py-2">
                  <ApproveRejectButtons requestId={request.id} userId={request.user_id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
