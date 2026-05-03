"use client";

import { useMemo } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, TimeScale, Title, Tooltip, Legend, Filler } from "chart.js";
import "chartjs-adapter-luxon";
import { Line } from "react-chartjs-2";
import type { Aggregate } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, TimeScale, Title, Tooltip, Legend, Filler);

const SPORT_COLOR: Record<string, string> = { Run: "#ff6b35", Ride: "#3da5d9", Swim: "#00d4d4", Hike: "#7fb069" };

export default function HRRecoveryChart({ aggregate }: { aggregate?: Aggregate }) {
  const recovery = aggregate?.hr_recovery;

  const { hrr60Data, hrr120Data, activities } = useMemo(() => {
    const trend = recovery?.trend ?? [];
    const acts = recovery?.activities ?? [];
    return {
      hrr60Data: trend
        .filter((p) => p.hrr_60 != null)
        .map((p) => ({ x: new Date(p.date).getTime(), y: p.hrr_60 })),
      hrr120Data: trend
        .filter((p) => p.hrr_120 != null)
        .map((p) => ({ x: new Date(p.date).getTime(), y: p.hrr_120 })),
      activities: acts,
    };
  }, [recovery]);

  if (!recovery || recovery.total_qualifying < 1) {
    return (
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">HR Recovery Rate</h3>
        <p className="text-[10px] text-gray-500 mb-3">
          How quickly your heart rate drops after ending a hard effort. Requires recording to continue 2+ min after stopping.
        </p>
        <div className="flex items-center justify-center h-[200px] text-gray-500 text-sm">
          {recovery ? `${recovery.total_qualifying} qualifying activities — need more for chart` : "No qualifying activities yet. Keep recording for 2+ min after stopping."}
        </div>
      </div>
    );
  }

  const hasTrend = hrr60Data.length >= 2;

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
      <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
        HR Recovery Rate
      </h3>
      <p className="text-[10px] text-gray-500 mb-3">
        BPM drop after peak effort. Higher = better aerobic fitness. {recovery.total_qualifying} qualifying activities (Z3+ effort, ≥90s recovery recording).
      </p>

      {hasTrend ? (
        <div className="h-[300px]">
          <Line
            data={{
              datasets: [
                {
                  label: "HRR 60s (drop after 1 min)",
                  data: hrr60Data as any,
                  borderColor: "#a78bfa",
                  backgroundColor: "rgba(167, 139, 250, 0.1)",
                  fill: false,
                  pointRadius: 3,
                  pointHoverRadius: 6,
                  pointBackgroundColor: "#a78bfa",
                  tension: 0.2,
                  borderWidth: 2,
                },
                ...(hrr120Data.length > 0
                  ? [{
                      label: "HRR 120s (drop after 2 min)",
                      data: hrr120Data as any,
                      borderColor: "rgba(167, 139, 250, 0.4)",
                      backgroundColor: "transparent",
                      fill: false,
                      pointRadius: 2,
                      pointHoverRadius: 5,
                      pointBackgroundColor: "rgba(167, 139, 250, 0.8)",
                      tension: 0.2,
                      borderWidth: 1.5,
                      borderDash: [4, 3],
                    }]
                  : []),
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
                      if (y != null) return `${ctx.dataset.label}: ${y.toFixed(1)} bpm`;
                      return "";
                    },
                  },
                },
              },
              scales: {
                x: {
                  type: "time" as const,
                  time: { unit: "year" as const, tooltipFormat: "MMM d, yyyy" },
                  ticks: { color: "#8888a0", maxTicksLimit: 8, font: { size: 10 } },
                  grid: { color: "#2a2a3a55" },
                },
                y: {
                  min: 0,
                  title: { display: true, text: "HR Drop (bpm)", color: "#8888a0", font: { size: 10 } },
                  ticks: { color: "#8888a0", font: { size: 10 } },
                  grid: { color: "#2a2a3a55" },
                },
              },
            }}
          />
        </div>
      ) : (
        <div className="flex items-center justify-center h-[200px] text-gray-500 text-sm">
          Need 2+ qualifying activities for trend chart
        </div>
      )}

      {/* Activity list */}
      {activities.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#2a2a3a] text-[10px]">
          <p className="text-gray-500 mb-2">Qualifying activities:</p>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {activities.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SPORT_COLOR[a.sport] ?? "#888" }} />
                <span className="text-gray-400">{a.name.slice(0, 30)}</span>
                <span className="text-gray-600">{a.date?.slice(0, 10)}</span>
                <span className="text-gray-500 ml-auto tabular-nums">
                  end: {a.end_hr} bpm → HRR60: {a.hrr_60} bpm
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
