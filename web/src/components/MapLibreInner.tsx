"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const RESOLUTIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

const ZOOM_TO_RES: { zoomMin: number; zoomMax: number; primary: number; blend: number }[] = [
  { zoomMin: 0, zoomMax: 2, primary: 3, blend: -1 },
  { zoomMin: 3, zoomMax: 3, primary: 4, blend: 3 },
  { zoomMin: 4, zoomMax: 5, primary: 5, blend: 4 },
  { zoomMin: 6, zoomMax: 6, primary: 6, blend: 5 },
  { zoomMin: 7, zoomMax: 8, primary: 7, blend: 6 },
  { zoomMin: 9, zoomMax: 9, primary: 8, blend: 7 },
  { zoomMin: 10, zoomMax: 11, primary: 9, blend: 8 },
  { zoomMin: 12, zoomMax: 12, primary: 10, blend: 9 },
  { zoomMin: 13, zoomMax: 14, primary: 11, blend: 10 },
  { zoomMin: 15, zoomMax: 15, primary: 12, blend: 11 },
  { zoomMin: 16, zoomMax: 22, primary: 13, blend: 12 },
];

const RADIUS: Record<number, number> = { 3: 18, 4: 16, 5: 14, 6: 12, 7: 10, 8: 9, 9: 8, 10: 7, 11: 6, 12: 5, 13: 4 };

const SPORT_COLORS: Record<string, string> = { Run: "#ff6b35", Ride: "#3da5d9", Swim: "#00d4d4", Hike: "#7fb069" };
const SPORT_LABELS: Record<string, string> = { Run: "Run", Ride: "Ride", Hike: "Hike", Swim: "Swim" };

const SPORT_KEY: Record<string, string> = { Run: "sr", Ride: "sd", Swim: "sw", Hike: "sh" };

const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

interface Manifest {
  activity_count: number;
  bbox: number[];
  percentiles: Record<string, number>;
  feature_counts: Record<string, number>;
}

