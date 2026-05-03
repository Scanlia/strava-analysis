"use client";

import dynamic from "next/dynamic";

const MapLibreMap = dynamic(() => import("./MapLibreInner"), {
  ssr: false,
  loading: () => (
    <div className="h-[550px] bg-[#141420] rounded-xl flex items-center justify-center">
      <p className="text-gray-500">Loading map...</p>
    </div>
  ),
});

export default function GPSHeatmap() {
  return <MapLibreMap />;
}
