// apps/admin/src/app/(dashboard)/destinations/map-picker.tsx
"use client";

import dynamic from "next/dynamic";

const MapPickerInner = dynamic(() => import("./map-picker-inner"), { ssr: false });

export function MapPicker({
  latitude,
  longitude,
  onChange,
}: {
  latitude?: number;
  longitude?: number;
  onChange: (lat: number, lng: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <MapPickerInner latitude={latitude} longitude={longitude} onChange={onChange} />
      <p className="text-sm text-gray-500">
        {latitude !== undefined && longitude !== undefined
          ? `Selected: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
          : "Click the map to set this destination's location."}
      </p>
    </div>
  );
}
