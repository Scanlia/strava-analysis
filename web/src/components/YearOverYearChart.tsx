"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { Activity } from "@/lib/data";
import { useMemo, useState } from "react";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Title, Tooltip, Legend);

type SportFilter = "All" | "Run" | "Ride" | "Swim" | "Hike";
type MetricKey = "distance_km" | "time_hours" | "elevation_m" | "trimp";

const SPORTS: SportFilter[] = ["All", "Run", "Ride", "Swim", "Hike"];

const METRICS: { key: MetricKey; label: string; unit: string; decimals: number }[] = [
  { key: "distance_km", label: "Distance", unit: "km", decimals: 1 },
  { key: "time_hours", label: "Time", unit: "hrs", decimals: 1 },
  { key: "elevation_m", label: "Elevation", unit: "m", decimals: 0 },
  { key: "trimp", label: "TRIMP", unit: "", decimals: 0 },
];

function getWeekOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function viridisRgb(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [0.267004, 0.004874, 0.329415],
    [0.282623, 0.140926, 0.457517],
    [0.229739, 0.322361, 0.545706],
    [0.127568, 0.566949, 0.550556],
    [0.369214, 0.788888, 0.382914],
    [0.993248, 0.906157, 0.143936],
  ];
  const clamped = Math.max(0, Math.min(1, t));
  const idx = clamped * (stops.length - 1);
  const i = Math.floor(idx);
  if (i >= stops.length - 1) {
    return stops[stops.length - 1].map((v) => Math.round(v * 255)) as [number, number, number];
  }
  const f = idx - i;
  return [
    Math.round((stops[i][0] + f * (stops[i + 1][0] - stops[i][0])) * 255),
    Math.round((stops[i][1] + f * (stops[i + 1][1] - stops[i][1])) * 255),
    Math.round((stops[i][2] + f * (stops[i + 1][2] - stops[i][2])) * 255),
  ];
}

function getMetricValue(a: Activity, metric: MetricKey): number {
  switch (metric) {
    case "distance_km":
      return (a.distance_m || 0) / 1000;
    case "time_hours":
      return (a.moving_time_sec || 0) / 3600;
    case "elevation_m":
      return a.elevation_gain_m || 0;
    case "trimp":
      return a.trimp ?? 0;
  }
}

export default function YearOverYearChart({ activities }: { activities: Activity[] }) {
  const [sport, setSport] = useState<SportFilter>("All");
  const [metric, setMetric] = useState<MetricKey>("distance_km");

  const { labels, datasets } = useMemo(() => {
    const filtered =
      sport === "All"
        ? activities
        : activities.filter((a) => a.sport?.toLowerCase() === sport.toLowerCase());

    // year → week → cumulative value
    const yearWeekMap: Record<number, Record<number, number>> = {};
    for (const a of filtered) {
      const d = new Date(a.start_time_local);
      if (isNaN(d.getTime())) continue;
      const year = d.getFullYear();
      const week = getWeekOfYear(d);
      if (week < 1 || week > 53) continue;
      const val = getMetricValue(a, metric);
      if (!yearWeekMap[year]) yearWeekMap[year] = {};
      yearWeekMap[year][week] = (yearWeekMap[year][week] || 0) + val;
    }

    const years = Object.keys(yearWeekMap)
      .map(Number)
      .filter((y) => Object.keys(yearWeekMap[y] || {}).length > 0)
      .sort((a, b) => a - b);

    if (years.length === 0) {
      return { labels: [], datasets: [] };
    }

    const now = new Date();
    const currentYear = now.getFullYear();

    const metricInfo = METRICS.find((m) => m.key === metric)!;
    const labels = Array.from({ length: 52 }, (_, i) => `W${i + 1}`);

    const datasets = years.map((year, idx) => {
      const t = years.length > 1 ? idx / (years.length - 1) : 0.5;
      const [r, g, b] = viridisRgb(t);
      const isCurrent = year === currentYear;

      // Opacity: current year solid; older years progressively more transparent
      const alpha = isCurrent
        ? 1
        : Math.max(0.18, 0.15 + (idx / Math.max(years.length - 1, 1)) * 0.7);

      const weeks = yearWeekMap[year] || {};
      const maxDataWeek = Object.keys(weeks).length > 0
        ? Math.max(...Object.keys(weeks).map(Number))
        : 0;

      // For current year: stop at last week with data (no trailing zero flatline)
      const maxWeek = isCurrent ? maxDataWeek : 52;

      const data: (number | null)[] = [];
      let total = 0;
      for (let w = 1; w <= 52; w++) {
        if (isCurrent && w > maxWeek) {
          data.push(null);
        } else {
          const val = weeks[w] || 0;
          data.push(val);
          total += val;
        }
      }

      const totalStr = metric === "trimp"
        ? `${total.toFixed(0)}`
        : `${total.toFixed(metricInfo.decimals)} ${metricInfo.unit}`;

      return {
        label: `${year} (${totalStr})`,
        data,
        borderColor: `rgba(${r},${g},${b},${alpha})`,
        backgroundColor: `rgba(${r},${g},${b},${alpha * 0.15})`,
        borderWidth: isCurrent ? 2.5 : 1.2,
        pointRadius: isCurrent ? 2 : 0,
        pointHoverRadius: 4,
        tension: 0.15,
        spanGaps: false,
      };
    });

    return { labels, datasets };
  }, [activities, sport, metric]);

  const metricInfo = METRICS.find((m) => m.key === metric)!;

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
      <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
        Year-over-Year Comparison
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Weekly {metricInfo.label.toLowerCase()} totals overlaid by year.
        Older years appear fainter (purple), newer years brighter (yellow-green).
      </p>

      {/* Sport filter tabs */}
      <div className="flex flex-wrap gap-2 mb-3">
        {SPORTS.map((s) => (
          <button
            key={s}
            onClick={() => setSport(s)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              sport === s
                ? "bg-violet-600 text-white"
                : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border border-white/10"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Metric selector tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              metric === m.key
                ? "bg-emerald-600 text-white"
                : "bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border border-white/10"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="h-[400px]">
        {datasets.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            No activities found for the selected filters.
          </div>
        ) : (
          <Line
            data={{ labels, datasets: datasets as any }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: "index" as const, intersect: false },
              plugins: {
                legend: {
                  position: "bottom" as const,
                  labels: {
                    color: "#e0e0ea",
                    usePointStyle: true,
                    padding: 10,
                    font: { size: 10 },
                  },
                },
                tooltip: {
                  callbacks: {
                    label: (ctx: any) => {
                      const val = ctx.parsed.y;
                      if (val == null) return "";
                      const yearLabel = ctx.dataset.label.split(" (")[0];
                      return `${yearLabel}: ${val.toFixed(metricInfo.decimals)} ${metricInfo.unit}`.trim();
                    },
                  },
                },
              },
              scales: {
                x: {
                  ticks: {
                    color: "#8888a0",
                    maxTicksLimit: 26,
                    font: { size: 10 },
                    callback: (_: any, index: number) =>
                      (index + 1) % 4 === 1 ? `W${index + 1}` : "",
                  },
                  grid: { color: "#2a2a3a55" },
                },
                y: {
                  title: {
                    display: true,
                    text: metricInfo.unit
                      ? `${metricInfo.label} (${metricInfo.unit})`
                      : metricInfo.label,
                    color: "#8888a0",
                    font: { size: 11 },
                  },
                  ticks: { color: "#8888a0", font: { size: 10 } },
                  grid: { color: "#2a2a3a55" },
                  beginAtZero: true,
                },
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
