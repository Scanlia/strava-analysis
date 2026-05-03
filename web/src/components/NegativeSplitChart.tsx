"use client";

import { useMemo } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, TimeScale, Title, Tooltip, Legend, Filler } from "chart.js";
import "chartjs-adapter-luxon";
import { Line } from "react-chartjs-2";
import type { Activity } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, TimeScale, Title, Tooltip, Legend, Filler);

interface Props {
  activities: Activity[];
}

export default function NegativeSplitChart({ activities }: Props) {
  const runs = useMemo(() => {
    return activities
      .filter((a) => {
        if (a.sport !== "Run") return false;
        const ns = (a as any).is_negative_split;
        if (ns === undefined || ns === null) return false;
        return a.start_time_utc != null;
      })
      .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));
  }, [activities]);

  const rollingData = useMemo(() => {
    const window = 10;
    const points: { x: number; y: number }[] = [];

    for (let i = 0; i < runs.length; i++) {
      const start = Math.max(0, i - window + 1);
      const slice = runs.slice(start, i + 1);
      const negCount = slice.filter(
        (r) => (r as any).is_negative_split === true
      ).length;
      const rate = slice.length > 0 ? (negCount / slice.length) * 100 : 0;
      points.push({
        x: new Date(runs[i].start_time_utc!).getTime(),
        y: Math.round(rate * 10) / 10,
      });
    }

    return points;
  }, [runs]);

  const overallStats = useMemo(() => {
    const total = runs.length;
    const neg = runs.filter(
      (r) => (r as any).is_negative_split === true
    ).length;
    const pct = total > 0 ? (neg / total) * 100 : 0;
    return { total, neg, pct };
  }, [runs]);

  if (runs.length < 5) {
    return (
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5 text-gray-300">
        <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
          Negative Split Rate
        </h3>
        <p className="text-[10px] text-gray-500 mb-3">
          Percentage of runs where second half is faster than first half.
        </p>
        <div className="flex items-center justify-center h-[300px] text-gray-500 text-sm">
          Not enough run data with split info (need 5+ runs)
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5 text-gray-300">
      <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
        Negative Split Rate (10-Run Rolling)
      </h3>
      <p className="text-[10px] text-gray-500 mb-2">
        Percentage of negative splits in the last 10 runs, over time.
      </p>

      <div className="flex items-center gap-6 mb-4">
        <div className="text-center">
          <div className="text-3xl font-bold text-violet-400 tabular-nums">
            {overallStats.neg}
          </div>
          <div className="text-xs text-gray-500">negative splits</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold text-emerald-400 tabular-nums">
            {overallStats.pct.toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500">
            of {overallStats.total} total runs
          </div>
        </div>
        <div className="flex-1" />
      </div>

      <div className="h-[300px]">
        <Line
          data={{
            datasets: [
              {
                label: "Negative Split Rate (last 10 runs)",
                data: rollingData as any,
                borderColor: "#a78bfa",
                backgroundColor: "rgba(167, 139, 250, 0.08)",
                fill: true,
                pointRadius: 1,
                pointHoverRadius: 4,
                pointBackgroundColor: "#a78bfa",
                tension: 0.2,
                borderWidth: 1.5,
              },
              {
                label: "50% line",
                data: rollingData.length > 0
                  ? [
                      { x: rollingData[0].x, y: 50 },
                      { x: rollingData[rollingData.length - 1].x, y: 50 },
                    ]
                  : [],
                borderColor: "#6b7280",
                borderWidth: 1,
                borderDash: [4, 4],
                pointRadius: 0,
                pointHoverRadius: 0,
                fill: false,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index" as const, intersect: false },
            plugins: {
              legend: {
                position: "bottom" as const,
                labels: { color: "#e0e0ea", usePointStyle: true, padding: 10, font: { size: 10 } },
              },
              tooltip: {
                callbacks: {
                  label: (ctx: any) => {
                    const y = ctx.parsed?.y ?? ctx.raw?.y;
                    if (y != null) return `Negative Split Rate: ${y.toFixed(1)}%`;
                    return "";
                  },
                },
              },
            },
            scales: {
              x: {
                type: "time" as const,
                time: { unit: "month" as const, tooltipFormat: "MMM d, yyyy" },
                ticks: { color: "#8888a0", maxTicksLimit: 12, font: { size: 10 } },
                grid: { color: "#2a2a3a55" },
              },
              y: {
                title: { display: true, text: "Negative Split %", color: "#8888a0", font: { size: 11 } },
                ticks: {
                  color: "#8888a0",
                  font: { size: 10 },
                  callback: (v: any) => `${v}%`,
                },
                grid: { color: "#2a2a3a55" },
                min: -5,
                max: 100,
              },
            },
          }}
        />
      </div>

      <div className="mt-3 pt-3 border-t border-[#2a2a3a] text-xs text-gray-500">
        {overallStats.total} runs with split data. Overall: {overallStats.neg} negative splits ({overallStats.pct.toFixed(1)}%).
      </div>
    </div>
  );
}