export default function MapLibreInner() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const loadedResolutions = useRef(new Set<number>());
  const manifestRef = useRef<Manifest | null>(null);

  // Filters
  const [visibleSports, setVisibleSports] = useState<Record<string, boolean>>({ Run: true, Ride: true, Swim: true, Hike: true });
  const [yearRange, setYearRange] = useState<[number, number]>([2019, 2026]);

  // Layer ID helpers
  const layerId = (res: number) => `h3-circle-r${res}`;
  const sourceId = (res: number) => `h3-src-r${res}`;

  // Fetch a resolution GeoJSON and add it to the map
  const loadResolution = useCallback(
    (res: number) => {
      const map = mapRef.current;
      if (!map || loadedResolutions.current.has(res)) return;

      const fname = `h3_res${String(res).padStart(2, "0")}.geojson`;
      const src = sourceId(res);
      const lyr = layerId(res);

      // Find zoom range for this resolution
      const entry = ZOOM_TO_RES.find((e) => e.primary === res);
      if (!entry) return;
      const zoomFadeIn = entry.zoomMin - 1;
      const zoomFadeOut = entry.zoomMax + 1;
      const r = RADIUS[res] || 6;

      const pcts = manifestRef.current?.percentiles || { p90: 2, p95: 3, p99: 10 };

      map.addSource(src, {
        type: "geojson",
        data: `/data/heatmap/${fname}`,
      });

      // Build radius/opacity interpolations avoiding duplicate input values
      // when zoomMin === zoomMax (single-zoom resolutions like res 4 at z3 only)
      const radiusStops: any[] = ["interpolate", ["linear"], ["zoom"], zoomFadeIn, r * 0.7];
      const opacityStops: any[] = ["interpolate", ["linear"], ["zoom"], zoomFadeIn, 0];
      if (entry.zoomMin !== entry.zoomMax) {
        radiusStops.push(entry.zoomMin, r, entry.zoomMax, r * 1.2);
        opacityStops.push(entry.zoomMin, 0.7, entry.zoomMax, 0.7);
      } else {
        radiusStops.push(entry.zoomMin, r);
        opacityStops.push(entry.zoomMin, 0.7);
      }
      radiusStops.push(zoomFadeOut, r * 1.4);
      opacityStops.push(zoomFadeOut, 0);

      map.addLayer({
        id: lyr,
        type: "circle",
        source: src,
        paint: {
          "circle-radius": radiusStops,
          "circle-color": [
            "interpolate", ["linear"], ["get", "n"],
            1, "#1a3a8c",
            Math.max(1, Math.round(pcts.p90 || 2)), "#2563eb",
            Math.max(2, Math.round(pcts.p95 || 3)), "#06b6d4",
            Math.round((pcts.p99 || 10) * 0.5) || 5, "#fde047",
            Math.round(pcts.p99 || 10), "#f97316",
            Math.round((pcts.p99 || 10) * 3) || 30, "#dc2626",
          ],
          "circle-opacity": opacityStops,
          "circle-blur": 0.3,
          "circle-stroke-width": 0,
        },
      });

      loadedResolutions.current.add(res);

      // Apply current filters to the new layer
      if (!map.getLayer(lyr)) return; // layer failed to add (e.g. bad paint spec)
      const activeSports = Object.entries(visibleSports)
        .filter(([, v]) => v)
        .map(([k]) => k);
      const parts: any[] = [];
      if (activeSports.length > 0 && activeSports.length < 4) {
        const orParts: any[] = ["any"];
        for (const s of activeSports) {
          orParts.push([">", ["get", SPORT_KEY[s]], 0]);
        }
        parts.push(orParts);
      }
      parts.push([">=", ["get", "ymax"], yearRange[0]]);
      parts.push(["<=", ["get", "ymin"], yearRange[1]]);
      if (parts.length > 0) {
        map.setFilter(lyr, ["all", ...parts]);
      }
    },
    [visibleSports, yearRange]
  );

  // Update sport/year filters on all loaded layers
  const applyFilters = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const res of loadedResolutions.current) {
      const lyr = layerId(res);
      if (!map.getLayer(lyr)) continue;

      const activeSports = Object.entries(visibleSports)
        .filter(([, v]) => v)
        .map(([k]) => k);

      const parts: any[] = [];

      // Sport filter
      if (activeSports.length > 0 && activeSports.length < 4) {
        const orParts: any[] = ["any"];
        for (const s of activeSports) {
          orParts.push([">", ["get", SPORT_KEY[s]], 0]);
        }
        parts.push(orParts);
      }

      // Year filter: cell overlaps with selected range
      parts.push([">=", ["get", "ymax"], yearRange[0]]);
      parts.push(["<=", ["get", "ymin"], yearRange[1]]);

      if (parts.length > 0) {
        map.setFilter(lyr, ["all", ...parts]);
      } else {
        map.setFilter(lyr, null);
      }
    }
  }, [visibleSports, yearRange]);

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
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      map.scrollZoom.setZoomRate(1 / 200);

      mapRef.current = map;

      map.on("load", async () => {
        try {
          // Fetch manifest
          const mResp = await fetch("/data/heatmap/manifest.json");
          if (!mResp.ok) throw new Error("Failed to fetch manifest");
          const manifest: Manifest = await mResp.json();
          manifestRef.current = manifest;

          // Fit bounds
          if (manifest.bbox && manifest.bbox.length === 4) {
            const [minLng, minLat, maxLng, maxLat] = manifest.bbox;
            map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 50, maxZoom: 10, animate: false });
          }

          // Load initial resolutions based on current zoom
          const z = Math.floor(map.getZoom());
          const needed = resolutionsNeededAtZoom(z);
          for (const r of needed) loadResolution(r);

          setLoaded(true);
        } catch (err) {
          console.error("Map init error:", err);
          setMapError("Failed to load heatmap data");
        }
      });

      // Lazy-load resolutions as user zooms
      map.on("zoom", () => {
        const z = Math.floor(map.getZoom());
        const needed = resolutionsNeededAtZoom(z);
        for (const r of needed) {
          if (!loadedResolutions.current.has(r)) loadResolution(r);
        }
      });

      // Click handler — query all circle layers
      map.on("click", (e) => {
        const allLayers = RESOLUTIONS.map(layerId).filter((id) => map.getLayer(id));
        if (!allLayers.length) return;
        const features = map.queryRenderedFeatures(e.point, { layers: allLayers });
        if (!features.length) return;
        const props = features[0].properties;
        if (!props) return;

        const n = props.n || 0;
        const sr = props.sr || 0;
        const sd = props.sd || 0;
        const sw = props.sw || 0;
        const sh = props.sh || 0;

        if (popupRef.current) popupRef.current.remove();

        const lines = [`<strong>Activities: ${n}</strong>`];
        if (sr) lines.push(`Run: ${sr}`);
        if (sd) lines.push(`Ride: ${sd}`);
        if (sw) lines.push(`Swim: ${sw}`);
        if (sh) lines.push(`Hike: ${sh}`);
        if (props.f) lines.push(`First: ${String(props.f).slice(0, 10)}`);
        if (props.l) lines.push(`Last: ${String(props.l).slice(0, 10)}`);

        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "250px" })
          .setLngLat(e.lngLat)
          .setHTML(lines.join("<br>"))
          .addTo(map);
      });

      // Hover cursor over any h3 circle
      map.on("mousemove", (e) => {
        const allLayers = RESOLUTIONS.map(layerId).filter((id) => map.getLayer(id));
        const features = allLayers.length ? map.queryRenderedFeatures(e.point, { layers: allLayers }) : [];
        map.getCanvas().style.cursor = features.length > 0 && allLayers.length > 0 ? "pointer" : "";
      });
    } catch (err) {
      console.error("Map init error:", err);
      setMapError("Failed to initialize map");
    }

    return () => {
      if (popupRef.current) popupRef.current.remove();
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  // Re-apply filters when sport/year selection changes
  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  // "Fit All" button handler
  const fitBounds = useCallback(() => {
    const map = mapRef.current;
    const m = manifestRef.current;
    if (!map || !m?.bbox) return;
    const [minLng, minLat, maxLng, maxLat] = m.bbox;
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 50, maxZoom: 10 });
  }, []);

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {Object.entries(SPORT_COLORS).map(([sport, color]) => (
          <label key={sport} className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={visibleSports[sport] ?? true}
              onChange={() => setVisibleSports((v) => ({ ...v, [sport]: !v[sport] }))}
              style={{ accentColor: color }}
            />
            <span style={{ color }}>{SPORT_LABELS[sport]}</span>
          </label>
        ))}
        <span className="text-gray-600">|</span>
        <select value={yearRange[0]} onChange={(e) => setYearRange([Number(e.target.value), yearRange[1]])} className="bg-[#1a1a2e] border border-[#2a2a3a] rounded text-[11px] text-gray-300 px-2 py-0.5">
          {[2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => (<option key={y} value={y}>{y}</option>))}
        </select>
        <span className="text-gray-500 text-[11px]">-</span>
        <select value={yearRange[1]} onChange={(e) => setYearRange([yearRange[0], Number(e.target.value)])} className="bg-[#1a1a2e] border border-[#2a2a3a] rounded text-[11px] text-gray-300 px-2 py-0.5">
          {[2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => (<option key={y} value={y}>{y}</option>))}
        </select>
        <button onClick={fitBounds} className="text-[11px] text-gray-400 hover:text-gray-200 bg-[#1a1a2e] border border-[#2a2a3a] rounded px-2 py-0.5">Fit All</button>
        <span className="text-[10px] text-gray-500 ml-auto">{manifestRef.current?.activity_count ?? 0} activities</span>
      </div>

      {/* Map */}
      <div className="relative h-[550px] rounded-lg overflow-hidden">
        <div ref={mapContainer} className="w-full h-full" style={{ background: "#0a0a1a" }} />

        {!loaded && !mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a1a]/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-400">Loading heatmap V2...</p>
            </div>
          </div>
        )}

        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a1a] z-10">
            <p className="text-red-400 text-sm">{mapError}</p>
          </div>
        )}
      </div>

      <div className="mt-2 text-[10px] text-gray-500 text-right">
        H3 hexbin heatmap &middot; Blue→Cyan→Yellow→Red = rare→frequent &middot; Click cells for details
      </div>
    </div>
  );
}

function resolutionsNeededAtZoom(z: number): number[] {
  const needed = new Set<number>();
  for (const entry of ZOOM_TO_RES) {
    if (z >= entry.zoomMin - 1 && z <= entry.zoomMax + 1) {
      needed.add(entry.primary);
      if (entry.blend > 0) needed.add(entry.blend);
    }
  }
  return Array.from(needed).sort((a, b) => a - b);
}
