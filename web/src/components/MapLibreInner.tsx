"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const SPORT_COLORS: Record<string, string> = { Run: "#ff6b35", Ride: "#3da5d9", Swim: "#00d4d4", Hike: "#7fb069" };
const SPORT_LABELS: Record<string, string> = { Run: "Run", Ride: "Ride", Hike: "Hike", Swim: "Swim" };
const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

const TILE_BASE = "/data/tiles";
const TRACKS_URL = "/data/heatmap/tracks_detailed.geojson";

interface Manifest {
  activity_count: number;
  bbox: number[];
  feature_counts: Record<string, number>;
}

export default function MapLibreInner() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const manifestRef = useRef<Manifest | null>(null);

  const [sportFilter, setSportFilter] = useState<string>("all");
  const [yearRange, setYearRange] = useState<[number, number]>([2019, 2026]);

  const activeTileSet = sportFilter === "all" ? "all" : `sport/${sportFilter.toLowerCase()}`;

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
          // Fetch old manifest for bounds
          const mResp = await fetch("/data/heatmap/manifest.json");
          if (mResp.ok) {
            const manifest: Manifest = await mResp.json();
            manifestRef.current = manifest;
            if (manifest.bbox && manifest.bbox.length === 4) {
              const [minLng, minLat, maxLng, maxLat] = manifest.bbox;
              map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 50, maxZoom: 10, animate: false });
            }
          }

          // Add raster tile source (V3 heatmap)
          map.addSource("heatmap", {
            type: "raster",
            tiles: [`${TILE_BASE}/all/{z}/{x}/{y}.png`],
            tileSize: 256,
            minzoom: 2,
            maxzoom: 16,
          });

          map.addLayer({
            id: "heatmap-layer",
            type: "raster",
            source: "heatmap",
            paint: {
              "raster-opacity": 0.92,
              "raster-fade-duration": 100,
            },
          });

          // Add invisible vector layer for hit-testing (click/hover)
          map.addSource("tracks", {
            type: "geojson",
            data: TRACKS_URL,
          });

          map.addLayer({
            id: "tracks-hit",
            type: "line",
            source: "tracks",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": "#ffffff",
              "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 14, 8, 18, 12],
              "line-opacity": 0, // invisible
            },
          });

          // Highlight layer (for hovered track)
          map.addLayer({
            id: "tracks-highlight",
            type: "line",
            source: "tracks",
            filter: ["==", "id", ""],
            paint: {
              "line-color": "#ffffff",
              "line-width": 5,
              "line-opacity": 0.9,
              "line-blur": 0,
            },
          });

          setLoaded(true);
        } catch (err) {
          console.error("Map init error:", err);
          setMapError("Failed to load heatmap data");
        }
      });

      // Click handler on invisible hit-test layer
      map.on("click", "tracks-hit", (e) => {
        const features = e.features;
        if (!features || features.length === 0) return;
        const props = features[0].properties;
        if (!props) return;

        const aid = String(props.id);
        map.setFilter("tracks-highlight", ["==", "id", aid]);

        if (popupRef.current) popupRef.current.remove();

        const lines = [
          `<strong>${props.sp || "Activity"}</strong>`,
          `ID: ${aid}`,
        ];

        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "300px" })
          .setLngLat(e.lngLat)
          .setHTML(lines.join("<br>"))
          .addTo(map);
      });

      map.on("mouseenter", "tracks-hit", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "tracks-hit", () => {
        map.getCanvas().style.cursor = "";
        map.setFilter("tracks-highlight", ["==", "id", ""]);
        if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
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

  // Switch tile source when sport filter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const src = map.getSource("heatmap") as maplibregl.RasterTileSource;
    if (src && "setTiles" in src) {
      src.setTiles([`${TILE_BASE}/${activeTileSet}/{z}/{x}/{y}.png`]);
    }
  }, [sportFilter, loaded]);

  // Apply year filter to hit-test layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (map.getLayer("tracks-hit")) {
      map.setFilter("tracks-hit", [
        "all",
        [">=", ["get", "y"], yearRange[0]],
        ["<=", ["get", "y"], yearRange[1]],
      ]);
    }
  }, [yearRange, loaded]);

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
        <label
          className={`text-[11px] cursor-pointer select-none px-2 py-0.5 rounded ${sportFilter === "all" ? "bg-[#2a2a3e] text-white" : "text-gray-400 hover:text-gray-200"}`}
          onClick={() => setSportFilter("all")}
        >
          All
        </label>
        {Object.entries(SPORT_COLORS).map(([sport, color]) => (
          <label
            key={sport}
            className={`text-[11px] cursor-pointer select-none px-2 py-0.5 rounded ${sportFilter === sport ? "bg-[#2a2a3e] text-white" : "text-gray-400 hover:text-gray-200"}`}
            style={sportFilter === sport ? { backgroundColor: color + "30", color } : {}}
            onClick={() => setSportFilter(sportFilter === sport ? "all" : sport)}
          >
            {SPORT_LABELS[sport]}
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
              <p className="text-xs text-gray-400">Loading heatmap V3...</p>
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
        Raster heatmap &middot; Blue→Cyan→Yellow→Red = rare→frequent &middot; Click tracks for details
      </div>
    </div>
  );
}
