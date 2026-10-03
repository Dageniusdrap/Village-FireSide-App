// apps/admin/src/app/(dashboard)/destinations/new/page.tsx
import { DestinationForm } from "../destination-form";

export default function NewDestinationPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New Destination</h1>
      <DestinationForm />
    </div>
  );
}
