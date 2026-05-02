"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  PointElement,
  Filler,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import type { MonthlyEntry, WeeklyEntry, YearlyEntry } from "@/lib/data";
import { useState } from "react";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler);

const COLORS = { run: "#ff6b6b", ride: "#4ecdc4", swim: "#45b7d1", hike: "#96ceb4" };
const SPORTS = ["run", "ride", "hike", "swim"] as const;

type VolumeData = MonthlyEntry | WeeklyEntry | YearlyEntry;

export default function VolumeCharts({
  monthly,
  weekly,
  yearly,
}: {
  monthly: MonthlyEntry[];
  weekly: WeeklyEntry[];
  yearly: YearlyEntry[];
}) {
  const [view, setView] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const data = view === "monthly" ? monthly : view === "weekly" ? weekly : yearly;
  const labelKey = view === "monthly" ? "month" : view === "weekly" ? "week" : "year";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labels = data.map((d: any) => String(d[labelKey] ?? ""));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getVal(entry: any, sport: string, key: string): number {
    return entry[sport]?.[key] ?? 0;
  }

  const stackedOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 16 } } },
    scales: {
      x: { stacked: true, ticks: { color: "#8888a0", maxRotation: 45, autoSkip: true, maxTicksLimit: 20 }, grid: { color: "#2a2a3a55" } },
      y: { stacked: true, ticks: { color: "#8888a0" }, grid: { color: "#2a2a3a55" } },
    },
  };

  return (
    <div>
      <div className="flex gap-2 mb-6 flex-wrap">
        {(["weekly", "monthly", "yearly"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              view === v ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border border-white/10"
            }`}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Distance by Sport</h3>
          <p className="text-xs text-gray-500 mb-3">Stacked km per {view === "monthly" ? "month" : view === "weekly" ? "week" : "year"}.</p>
          <div className="h-80">
            <Bar
              data={{
                labels,
                datasets: SPORTS.map((s) => ({
                  label: s.charAt(0).toUpperCase() + s.slice(1),
                  data: data.map((d) => getVal(d, s, "distance_km")),
                  backgroundColor: COLORS[s],
                  borderRadius: 4,
                })),
              }}
              options={{
                ...stackedOptions,
                scales: { ...stackedOptions.scales, x: { ...stackedOptions.scales?.x, stacked: true }, y: { ...stackedOptions.scales?.y, stacked: true } },
              }}
            />
          </div>
        </div>
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Time by Sport</h3>
          <p className="text-xs text-gray-500 mb-3">Stacked hours per {view === "monthly" ? "month" : view === "weekly" ? "week" : "year"}.</p>
          <div className="h-80">
            <Bar
              data={{
                labels,
                datasets: SPORTS.map((s) => ({
                  label: s.charAt(0).toUpperCase() + s.slice(1),
                  data: data.map((d) => getVal(d, s, "time_hours")),
                  backgroundColor: COLORS[s],
                  borderRadius: 4,
                })),
              }}
              options={{
                ...stackedOptions,
                scales: { ...stackedOptions.scales, x: { ...stackedOptions.scales?.x, stacked: true }, y: { ...stackedOptions.scales?.y, stacked: true } },
              }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Elevation Gain</h3>
          <p className="text-xs text-gray-500 mb-3">Stacked metres per {view === "monthly" ? "month" : view === "weekly" ? "week" : "year"}.</p>
          <div className="h-80">
            <Bar
              data={{
                labels,
                datasets: ["run", "ride", "hike"].map((s) => ({
                  label: s.charAt(0).toUpperCase() + s.slice(1),
                  data: data.map((d) => getVal(d, s, "elevation_m")),
                  backgroundColor: COLORS[s as keyof typeof COLORS],
                  borderRadius: 4,
                })),
              }}
              options={{
                ...stackedOptions,
                scales: { ...stackedOptions.scales, x: { ...stackedOptions.scales?.x, stacked: true }, y: { ...stackedOptions.scales?.y, stacked: true } },
              }}
            />
          </div>
        </div>
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Relative Effort</h3>
          <p className="text-xs text-gray-500 mb-3">Strava Suffer Score — HR-based effort per {view === "monthly" ? "month" : view === "weekly" ? "week" : "year"}.</p>
          <div className="h-80">
            <Line
              data={{
                labels,
                datasets: SPORTS.map((s) => ({
                  label: s.charAt(0).toUpperCase() + s.slice(1),
                  data: data.map((d) => getVal(d, s, "relative_effort")),
                  borderColor: COLORS[s],
                  backgroundColor: COLORS[s] + "30",
                  tension: 0.3,
                  pointRadius: 2,
                  fill: false,
                })),
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 16 } } },
                scales: {
                  x: { ticks: { color: "#8888a0", maxRotation: 45, autoSkip: true, maxTicksLimit: 20 }, grid: { color: "#2a2a3a55" } },
                  y: { ticks: { color: "#8888a0" }, grid: { color: "#2a2a3a55" } },
                },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
