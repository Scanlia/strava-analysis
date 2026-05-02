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
  TimeScale,
  LogarithmicScale,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { useState, useMemo } from "react";
import type { Aggregate } from "@/lib/data";

ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  LogarithmicScale,
);

const SPORT_TABS = ["Run", "Ride", "Swim", "Hike"] as const;

interface SpeedEntry {
  activity_id: string;
  activity_name: string;
  date: string;
  speed_ms?: number;
  speed: {
    target: number;
    unit: string;
    distance_m?: number;
    speed_ms: number;
    pace_min_km: number | null;
    speed_kmh: number | null;
  };
}

interface SpeedDurationSport {
  targets: string[];
  best_ever: Record<string, SpeedEntry>;
  by_year: Record<string, Record<string, SpeedEntry[]>>;
}

function formatDuration(seconds: number): string {
  if (seconds < 120) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${(seconds / 3600).toFixed(1)}hr`;
}

function getSpeedKmh(entry: SpeedEntry): number {
  return entry.speed.speed_kmh ?? entry.speed.speed_ms * 3.6;
}

function targetDuration(target: string, speedMs: number): number {
  const match = target.match(/^(\d+)([sm])$/);
  if (!match) return parseInt(target) || 0;
  const value = parseInt(match[1]);
  if (match[2] === "s") return value;
  return value / speedMs;
}

function yearLineStyle(
  year: number,
  years: number[],
  currentYear: number,
): { color: string; borderWidth: number; borderDash: number[] } {
  const sorted = [...years].sort((a, b) => a - b);
  const idx = sorted.indexOf(year);
  const t = sorted.length > 1 ? idx / (sorted.length - 1) : 0.5;

  const stops: [number, number, number][] = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];
  const pos = t * (stops.length - 1);
  const i = Math.min(Math.floor(pos), stops.length - 2);
  const f = pos - i;
  const [r1, g1, b1] = stops[i];
  const [r2, g2, b2] = stops[i + 1];
  const r = Math.round(r1 + (r2 - r1) * f);
  const gr = Math.round(g1 + (g2 - g1) * f);
  const bl = Math.round(b1 + (b2 - b1) * f);

  const isCurrent = year === currentYear;
  return {
    color: `rgba(${r},${gr},${bl},${isCurrent ? 1 : 0.45 + t * 0.4})`,
    borderWidth: isCurrent ? 3 : 1.5,
    borderDash: isCurrent ? [] : [8, 4],
  };
}

export default function SpeedDurationChart({ aggregate }: { aggregate: Aggregate }) {
  const speedDuration = (aggregate as any).speed_duration as Record<string, SpeedDurationSport> | undefined;

  const availableSports = useMemo(
    () => SPORT_TABS.filter((s) => speedDuration?.[s]),
    [speedDuration],
  );

  const [sport, setSport] = useState<string>(availableSports[0] ?? "");

  if (!speedDuration || availableSports.length === 0) return null;

  const sportData = speedDuration[sport];
  if (!sportData) return null;

  const { targets, best_ever: bestEver, by_year: byYear } = sportData;

  const currentYear = new Date().getFullYear();

  // Collect all years that appear in by_year across all targets
  const allYears = useMemo(() => {
    const set = new Set<number>();
    for (const t of targets) {
      const yd = byYear[t];
      if (yd) {
        for (const y of Object.keys(yd)) {
          set.add(parseInt(y));
        }
      }
    }
    return [...set].sort((a, b) => a - b);
  }, [targets, byYear]);

  // Build per-year datasets
  const yearDatasets = useMemo(() => {
    return allYears.map((year) => {
      const points: { x: number; y: number; activityName: string; date: string }[] = [];

      for (const target of targets) {
        const entries = byYear[target]?.[String(year)];
        if (!entries || entries.length === 0) continue;
        let best = entries[0];
        let bestKmh = getSpeedKmh(best);
        for (let i = 1; i < entries.length; i++) {
          const kmh = getSpeedKmh(entries[i]);
          if (kmh > bestKmh) {
            best = entries[i];
            bestKmh = kmh;
          }
        }
        const dur = targetDuration(target, best.speed.speed_ms);
        points.push({
          x: dur,
          y: bestKmh,
          activityName: best.activity_name,
          date: best.date,
        });
      }

      points.sort((a, b) => a.x - b.x);
      return { year, points };
    });
  }, [allYears, targets, byYear]);

  // Best-ever points
  const bestEverPoints = useMemo(() => {
    const points: { x: number; y: number; activityName: string; date: string }[] = [];
    for (const target of Object.keys(bestEver)) {
      const entry = bestEver[target];
      if (!entry) continue;
      const dur = targetDuration(target, entry.speed.speed_ms);
      points.push({
        x: dur,
        y: getSpeedKmh(entry),
        activityName: entry.activity_name,
        date: entry.date,
      });
    }
    points.sort((a, b) => a.x - b.x);
    return points;
  }, [bestEver]);

  // Compute y-axis range for shared speed/pace axes
  const allSpeeds = useMemo(() => {
    const speeds: number[] = [];
    for (const ds of yearDatasets) {
      for (const p of ds.points) speeds.push(p.y);
    }
    for (const p of bestEverPoints) speeds.push(p.y);
    return speeds;
  }, [yearDatasets, bestEverPoints]);

  const yMin = allSpeeds.length > 0 ? Math.floor(Math.min(...allSpeeds) * 0.95) : 0;
  const yMax = allSpeeds.length > 0 ? Math.ceil(Math.max(...allSpeeds) * 1.05) : 30;

  const chartData = {
    datasets: [
      ...yearDatasets.map(({ year, points }) => {
        const style = yearLineStyle(year, allYears, currentYear);
        return {
          label: String(year),
          data: points,
          borderColor: style.color,
          backgroundColor: style.color,
          borderWidth: style.borderWidth,
          borderDash: style.borderDash,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0,
          spanGaps: false,
        };
      }),
      ...(bestEverPoints.length > 0
        ? [
            {
              label: "Best Ever",
              data: bestEverPoints,
              borderColor: "#ffffff",
              backgroundColor: "#ffffff",
              borderWidth: 0,
              pointRadius: 8,
              pointHoverRadius: 10,
              pointStyle: "star" as const,
              showLine: false,
              order: 0,
            },
          ]
        : []),
    ],
  };

  const showPace = sport === "Run";

  const chartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "nearest" as const, intersect: false },
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: {
          color: "#e0e0ea",
          usePointStyle: true,
          padding: 14,
          font: { size: 11 },
        },
      },
      tooltip: {
        backgroundColor: "#1a1a2e",
        titleColor: "#e0e0ea",
        bodyColor: "#c0c0d0",
        borderColor: "#2a2a3a",
        borderWidth: 1,
        callbacks: {
          title: (items: any) =>
            items.length ? formatDuration(items[0].parsed.x) : "",
          label: (ctx: any) => {
            const raw = ctx.raw as { x: number; y: number; activityName?: string; date?: string };
            const lines = [`Speed: ${raw.y.toFixed(1)} km/h`];
            if (showPace && raw.y > 0) {
              lines.push(`Pace: ${(60 / raw.y).toFixed(2)} min/km`);
            }
            if (raw.activityName) {
              lines.push(`Activity: ${raw.activityName}`);
            }
            return lines;
          },
        },
      },
    },
    scales: {
      x: {
        type: "logarithmic" as const,
        title: {
          display: true,
          text: "Duration",
          color: "#8888a0",
          font: { size: 11 },
        },
        ticks: {
          color: "#8888a0",
          font: { size: 10 },
          callback: (value: any) => formatDuration(value),
          maxTicksLimit: 10,
        },
        grid: { color: "#2a2a3a55" },
      },
      y: {
        type: "linear" as const,
        position: "left" as const,
        min: yMin,
        max: yMax,
        title: {
          display: true,
          text: "Speed (km/h)",
          color: "#8888a0",
          font: { size: 11 },
        },
        ticks: {
          color: "#8888a0",
          font: { size: 10 },
        },
        grid: { color: "#2a2a3a55" },
      },
      ...(showPace
        ? {
            yPace: {
              type: "linear" as const,
              position: "right" as const,
              min: yMin,
              max: yMax,
              title: {
                display: true,
                text: "Pace (min/km)",
                color: "#8888a0",
                font: { size: 11 },
              },
              ticks: {
                color: "#8888a0",
                font: { size: 10 },
                callback: (value: any) => {
                  if (value > 0) return (60 / value).toFixed(2);
                  return "";
                },
              },
              grid: { drawOnChartArea: false },
            },
          }
        : {}),
    },
  };

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
      <div className="flex items-center gap-1 mb-4">
        {availableSports.map((s) => (
          <button
            key={s}
            onClick={() => setSport(s)}
            className={`px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
              sport === s
                ? "bg-violet-600 text-white"
                : "bg-white/5 text-gray-400 hover:text-white border border-white/10"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="h-[400px]">
        <Line data={chartData} options={chartOptions} />
      </div>
    </div>
  );
}
