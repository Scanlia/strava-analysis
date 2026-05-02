"use client";

import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, BarElement, Title, Tooltip, Legend, TimeScale, Filler } from "chart.js";
import "chartjs-adapter-luxon";
import { Line, Bar } from "react-chartjs-2";
import { useState } from "react";
import type { Activity } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, BarElement, TimeScale, Filler, Title, Tooltip, Legend);

const RUN_COLOR = "#ff6b6b";
const RIDE_COLOR = "#4ecdc4";
const HIKE_COLOR = "#96ceb4";

function linearRegression(data: { x: number; y: number }[]): { slope: number; intercept: number; r2: number } | null {
  if (data.length < 2) return null;
  const n = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const p of data) { sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumX2 += p.x * p.x; sumY2 += p.y * p.y; }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const rNum = n * sumXY - sumX * sumY;
  const rDen = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return { slope, intercept, r2: rDen !== 0 ? (rNum / rDen) ** 2 : 0 };
}

function ewma(points: { x: number; y: number }[], alpha = 0.02): { x: number; y: number }[] {
  if (!points.length) return [];
  const result = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i++) result.push({ x: points[i].x, y: alpha * points[i].y + (1 - alpha) * result[i - 1].y });
  return result;
}

function trendLine(slope: number, intercept: number, x1: number, x2: number) {
  return [{ x: x1, y: intercept + slope * x1 }, { x: x2, y: intercept + slope * x2 }];
}

type TrendMode = "linear" | "ewma";
type SegmentMode = "activity" | "segments";

