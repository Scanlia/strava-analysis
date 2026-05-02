"use client";

import type { Activity } from "@/lib/data";
import { useState } from "react";

const PER_PAGE = 25;
const SPORTS = ["All", "Run", "Ride", "Swim", "Hike"];
const SPORT_COLORS: Record<string, string> = { Run: "bg-red-500/20 text-red-400", Ride: "bg-teal-500/20 text-teal-400", Swim: "bg-sky-500/20 text-sky-400", Hike: "bg-green-500/20 text-green-400" };

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtKm(m: number) { return (m / 1000).toFixed(1) + " km"; }
function fmtHrs(s: number) {
  if (s < 3600) return (s / 60).toFixed(1) + " min";
  return (s / 3600).toFixed(1) + " hrs";
}
function fmtPace(mps: number) {
  if (!mps || mps === 0) return "—";
  const mpk = 1000 / mps / 60;
  return Math.floor(mpk) + ":" + String(Math.round((mpk - Math.floor(mpk)) * 60)).padStart(2, "0") + " /km";
}
function fmtSpeed(mps: number) {
  if (!mps || mps === 0) return "—";
  return (mps * 3.6).toFixed(1) + " km/h";
}

export default function ActivityTable({ activities }: { activities: Activity[] }) {
  const [filter, setFilter] = useState("All");
  const [page, setPage] = useState(0);

  const filtered = filter === "All" ? activities : activities.filter((a) => a.sport === filter);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const currentPage = Math.min(page, Math.max(0, totalPages - 1));
  const pageActs = filtered.slice(currentPage * PER_PAGE, (currentPage + 1) * PER_PAGE);

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {SPORTS.map((s) => (
          <button
            key={s}
            onClick={() => { setFilter(s); setPage(0); }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              filter === s ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border border-white/10"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-gray-500 uppercase bg-white/[0.02]">
              <th className="text-left p-2.5">Date</th>
              <th className="text-left p-2.5">Sport</th>
              <th className="text-left p-2.5">Name</th>
              <th className="text-left p-2.5">Distance</th>
              <th className="text-left p-2.5">Time</th>
              <th className="text-left p-2.5">Elev.</th>
              <th className="text-left p-2.5">Avg HR</th>
              <th className="text-left p-2.5">EF</th>
              <th className="text-left p-2.5">Pace/Speed</th>
            </tr>
          </thead>
          <tbody>
            {pageActs.map((a) => (
              <tr key={a.id} className="border-t border-[#2a2a3a55] hover:bg-white/[0.03]">
                <td className="p-2.5 whitespace-nowrap">{fmtDate(a.start_time_utc)}</td>
                <td className="p-2.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SPORT_COLORS[a.sport] || "bg-white/10 text-gray-400"}`}>{a.sport}</span>
                </td>
                <td className="p-2.5 max-w-40 truncate">{a.name}</td>
                <td className="p-2.5">{fmtKm(a.distance_m)}</td>
                <td className="p-2.5">{fmtHrs(a.moving_time_sec)}</td>
                <td className="p-2.5">{(a.elevation_gain_m || 0).toFixed(0)} m</td>
                <td className="p-2.5">{a.avg_hr > 0 ? a.avg_hr : "—"}</td>
                <td className="p-2.5">{a.efficiency_factor ? a.efficiency_factor.toFixed(2) : "—"}</td>
                <td className="p-2.5">{a.sport === "Run" ? fmtPace(a.avg_speed) : fmtSpeed(a.avg_speed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-3 mt-4 items-center">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-500">{currentPage + 1} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage >= totalPages - 1}
            className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
