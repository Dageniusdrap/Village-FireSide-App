// apps/admin/src/app/(dashboard)/destinations/map-picker-inner.tsx
"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";

// Leaflet's default marker icon references image URLs that don't resolve
// correctly under a bundler without this — a well-known Leaflet/webpack
// interop issue, not specific to this codebase.
const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// Kampala, Uganda — a reasonable default center given the app's stated
// geographic focus, used only when a destination has no coordinates yet.
const DEFAULT_CENTER: [number, number] = [0.3476, 32.5825];

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapPickerInner({
  latitude,
  longitude,
  onChange,
}: {
  latitude?: number;
  longitude?: number;
  onChange: (lat: number, lng: number) => void;
}) {
  const center: [number, number] =
    latitude !== undefined && longitude !== undefined ? [latitude, longitude] : DEFAULT_CENTER;

  return (
    <MapContainer center={center} zoom={latitude !== undefined ? 10 : 6} style={{ height: 300 }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onPick={onChange} />
      {latitude !== undefined && longitude !== undefined && (
        <Marker position={[latitude, longitude]} icon={markerIcon} />
      )}
    </MapContainer>
  );
}
