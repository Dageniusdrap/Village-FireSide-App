export function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-gray-500">{note}</p>
    </div>
  );
}
