"use client";

import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, BarElement, Title, Tooltip, Legend, TimeScale, Filler } from "chart.js";
import "chartjs-adapter-luxon";
import { Line, Bar } from "react-chartjs-2";
import type { Activity } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, BarElement, TimeScale, Filler, Title, Tooltip, Legend);

const RUN_COLOR = "#ff6b6b";
const RIDE_COLOR = "#4ecdc4";
const HIKE_COLOR = "#96ceb4";

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

function trendLine(slope: number, intercept: number, x1: number, x2: number) {
  return [
    { x: x1, y: intercept + slope * x1 },
    { x: x2, y: intercept + slope * x2 },
  ];
}

export default function GAPCharts({ activities }: { activities: Activity[] }) {
  // --- Running GAP ---
  const runsWithGAP = activities
    .filter((a) => a.sport === "Run" && (a.gap_avg_pace_min_per_km ?? 0) > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));

  const runPoints = runsWithGAP.map((a) => ({
    x: new Date(a.start_time_utc!).getTime(),
    y: a.gap_avg_pace_min_per_km!,
  }));
  const runReg = linearRegression(runPoints.map((p, i) => ({ x: i, y: p.y })));

  const runTrendline = runReg ? trendLine(runReg.slope, runReg.intercept, 0, runPoints.length - 1).map((p) => ({
    x: runPoints[p.x]?.x ?? runPoints[0].x,
    y: p.y,
  })) : [];

  const isRunImproving = runReg ? runReg.slope < 0 : false; // negative slope in data = lower pace = faster = improving

  // --- Cycling Grade Adjusted Speed ---
  const ridesWithGAS = activities
    .filter((a) => a.sport === "Ride" && (a.grade_adjusted_speed_kmh ?? 0) > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));

  const ridePoints = ridesWithGAS.map((a) => ({
    x: new Date(a.start_time_utc!).getTime(),
    y: a.grade_adjusted_speed_kmh!,
  }));
  const rideReg = linearRegression(ridePoints.map((p, i) => ({ x: i, y: p.y })));

  const rideTrendline = rideReg ? trendLine(rideReg.slope, rideReg.intercept, 0, ridePoints.length - 1).map((p) => ({
    x: ridePoints[p.x]?.x ?? ridePoints[0].x,
    y: p.y,
  })) : [];

  const isRideImproving = rideReg ? rideReg.slope > 0 : false;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Running GAP */}
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
          Running — Grade Adjusted Pace vs Raw Pace
        </h3>
        {runReg && (
          <p className="text-xs mb-3">
            <span className={isRunImproving ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>
              {isRunImproving ? "Getting faster ✅" : "Getting slower ⚠️"}
            </span>
            <span className="text-gray-500"> — GAP changing by {Math.abs(runReg.slope).toFixed(3)} min/km per run</span>
          </p>
        )}
        <div className="h-80">
          <Line
            data={{
              datasets: [
                {
                  label: "GAP (Grade Adjusted)",
                  data: runPoints as any,
                  borderColor: RUN_COLOR,
                  backgroundColor: RUN_COLOR + "30",
                  tension: 0.3,
                  pointRadius: 5,
                  fill: false,
                  order: 1,
                },
                ...(runTrendline.length > 0
                  ? [{
                      label: "Trend",
                      data: runTrendline as any,
                      borderColor: isRunImproving ? "#4ade80" : "#f87171",
                      backgroundColor: "transparent",
                      borderWidth: 2.5,
                      borderDash: [6, 3],
                      pointRadius: 0,
                      fill: false,
                      tension: 0,
                      order: 2,
                    }]
                  : []),
                {
                  label: "Raw Pace",
                  data: runsWithGAP.map((a) => ({ x: new Date(a.start_time_utc!).getTime(), y: a.avg_pace_min_per_km ?? null })) as any,
                  borderColor: RUN_COLOR + "50",
                  backgroundColor: "transparent",
                  borderDash: [3, 3],
                  tension: 0.3,
                  pointRadius: 2,
                  fill: false,
                  order: 3,
                },
              ],
            }}
            options={{
              responsive: true, maintainAspectRatio: false,
              plugins: {
                legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 14, font: { size: 11 } } },
                tooltip: { callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(2)} min/km` } },
              },
              scales: {
                x: { type: "time", time: { unit: "month", tooltipFormat: "MMM d, yyyy" }, ticks: { color: "#8888a0", maxTicksLimit: 15, font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
                y: { reverse: true, title: { display: true, text: "min/km (faster ↑)", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
              },
            }}
          />
        </div>
      </div>

      {/* Cycling Grade Adjusted Speed */}
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
          Cycling — Grade Adjusted Speed vs Raw Speed
        </h3>
        {rideReg && (
          <p className="text-xs mb-3">
            <span className={isRideImproving ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>
              {isRideImproving ? "Getting faster ✅" : "Getting slower ⚠️"}
            </span>
            <span className="text-gray-500"> — GAS changing by {Math.abs(rideReg.slope).toFixed(3)} km/h per ride</span>
          </p>
        )}
        <div className="h-80">
          <Line
            data={{
              datasets: [
                {
                  label: "Grade Adj. Speed",
                  data: ridePoints as any,
                  borderColor: RIDE_COLOR,
                  backgroundColor: RIDE_COLOR + "30",
                  tension: 0.3,
                  pointRadius: 5,
                  fill: false,
                  order: 1,
                },
                ...(rideTrendline.length > 0
                  ? [{
                      label: "Trend",
                      data: rideTrendline as any,
                      borderColor: isRideImproving ? "#4ade80" : "#f87171",
                      backgroundColor: "transparent",
                      borderWidth: 2.5,
                      borderDash: [6, 3],
                      pointRadius: 0,
                      fill: false,
                      tension: 0,
                      order: 2,
                    }]
                  : []),
                {
                  label: "Raw Speed",
                  data: ridesWithGAS.map((a) => ({ x: new Date(a.start_time_utc!).getTime(), y: a.avg_speed_kmh ?? null })) as any,
                  borderColor: RIDE_COLOR + "50",
                  backgroundColor: "transparent",
                  borderDash: [3, 3],
                  tension: 0.3,
                  pointRadius: 2,
                  fill: false,
                  order: 3,
                },
              ],
            }}
            options={{
              responsive: true, maintainAspectRatio: false,
              plugins: {
                legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 14, font: { size: 11 } } },
                tooltip: { callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(1)} km/h` } },
              },
              scales: {
                x: { type: "time", time: { unit: "month", tooltipFormat: "MMM d, yyyy" }, ticks: { color: "#8888a0", maxTicksLimit: 15, font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
                y: { title: { display: true, text: "km/h — higher = faster", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
              },
            }}
          />
        </div>
      </div>

      {/* Elevation Gain per KM */}
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Climbing Intensity — Avg Elevation Gain per km</h3>
        <p className="text-xs text-gray-400 mb-3">How much climbing you do per km, by sport. Higher = hillier routes.</p>
        <div className="h-80">
          <Bar
            data={{
              labels: ["Run", "Ride", "Hike"],
              datasets: [{
                data: [
                  activities.filter((a) => a.sport === "Run").reduce((s, a) => s + (a.elevation_per_km ?? 0), 0) / Math.max(1, activities.filter((a) => a.sport === "Run" && a.elevation_per_km != null).length),
                  activities.filter((a) => a.sport === "Ride").reduce((s, a) => s + (a.elevation_per_km ?? 0), 0) / Math.max(1, activities.filter((a) => a.sport === "Ride" && a.elevation_per_km != null).length),
                  activities.filter((a) => a.sport === "Hike").reduce((s, a) => s + (a.elevation_per_km ?? 0), 0) / Math.max(1, activities.filter((a) => a.sport === "Hike" && a.elevation_per_km != null).length),
                ],
                backgroundColor: [RUN_COLOR, RIDE_COLOR, HIKE_COLOR],
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

      {/* VAM Chart */}
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">VAM — Vertical Ascent Speed</h3>
        <p className="text-xs text-gray-400 mb-3">Metres climbed per hour on uphill sections. Higher = stronger climber.</p>
        <div className="h-80">
          {activities.filter((a) => (a.vam ?? 0) > 0).length > 0 ? (
            <Bar
              data={{
                labels: activities.filter((a) => (a.vam ?? 0) > 0).sort((a, b) => (b.vam ?? 0) - (a.vam ?? 0)).map((a) =>
                  `${a.name.slice(0, 18)} (${new Date(a.start_time_utc!).toLocaleDateString("en-US", { month: "short", day: "numeric" })})`
                ),
                datasets: [{
                  data: activities.filter((a) => (a.vam ?? 0) > 0).sort((a, b) => (b.vam ?? 0) - (a.vam ?? 0)).map((a) => a.vam ?? 0),
                  backgroundColor: activities.filter((a) => (a.vam ?? 0) > 0).sort((a, b) => (b.vam ?? 0) - (a.vam ?? 0)).map((a) =>
                    ({ Run: RUN_COLOR, Ride: RIDE_COLOR, Hike: HIKE_COLOR }[a.sport] || "#8888a0")
                  ),
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
  );
}
