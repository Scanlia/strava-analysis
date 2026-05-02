"use client";

import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, BarElement, Title, Tooltip, Legend } from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import type { Activity } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, BarElement, Title, Tooltip, Legend);

const RUN_COLOR = "#ff6b6b";
const RIDE_COLOR = "#4ecdc4";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function GAPCharts({ activities }: { activities: Activity[] }) {
  // --- GAP for Running ---
  const runsWithGAP = activities
    .filter((a) => a.sport === "Run" && (a.gap_avg_pace_min_per_km ?? 0) > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));

  // --- Grade Adjusted Speed for Cycling ---
  const ridesWithGAS = activities
    .filter((a) => a.sport === "Ride" && (a.grade_adjusted_speed_kmh ?? 0) > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Running GAP */}
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">Running — Grade Adjusted Pace vs Raw Pace</h3>
        <div className="h-80">
          {runsWithGAP.length > 0 ? (
            <Line
              data={{
                labels: runsWithGAP.map((a) => fmtDate(a.start_time_utc)),
                datasets: [
                  {
                    label: "Raw Pace",
                    data: runsWithGAP.map((a) => a.avg_pace_min_per_km ?? null),
                    borderColor: RUN_COLOR + "80",
                    backgroundColor: "transparent",
                    borderDash: [5, 5],
                    tension: 0.3,
                    pointRadius: 3,
                  },
                  {
                    label: "GAP (Grade Adjusted)",
                    data: runsWithGAP.map((a) => a.gap_avg_pace_min_per_km ?? null),
                    borderColor: RUN_COLOR,
                    backgroundColor: RUN_COLOR + "30",
                    tension: 0.3,
                    pointRadius: 5,
                    fill: false,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 12, font: { size: 11 } } },
                  tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(2)} min/km` } },
                },
                scales: {
                  x: { ticks: { color: "#8888a0", maxRotation: 45, autoSkip: true, maxTicksLimit: 15 }, grid: { color: "#2a2a3a55" } },
                  y: { reverse: true, title: { display: true, text: "min/km (lower = faster)", color: "#8888a0" }, ticks: { color: "#8888a0", callback: (v) => `${v} min/km` }, grid: { color: "#2a2a3a55" } },
                },
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">No GAP data available for runs</div>
          )}
        </div>
      </div>

      {/* Cycling Grade Adjusted Speed */}
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">Cycling — Grade Adjusted Speed vs Raw Speed</h3>
        <div className="h-80">
          {ridesWithGAS.length > 0 ? (
            <Line
              data={{
                labels: ridesWithGAS.map((a) => fmtDate(a.start_time_utc)),
                datasets: [
                  {
                    label: "Raw Speed",
                    data: ridesWithGAS.map((a) => a.avg_speed_kmh ?? null),
                    borderColor: RIDE_COLOR + "80",
                    backgroundColor: "transparent",
                    borderDash: [5, 5],
                    tension: 0.3,
                    pointRadius: 3,
                  },
                  {
                    label: "Grade Adj. Speed",
                    data: ridesWithGAS.map((a) => a.grade_adjusted_speed_kmh ?? null),
                    borderColor: RIDE_COLOR,
                    backgroundColor: RIDE_COLOR + "30",
                    tension: 0.3,
                    pointRadius: 5,
                    fill: false,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 12, font: { size: 11 } } },
                  tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(1)} km/h` } },
                },
                scales: {
                  x: { ticks: { color: "#8888a0", maxRotation: 45, autoSkip: true, maxTicksLimit: 15 }, grid: { color: "#2a2a3a55" } },
                  y: { title: { display: true, text: "km/h", color: "#8888a0" }, ticks: { color: "#8888a0" }, grid: { color: "#2a2a3a55" } },
                },
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">No grade-adjusted data for rides</div>
          )}
        </div>
      </div>

      {/* Elevation Gain per KM */}
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">Climbing Intensity — Elevation Gain per km</h3>
        <div className="h-80">
          <Bar
            data={{
              labels: ["run", "ride", "hike"],
              datasets: [
                {
                  label: "Avg Elev. per km (m)",
                  data: [
                    activities.filter((a) => a.sport === "Run").reduce((s, a) => s + (a.elevation_per_km ?? 0), 0) / Math.max(1, activities.filter((a) => a.sport === "Run" && a.elevation_per_km != null).length),
                    activities.filter((a) => a.sport === "Ride").reduce((s, a) => s + (a.elevation_per_km ?? 0), 0) / Math.max(1, activities.filter((a) => a.sport === "Ride" && a.elevation_per_km != null).length),
                    activities.filter((a) => a.sport === "Hike").reduce((s, a) => s + (a.elevation_per_km ?? 0), 0) / Math.max(1, activities.filter((a) => a.sport === "Hike" && a.elevation_per_km != null).length),
                  ],
                  backgroundColor: [RUN_COLOR, RIDE_COLOR, "#96ceb4"],
                  borderRadius: 6,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: "#e0e0ea", font: { size: 12 } }, grid: { color: "#2a2a3a55" } },
                y: { title: { display: true, text: "m / km", color: "#8888a0" }, ticks: { color: "#8888a0" }, grid: { color: "#2a2a3a55" } },
              },
            }}
          />
        </div>
      </div>

      {/* VAM Chart */}
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">VAM — Vertical Ascent Speed (m/h on climbs)</h3>
        <div className="h-80">
          <Bar
            data={{
              labels: activities.filter((a) => (a.vam ?? 0) > 0).map((a) => `${a.name.slice(0, 20)} (${fmtDate(a.start_time_utc)})`),
              datasets: [
                {
                  data: activities.filter((a) => (a.vam ?? 0) > 0).map((a) => a.vam ?? 0),
                  backgroundColor: activities.filter((a) => (a.vam ?? 0) > 0).map((a) => COLORS[a.sport] || "#8888a0"),
                  borderRadius: 4,
                },
              ],
            }}
            options={{
              indexAxis: "y",
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `VAM: ${(ctx.parsed.x ?? 0).toFixed(0)} m/h` } } },
              scales: {
                x: { title: { display: true, text: "m/h", color: "#8888a0" }, ticks: { color: "#8888a0" }, grid: { color: "#2a2a3a55" } },
                y: { ticks: { color: "#e0e0ea", font: { size: 9 } }, grid: { color: "#2a2a3a55" } },
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}

const COLORS: Record<string, string> = { Run: "#ff6b6b", Ride: "#4ecdc4", Hike: "#96ceb4", Swim: "#45b7d1" };
