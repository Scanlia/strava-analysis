"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { Activity } from "@/lib/data";

const MapLibreMap = dynamic(() => import("./MapLibreInner"), {
  ssr: false,
  loading: () => (
    <div className="h-[550px] bg-[#141420] rounded-xl flex items-center justify-center">
      <p className="text-gray-500">Loading map...</p>
    </div>
  ),
});

export default function GPSHeatmap({ activities }: { activities: Activity[] }) {
  return <MapLibreMap activities={activities} />;
}
