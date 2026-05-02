"use client";

import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, Filler, Title, Tooltip, Legend, TimeScale } from "chart.js";
import "chartjs-adapter-luxon";
import { Line } from "react-chartjs-2";
import type { Aggregate } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, TimeScale, Title, Tooltip, Legend);

const CTL_COLOR = "#4ecdc4";
const ATL_COLOR = "#ff6b6b";
const TSB_POS = "#22c55e";
const TSB_NEG = "#ef4444";

export default function CTLChart({ aggregate }: { aggregate: Aggregate }) {
  const data = aggregate.ctl_atl_tsb || [];
  if (data.length < 10) return null;

  const ctlData = data.map((d) => ({ x: new Date(d.date + "T00:00:00").getTime(), y: d.ctl }));
  const atlData = data.map((d) => ({ x: new Date(d.date + "T00:00:00").getTime(), y: d.atl }));
  const tsbData = data.map((d) => ({ x: new Date(d.date + "T00:00:00").getTime(), y: d.tsb }));

  const last = data[data.length - 1];
  const tsbLabel = last.tsb > 25 ? "Very Fresh / Detrained" : last.tsb > 5 ? "Fresh / Race-Ready" : last.tsb > -10 ? "Neutral / Building" : last.tsb > -30 ? "Fatigued / Productive" : "Very Fatigued / Overreaching Risk";

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
      <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">CTL / ATL / TSB — Training Load Balance</h3>
      <p className="text-[10px] text-gray-500 mb-2">
        CTL = Fitness (42d EWMA), ATL = Fatigue (7d EWMA), TSB = Form (CTL − ATL). Current: <span className={last.tsb >= 0 ? "text-green-400" : "text-red-400"}>{last.tsb.toFixed(0)} TSB ({tsbLabel})</span>
      </p>
      <p className="text-[10px] text-gray-500 mb-3">Takes ~6 weeks to stabilise after a gap. TRIMP-based load (Banister).</p>
      <div className="h-96">
        <Line
          data={{
            datasets: [
              { label: "CTL (Fitness)", data: ctlData as any, borderColor: CTL_COLOR, borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: "y", order: 1 },
              { label: "ATL (Fatigue)", data: atlData as any, borderColor: ATL_COLOR, borderWidth: 1.5, pointRadius: 0, tension: 0.1, borderDash: [4, 3], yAxisID: "y", order: 2 },
              {
                label: "TSB (Form)",
                data: tsbData as any,
                borderColor: "transparent",
                backgroundColor: (ctx: any) => {
                  if (!ctx.chart?.chartArea) return "transparent";
                  const g = ctx.chart.ctx.createLinearGradient(0, ctx.chart.chartArea.top, 0, ctx.chart.chartArea.bottom);
                  g.addColorStop(0, TSB_POS + "aa");
                  g.addColorStop(0.5, TSB_POS + "33");
                  g.addColorStop(0.5, TSB_NEG + "33");
                  g.addColorStop(1, TSB_NEG + "aa");
                  return g;
                },
                fill: true,
                pointRadius: 0,
                tension: 0.1,
                yAxisID: "y1",
                order: 3,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index" as const, intersect: false },
            plugins: {
              legend: { position: "bottom" as const, labels: { color: "#e0e0ea", usePointStyle: true, padding: 14, font: { size: 11 } } },
              tooltip: { callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(1)}` } },
            },
            scales: {
              x: { type: "time" as const, time: { unit: "month" as const, tooltipFormat: "MMM d, yyyy" }, ticks: { color: "#8888a0", maxTicksLimit: 15, font: { size: 11 } }, grid: { color: "#2a2a3a55" } },
              y: { type: "linear" as const, position: "left" as const, title: { display: true, text: "CTL / ATL", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { color: "#2a2a3a55" }, min: 0 },
              y1: { type: "linear" as const, position: "right" as const, title: { display: true, text: "TSB (Form)", color: "#8888a0", font: { size: 11 } }, ticks: { color: "#8888a0", font: { size: 11 } }, grid: { drawOnChartArea: false } },
            },
          }}
        />
      </div>
      <div className="flex gap-4 mt-3 text-[10px] text-gray-500">
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500" /> Positive = Fresh</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500" /> Negative = Fatigued</div>
      </div>
    </div>
  );
}
