"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Activity } from "@/lib/data";

const COLORS: Record<string, string> = {
  Run: "#ff6b6b",
  Ride: "#4ecdc4",
  Hike: "#96ceb4",
  Swim: "#38bdf8",
};

const SPORT_ALPHA: Record<string, number> = { Run: 0.06, Ride: 0.04, Hike: 0.07, Swim: 0.08 };

function HeatmapLayer({ activities, visibleSports }: { activities: Activity[]; visibleSports: Record<string, boolean> }) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    canvas.style.width = size.x + "px";
    canvas.style.height = size.y + "px";

    ctx.clearRect(0, 0, size.x, size.y);
    ctx.globalCompositeOperation = "lighter";

    const zoom = map.getZoom();
    // Point radius scales with zoom — tiny dots when zoomed out, larger when zoomed in
    const baseRadius = Math.max(0.3, 6 - zoom * 0.35);

    for (const a of activities) {
      if (!visibleSports[a.sport]) continue;
      const color = COLORS[a.sport] || "#888";
      const alpha = SPORT_ALPHA[a.sport] || 0.05;
      const stream = a.stream || [];
      if (stream.length < 2) continue;

      // Parse hex to RGB for additive blending
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;

      for (const p of stream) {
        if (!p.lat || !p.lon) continue;
        const px = map.latLngToContainerPoint([p.lat, p.lon]);
        ctx.beginPath();
        ctx.arc(px.x, px.y, baseRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [activities, visibleSports, map]);

  useEffect(() => {
    // Create canvas overlay
    const CanvasLayer = L.Layer.extend({
      onAdd: function () {
        const pane = map.getPanes().overlayPane;
        const canvas = document.createElement("canvas");
        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.pointerEvents = "none";
        canvas.style.zIndex = "400";
        pane.appendChild(canvas);
        canvasRef.current = canvas;
        draw();
      },
      onRemove: function () {
        if (canvasRef.current) {
          canvasRef.current.remove();
          canvasRef.current = null;
        }
      },
      _update: function () {
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => draw());
      },
    });

    const layer = new CanvasLayer();
    map.addLayer(layer);

    // Redraw on move/zoom
    map.on("moveend", () => layer._update());
    map.on("zoomend", () => layer._update());

    return () => {
      map.removeLayer(layer);
      map.off("moveend");
      map.off("zoomend");
    };
  }, [map, draw]);

  // Redraw when filters change
  useEffect(() => {
    if (canvasRef.current) {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => draw());
    }
  }, [visibleSports, draw]);

  return null;
}

export default function LeafletMapInner({ activities }: { activities: Activity[] }) {
  const [visibleSports, setVisibleSports] = useState<Record<string, boolean>>({
    Run: true, Ride: true, Hike: true, Swim: true,
  });

  const filteredActivities = activities.filter((a) =>
    !a.is_manual && !a.is_indoor && a.stream && a.stream.length > 0
  );

  const pointCount = filteredActivities.reduce((s, a) => s + (a.stream?.length || 0), 0);

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
          {filteredActivities.length} activities · {pointCount.toLocaleString()} pts
        </span>
      </div>
      {filteredActivities.length > 0 ? (
        <div className="h-[500px] rounded-lg overflow-hidden relative">
          <MapContainer
            center={[-27.5, 153]}
            zoom={5}
            style={{ height: "100%", width: "100%", background: "#0a0a1a" }}
            zoomControl={true}
            scrollWheelZoom={true}
            attributionControl={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <HeatmapLayer activities={filteredActivities} visibleSports={visibleSports} />
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
