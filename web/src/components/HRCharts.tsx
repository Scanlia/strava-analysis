"use client";

import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  Title, Tooltip, Legend, PointElement, ArcElement, TimeScale,
} from "chart.js";
import "chartjs-adapter-luxon";
import { Bar, Doughnut, Line, Scatter } from "react-chartjs-2";
import { useState } from "react";
import type { Activity } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, TimeScale, Title, Tooltip, Legend);

const COLORS: Record<string, string> = { Run: "#ff6b6b", Ride: "#4ecdc4", Hike: "#96ceb4", Swim: "#45b7d1" };
const ZONE_COLORS = ["#96ceb4", "#4ecdc4", "#ffe66d", "#ff6b6b", "#ff3333"];

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function linearRegression(data: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } | null {
  if (data.length < 2) return null;
  const n = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const p of data) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const rNum = n * sumXY - sumX * sumY;
  const rDen = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  const r2 = rDen !== 0 ? (rNum / rDen) ** 2 : 0;
  return { slope, intercept, r2 };
}

function ewma(points: { x: number; y: number }[], alpha: number = 0.3): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const result: { x: number; y: number }[] = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i++) {
    result.push({
      x: points[i].x,
      y: alpha * points[i].y + (1 - alpha) * result[i - 1].y,
    });
  }
  return result;
}

type TrendMode = "linear" | "ewma";

