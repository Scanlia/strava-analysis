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
  ScatterController,
} from "chart.js";
import { Scatter } from "react-chartjs-2";
import { useState, useMemo } from "react";
import type { Activity, GapSegment, Aggregate } from "@/lib/data";

ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  ScatterController,
);

const HR_BIN = 10;

type SportTab = "Run" | "Ride";

interface PaceHRPoint {
  hr: number;
  value: number;
  year: number;
  activityName: string;
  date: string;
}

function formatPace(minPerKm: number): string {
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")} /km`;
}

function yearColor(year: number, years: number[], alpha: number = 1): string {
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
  return `rgba(${r},${gr},${bl},${alpha})`;
}

export default function PaceHRScatter({
  activities,
  aggregate,
}: {
  activities: Activity[];
  aggregate?: Aggregate;
}) {
  const [sport, setSport] = useState<SportTab>("Run");

  const sportMaxHR = aggregate?.sport_max_hr?.[sport] ?? 0;
  const z2Min = sportMaxHR > 0 ? Math.round(sportMaxHR * 0.6) : 0;
  const z2Max = sportMaxHR > 0 ? Math.round(sportMaxHR * 0.7) : 0;

  const points = useMemo(() => {
    const result: PaceHRPoint[] = [];
    const sportActs = activities.filter(
      (a) =>
        a.sport === sport &&
        a.gap_segments?.length &&
        a.start_time_utc,
    );
    for (const act of sportActs) {
      const year = new Date(act.start_time_utc!).getFullYear();
      for (const seg of act.gap_segments!) {
        if (seg.avg_hr == null) continue;
        if (
          sportMaxHR > 0 &&
          (seg.avg_hr < z2Min || seg.avg_hr > z2Max)
        )
          continue;
        if (sport === "Run") {
          if (seg.gap_pace_min_km != null && seg.gap_pace_min_km > 0) {
            result.push({
              hr: seg.avg_hr,
              value: seg.gap_pace_min_km,
              year,
              activityName: act.name,
              date: act.start_time_utc!,
            });
          }
        } else {
          if (seg.gap_speed_kmh != null && seg.gap_speed_kmh > 0) {
            result.push({
              hr: seg.avg_hr,
              value: seg.gap_speed_kmh,
              year,
              activityName: act.name,
              date: act.start_time_utc!,
            });
          }
        }
      }
    }
    return result;
  }, [activities, sport, sportMaxHR, z2Min, z2Max]);

  const years = useMemo(() => {
    const set = new Set(points.map((p) => p.year));
    return [...set].sort((a, b) => a - b);
  }, [points]);

  const binnedTrends = useMemo(() => {
    return years.map((year) => {
      const yearPoints = points.filter((p) => p.year === year);
      const bins = new Map<
        number,
        { hrSum: number; valSum: number; count: number }
      >();
      for (const p of yearPoints) {
        const binStart = Math.floor(p.hr / HR_BIN) * HR_BIN;
        const b = bins.get(binStart) || {
          hrSum: 0,
          valSum: 0,
          count: 0,
        };
        b.hrSum += p.hr;
        b.valSum += p.value;
        b.count++;
        bins.set(binStart, b);
      }
      return Array.from(bins.entries())
        .filter(([, b]) => b.count >= 2)
        .map(([, b]) => ({
          x: b.hrSum / b.count,
          y: b.valSum / b.count,
        }))
        .sort((a, b) => a.x - b.x);
    });
  }, [points, years]);

  const isRun = sport === "Run";
  const hasData = points.length > 0;

  const datasets: any[] = [];

  years.forEach((year, idx) => {
    const yearPoints = points.filter((p) => p.year === year);
    const colorPt = yearColor(year, years, 0.75);
    const colorTrend = yearColor(year, years, 1);

    datasets.push({
      label: String(year),
      data: yearPoints.map((p) => ({
        x: p.hr,
        y: p.value,
        activityName: p.activityName,
        date: p.date,
      })),
      borderColor: colorPt,
      backgroundColor: colorPt,
      pointRadius: 3,
      pointHoverRadius: 6,
      showLine: false,
      order: 2,
    });

    const trend = binnedTrends[idx];
    if (trend && trend.length >= 2) {
      datasets.push({
        label: `${year} trend`,
        data: trend,
        borderColor: colorTrend,
        backgroundColor: colorTrend,
        borderWidth: 2.5,
        pointRadius: 0,
        showLine: true,
        tension: 0,
        order: 1,
      });
    }
  });

  const chartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: {
          color: "#e0e0ea",
          usePointStyle: true,
          padding: 8,
          font: { size: 10 },
          filter: (item: any) =>
            typeof item.text === "string" && !item.text.includes("trend"),
        },
      },
      tooltip: {
        backgroundColor: "#1a1a2e",
        titleColor: "#e0e0ea",
        bodyColor: "#c0c0d0",
        borderColor: "#2a2a3a",
        borderWidth: 1,
        callbacks: {
          label: (ctx: any) => {
            const raw = ctx.raw as any;
            if (!raw) return "";
            const lines: string[] = [];
            if (isRun) {
              lines.push(`Pace: ${formatPace(raw.y ?? 0)}`);
            } else {
              lines.push(`Speed: ${(raw.y ?? 0).toFixed(1)} km/h`);
            }
            lines.push(`HR: ${Math.round(raw.x ?? 0)} bpm`);
            if (raw.activityName) {
              lines.push(`Activity: ${raw.activityName}`);
              if (raw.date) {
                lines.push(
                  `Date: ${new Date(raw.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}`,
                );
              }
            }
            return lines;
          },
        },
      },
    },
    scales: {
      x: {
        type: "linear" as const,
        title: {
          display: true,
          text: "Avg HR (bpm)",
          color: "#8888a0",
          font: { size: 11 },
        },
        ticks: {
          color: "#8888a0",
          font: { size: 11 },
        },
        grid: { color: "#2a2a3a55" },
      },
      y: {
        type: "linear" as const,
        reverse: isRun,
        title: {
          display: true,
          text: isRun
            ? "GAP Pace (min/km \u2014 faster \u2191)"
            : "GAP Speed (km/h)",
          color: "#8888a0",
          font: { size: 11 },
        },
        ticks: {
          color: "#8888a0",
          font: { size: 11 },
          callback: isRun
            ? (v: any) =>
                typeof v === "number" && v > 0 ? formatPace(v) : v
            : undefined,
        },
        grid: { color: "#2a2a3a55" },
      },
    },
  };

  const z2Label =
    sportMaxHR > 0
      ? `Z2 (${z2Min}\u2013${z2Max} bpm = 60\u201370% of ${sportMaxHR} max)`
      : "Z2 range unknown (no sport max HR)";

  if (!hasData) return null;

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
      <div className="flex items-center gap-1 mb-3">
        {(["Run", "Ride"] as const).map((s) => (
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
      <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
        Pace-HR Efficiency \u2014 {sport}
      </h3>
      <p className="text-[10px] text-gray-500 mb-1">
        Each dot = a {isRun ? "1km" : "5min"} split. Filtered to {z2Label}.
        {sportMaxHR === 0 &&
          " No Z2 filter applied due to missing sport max HR."}
      </p>
      <p className="text-xs text-gray-400 mb-3">
        Improvement = cloud shifts up-left
      </p>
      <div className="h-[400px]">
        <Scatter data={{ datasets }} options={chartOptions} />
      </div>
    </div>
  );
}
