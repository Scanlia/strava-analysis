"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Activity } from "@/lib/data";

interface StreamPoint {
  lat: number;
  lon: number;
}

const COLORS: Record<string, string> = {
  Run: "#ff6b6b",
  Ride: "#4ecdc4",
  Hike: "#96ceb4",
  Swim: "#38bdf8",
};

const OPACITIES: Record<string, number> = {
  Run: 0.12,
  Ride: 0.08,
  Hike: 0.1,
  Swim: 0.1,
};

function FitToBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions);
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    }
  }, [positions, map]);
  return null;
}

export default function LeafletMapInner({ activities }: { activities: Activity[] }) {
  const [visibleSports, setVisibleSports] = useState<Record<string, boolean>>({
    Run: true, Ride: true, Hike: true, Swim: true,
  });

  const filteredActivities = activities.filter((a) =>
    !a.is_manual && !a.is_indoor && a.stream && a.stream.length > 0 && visibleSports[a.sport]
  );

  const allPositions: [number, number][] = [];
  const polylines = filteredActivities.map((a) => {
    const positions: [number, number][] = [];
    for (const p of (a.stream || [])) {
      if (p.lat && p.lon) {
        positions.push([p.lat, p.lon]);
        allPositions.push([p.lat, p.lon]);
      }
    }
    if (positions.length < 2) return null;
    return (
      <Polyline
        key={a.id}
        positions={positions}
        pathOptions={{
          color: COLORS[a.sport] || "#888",
          weight: 2,
          opacity: OPACITIES[a.sport] || 0.1,
        }}
      />
    );
  });

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
      <div className="flex flex-wrap gap-2 mb-3">
        {Object.entries(COLORS).map(([sport, color]) => (
          <label key={sport} className="flex items-center gap-1.5 text-[11px] cursor-pointer">
            <input
              type="checkbox"
              checked={visibleSports[sport]}
              onChange={() => setVisibleSports((v) => ({ ...v, [sport]: !v[sport] }))}
              className="accent-current"
              style={{ accentColor: color }}
            />
            <span style={{ color }}>{sport}</span>
          </label>
        ))}
        <span className="text-[10px] text-gray-500 ml-2">
          {filteredActivities.length} activities
        </span>
      </div>
      {filteredActivities.length > 0 ? (
        <div className="h-[500px] rounded-lg overflow-hidden">
          <MapContainer
            center={[-27.5, 153]}
            zoom={5}
            style={{ height: "100%", width: "100%", background: "#1a1a2e" }}
            zoomControl={true}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {polylines}
            <FitToBounds positions={allPositions} />
          </MapContainer>
        </div>
      ) : (
        <div className="h-[500px] bg-[#1a1a2e] rounded-lg flex items-center justify-center">
          <p className="text-gray-500">No GPS activities to display</p>
        </div>
      )}
    </div>
  );
}
