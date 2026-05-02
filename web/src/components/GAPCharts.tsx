"use client";

import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, BarElement, Title, Tooltip, Legend, TimeScale } from "chart.js";
import "chartjs-adapter-luxon";
import { Line, Bar } from "react-chartjs-2";
import { useState } from "react";
import type { Activity, GapTrends } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, BarElement, TimeScale, Title, Tooltip, Legend);

const RUN_COLOR = "#ff6b6b";
const RIDE_COLOR = "#4ecdc4";
const HIKE_COLOR = "#96ceb4";

type TrendMode = "split" | "activity";
type TrendType = "loess" | "linear";

function slopeLabel(trends: GapTrends | undefined, mode: TrendMode, isRun: boolean): string {
  if (!trends) return "";
  const lin = mode === "split" ? trends.linear_split : trends.linear_act;
  if (!lin || !lin.slope_per_month) return "";
  const val = Math.abs(lin.slope_per_month);
  const unit = isRun ? "min/km" : "km/h";
  const improving = isRun ? lin.slope_per_month < 0 : lin.slope_per_month > 0;
  const dir = improving ? "improving" : "declining";
  const emoji = improving ? "\u2705" : "\u26a0\ufe0f";
  return `${dir} ${emoji} — ${val.toFixed(3)} ${unit}/month`;
}

