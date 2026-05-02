"use client";

import { useMemo } from "react";
import type { Activity } from "@/lib/data";

export default function RacePredictor({ activities }: { activities: Activity[] }) {
  const predictions = useMemo(() => {
    const runs = activities.filter((a) => a.sport === "Run" && a.best_efforts);
    if (runs.length === 0) return null;

    // Find best recent 5km and 10km
    const best = { km5: null as any, km10: null as any };
    const now = new Date().getTime();

    for (const a of runs) {
      if (!a.best_efforts || !a.start_time_utc) continue;
      const ts = new Date(a.start_time_utc).getTime();
      const daysAgo = (now - ts) / 86400000;
      if (daysAgo > 90) continue;

      const be5 = a.best_efforts["5000m"] as any;
      if (be5 && be5.time_s && (!best.km5 || be5.time_s < best.km5.time_s)) {
        best.km5 = { time: be5.time_s, name: a.name, date: a.start_time_utc };
      }
      const be10 = a.best_efforts["10000m"] as any;
      if (be10 && be10.time_s && (!best.km10 || be10.time_s < best.km10.time_s)) {
        best.km10 = { time: be10.time_s, name: a.name, date: a.start_time_utc };
      }
    }

    if (!best.km5 && !best.km10) return null;

    const ref = best.km5 || best.km10;
    const refDist = best.km5 ? 5000 : 10000;
    const refTime = ref.time;

    // Riegel: T2 = T1 * (D2/D1)^1.06
    const predict = (dist: number) => refTime * Math.pow(dist / refDist, 1.06);
    const targets = [
      { label: "5 km", dist: 5000, hide: !!best.km5 },
      { label: "10 km", dist: 10000, hide: !!best.km10 },
      { label: "Half Marathon", dist: 21097 },
      { label: "Marathon", dist: 42195 },
    ];

    return { ref, targets, predictions: targets.filter((t) => !t.hide).map((t) => ({ ...t, time: predict(t.dist) })) };
  }, [activities]);

  if (!predictions) return null;

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
      <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Race Time Predictor (Riegel)</h3>
      <p className="text-[10px] text-gray-500 mb-4">
        Based on your {predictions.ref.km5 ? `best 5km (${formatTime(predictions.ref.time)})` : `best 10km (${formatTime(predictions.ref.time)})`} set {predictions.ref.km5 ? "recently" : "recently"}. Assumes equivalent conditions and adequate training volume. Predictions for distances much longer than you&apos;ve trained are aspirational.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {predictions.predictions.map((p) => (
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