export default function GAPCharts({ activities }: { activities: Activity[] }) {
  const [trendMode, setTrendMode] = useState<TrendMode>("linear");
  const [runSegmentMode, setRunSegmentMode] = useState<SegmentMode>("segments");
  const [rideSegmentMode, setRideSegmentMode] = useState<SegmentMode>("segments");

  // --- Running data ---
  const runsWithGAP = activities
    .filter((a) => a.sport === "Run" && (a.gap_avg_pace_min_per_km ?? 0) > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));

  const runPoints = runsWithGAP.map((a) => ({ x: new Date(a.start_time_utc!).getTime(), y: a.gap_avg_pace_min_per_km! }));
  const runReg = linearRegression(runPoints.map((p, i) => ({ x: i, y: p.y })));
  const runTrendline = runReg ? trendLine(runReg.slope, runReg.intercept, 0, runPoints.length - 1).map((p) => ({ x: runPoints[p.x]?.x ?? runPoints[0].x, y: p.y })) : [];
  const runEWMA = ewma(runPoints.map((p, i) => ({ x: i, y: p.y }))).map((p, i) => ({ x: runPoints[i]?.x ?? runPoints[0]?.x, y: p.y }));

  const runSegments: { x: number; y: number; grade: number; paceStr: string | null }[] = [];
  for (const a of runsWithGAP) {
    if (a.gap_segments && a.start_time_utc) {
      const ts = new Date(a.start_time_utc).getTime();
      for (const seg of a.gap_segments) if (seg.gap_pace_min_km != null) runSegments.push({ x: ts, y: seg.gap_pace_min_km, grade: seg.grade_pct, paceStr: seg.gap_pace_str });
    }
  }
  runSegments.sort((a, b) => a.x - b.x);
  const runSegReg = linearRegression(runSegments.map((p, i) => ({ x: i, y: p.y })));
  const runSegTrendline = runSegReg && runSegments.length >= 2 ? trendLine(runSegReg.slope, runSegReg.intercept, 0, runSegments.length - 1).map((p) => ({ x: runSegments[p.x]?.x ?? runSegments[0].x, y: p.y })) : [];
  const runSegEWMA = ewma(runSegments.map((p, i) => ({ x: i, y: p.y }))).map((p, i) => ({ x: runSegments[i]?.x ?? runSegments[0]?.x, y: p.y }));

  // --- Cycling data ---
  const ridesWithGAS = activities
    .filter((a) => a.sport === "Ride" && (a.grade_adjusted_speed_kmh ?? 0) > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));

  const ridePoints = ridesWithGAS.map((a) => ({ x: new Date(a.start_time_utc!).getTime(), y: a.grade_adjusted_speed_kmh! }));
  const rideReg = linearRegression(ridePoints.map((p, i) => ({ x: i, y: p.y })));
  const rideTrendline = rideReg ? trendLine(rideReg.slope, rideReg.intercept, 0, ridePoints.length - 1).map((p) => ({ x: ridePoints[p.x]?.x ?? ridePoints[0].x, y: p.y })) : [];
  const rideEWMA = ewma(ridePoints.map((p, i) => ({ x: i, y: p.y }))).map((p, i) => ({ x: ridePoints[i]?.x ?? ridePoints[0]?.x, y: p.y }));

  const rideSegments: { x: number; y: number; grade: number }[] = [];
  for (const a of ridesWithGAS) {
    if (a.gap_segments && a.start_time_utc) {
      const ts = new Date(a.start_time_utc).getTime();
      for (const seg of a.gap_segments) if (seg.gap_speed_kmh != null) rideSegments.push({ x: ts, y: seg.gap_speed_kmh, grade: seg.grade_pct });
    }
  }
  rideSegments.sort((a, b) => a.x - b.x);
  const rideSegReg = linearRegression(rideSegments.map((p, i) => ({ x: i, y: p.y })));
  const rideSegTrendline = rideSegReg && rideSegments.length >= 2 ? trendLine(rideSegReg.slope, rideSegReg.intercept, 0, rideSegments.length - 1).map((p) => ({ x: rideSegments[p.x]?.x ?? rideSegments[0].x, y: p.y })) : [];
  const rideSegEWMA = ewma(rideSegments.map((p, i) => ({ x: i, y: p.y }))).map((p, i) => ({ x: rideSegments[i]?.x ?? rideSegments[0]?.x, y: p.y }));

  // --- Chart options ---
  const runOptions = (mode: SegmentMode): any => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 14, font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx: any) => mode === "segments" ? `Pace: ${runSegments[ctx.dataIndex]?.paceStr ?? (ctx.parsed.y ?? 0).toFixed(2)}/km (grade: ${runSegments[ctx.dataIndex]?.grade?.toFixed(1) ?? "?"}%)` : `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(2)} min/km` } }
    },
    scales: {
      x: { type: "time" as const, time: { unit: "month" as const, tooltipFormat: "MMM d, yyyy" }, ticks: { color: "#8888a0", maxTicksLimit: 15, font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
      y: { reverse: true, title: { display: true, text: "min/km (faster \u2191)", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
    },
  });

  const rideOptions = (mode: SegmentMode): any => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 14, font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx: any) => mode === "segments" ? `Speed: ${(ctx.parsed.y ?? 0).toFixed(1)} km/h (grade: ${(rideSegments[ctx.dataIndex] ?? {grade:0}).grade?.toFixed(1) ?? "?"}%)` : `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(1)} km/h` } },
    },
    scales: {
      x: { type: "time" as const, time: { unit: "month" as const, tooltipFormat: "MMM d, yyyy" }, ticks: { color: "#8888a0", maxTicksLimit: 15, font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
      y: { title: { display: true, text: "km/h — higher = faster", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
    },
  });

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Row 1: Running + Cycling */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Running GAP */}
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Running — Pace (Grade Adjusted) vs Raw Pace</h3>
          <p className="text-[10px] text-gray-500 mb-2">Minetti metabolic model (k=0.033 uphill, k=0.017 downhill). Adj. pace = raw × (1 + k·grade%).</p>
          <div className="flex gap-2 mb-3 text-[10px]">
            {(["activity", "segments"] as const).map((m) => (
              <button key={m} onClick={() => setRunSegmentMode(m)} className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${runSegmentMode === m ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white border border-white/10"}`}>
                {m === "activity" ? "Per Activity" : "Per 1km Split"}
              </button>
            ))}
            <span className="border-r border-white/10 mx-0.5" />
            {(["linear", "ewma"] as const).map((m) => (
              <button key={m} onClick={() => setTrendMode(m)} className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${trendMode === m ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border border-white/10"}`}>
                {m === "linear" ? "Linear Trend" : "EWMA Trend"}
              </button>
            ))}
          </div>
          {runReg && runSegmentMode === "activity" && (
            <p className="text-xs mb-3"><span className="font-semibold" style={{ color: runReg.slope < 0 ? "#8a9e8a" : "#9e8a8a" }}>{runReg.slope < 0 ? "Getting faster \u2705" : "Getting slower \u26a0\ufe0f"}</span><span className="text-gray-500"> — pace changing by {Math.abs(runReg.slope).toFixed(3)} min/km per run</span></p>
          )}
          {runSegReg && runSegmentMode === "segments" && (
            <p className="text-xs mb-3"><span className="font-semibold" style={{ color: runSegReg.slope < 0 ? "#8a9e8a" : "#9e8a8a" }}>{runSegReg.slope < 0 ? "Getting faster \u2705" : "Getting slower \u26a0\ufe0f"}</span><span className="text-gray-500"> — pace changing by {Math.abs(runSegReg.slope).toFixed(3)} min/km per km</span></p>
          )}
          <div className="h-80">
            <Line
              data={{ datasets: runSegmentMode === "activity" ? [
                { label: "Pace (Grade Adj.)", data: runPoints as any, borderColor: RUN_COLOR, backgroundColor: RUN_COLOR + "30", pointRadius: 5, showLine: false, order: 1 },
                ...(trendMode === "linear" && runTrendline.length > 0 ? [{ label: "Linear Trend", data: runTrendline as any, borderColor: RUN_COLOR + "cc", borderWidth: 2.5, borderDash: [6, 3], pointRadius: 0, tension: 0, order: 2 }] : []),
                ...(trendMode === "ewma" && runEWMA.length > 0 ? [{ label: "EWMA Trend", data: runEWMA as any, borderColor: RUN_COLOR + "cc", borderWidth: 2.5, pointRadius: 0, tension: 0, order: 2 }] : []),
                { label: "Raw Pace", data: runsWithGAP.map((a) => ({ x: new Date(a.start_time_utc!).getTime(), y: a.avg_pace_min_per_km ?? null })) as any, borderColor: RUN_COLOR + "50", borderDash: [3, 3], pointRadius: 2, showLine: false, order: 3 },
              ] : [
                { label: "1km Pace (Grade Adj.)", data: runSegments as any, borderColor: RUN_COLOR, backgroundColor: RUN_COLOR + "66", pointRadius: 4, showLine: false, order: 2 },
                ...(trendMode === "linear" && runSegTrendline.length > 0 ? [{ label: "Linear Trend", data: runSegTrendline as any, borderColor: "#f59e0b", borderWidth: 2, borderDash: [6, 3], pointRadius: 0, tension: 0, order: 1 }] : []),
                ...(trendMode === "ewma" && runSegEWMA.length > 0 ? [{ label: "EWMA Trend", data: runSegEWMA as any, borderColor: RUN_COLOR + "cc", borderWidth: 2.5, pointRadius: 0, tension: 0, order: 1 }] : []),
              ] }}
              options={runOptions(runSegmentMode)}
            />
          </div>
        </div>

        {/* Cycling GAS */}
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Cycling — Speed (Grade Adjusted) vs Raw Speed</h3>
          <p className="text-[10px] text-gray-500 mb-2">Simplified gravitational model. Adj. speed = raw × (1 + 0.033·grade%) for uphill.</p>
          <div className="flex gap-2 mb-3 text-[10px]">
            {(["activity", "segments"] as const).map((m) => (
              <button key={m} onClick={() => setRideSegmentMode(m)} className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${rideSegmentMode === m ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white border border-white/10"}`}>
                {m === "activity" ? "Per Activity" : "Per 5km Split"}
              </button>
            ))}
            <span className="border-r border-white/10 mx-0.5" />
            {(["linear", "ewma"] as const).map((m) => (
              <button key={m} onClick={() => setTrendMode(m)} className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${trendMode === m ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border border-white/10"}`}>
                {m === "linear" ? "Linear Trend" : "EWMA Trend"}
              </button>
            ))}
          </div>
          {rideReg && rideSegmentMode === "activity" && (
            <p className="text-xs mb-3"><span className="font-semibold" style={{ color: rideReg.slope > 0 ? "#8a9e8a" : "#9e8a8a" }}>{rideReg.slope > 0 ? "Getting faster \u2705" : "Getting slower \u26a0\ufe0f"}</span><span className="text-gray-500"> — speed changing by {Math.abs(rideReg.slope).toFixed(3)} km/h per ride</span></p>
          )}
          {rideSegReg && rideSegmentMode === "segments" && (
            <p className="text-xs mb-3"><span className="font-semibold" style={{ color: rideSegReg.slope > 0 ? "#8a9e8a" : "#9e8a8a" }}>{rideSegReg.slope > 0 ? "Getting faster \u2705" : "Getting slower \u26a0\ufe0f"}</span><span className="text-gray-500"> — speed changing by {Math.abs(rideSegReg.slope).toFixed(3)} km/h per 5km</span></p>
          )}
          <div className="h-80">
            <Line
              data={{ datasets: rideSegmentMode === "activity" ? [
                { label: "Speed (Grade Adj.)", data: ridePoints as any, borderColor: RIDE_COLOR, backgroundColor: RIDE_COLOR + "30", pointRadius: 5, showLine: false, order: 1 },
                ...(trendMode === "linear" && rideTrendline.length > 0 ? [{ label: "Linear Trend", data: rideTrendline as any, borderColor: RIDE_COLOR + "cc", borderWidth: 2.5, borderDash: [6, 3], pointRadius: 0, tension: 0, order: 2 }] : []),
                ...(trendMode === "ewma" && rideEWMA.length > 0 ? [{ label: "EWMA Trend", data: rideEWMA as any, borderColor: RIDE_COLOR + "cc", borderWidth: 2.5, pointRadius: 0, tension: 0, order: 2 }] : []),
                { label: "Raw Speed", data: ridesWithGAS.map((a) => ({ x: new Date(a.start_time_utc!).getTime(), y: a.avg_speed_kmh ?? null })) as any, borderColor: RIDE_COLOR + "50", borderDash: [3, 3], pointRadius: 2, showLine: false, order: 3 },
              ] : [
                { label: "5km Speed (Grade Adj.)", data: rideSegments as any, borderColor: RIDE_COLOR, backgroundColor: RIDE_COLOR + "66", pointRadius: 4, showLine: false, order: 2 },
                ...(trendMode === "linear" && rideSegTrendline.length > 0 ? [{ label: "Linear Trend", data: rideSegTrendline as any, borderColor: "#f59e0b", borderWidth: 2, borderDash: [6, 3], pointRadius: 0, tension: 0, order: 1 }] : []),
                ...(trendMode === "ewma" && rideSegEWMA.length > 0 ? [{ label: "EWMA Trend", data: rideSegEWMA as any, borderColor: RIDE_COLOR + "cc", borderWidth: 2.5, pointRadius: 0, tension: 0, order: 1 }] : []),
              ] }}
              options={rideOptions(rideSegmentMode)}
            />
          </div>
        </div>
      </div>

      {/* Row 2: Climbing Intensity + VAM */}
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
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { ticks: { color: "#e0e0ea", font: { size: 12 } }, grid: { color: "#2a2a3a55" } },
                  y: { title: { display: true, text: "m / km", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
                },
              }}
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
                options={{
                  indexAxis: "y", responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx: any) => `VAM: ${(ctx.parsed.x ?? 0).toFixed(0)} m/h` } } },
                  scales: {
                    x: { title: { display: true, text: "m/h", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
                    y: { ticks: { color: "#e0e0ea", font: { size: 9 } }, grid: { color: "#2a2a3a55" } },
                  },
                }}
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
