"use client";

import { useMemo, useState } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, TimeScale, Title, Tooltip, Legend, Filler, ScatterController } from "chart.js";
import "chartjs-adapter-luxon";
import { Line } from "react-chartjs-2";
import type { Aggregate, BestEffortProgressionTarget, BestEffortProgressionPoint } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, TimeScale, Title, Tooltip, Legend, Filler, ScatterController);

const SPORT_LABEL: Record<string, string> = { Run: "Running", Ride: "Cycling", Swim: "Swimming" };
const SPORT_COLOR: Record<string, string> = { Run: "#ff6b35", Ride: "#3da5d9", Swim: "#00d4d4" };

const TARGET_SORT: Record<string, number> = {
  "1000m": 1, "5000m": 2, "10000m": 3, "21097m": 4,
  "300s": 1, "1200s": 2, "3600s": 3, "5400s": 4,
  "100m": 1, "400m": 2, "1500m": 3,
};

function fmtPace(secPerKm: number | null): string {
  if (!secPerKm || secPerKm <= 0) return "--";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDuration(secs: number): string {
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.round(secs % 60);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtSpeed(kmh: number | null): string {
  if (!kmh) return "--";
  return `${kmh.toFixed(1)} km/h`;
}

function fmtDist(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

export default function BestEffortProgression({ aggregate }: { aggregate?: Aggregate }) {
  const [sport, setSport] = useState("Run");
  const [activeTarget, setActiveTarget] = useState<string>("");
  const [prOnly, setPrOnly] = useState(false);

  const progression = aggregate?.best_effort_progression ?? {};
  const sportData = progression[sport] ?? {};

  // Sorted target keys
  const targets = useMemo(() => {
    return Object.keys(sportData).sort((a, b) => (TARGET_SORT[a] ?? 99) - (TARGET_SORT[b] ?? 99));
  }, [sportData]);

  // Auto-select first target
  const selectedTarget = activeTarget && sportData[activeTarget] ? activeTarget : targets[0] ?? "";
  const data = (sportData[selectedTarget] ?? {}) as BestEffortProgressionTarget;

  const isDistanceTarget = data?.unit === "m";
  const isRun = sport === "Run";

  // Compute y-axis value from scatter point for display
  function yValue(p: BestEffortProgressionPoint): number {
    if (isDistanceTarget) return (p.pace_min_km ?? 0) * 60; // seconds per km
    return p.speed_kmh ?? 0;
  }

  function fmtY(v: number): string {
    if (isDistanceTarget) return fmtPace(v / 60); // seconds → min:sec per km
    return fmtSpeed(v);
  }

  // Chart datasets
  const chartData = useMemo(() => {
    if (!data?.scatter) return { datasets: [] };

    const color = SPORT_COLOR[sport] ?? "#888";
    const datasets: any[] = [];
    const scatter = data.scatter;
    const prLine = data.pr_line ?? [];
    const loess = data.loess ?? [];
    const refMs = scatter[0] ? new Date(scatter[0].date).getTime() : 0;

    // LOESS trend line
    if (loess.length >= 2) {
      datasets.push({
        label: "Trend (LOESS)",
        data: loess.map((p) => ({
          x: refMs + p.days * 86400000,
          y: isDistanceTarget ? p.value / (data.target_value / 1000) * 60 : p.value / (data.target_value / 60) * 3.6,
        })),
        borderColor: color + "80",
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
        order: 3,
      });
    }

    // PR step-line
    if (prLine.length >= 2) {
      const stepData: { x: number; y: number }[] = [];
      for (let i = 0; i < prLine.length; i++) {
        const pt = prLine[i];
        const x = new Date(pt.date).getTime();
        const y = yValue(pt);
        stepData.push({ x, y });
        // Carry forward: next PR's date but current PR's value
        if (i < prLine.length - 1) {
          const nextX = new Date(prLine[i + 1].date).getTime();
          stepData.push({ x: nextX, y });
        }
      }
      datasets.push({
        label: "PR step-line",
        data: stepData,
        borderColor: "#ffffff",
        borderWidth: 1.5,
        borderDash: [4, 2],
        pointRadius: 0,
        fill: false,
        stepped: false,
        tension: 0,
        order: 2,
      });
    }

    // Scatter points
    const visibleScatter = prOnly ? scatter.filter((p) => p.is_pr) : scatter;
    const nonPr = visibleScatter.filter((p) => !p.is_pr);
    const pr = visibleScatter.filter((p) => p.is_pr);

    if (nonPr.length > 0) {
      datasets.push({
        label: prOnly ? "PRs" : "Best efforts",
        data: nonPr.map((p) => ({
          x: new Date(p.date).getTime(),
          y: yValue(p),
          ...p,
        })),
        borderColor: color + "4d",
        backgroundColor: color + "33",
        pointRadius: 4,
        pointHoverRadius: 7,
        showLine: false,
        order: 1,
      });
    }

    if (pr.length > 0) {
      datasets.push({
        label: "Personal Record",
        data: pr.map((p) => ({
          x: new Date(p.date).getTime(),
          y: yValue(p),
          ...p,
        })),
        borderColor: "#fbbf24",
        backgroundColor: "#fbbf24",
        pointRadius: 8,
        pointHoverRadius: 11,
        pointBorderColor: "#ffffff",
        pointBorderWidth: 1.5,
        showLine: false,
        order: 0,
      });
    }

    // Current PR star (separate dataset for the largest marker)
    if (data.current_pr && pr.length > 0) {
      const cp = data.current_pr;
      const cpY = yValue(cp);
      // Only add if it's the last PR
      const lastPr = pr[pr.length - 1];
      if (cp.activity_id === lastPr.activity_id) {
        // Replace the last PR's style by making it larger in the PR dataset
        // We'll do this by finding and adjusting it in the PR dataset
        const prDataset = datasets.find((d: any) => d.label === "Personal Record");
        if (prDataset) {
          const dataArr = prDataset.data as any[];
          if (dataArr.length > 0) {
            const last = dataArr[dataArr.length - 1];
            last.pointStyle = "star";
            last.pointRadius = 12;
          }
        }
      }
    }

    return { datasets };
  }, [data, sport, isDistanceTarget, prOnly]);

  if (targets.length === 0) {
    return (
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <div className="flex items-center gap-1 mb-3">
          {Object.entries(SPORT_LABEL).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setSport(key); setActiveTarget(""); }}
              className={`px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                sport === key ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white border border-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">Best Effort Progression</h3>
        <div className="flex items-center justify-center h-[200px] text-gray-500 text-sm">
          Not enough best-effort data for {SPORT_LABEL[sport] ?? sport}.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
      {/* Sport tabs */}
      <div className="flex items-center gap-1 mb-3">
        {Object.entries(SPORT_LABEL).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setSport(key); setActiveTarget(""); }}
            className={`px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
              sport === key ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white border border-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold">
            Best {data.target_label} Efforts — {SPORT_LABEL[sport]}
          </h3>
          <p className="text-[10px] text-gray-500">
            {data.total_qualifying} qualifying activities. {data.total_qualifying < 3 ? "Building baseline" : data.total_qualifying < 10 ? "PR step-line shown, LOESS hidden (need 10+)" : "Full chart with trends."}
          </p>
        </div>

        {/* PR stat box */}
        {data.current_pr && (
          <div className="bg-[#1a1a2e] border border-[#2a2a3a] rounded-lg px-3 py-2 text-[10px] leading-relaxed shrink-0 ml-4">
            <div className="text-gray-500">Current {data.target_label} PR</div>
            <div className="text-yellow-400 font-bold text-sm tabular-nums">
              {isDistanceTarget ? fmtDuration(data.current_pr.value) : fmtDist(data.current_pr.value)}
            </div>
            <div className="text-gray-500">
              {data.current_pr.date?.slice(0, 10)} · {isDistanceTarget ? fmtPace(data.current_pr.pace_min_km) + "/km" : fmtSpeed(data.current_pr.speed_kmh)}
            </div>
            {data.pr_comparisons.length > 0 && (
              <div className="border-t border-[#2a2a3a] mt-1.5 pt-1.5 space-y-0.5">
                {data.pr_comparisons.map((c) => (
                  <div key={c.years_ago} className="text-gray-500">
                    vs {c.years_ago}y ago:{" "}
                    {c.diff_value != null ? (
                      <span className={isDistanceTarget ? (c.diff_value <= 0 ? "text-emerald-400" : "text-red-400") : (c.diff_value >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {c.diff_value > 0 ? "+" : ""}
                        {isDistanceTarget ? (c.diff_value > 0 ? `+${fmtDuration(Math.abs(c.diff_value))}` : fmtDuration(Math.abs(c.diff_value))) : `${c.diff_value > 0 ? "+" : ""}${Math.round(c.diff_value)} m`}
                      </span>
                    ) : (
                      <span className="text-gray-600">no data</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Target tabs + filters */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {targets.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTarget(t)}
            className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all cursor-pointer ${
              selectedTarget === t ? "bg-violet-600/30 text-violet-200 border border-violet-500/50" : "bg-white/5 text-gray-400 hover:text-white border border-white/10"
            }`}
          >
            {(sportData[t] as BestEffortProgressionTarget)?.target_label ?? t}
          </button>
        ))}
        <span className="text-gray-600 mx-1">|</span>
        <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer select-none">
          <input type="checkbox" checked={prOnly} onChange={(e) => setPrOnly(e.target.checked)} className="accent-violet-500" />
          PRs only
        </label>
      </div>

      {/* Trend annotation */}
      {data.trend_annotation && (
        <p className="text-[10px] text-gray-500 mb-1">
          Trend (last 12mo):{" "}
          <span className={data.trend_annotation.includes("improving") ? "text-emerald-400" : data.trend_annotation === "stable" ? "text-gray-400" : "text-red-400"}>
            {data.trend_annotation === "stable" ? "Stable" : data.trend_annotation}
          </span>
        </p>
      )}

      <div className="h-[350px]">
        <Line
          data={chartData}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index" as const, intersect: false },
            plugins: {
              legend: {
                position: "bottom" as const,
                labels: { color: "#e0e0ea", usePointStyle: true, padding: 10, font: { size: 9 }, filter: (item) => item.text !== "PRs" },
              },
              tooltip: {
                backgroundColor: "#1a1a2e",
                titleColor: "#e0e0ea",
                bodyColor: "#c0c0d0",
                borderColor: "#2a2a3a",
                borderWidth: 1,
                callbacks: {
                  title: (ctx: any) => {
                    const d = ctx[0]?.raw;
                    if (!d?.activity_name) return "";
                    const dt = d.date ? new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
                    return `${d.activity_name} · ${dt}`;
                  },
                  label: (ctx: any) => {
                    const d = ctx.raw;
                    if (!d) return "";
                    const lines: string[] = [];
                    if (data.unit === "m") {
                      lines.push(`Best ${data.target_label}: ${fmtDuration(d.value)} (${fmtPace((d.pace_min_km ?? 0) * 60 / 60)})`);
                    } else {
                      lines.push(`Best ${data.target_label}: ${fmtDist(d.value)}`);
                    }
                    if (d.activity_name) {
                      lines.push(`Within activity: ${fmtDist((d.start_index ?? 0) * 10)} → ${fmtDist((d.end_index ?? 0) * 10)} of ${fmtDist(d.total_distance_m ?? 0)}`);
                    }
                    if (d.is_pr) lines.push("Personal Record");
                    return lines;
                  },
                },
              },
            },
            scales: {
              x: {
                type: "time" as const,
                time: { unit: "year" as const, tooltipFormat: "MMM d, yyyy" },
                ticks: { color: "#8888a0", maxTicksLimit: 10, font: { size: 10 } },
                grid: { color: "#2a2a3a55" },
              },
              y: {
                reverse: isDistanceTarget,
                title: {
                  display: true,
                  text: isDistanceTarget ? "Pace (per km)" : "Speed (km/h)",
                  color: "#8888a0",
                  font: { size: 10 },
                },
                ticks: {
                  color: "#8888a0",
                  font: { size: 10 },
                  callback: (v: any) => fmtY(v),
                },
                grid: { color: "#2a2a3a55" },
              },
            },
          }}
        />
      </div>
    </div>
  );
}
