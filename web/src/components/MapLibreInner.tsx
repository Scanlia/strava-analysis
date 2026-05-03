"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { Activity } from "@/lib/data";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const SPORT_COLORS: Record<string, string> = {
  Run: "#ff6b35",
  Ride: "#3da5d9",
  Swim: "#00d4d4",
  Hike: "#7fb069",
};

const SPORT_LABELS: Record<string, string> = {
  Run: "Run",
  Ride: "Ride",
  Hike: "Hike",
  Swim: "Swim",
};

const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

const HEATMAP_URL = "/data/heatmap/tracks_density.geojson";
const TRACKS_URL = "/data/heatmap/tracks_detailed.geojson";
const MANIFEST_URL = "/data/heatmap/manifest.json";

interface Manifest {
  activity_count: number;
  bbox: number[];
}

function formatKm(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

function fmtSec(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function MapLibreInner({ activities }: { activities: Activity[] }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // Filters
  const [visibleSports, setVisibleSports] = useState<Record<string, boolean>>({
    Run: true, Ride: true, Swim: true, Hike: true,
  });
  const [yearRange, setYearRange] = useState<[number, number]>([2019, 2026]);
  const [fadeOld, setFadeOld] = useState(true);

  // Stats
  const gpsActivities = activities.filter((a) => !a.is_manual && !a.is_indoor && (a.stream?.length ?? 0) > 0);

  // Build activity lookup from activities prop
  const activityLookup = useRef<Map<string, Activity>>(new Map());
  useEffect(() => {
    const m = new Map<string, Activity>();
    for (const a of activities) {
      if (a.id) m.set(String(a.id), a);
    }
    activityLookup.current = m;
  }, [activities]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    try {
      const map = new maplibregl.Map({
        container: mapContainer.current,
        style: DARK_STYLE,
        center: [0, 0],
        zoom: 1.5,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        "bottom-right"
      );

      mapRef.current = map;

      map.on("load", async () => {
        try {
          // Fit bounds from manifest
          const manifestResp = await fetch(MANIFEST_URL);
          if (manifestResp.ok) {
            const manifest: Manifest = await manifestResp.json();
            if (manifest.bbox && manifest.bbox.length === 4) {
              const [minLng, minLat, maxLng, maxLat] = manifest.bbox;
              map.fitBounds(
                [
                  [minLng, minLat],
                  [maxLng, maxLat],
                ],
                { padding: 50, maxZoom: 10, animate: false }
              );
            }
          }

          // Add heatmap density source & layer
          map.addSource("density", {
            type: "geojson",
            data: HEATMAP_URL,
          });

          map.addLayer({
            id: "activity-heatmap",
            type: "heatmap",
            source: "density",
            maxzoom: 13,
            paint: {
              "heatmap-weight": [
                "interpolate", ["linear"], ["zoom"],
                0, 0.5,
                9, 1.0,
              ],
              "heatmap-intensity": [
                "interpolate", ["linear"], ["zoom"],
                0, 1,
                9, 2,
                13, 3,
              ],
              "heatmap-color": [
                "interpolate", ["linear"], ["heatmap-density"],
                0, "rgba(0, 0, 0, 0)",
                0.1, "rgba(0, 50, 200, 0.5)",
                0.3, "rgba(0, 150, 255, 0.7)",
                0.5, "rgba(0, 255, 200, 0.85)",
                0.7, "rgba(255, 220, 0, 0.95)",
                1.0, "rgba(255, 50, 0, 1)",
              ],
              "heatmap-radius": [
                "interpolate", ["linear"], ["zoom"],
                0, 2,
                6, 8,
                9, 15,
                13, 25,
              ],
              "heatmap-opacity": [
                "interpolate", ["linear"], ["zoom"],
                11, 1,
                13, 0,
              ],
            },
          });

          // Add track polylines source & layer
          map.addSource("tracks", {
            type: "geojson",
            data: TRACKS_URL,
          });

          map.addLayer({
            id: "activity-tracks",
            type: "line",
            source: "tracks",
            minzoom: 11,
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": [
                "match",
                ["get", "sp"],
                "Run", SPORT_COLORS["Run"],
                "Ride", SPORT_COLORS["Ride"],
                "Swim", SPORT_COLORS["Swim"],
                "Hike", SPORT_COLORS["Hike"],
                "#ffffff",
              ],
              "line-width": [
                "interpolate", ["linear"], ["zoom"],
                11, 1,
                14, 2,
                18, 4,
              ],
              "line-opacity": [
                "interpolate", ["linear"], ["zoom"],
                11, 0,
                13, 0.15,
                18, 0.35,
              ],
              "line-blur": 0.5,
            },
          });

          // Highlight layer
          map.addLayer({
            id: "activity-highlight",
            type: "line",
            source: "tracks",
            filter: ["==", "id", ""],
            paint: {
              "line-color": "#ffffff",
              "line-width": 4,
              "line-opacity": 1,
              "line-blur": 0,
            },
          });

          setLoaded(true);
        } catch (err) {
          console.error("Failed to load GeoJSON:", err);
          setMapError("Failed to load track data");
        }
      });

      // Click handler
      map.on("click", "activity-tracks", (e) => {
        const features = e.features;
        if (!features || features.length === 0) return;
        const props = features[0].properties;
        if (!props) return;

        const aid = String(props.id);
        const act = activityLookup.current.get(aid);

        // Highlight the clicked track
        map.setFilter("activity-highlight", ["==", "id", aid]);

        if (popupRef.current) popupRef.current.remove();

        const coords = e.lngLat;
        const lines = [];
        if (act) {
          lines.push(`<strong>${act.name}</strong>`);
          lines.push(`Sport: ${act.sport} · ${act.start_time_local?.slice(0, 10) || ""}`);
          lines.push(`Distance: ${formatKm(act.distance_m)}`);
          lines.push(`Time: ${fmtSec(act.moving_time_sec)}`);
        } else {
          lines.push(`<strong>${props.name || "Activity"}</strong>`);
          lines.push(`Sport: ${props.sp}`);
        }

        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "300px" })
          .setLngLat(coords)
          .setHTML(lines.join("<br>"))
          .addTo(map);
      });

      map.on("mouseenter", "activity-tracks", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "activity-tracks", () => {
        map.getCanvas().style.cursor = "";
        map.setFilter("activity-highlight", ["==", "id", ""]);
        if (popupRef.current) {
          popupRef.current.remove();
          popupRef.current = null;
        }
      });

    } catch (err) {
      console.error("Map init error:", err);
      setMapError("Failed to initialize map");
    }

    return () => {
      if (popupRef.current) popupRef.current.remove();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Apply sport filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const activeSports = Object.entries(visibleSports)
      .filter(([, v]) => v)
      .map(([k]) => k);

    const parts: any[] = ["all"];

    if (activeSports.length < 4) {
      const sportParts: any[] = ["any"];
      for (const s of activeSports) {
        sportParts.push(["==", ["get", "sp"], s]);
      }
      parts.push(sportParts);
    }

    parts.push([">=", ["get", "y"], yearRange[0]]);
    parts.push(["<=", ["get", "y"], yearRange[1]]);

    if (map.getLayer("activity-tracks")) {
      map.setFilter("activity-tracks", parts);
    }
  }, [visibleSports, yearRange, loaded]);

  // "Home" / fit-to-bounds button
  const fitBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    fetch(MANIFEST_URL)
      .then((r) => r.json())
      .then((m: Manifest) => {
        if (m.bbox && m.bbox.length === 4) {
          const [minLng, minLat, maxLng, maxLat] = m.bbox;
          map.fitBounds(
            [
              [minLng, minLat],
              [maxLng, maxLat],
            ],
            { padding: 50, maxZoom: 10 }
          );
        }
      })
      .catch(() => {});
  }, []);

  if (gpsActivities.length === 0) {
    return (
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <div className="h-[500px] bg-[#1a1a2e] rounded-lg flex items-center justify-center">
          <p className="text-gray-500">No GPS activities to display</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {Object.entries(SPORT_COLORS).map(([sport, color]) => (
          <label
            key={sport}
            className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none"
          >
            <input
              type="checkbox"
              checked={visibleSports[sport] ?? true}
              onChange={() =>
                setVisibleSports((v) => ({ ...v, [sport]: !v[sport] }))
              }
              style={{ accentColor: color }}
              className="accent-current"
            />
            <span style={{ color }}>{SPORT_LABELS[sport]}</span>
          </label>
        ))}
        <span className="text-gray-600">|</span>
        <select
          value={yearRange[0]}
          onChange={(e) => setYearRange([Number(e.target.value), yearRange[1]])}
          className="bg-[#1a1a2e] border border-[#2a2a3a] rounded text-[11px] text-gray-300 px-2 py-0.5"
        >
          {[2019,2020,2021,2022,2023,2024,2025,2026].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span className="text-gray-500 text-[11px]">–</span>
        <select
          value={yearRange[1]}
          onChange={(e) => setYearRange([yearRange[0], Number(e.target.value)])}
          className="bg-[#1a1a2e] border border-[#2a2a3a] rounded text-[11px] text-gray-300 px-2 py-0.5"
        >
          {[2019,2020,2021,2022,2023,2024,2025,2026].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button
          onClick={fitBounds}
          className="text-[11px] text-gray-400 hover:text-gray-200 bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-0.5"
        >
          Fit All
        </button>
        <span className="text-[10px] text-gray-500 ml-auto">
          {gpsActivities.length} activities
        </span>
      </div>

      {/* Map */}
      <div className="relative h-[550px] rounded-lg overflow-hidden">
        <div ref={mapContainer} className="w-full h-full" style={{ background: "#0a0a1a" }} />

        {/* Loading overlay */}
        {!loaded && !mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a1a]/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-400">Loading heatmap...</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a1a] z-10">
            <p className="text-red-400 text-sm">{mapError}</p>
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="mt-2 text-[10px] text-gray-500 text-right">
        Blue→Cyan→Yellow→Red = low→high density &middot; Zoom in for individual tracks
      </div>
    </div>
  );
}