export default function HRCharts({ activities }: { activities: Activity[] }) {
  const [efTrendMode, setEfTrendMode] = useState<TrendMode>("linear");
  // --- HR scatter ---
  const withHR = activities
    .filter((a) => a.has_hr && a.avg_hr > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));

  const hrDatasets = ["Run", "Ride", "Hike"]
    .filter((s) => withHR.some((a) => a.sport === s))
    .map((s) => {
      const sportActs = withHR.filter((a) => a.sport === s).sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));
      return {
        label: s,
        data: sportActs.map((a) => {
          const d = a.start_time_utc ? new Date(a.start_time_utc).getTime() : null;
          return d ? { x: d, y: a.avg_hr } : null;
        }).filter(Boolean),
        borderColor: COLORS[s],
        backgroundColor: COLORS[s],
        pointRadius: 5,
        pointHoverRadius: 7,
        showLine: false,
      };
    });

  // --- EF trend per sport with linear trendlines ---
  const efActs = activities
    .filter((a) => (a.efficiency_factor ?? 0) > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));

  const efBySport: Record<string, { x: number; y: number }[]> = {};
  for (const a of efActs) {
    if (!efBySport[a.sport]) efBySport[a.sport] = [];
    const ts = a.start_time_utc ? new Date(a.start_time_utc).getTime() : null;
    if (ts) efBySport[a.sport].push({ x: ts, y: a.efficiency_factor! });
  }

  // Compute trendlines per sport
  const efRegressions: Record<string, { slope: number; intercept: number } | null> = {};
  for (const [sport, data] of Object.entries(efBySport)) {
    const sorted = data.sort((a, b) => a.x - b.x);
    const reg = linearRegression(sorted.map((p, i) => ({ x: i, y: p.y })));
    efRegressions[sport] = reg;
  }

  const efDatasets = Object.entries(efBySport).flatMap(([sport, data]) => {
    const sorted = data.sort((a, b) => a.x - b.x);
    const datasets: any[] = [{
      label: sport + " EF",
      data: sorted,
      borderColor: COLORS[sport] || "#8888a0",
      backgroundColor: (COLORS[sport] || "#8888a0") + "30",
      tension: 0,
      pointRadius: 4,
      showLine: false,
      fill: false,
      order: 1,
    }];
    const reg = efRegressions[sport];
    if (efTrendMode === "linear" && reg && sorted.length >= 2) {
      datasets.push({
        label: sport + " Trend",
        data: [
          { x: sorted[0].x, y: reg.intercept },
          { x: sorted[sorted.length - 1].x, y: reg.intercept + reg.slope * (sorted.length - 1) },
        ],
        borderColor: (COLORS[sport] || "#8888a0") + "cc",
        backgroundColor: "transparent",
        borderWidth: 2.5,
        borderDash: [6, 3],
        pointRadius: 0,
        fill: false,
        tension: 0,
        order: 2,
      });
    } else if (efTrendMode === "ewma" && sorted.length >= 2) {
      const e = ewma(sorted.map((p, i) => ({ x: i, y: p.y })));
      const eData = e.map((p, i) => ({ x: sorted[i]?.x ?? sorted[0].x, y: p.y }));
      datasets.push({
        label: sport + " EWMA",
        data: eData,
        borderColor: (COLORS[sport] || "#8888a0") + "cc",
        backgroundColor: "transparent",
        borderWidth: 2.5,
        pointRadius: 0,
        fill: false,
        tension: 0,
        order: 2,
      });
    }
    return datasets;
  });

  // --- HR zones ---
  const zones: Record<string, number> = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  activities.forEach((a) => {
    if (a.hr_zones) Object.entries(a.hr_zones).forEach(([k, v]) => { zones[k] = (zones[k] || 0) + v; });
  });

  // --- Aerobic decoupling ---
  const decouplingActs = activities
    .filter((a) => a.aerobic_decoupling_pct != null && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));

  const decouplingLabels = decouplingActs.map((a) =>
    `${a.sport === "Run" ? "🏃" : a.sport === "Ride" ? "🚴" : a.sport === "Hike" ? "🥾" : "🏊"} ${a.name.slice(0, 18)} (${fmtDate(a.start_time_utc)})`
  );
  const decouplingValues = decouplingActs.map((a) => a.aerobic_decoupling_pct ?? 0);
  const decouplingColors = decouplingValues.map((v) => (v > 5 ? "#f87171" : "#4ade80"));

  // Decoupling trendline
  const decoupPoints = decouplingActs.map((a, i) => ({ x: new Date(a.start_time_utc!).getTime(), y: a.aerobic_decoupling_pct! }));
  const decoupReg = linearRegression(decoupPoints.map((p, i) => ({ x: i, y: p.y })));
  const isDecoupImproving = decoupReg ? decoupReg.slope < 0 : false; // lower = fitter

  // --- TRIMP ---
  const trimpActs = activities
    .filter((a) => (a.trimp ?? 0) > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));
  const trimpLabels = trimpActs.map((a) => fmtDate(a.start_time_utc));

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* HR Scatter */}
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Average HR by Activity</h3>
          <p className="text-xs text-gray-400 mb-3">Per-activity average heart rate. Lower HR at same pace = improved fitness.</p>
          <div className="h-80">
            {hrDatasets.length > 0 ? (
              <Scatter
                data={{ datasets: hrDatasets }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 16, font: { size: 11 } } },
                    tooltip: { callbacks: { label: (ctx: any) => `HR: ${ctx.parsed.y ?? 0} bpm` } },
                  },
                  scales: {
                    x: { type: "time", time: { unit: "month", tooltipFormat: "MMM d, yyyy" }, ticks: { color: "#8888a0", maxTicksLimit: 20, font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
                    y: { title: { display: true, text: "bpm", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
                  },
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">No HR data available</div>
            )}
          </div>
        </div>

        {/* EF Trend */}
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold">Efficiency Factor Trend</h3>
            <div className="flex gap-1">
              {(["linear", "ewma"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setEfTrendMode(m)}
                  className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all cursor-pointer ${
                    efTrendMode === m ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border border-white/10"
                  }`}
                >
                  {m === "linear" ? "Linear" : "EWMA"}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            EF = speed ÷ HR. Higher EF = more speed per heartbeat = fitter.
          </p>
          {Object.entries(efRegressions).filter(([, r]) => r).length > 0 && (
            <div className="text-xs text-gray-400 mb-3 space-y-0.5">
              {Object.entries(efRegressions).filter(([, r]) => r).map(([sport, reg]) => {
                const improving = reg!.slope > 0;
                const label = sport === "Run" ? "per run" : sport === "Ride" ? "per ride" : sport === "Hike" ? "per hike" : "per swim";
                return (
                  <div key={sport}>
                    <span style={{ color: COLORS[sport] || "#888" }}>● {sport}</span>:{" "}
                    <span className={improving ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>
                      {improving ? "getting fitter" : "declining"} {improving ? "✅" : "⚠️"}
                    </span>{" "}
                    <span className="text-gray-500">({Math.abs(reg!.slope).toFixed(3)} EF/{label})</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="h-80">
            {efDatasets.length > 0 ? (
              <Line
                data={{ datasets: efDatasets }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 14, font: { size: 10 } } },
                    tooltip: { callbacks: { label: (ctx: any) => `EF: ${(ctx.parsed.y ?? 0).toFixed(2)}` } },
                  },
                  scales: {
                    x: { type: "time", time: { unit: "month", tooltipFormat: "MMM d, yyyy" }, ticks: { color: "#8888a0", maxTicksLimit: 20, font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
                    y: { title: { display: true, text: "Efficiency Factor", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
                  },
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">No EF data available</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* HR Zones */}
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">HR Zone Distribution</h3>
          <p className="text-xs text-gray-400 mb-3">Total time-in-zone across all activities with HR data.</p>
          <div className="h-72">
            <Doughnut
              data={{
                labels: ["Z1 Recovery", "Z2 Endurance", "Z3 Tempo", "Z4 Threshold", "Z5 Max"],
                datasets: [{
                  data: [zones.Z1 || 0, zones.Z2 || 0, zones.Z3 || 0, zones.Z4 || 0, zones.Z5 || 0],
                  backgroundColor: ZONE_COLORS,
                  borderColor: "#141420",
                }],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: {
                  legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 10, font: { size: 10 } } },
                },
              }}
            />
          </div>
        </div>

        {/* Aerobic Decoupling */}
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Aerobic Decoupling</h3>
          <p className="text-xs text-gray-400 mb-3">
            Pace/HR drift — first half vs second half. Lower % = better endurance.
          </p>
          {decoupReg && (
            <p className="text-xs mb-3">
              <span className={isDecoupImproving ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>
                {isDecoupImproving ? "Improving endurance ✅" : "Declining endurance ⚠️"}
              </span>
              <span className="text-gray-500"> — changing by {Math.abs(decoupReg.slope).toFixed(3)}%/activity</span>
            </p>
          )}
          <div className="h-72">
            {decouplingActs.length > 0 ? (
              <Bar
                data={{
                  labels: decouplingLabels,
                  datasets: [{ data: decouplingValues, backgroundColor: decouplingColors, borderRadius: 4 }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => `Decoupling: ${(ctx.parsed.y ?? 0).toFixed(2)}%` } },
                  },
                  scales: {
                    x: { ticks: { color: "#8888a0", maxRotation: 45, autoSkip: true, maxTicksLimit: 10, font: { size: 9 } }, grid: { color: "#2a2a3a55" } },
                    y: { title: { display: true, text: "%", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
                  },
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">No decoupling data</div>
            )}
          </div>
        </div>

        {/* TRIMP */}
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Training Load (TRIMP)</h3>
          <p className="text-xs text-gray-400 mb-3">
            Training Impulse — HR-based training load score. Accounts for duration × intensity. Higher = harder session.
          </p>
          <div className="h-72">
            {trimpActs.length > 0 ? (
              <Bar
                data={{
                  labels: trimpLabels,
                  datasets: [{
                    data: trimpActs.map((a) => a.trimp ?? 0),
                    backgroundColor: trimpActs.map((a) => COLORS[a.sport] || "#8888a0"),
                    borderRadius: 3,
                  }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => `TRIMP: ${(ctx.parsed.y ?? 0).toFixed(1)}` } },
                  },
                  scales: {
                    x: { ticks: { color: "#8888a0", maxRotation: 45, autoSkip: true, maxTicksLimit: 10, font: { size: 9 } }, grid: { color: "#2a2a3a55" } },
                    y: { ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
                  },
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">No TRIMP data</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
