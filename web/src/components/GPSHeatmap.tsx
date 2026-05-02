"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { Activity } from "@/lib/data";

// Dynamically import leaflet components to avoid SSR issues
const LeafletMap = dynamic(
  () => import("./LeafletMapInner"),
  { ssr: false, loading: () => <div className="h-[500px] bg-[#141420] rounded-xl flex items-center justify-center"><p className="text-gray-500">Loading map...</p></div> }
);

export default function GPSHeatmap({ activities }: { activities: Activity[] }) {
  return <LeafletMap activities={activities} />;
}