export default function GAPCharts({ activities, trends }: { activities: Activity[]; trends: Record<string, GapTrends> }) {
  const [runTrendMode, setRunTrendMode] = useState<TrendMode>("split");
  const [rideTrendMode, setRideTrendMode] = useState<TrendMode>("split");
  const [runTrendType, setRunTrendType] = useState<TrendType>("loess");
  const [rideTrendType, setRideTrendType] = useState<TrendType>("loess");

  const runTrend = trends.run;
  const rideTrend = trends.ride;

  // --- Helper: build linear regression line from server data ---
  function buildLinearLine(trend: GapTrends | undefined, mode: TrendMode) {
    if (!trend) return [];
    const lin = mode === "split" ? trend.linear_split : trend.linear_act;
    if (!lin || !lin.slope_per_month || lin.slope_per_month === 0) return [];
    const data = mode === "split" ? trend.loess_split : trend.loess_act;
    if (data.length < 2) return [];
    const minDays = data[0].days;
    const maxDays = data[data.length - 1].days;
    const slope_per_day = lin.slope_per_month / 30.44;
    return [
      { x: new Date(trend.ref_date).getTime() + minDays * 86400000, y: lin.intercept + slope_per_day * minDays },
      { x: new Date(trend.ref_date).getTime() + maxDays * 86400000, y: lin.intercept + slope_per_day * maxDays },
    ];
  }

  // --- Running data ---
  const runsWithGAP = activities
    .filter((a) => a.sport === "Run" && (a.gap_avg_pace_min_per_km ?? 0) > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));

  const runSegments: { x: number; y: number; grade: number; paceStr: string | null }[] = [];
  for (const a of runsWithGAP) {
    if (a.gap_segments && a.start_time_utc) {
      const ts = new Date(a.start_time_utc).getTime();
      for (const seg of a.gap_segments) if (seg.gap_pace_min_km != null) runSegments.push({ x: ts, y: seg.gap_pace_min_km, grade: seg.grade_pct, paceStr: seg.gap_pace_str });
    }
  }
  runSegments.sort((a, b) => a.x - b.x);

  const runActPoints: { x: number; y: number }[] = [];
  for (const a of runsWithGAP) {
    if (!a.start_time_utc || !a.gap_segments?.length) continue;
    const ts = new Date(a.start_time_utc).getTime();
    let w = 0, ws = 0;
    for (const seg of a.gap_segments) {
      if (seg.gap_pace_min_km != null && seg.gap_pace_min_km > 0) {
        const spd = 1000 / (seg.gap_pace_min_km * 60);
        ws += spd * 1000;
        w += 1000;
      }
    }
    if (w > 0) runActPoints.push({ x: ts, y: (1000 / (ws / w)) / 60 });
  }

  const runLoessSplit = (runTrend?.loess_split || []).map((p) => ({
    x: new Date(runTrend!.ref_date).getTime() + p.days * 86400000,
    y: p.value,
  }));
  const runLoessAct = (runTrend?.loess_act || []).map((p) => ({
    x: new Date(runTrend!.ref_date).getTime() + p.days * 86400000,
    y: p.value,
  }));
  const runLinearSplit = buildLinearLine(runTrend, "split");
  const runLinearAct = buildLinearLine(runTrend, "activity");

  // --- Cycling data ---
  const ridesWithGAS = activities
    .filter((a) => a.sport === "Ride" && (a.grade_adjusted_speed_kmh ?? 0) > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));

  const rideSegments: { x: number; y: number; grade: number }[] = [];
  for (const a of ridesWithGAS) {
    if (a.gap_segments && a.start_time_utc) {
      const ts = new Date(a.start_time_utc).getTime();
      for (const seg of a.gap_segments) if (seg.gap_speed_kmh != null) rideSegments.push({ x: ts, y: seg.gap_speed_kmh, grade: seg.grade_pct });
    }
  }
  rideSegments.sort((a, b) => a.x - b.x);

  const rideActPoints: { x: number; y: number }[] = [];
  for (const a of ridesWithGAS) {
    if (!a.start_time_utc || !a.gap_segments?.length) continue;
    const ts = new Date(a.start_time_utc).getTime();
    let w = 0, ws = 0;
    for (const seg of a.gap_segments) {
      if (seg.gap_speed_kmh != null) {
        const spd = seg.gap_speed_kmh / 3.6;
        ws += spd * 5000;
        w += 5000;
      }
    }
    if (w > 0) rideActPoints.push({ x: ts, y: (ws / w) * 3.6 });
  }

  const rideLoessSplit = (rideTrend?.loess_split || []).map((p) => ({
    x: new Date(rideTrend!.ref_date).getTime() + p.days * 86400000,
    y: p.value,
  }));
  const rideLoessAct = (rideTrend?.loess_act || []).map((p) => ({
    x: new Date(rideTrend!.ref_date).getTime() + p.days * 86400000,
    y: p.value,
  }));
  const rideLinearSplit = buildLinearLine(rideTrend, "split");
  const rideLinearAct = buildLinearLine(rideTrend, "activity");

  const runOptions = (): any => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 14, font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(2)} min/km` } },
    },
    scales: {
      x: { type: "time" as const, time: { unit: "month" as const, tooltipFormat: "MMM d, yyyy" }, ticks: { color: "#8888a0", maxTicksLimit: 15, font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
      y: { reverse: true, title: { display: true, text: "min/km (faster \u2191)", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
    },
  });

  const rideOptions = (): any => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 14, font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(1)} km/h` } },
    },
    scales: {
      x: { type: "time" as const, time: { unit: "month" as const, tooltipFormat: "MMM d, yyyy" }, ticks: { color: "#8888a0", maxTicksLimit: 15, font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
      y: { title: { display: true, text: "km/h — higher = faster", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
    },
  });

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Running */}
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Running — Pace (Grade Adjusted)</h3>
          <p className="text-[10px] text-gray-500 mb-2">Per-point Minetti model, 35m grade window, 1km split aggregation. Stops excluded.</p>
          <div className="flex flex-wrap gap-2 mb-3 text-[10px]">
            {(["split", "activity"] as const).map((m) => (
              <button key={m} onClick={() => setRunTrendMode(m)} className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${runTrendMode === m ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white border border-white/10"}`}>
                {m === "split" ? "Per Split (1km)" : "Per Activity"}
              </button>
            ))}
            <span className="border-l border-white/10 mx-1" />
            {(["loess", "linear"] as const).map((t) => (
              <button key={t} onClick={() => setRunTrendType(t)} className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${runTrendType === t ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white border border-white/10"}`}>
                {t === "loess" ? "LOESS" : "Linear (Reg)"}
              </button>
            ))}
          </div>
          {runTrend && (
            <p className="text-xs mb-3">
              <span className="font-semibold" style={{ color: runTrend.linear_split.slope_per_month < 0 ? "#8a9e8a" : "#9e8a8a" }}>
                {slopeLabel(runTrend, runTrendMode, true)}
              </span>
              <span className="text-gray-500"> — {runTrendType === "loess" ? "LOESS" : "Linear"} trend ({runTrend.n_splits} splits / {runTrend.n_activities} runs)</span>
            </p>
          )}
          <div className="h-80">
            <Line
              data={{ datasets: [
                { label: "1km Split", data: runSegments.map((s) => ({ x: s.x, y: s.y })) as any, borderColor: RUN_COLOR, backgroundColor: RUN_COLOR + "44", pointRadius: 3, showLine: false, order: 5 },
                ...(runTrendType === "loess" && runLoessSplit.length > 0 ? [{ label: "LOESS (per-split)", data: runLoessSplit as any, borderColor: RUN_COLOR, borderWidth: 2.5, pointRadius: 0, tension: 0, order: 1 }] : []),
                ...(runTrendType === "loess" && runLoessAct.length > 0 ? [{ label: "LOESS (per-activity)", data: runLoessAct as any, borderColor: "#f59e0b", borderWidth: 2.5, pointRadius: 0, tension: 0, order: 2, borderDash: [4, 4] }] : []),
                ...(runTrendType === "linear" && runLinearSplit.length > 0 ? [{ label: "Linear (per-split)", data: runLinearSplit as any, borderColor: RUN_COLOR, borderWidth: 2.5, pointRadius: 0, tension: 0, order: 1 }] : []),
                ...(runTrendType === "linear" && runLinearAct.length > 0 ? [{ label: "Linear (per-activity)", data: runLinearAct as any, borderColor: "#f59e0b", borderWidth: 2.5, pointRadius: 0, tension: 0, order: 2, borderDash: [4, 4] }] : []),
                { label: "Activity Avg", data: runActPoints as any, borderColor: "#f59e0b", backgroundColor: "#f59e0b44", pointRadius: 5, showLine: false, order: 6 },
              ] }}
              options={runOptions()}
            />
          </div>
        </div>

        {/* Cycling */}
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Cycling — Speed (Grade Adjusted)</h3>
          <p className="text-[10px] text-gray-500 mb-2">Per-point Minetti model, 35m grade window, 5min moving-time splits. Stops excluded.</p>
          <div className="flex flex-wrap gap-2 mb-3 text-[10px]">
            {(["split", "activity"] as const).map((m) => (
              <button key={m} onClick={() => setRideTrendMode(m)} className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${rideTrendMode === m ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white border border-white/10"}`}>
                {m === "split" ? "Per Split (5min)" : "Per Activity"}
              </button>
            ))}
            <span className="border-l border-white/10 mx-1" />
            {(["loess", "linear"] as const).map((t) => (
              <button key={t} onClick={() => setRideTrendType(t)} className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${rideTrendType === t ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white border border-white/10"}`}>
                {t === "loess" ? "LOESS" : "Linear (Reg)"}
              </button>
            ))}
          </div>
          {rideTrend && (
            <p className="text-xs mb-3">
              <span className="font-semibold" style={{ color: rideTrend.linear_split.slope_per_month > 0 ? "#8a9e8a" : "#9e8a8a" }}>
                {slopeLabel(rideTrend, rideTrendMode, false)}
              </span>
              <span className="text-gray-500"> — {rideTrendType === "loess" ? "LOESS" : "Linear"} trend ({rideTrend.n_splits} splits / {rideTrend.n_activities} rides)</span>
            </p>
          )}
          <div className="h-80">
            <Line
              data={{ datasets: [
                { label: "5min Split", data: rideSegments.map((s) => ({ x: s.x, y: s.y })) as any, borderColor: RIDE_COLOR, backgroundColor: RIDE_COLOR + "44", pointRadius: 3, showLine: false, order: 5 },
                ...(rideTrendType === "loess" && rideLoessSplit.length > 0 ? [{ label: "LOESS (per-split)", data: rideLoessSplit as any, borderColor: RIDE_COLOR, borderWidth: 2.5, pointRadius: 0, tension: 0, order: 1 }] : []),
                ...(rideTrendType === "loess" && rideLoessAct.length > 0 ? [{ label: "LOESS (per-activity)", data: rideLoessAct as any, borderColor: "#f59e0b", borderWidth: 2.5, pointRadius: 0, tension: 0, order: 2, borderDash: [4, 4] }] : []),
                ...(rideTrendType === "linear" && rideLinearSplit.length > 0 ? [{ label: "Linear (per-split)", data: rideLinearSplit as any, borderColor: RIDE_COLOR, borderWidth: 2.5, pointRadius: 0, tension: 0, order: 1 }] : []),
                ...(rideTrendType === "linear" && rideLinearAct.length > 0 ? [{ label: "Linear (per-activity)", data: rideLinearAct as any, borderColor: "#f59e0b", borderWidth: 2.5, pointRadius: 0, tension: 0, order: 2, borderDash: [4, 4] }] : []),
                { label: "Activity Avg", data: rideActPoints as any, borderColor: "#f59e0b", backgroundColor: "#f59e0b44", pointRadius: 5, showLine: false, order: 6 },
              ] }}
              options={rideOptions()}
            />
          </div>
        </div>
      </div>

      {/* Climbing + VAM */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5 lg:col-span-1">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Climbing Intensity — Avg Elevation Gain per km</h3>
          <p className="text-xs text-gray-400 mb-3">How much climbing you do per km, by sport. Higher = hillier routes.</p>
          <div className="h-[420px]">
            <Bar
              data={{
                labels: ["Hike", "Ride", "Run"],
                datasets: [{
                  data: [
                    activities.filter((a) => a.sport === "Hike").reduce((s, a) => s + (a.elevation_per_km ?? 0), 0) / Math.max(1, activities.filter((a) => a.sport === "Hike" && a.elevation_per_km != null).length),
                    activities.filter((a) => a.sport === "Ride").reduce((s, a) => s + (a.elevation_per_km ?? 0), 0) / Math.max(1, activities.filter((a) => a.sport === "Ride" && a.elevation_per_km != null).length),
                    activities.filter((a) => a.sport === "Run").reduce((s, a) => s + (a.elevation_per_km ?? 0), 0) / Math.max(1, activities.filter((a) => a.sport === "Run" && a.elevation_per_km != null).length),
                  ],
                  backgroundColor: [HIKE_COLOR, RIDE_COLOR, RUN_COLOR],
                  borderRadius: 6,
                }],
              }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#e0e0ea", font: { size: 12 } }, grid: { color: "#2a2a3a55" } }, y: { title: { display: true, text: "m / km", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } } } }}
            />
          </div>
        </div>
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5 lg:col-span-2">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">VAM — Vertical Ascent Speed</h3>
          <p className="text-xs text-gray-400 mb-3">Metres climbed per hour on uphill sections. Higher = stronger climber.</p>
          <div className="h-[420px]">
            {activities.filter((a) => (a.vam ?? 0) > 0).length > 0 ? (
              <Bar
                data={{
                  labels: activities.filter((a) => (a.vam ?? 0) > 0).sort((a, b) => (b.vam ?? 0) - (a.vam ?? 0)).map((a) => `${a.name.slice(0, 18)} (${new Date(a.start_time_utc!).toLocaleDateString("en-US", { month: "short", day: "numeric" })})`),
                  datasets: [{
                    data: activities.filter((a) => (a.vam ?? 0) > 0).sort((a, b) => (b.vam ?? 0) - (a.vam ?? 0)).map((a) => a.vam ?? 0),
                    backgroundColor: activities.filter((a) => (a.vam ?? 0) > 0).sort((a, b) => (b.vam ?? 0) - (a.vam ?? 0)).map((a) => ({ Run: RUN_COLOR, Ride: RIDE_COLOR, Hike: HIKE_COLOR }[a.sport] || "#8888a0")),
                    borderRadius: 4,
                  }],
                }}
                options={{ indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx: any) => `VAM: ${(ctx.parsed.x ?? 0).toFixed(0)} m/h` } } }, scales: { x: { title: { display: true, text: "m/h", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } }, y: { ticks: { color: "#e0e0ea", font: { size: 9 } }, grid: { color: "#2a2a3a55" } } } }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">No VAM data available</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
