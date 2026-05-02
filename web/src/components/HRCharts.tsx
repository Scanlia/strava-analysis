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
  ArcElement,
  TimeScale,
} from "chart.js";
import "chartjs-adapter-luxon";
import { Bar, Doughnut, Line, Scatter } from "react-chartjs-2";
import type { Activity } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, TimeScale, Title, Tooltip, Legend);

const COLORS: Record<string, string> = { Run: "#ff6b6b", Ride: "#4ecdc4", Hike: "#96ceb4", Swim: "#45b7d1" };
const ZONE_COLORS = ["#96ceb4", "#4ecdc4", "#ffe66d", "#ff6b6b", "#ff3333"];

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function HRCharts({ activities }: { activities: Activity[] }) {
  // --- HR scatter (time scale for proper ordering) ---
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
          return d ? { x: d, y: a.avg_hr, name: a.name, date: fmtDate(a.start_time_utc) } : null;
        }).filter(Boolean),
        borderColor: COLORS[s],
        backgroundColor: COLORS[s],
        pointRadius: 5,
        pointHoverRadius: 7,
        showLine: false,
      };
    });

  // --- EF trend per sport with proper line ---
  const efActs = activities
    .filter((a) => (a.efficiency_factor ?? 0) > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));

  const efBySport: Record<string, { x: number; y: number }[]> = {};
  for (const a of efActs) {
    if (!efBySport[a.sport]) efBySport[a.sport] = [];
    const ts = a.start_time_utc ? new Date(a.start_time_utc).getTime() : null;
    if (ts) efBySport[a.sport].push({ x: ts, y: a.efficiency_factor! });
  }

  const efDatasets = Object.entries(efBySport).map(([sport, data]) => ({
    label: sport + " EF",
    data: data.sort((a, b) => a.x - b.x),
    borderColor: COLORS[sport] || "#8888a0",
    backgroundColor: (COLORS[sport] || "#8888a0") + "30",
    tension: 0.3,
    pointRadius: 4,
    showLine: true,
    fill: false,
  }));

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
    `${a.sport === 'Run' ? '🏃' : a.sport === 'Ride' ? '🚴' : a.sport === 'Hike' ? '🥾' : '🏊'} ${a.name.slice(0, 18)} (${fmtDate(a.start_time_utc)})`
  );
  const decouplingValues = decouplingActs.map((a) => a.aerobic_decoupling_pct ?? 0);
  const decouplingColors = decouplingValues.map((v) => (v > 5 ? "#ff6b6b" : "#4ecdc4"));

  // --- TRIMP ---
  const trimpActs = activities
    .filter((a) => (a.trimp ?? 0) > 0 && a.start_time_utc)
    .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));
  const trimpLabels = trimpActs.map((a) => fmtDate(a.start_time_utc));

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">Average HR by Activity</h3>
          <div className="h-80">
            {hrDatasets.length > 0 ? (
              <Scatter
                data={{ datasets: hrDatasets }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 16 } },
                    tooltip: { callbacks: { label: (ctx: any) => `HR: ${ctx.parsed.y ?? 0} bpm` } },
                  },
                  scales: {
                    x: {
                      type: "time",
                      time: { unit: "month", tooltipFormat: "MMM d, yyyy" },
                      ticks: { color: "#8888a0", maxTicksLimit: 20 },
                      grid: { color: "#2a2a3a55" },
                    },
                    y: { title: { display: true, text: "bpm", color: "#8888a0" }, ticks: { color: "#8888a0" }, grid: { color: "#2a2a3a55" } },
                  },
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">No HR data available</div>
            )}
          </div>
        </div>
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">Efficiency Factor Trend (pace/HR)</h3>
          <div className="h-80">
            {efDatasets.length > 0 ? (
              <Line
                data={{ datasets: efDatasets }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 16 } },
                    tooltip: { callbacks: { label: (ctx: any) => `EF: ${(ctx.parsed.y ?? 0).toFixed(2)}` } },
                  },
                  scales: {
                    x: {
                      type: "time",
                      time: { unit: "month", tooltipFormat: "MMM d, yyyy" },
                      ticks: { color: "#8888a0", maxTicksLimit: 20 },
                      grid: { color: "#2a2a3a55" },
                    },
                    y: { title: { display: true, text: "Efficiency Factor", color: "#8888a0" }, ticks: { color: "#8888a0" }, grid: { color: "#2a2a3a55" } },
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
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">HR Zone Distribution</h3>
          <div className="h-72">
            <Doughnut
              data={{
                labels: ["Z1 Recovery", "Z2 Endurance", "Z3 Tempo", "Z4 Threshold", "Z5 Max"],
                datasets: [
                  {
                    data: [zones.Z1 || 0, zones.Z2 || 0, zones.Z3 || 0, zones.Z4 || 0, zones.Z5 || 0],
                    backgroundColor: ZONE_COLORS,
                    borderColor: "#141420",
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 8, font: { size: 10 } } },
                },
              }}
            />
          </div>
        </div>
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">Aerobic Decoupling (lower = fitter)</h3>
          <div className="h-72">
            {decouplingActs.length > 0 ? (
              <Bar
                data={{
                  labels: decouplingLabels,
                  datasets: [{ data: decouplingValues, backgroundColor: decouplingColors, borderRadius: 4 }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => `Decoupling: ${(ctx.parsed.y ?? 0).toFixed(2)}%` } },
                  },
                  scales: {
                    x: { ticks: { color: "#8888a0", maxRotation: 45, autoSkip: true, maxTicksLimit: 12, font: { size: 9 } }, grid: { color: "#2a2a3a55" } },
                    y: { title: { display: true, text: "%", color: "#8888a0" }, ticks: { color: "#8888a0" }, grid: { color: "#2a2a3a55" } },
                  },
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">No decoupling data</div>
            )}
          </div>
        </div>
        <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">Training Load (TRIMP)</h3>
          <div className="h-72">
            {trimpActs.length > 0 ? (
              <Bar
                data={{
                  labels: trimpLabels,
                  datasets: [
                    {
                      data: trimpActs.map((a) => a.trimp ?? 0),
                      backgroundColor: trimpActs.map((a) => COLORS[a.sport] || "#8888a0"),
                      borderRadius: 3,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => `TRIMP: ${(ctx.parsed.y ?? 0).toFixed(1)}` } },
                  },
                  scales: {
                    x: { ticks: { color: "#8888a0", maxRotation: 45, autoSkip: true, maxTicksLimit: 12, font: { size: 9 } }, grid: { color: "#2a2a3a55" } },
                    y: { ticks: { color: "#8888a0" }, grid: { color: "#2a2a3a55" } },
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
