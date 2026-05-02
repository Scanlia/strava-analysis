"use client";

import { useMemo } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, TimeScale, Title, Tooltip, Legend } from "chart.js";
import "chartjs-adapter-luxon";
import { Line } from "react-chartjs-2";
import type { Activity } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, TimeScale, Title, Tooltip, Legend);

interface Props {
  activities: Activity[];
}

interface HikePoint {
  date: Date;
  ratio: number;
  name: string;
}

export default function NaismithChart({ activities }: Props) {
  const hikes = useMemo(() => {
    const seen = new Set<string>();
    const points: HikePoint[] = [];

    for (const a of activities) {
      if (a.sport !== "Hike") continue;
      const ratio = (a as any).naismith_ratio;
      if (ratio == null || typeof ratio !== "number") continue;
      if (!a.start_time_utc) continue;

      const d = new Date(a.start_time_utc);
      const dateKey = d.toISOString().slice(0, 10);
      if (seen.has(dateKey)) continue;
      seen.add(dateKey);

      points.push({
        date: d,
        ratio: ratio as number,
        name: a.name,
      });
    }

    points.sort((a, b) => a.date.getTime() - b.date.getTime());
    return points;
  }, [activities]);

  if (hikes.length < 2) {
    return (
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5 text-gray-300">
        <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
          Naismith Ratio — Hike Efficiency
        </h3>
        <p className="text-[10px] text-gray-500 mb-3">
          Compares actual hiking speed to Naismith's rule prediction.
        </p>
        <div className="flex items-center justify-center h-[300px] text-gray-500 text-sm">
          Not enough hike data with Naismith ratios (need 2+ hikes)
        </div>
      </div>
    );
  }

  const firstDate = hikes[0].date;
  const lastDate = hikes[hikes.length - 1].date;

  const referenceLines = [
    { value: 1.0, label: "Naismith fit", color: "#8888a0" },
    { value: 0.85, label: "strong hiker", color: "#22c55e" },
    { value: 1.2, label: "leisurely", color: "#f59e0b" },
  ];

  const pointColors = hikes.map((h) => {
    if (h.ratio < 0.85) return "#22c55e";
    if (h.ratio < 1.0) return "#3b82f6";
    if (h.ratio < 1.2) return "#f59e0b";
    return "#ef4444";
  });

  const datasets: any[] = [
    {
      label: "Naismith Ratio",
      data: hikes.map((h) => ({ x: h.date.getTime(), y: h.ratio, name: h.name })),
      borderColor: "#a78bfa",
      backgroundColor: pointColors,
      pointBackgroundColor: pointColors,
      pointBorderColor: pointColors,
      pointRadius: 5,
      pointHoverRadius: 7,
      showLine: true,
      borderWidth: 1.5,
      tension: 0,
      order: 10,
    },
    ...referenceLines.map((ref) => ({
      label: `${ref.label} (${ref.value})`,
      data: [
        { x: firstDate.getTime(), y: ref.value },
        { x: lastDate.getTime(), y: ref.value },
      ],
      borderColor: ref.color,
      borderWidth: 1,
      borderDash: [6, 4],
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false,
      order: 1,
    })),
  ];

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5 text-gray-300">
      <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
        Naismith Ratio — Hike Efficiency
      </h3>
      <p className="text-[10px] text-gray-500 mb-2">
        Compares actual hiking speed to Naismith's rule. Ratio &lt; 1 = faster than predicted, &gt; 1 = slower.
      </p>
      <div className="flex flex-wrap gap-3 mb-3 text-[10px] text-gray-500">
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-[#22c55e]" /> Strong (&lt;0.85)
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-[#3b82f6]" /> Good (0.85–1.0)
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-[#f59e0b]" /> Leisurely (1.0–1.2)
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-[#ef4444]" /> Slow (&gt;1.2)
        </div>
      </div>
      <div className="h-[300px]">
        <Line
          data={{ datasets }}
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
                    const raw = ctx.raw;
                    if (raw && raw.name) {
                      return `${raw.name}: ${raw.y.toFixed(2)}`;
                    }
                    const y = ctx.parsed?.y ?? ctx.raw?.y;
                    if (y != null) return `${ctx.dataset.label}: ${y.toFixed(2)}`;
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
                title: { display: true, text: "Naismith Ratio", color: "#8888a0", font: { size: 11 } },
                ticks: { color: "#8888a0", font: { size: 10 } },
                grid: { color: "#2a2a3a55" },
                min: 0.5,
                max: 2.0,
              },
            },
          }}
        />
      </div>
      <div className="mt-3 pt-3 border-t border-[#2a2a3a] text-xs text-gray-500">
        {hikes.length} hikes with Naismith data. Reference lines: 1.0 = exact Naismith fit, 0.85 = strong hiker, 1.2 = leisurely.
      </div>
    </div>
  );
}
