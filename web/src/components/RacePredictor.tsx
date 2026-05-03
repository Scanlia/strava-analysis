"use client";

import { useMemo } from "react";
import type { Activity } from "@/lib/data";

export default function RacePredictor({ activities }: { activities: Activity[] }) {
  const predictions = useMemo(() => {
    const runs = activities.filter((a) => a.sport === "Run" && a.best_efforts);
    if (runs.length === 0) return { error: true };

    // Find best 5km and 10km — prefer last 90 days, fall back to all-time
    const now = Date.now();
    const best = { km5: null as any, km10: null as any, km5Recent: null as any, km10Recent: null as any };

    for (const a of runs) {
      if (!a.best_efforts || !a.start_time_utc) continue;
      const ts = new Date(a.start_time_utc).getTime();
      const daysAgo = (now - ts) / 86400000;

      const be5 = a.best_efforts["5000m"] as any;
      if (be5 && be5.time_s) {
        const entry = { time: be5.time_s, name: a.name, date: a.start_time_utc, daysAgo: Math.round(daysAgo) };
        if (!best.km5 || be5.time_s < best.km5.time) best.km5 = entry;
        if (daysAgo <= 90 && (!best.km5Recent || be5.time_s < best.km5Recent.time)) best.km5Recent = entry;
      }

      const be10 = a.best_efforts["10000m"] as any;
      if (be10 && be10.time_s) {
        const entry = { time: be10.time_s, name: a.name, date: a.start_time_utc, daysAgo: Math.round(daysAgo) };
        if (!best.km10 || be10.time_s < best.km10.time) best.km10 = entry;
        if (daysAgo <= 90 && (!best.km10Recent || be10.time_s < best.km10.time)) best.km10Recent = entry;
      }
    }

    if (!best.km5 && !best.km10) return { error: true };

    // Prefer recent, fall back to all-time
    const useRecent = !!(best.km5Recent || best.km10Recent);
    const ref = best.km5Recent || best.km10Recent || best.km5 || best.km10;
    const refDist = (best.km5Recent || best.km5) ? 5000 : 10000;
    const staleDays = ref.daysAgo;

    // Riegel: T2 = T1 * (D2/D1)^1.06
    const predict = (dist: number) => ref.time * Math.pow(dist / refDist, 1.06);
    const targets = [
      { label: "5 km", dist: 5000, hide: !!best.km5Recent || !!best.km5 },
      { label: "10 km", dist: 10000, hide: !!best.km10Recent || !!best.km10 },
      { label: "Half Marathon", dist: 21097 },
      { label: "Marathon", dist: 42195 },
    ];

    return { ref, refDist, useRecent, staleDays, predictions: targets.filter((t) => !t.hide).map((t) => ({ ...t, time: predict(t.dist) })) };
  }, [activities]);

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  if ("error" in predictions && predictions.error) {
    return (
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Race Time Predictor (Riegel)</h3>
        <div className="flex items-center justify-center h-[120px] text-gray-500 text-sm">
          No qualifying 5km or 10km best effort found. Complete a run of at least 6.5km with GPS to generate predictions.
        </div>
      </div>
    );
  }

  const { ref, refDist, useRecent, staleDays, predictions: preds } = predictions as any;

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
      <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Race Time Predictor (Riegel)</h3>
      <p className="text-[10px] text-gray-500 mb-4">
        Based on your {refDist === 5000 ? "5km" : "10km"} best of {formatTime(ref.time)}
        {ref.date ? ` (set ${new Date(ref.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})` : ""}.
        {!useRecent && staleDays > 90 ? ` Reference is ${staleDays} days old — predictions may not reflect current fitness.` : ""}
        {" "}Assumes equivalent conditions and adequate training volume. Distances beyond what you&apos;ve trained are aspirational.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {preds.map((p: any) => (
          <div key={p.label} className="bg-[#1a1a2e] rounded-lg p-3 text-center border border-[#2a2a3a]">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">{p.label}</div>
            <div className="text-lg font-bold text-gray-200 mt-1">{formatTime(p.time)}</div>
            <div className="text-[10px] text-gray-600 mt-0.5">
              {(p.time / 60 / (p.dist / 1000)).toFixed(2)} min/km
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-600 mt-3">
        Riegel formula: T₂ = T₁ × (D₂/D₁)^1.06. Only predicts within current fitness — longer distances require specific training.
      </p>
    </div>
  );
}
