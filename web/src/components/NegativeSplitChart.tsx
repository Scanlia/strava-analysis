"use client";

import { useMemo, useState } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, BarElement, TimeScale, Title, Tooltip, Legend, Filler } from "chart.js";
import "chartjs-adapter-luxon";
import { Line, Bar } from "react-chartjs-2";
import type { Activity, NegSplitSummary } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, BarElement, TimeScale, Title, Tooltip, Legend, Filler);

interface Props {
  activities: Activity[];
  summary?: NegSplitSummary | null;
}

function fmtPace(secPerKm: number): string {
  if (!secPerKm || secPerKm <= 0) return "--";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

type DisplayMode = "gap" | "raw";

const BAND_LABELS: Record<string, string> = { short: "Short (<8km)", medium: "Medium (8–15km)", long: "Long (>15km)" };

export default function NegativeSplitChart({ activities, summary }: Props) {
  const [mode, setMode] = useState<DisplayMode>("gap");
  const [bandFilters, setBandFilters] = useState<Set<string>>(new Set(["short", "medium", "long"]));

  // Extract qualifying runs
  const qualifyingRuns = useMemo(() => {
    return activities
      .filter((a) => {
        const ns = a.neg_split;
        return ns?.qualifies === true && a.start_time_utc;
      })
      .sort((a, b) => (a.start_time_utc ?? "").localeCompare(b.start_time_utc ?? ""));
  }, [activities]);

  const filteredRuns = useMemo(() => {
    return qualifyingRuns.filter((a) => {
      if (a.neg_split) {
        return bandFilters.has(a.neg_split.distance_band);
      }
      return false;
    });
  }, [qualifyingRuns, bandFilters]);

  // Compute rolling rates from filtered data
  const rolling10 = useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 9; i < filteredRuns.length; i++) {
      const slice = filteredRuns.slice(i - 9, i + 1);
      const neg = slice.filter((r) => {
        const ns = r.neg_split!;
        return mode === "gap" ? ns.is_negative_split : (ns.raw_split_delta_seconds ?? 0) > 0;
      }).length;
      pts.push({
        x: new Date(filteredRuns[i].start_time_utc!).getTime(),
        y: Math.round((neg / slice.length) * 1000) / 10,
      });
    }
    return pts;
  }, [filteredRuns, mode]);

  const rolling30 = useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 29; i < filteredRuns.length; i++) {
      const slice = filteredRuns.slice(i - 29, i + 1);
      const neg = slice.filter((r) => {
        const ns = r.neg_split!;
        return mode === "gap" ? ns.is_negative_split : (ns.raw_split_delta_seconds ?? 0) > 0;
      }).length;
      pts.push({
        x: new Date(filteredRuns[i].start_time_utc!).getTime(),
        y: Math.round((neg / slice.length) * 1000) / 10,
      });
    }
    return pts;
  }, [filteredRuns, mode]);

  // LOESS trend from aggregate (precomputed, unfiltered) — use for default view
  const loessData = useMemo(() => {
    if (!summary?.loess_trend || summary.loess_trend.length === 0) return [];
    const refMs = filteredRuns[0] ? new Date(filteredRuns[0].start_time_utc!).getTime() : 0;
    return summary.loess_trend.map((p) => ({
      x: refMs + p.days * 86400000,
      y: p.value,
    }));
  }, [summary, filteredRuns]);

  // Headline stats
  const headline = useMemo(() => {
    if (summary?.headline) return summary.headline;
    const recent = filteredRuns.slice(-10);
    const neg = recent.filter((r) => (mode === "gap" ? r.neg_split?.is_negative_split : (r.neg_split?.raw_split_delta_seconds ?? 0) > 0)).length;
    return {
      recent_10_neg: neg,
      recent_10_total: recent.length,
      recent_rate: recent.length > 0 ? Math.round((neg / recent.length) * 1000) / 10 : 0,
      vs_6mo_ago: null,
    };
  }, [filteredRuns, mode, summary]);

  // Distance band stats from aggregate (unfiltered)
  const bandStats = summary?.band_stats ?? {};

  // Per-run bar data
  const barData = useMemo(() => {
    const ds = filteredRuns.map((r) => {
      const ns = r.neg_split!;
      const delta = mode === "gap" ? (ns.split_delta_seconds ?? 0) : (ns.raw_split_delta_seconds ?? 0);
      const pct = Math.max(-20, Math.min(20, (mode === "gap" ? (ns.split_delta_pct ?? 0) : (ns.raw_split_delta_pct ?? 0))));
      const isNeg = delta > 0;
      return {
        x: new Date(r.start_time_utc!).getTime(),
        y: pct,
        isNeg,
        deltaSeconds: delta,
        activity: r,
      };
    });
    return ds;
  }, [filteredRuns, mode]);

  // Time bounds for shared x-axis
  const timeMin = filteredRuns[0] ? new Date(filteredRuns[0].start_time_utc!).getTime() : undefined;
  const timeMax = filteredRuns.length > 0 ? new Date(filteredRuns[filteredRuns.length - 1].start_time_utc!).getTime() : undefined;

  // Bar y-axis auto-scale (symmetric around zero)
  const barAbsMax = useMemo(() => {
    const maxVal = Math.max(
      ...barData.map((d) => Math.abs(d.y)),
      5
    );
    return Math.ceil(maxVal / 5) * 5;
  }, [barData]);

  const showTopPanel = filteredRuns.length >= 10;

  const commonXOptions = {
    type: "time" as const,
    time: { unit: "month" as const, tooltipFormat: "MMM d, yyyy" },
    ticks: { color: "#8888a0", maxTicksLimit: 12, font: { size: 10 } },
    grid: { color: "#2a2a3a55" },
    min: timeMin,
    max: timeMax,
  };

  // Empty / sparse states
  if (qualifyingRuns.length < 3) {
    return (
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5 text-gray-300">
        <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
          Negative Split Rate
        </h3>
        <p className="text-[10px] text-gray-500 mb-3">
          Percentage of runs where second half is faster than first half.
        </p>
        <div className="flex items-center justify-center h-[300px] text-gray-500 text-sm">
          Need 3+ qualifying runs — currently {qualifyingRuns.length}
        </div>
      </div>
    );
  }

  if (qualifyingRuns.length < 10) {
    return (
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5 text-gray-300">
        <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
          Negative Split Rate
        </h3>
        <p className="text-[10px] text-gray-500 mb-2">
          Need at least 10 qualifying runs to show trend — currently {qualifyingRuns.length}.
        </p>
        <div className="flex items-center gap-4 mb-3">
          <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer">
            <input type="checkbox" checked={mode === "gap"} onChange={() => setMode(mode === "gap" ? "raw" : "gap")} className="accent-violet-500" />
            GAP-adjusted
          </label>
        </div>
        <div className="h-[280px]">
          <Bar
            data={{
              datasets: [
                {
                  label: "Split Δ (sec/km)",
                  data: barData.map((d) => ({
                    x: d.x,
                    y: d.deltaSeconds,
                  })),
                  backgroundColor: barData.map((d) => (d.isNeg ? "rgba(16, 185, 129, 0.6)" : "rgba(239, 68, 68, 0.5)")),
                  borderColor: barData.map((d) => (d.isNeg ? "rgb(16, 185, 129)" : "rgb(239, 68, 68)")),
                  borderWidth: 1,
                  borderRadius: 2,
                  maxBarThickness: 20,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    title: (ctx: any) => {
                      const d = barData[ctx[0]?.dataIndex];
                      if (!d) return "";
                      const a = d.activity;
                      const dt = a.start_time_utc ? new Date(a.start_time_utc).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
                      return `${a.name} · ${dt}`;
                    },
                    label: (ctx: any) => {
                      const d = barData[ctx.dataIndex];
                      if (!d) return "";
                      const ns = d.activity.neg_split!;
                      const pHalf = mode === "gap" ? ns.pace_first_half : ns.raw_pace_first_half;
                      const sHalf = mode === "gap" ? ns.pace_second_half : ns.raw_pace_second_half;
                      const lines = [
                        `Distance: ${ns.distance_km} km`,
                        `First half:  ${pHalf ? fmtPace(pHalf) : "--"}`,
                        `Second half: ${sHalf ? fmtPace(sHalf) : "--"}`,
                        d.isNeg
                          ? `Negative split by ${Math.abs(d.deltaSeconds).toFixed(1)} sec/km`
                          : `Positive split by ${Math.abs(d.deltaSeconds).toFixed(1)} sec/km`,
                      ];
                      return lines;
                    },
                  },
                },
              },
              scales: {
                x: commonXOptions,
                y: {
                  title: { display: true, text: "Split Δ (sec/km)", color: "#8888a0", font: { size: 10 } },
                  ticks: { color: "#8888a0", font: { size: 10 } },
                  grid: { color: "#2a2a3a55" },
                },
              },
            }}
          />
        </div>
        <div className="mt-2 text-[10px] text-gray-500 text-center">
          Positive = negative split (2nd half faster). {filteredRuns.length} qualifying runs shown.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5 text-gray-300">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold">
          Negative Split Rate
        </h3>
        <div className="flex items-center gap-3">
          {(["short", "medium", "long"] as const).map((b) => (
            <label key={b} className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={bandFilters.has(b)}
                onChange={() => {
                  const next = new Set(bandFilters);
                  if (next.has(b)) next.delete(b);
                  else next.add(b);
                  setBandFilters(next);
                }}
                className="accent-violet-500"
              />
              {BAND_LABELS[b]?.split(" ")[0]}
            </label>
          ))}
          <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer">
            <input type="checkbox" checked={mode === "gap"} onChange={() => setMode(mode === "gap" ? "raw" : "gap")} className="accent-violet-500" />
            GAP
          </label>
        </div>
      </div>
      <p className="text-[10px] text-gray-500 mb-3">
        {mode === "gap" ? "GAP-adjusted" : "Raw"} pacing: % of runs with negative splits (2nd half faster). {filteredRuns.length} qualifying runs.
      </p>

      {/* Headline stats row */}
      <div className="flex items-center gap-6 mb-4 text-xs">
        <div>
          <span className="text-gray-500">Last 10: </span>
          <span className="tabular-nums font-semibold text-violet-300">{headline.recent_10_neg} / {headline.recent_10_total}</span>
        </div>
        <div>
          <span className="text-gray-500">Rate: </span>
          <span className="tabular-nums font-semibold text-emerald-300">{headline.recent_rate}%</span>
        </div>
        {headline.vs_6mo_ago != null && (
          <div>
            <span className="text-gray-500">vs 6mo: </span>
            <span className={`tabular-nums font-semibold ${headline.vs_6mo_ago >= 0 ? "text-emerald-300" : "text-red-400"}`}>
              {headline.vs_6mo_ago >= 0 ? "+" : ""}{headline.vs_6mo_ago}pp
            </span>
          </div>
        )}
      </div>

      {/* Top panel: Rolling rate */}
      {showTopPanel && (
        <div className="h-[220px] mb-1">
          <Line
            data={{
              datasets: [
                {
                  label: "Rolling 10-run",
                  data: rolling10 as any,
                  borderColor: "#a78bfa",
                  backgroundColor: "rgba(167, 139, 250, 0.06)",
                  fill: true,
                  pointRadius: 0,
                  pointHoverRadius: 3,
                  pointBackgroundColor: "#a78bfa",
                  tension: 0.2,
                  borderWidth: 2,
                  order: 1,
                },
                {
                  label: "Rolling 30-run",
                  data: rolling30 as any,
                  borderColor: "rgba(167, 139, 250, 0.35)",
                  borderWidth: 1.2,
                  borderDash: [3, 2],
                  pointRadius: 0,
                  pointHoverRadius: 2,
                  fill: false,
                  tension: 0.2,
                  order: 2,
                },
                ...(loessData.length > 0
                  ? [{
                      label: "LOESS trend",
                      data: loessData as any,
                      borderColor: "rgba(244, 114, 182, 0.7)",
                      borderWidth: 1.5,
                      borderDash: [6, 3],
                      pointRadius: 0,
                      pointHoverRadius: 0,
                      fill: false,
                      tension: 0.4,
                      order: 3,
                    }]
                  : []),
                {
                  label: "50% (random)",
                  data:
                    rolling10.length > 0
                      ? [
                          { x: rolling10[0].x, y: 50 },
                          { x: rolling10[rolling10.length - 1].x, y: 50 },
                        ]
                      : [],
                  borderColor: "rgba(107, 114, 128, 0.6)",
                  borderWidth: 1,
                  borderDash: [4, 4],
                  pointRadius: 0,
                  pointHoverRadius: 0,
                  fill: false,
                  order: 10,
                },
                {
                  label: "70% (good)",
                  data:
                    rolling10.length > 0
                      ? [
                          { x: rolling10[0].x, y: 70 },
                          { x: rolling10[rolling10.length - 1].x, y: 70 },
                        ]
                      : [],
                  borderColor: "rgba(16, 185, 129, 0.5)",
                  borderWidth: 1,
                  borderDash: [4, 4],
                  pointRadius: 0,
                  pointHoverRadius: 0,
                  fill: false,
                  order: 10,
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
                  labels: { color: "#e0e0ea", usePointStyle: true, padding: 8, font: { size: 9 }, boxWidth: 12 },
                },
                tooltip: {
                  callbacks: {
                    label: (ctx: any) => {
                      if (ctx.dataset.label?.includes("%")) return "";
                      const y = ctx.parsed?.y ?? ctx.raw?.y;
                      if (y != null) return `${ctx.dataset.label}: ${y.toFixed(1)}%`;
                      return "";
                    },
                  },
                },
              },
              scales: {
                x: commonXOptions,
                y: {
                  min: 0,
                  max: 100,
                  title: { display: true, text: "Neg Split Rate %", color: "#8888a0", font: { size: 10 } },
                  ticks: { color: "#8888a0", font: { size: 9 }, callback: (v: any) => `${v}%` },
                  grid: { color: "#2a2a3a55" },
                },
              },
            }}
          />
        </div>
      )}

      {/* Bottom panel: Per-run bars */}
      <div className={showTopPanel ? "h-[200px]" : "h-[250px]"}>
        <Bar
          data={{
            datasets: [
              {
                label: mode === "gap" ? "Split Δ % (GAP)" : "Split Δ % (Raw)",
                data: barData.map((d) => ({
                  x: d.x,
                  y: d.deltaSeconds,
                })),
                backgroundColor: barData.map((d) =>
                  d.isNeg ? "rgba(16, 185, 129, 0.55)" : "rgba(239, 68, 68, 0.45)"
                ),
                borderColor: barData.map((d) =>
                  d.isNeg ? "rgb(16, 185, 129)" : "rgb(239, 68, 68)"
                ),
                borderWidth: 0.5,
                borderRadius: 2,
                maxBarThickness: 18,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  title: (ctx: any) => {
                    const d = barData[ctx[0]?.dataIndex];
                    if (!d) return "";
                    const a = d.activity;
                    const dt = a.start_time_utc
                      ? new Date(a.start_time_utc).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : "";
                    return `${a.name} · ${dt}`;
                  },
                  label: (ctx: any) => {
                    const d = barData[ctx.dataIndex];
                    if (!d) return "";
                    const ns = d.activity.neg_split!;
                    const pHalf = mode === "gap" ? ns.pace_first_half : ns.raw_pace_first_half;
                    const sHalf = mode === "gap" ? ns.pace_second_half : ns.raw_pace_second_half;
                    return [
                      `Distance: ${ns.distance_km} km`,
                      `First half:  ${pHalf ? fmtPace(pHalf) : "--"}`,
                      `Second half: ${sHalf ? fmtPace(sHalf) : "--"}`,
                      d.isNeg
                        ? `Negative split by ${Math.abs(d.deltaSeconds).toFixed(1)} sec/km`
                        : `Positive split by ${Math.abs(d.deltaSeconds).toFixed(1)} sec/km`,
                    ];
                  },
                },
              },
            },
            scales: {
              x: {
                ...commonXOptions,
                title: { display: true, text: "Date", color: "#8888a0", font: { size: 10 } },
              },
              y: {
                min: -barAbsMax,
                max: barAbsMax,
                title: { display: true, text: "Split Δ (sec/km)", color: "#8888a0", font: { size: 10 } },
                ticks: { color: "#8888a0", font: { size: 9 } },
                grid: {
                  color: "#2a2a3a55",
                },
              },
            },
          }}
        />
      </div>

      {/* Per-distance breakdown */}
      {Object.keys(bandStats).length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#2a2a3a]">
          <p className="text-[10px] text-gray-500 mb-2">Negative split rate by distance (all-time)</p>
          <div className="space-y-2">
            {(["short", "medium", "long"] as const).map((band) => {
              const bs = bandStats[band];
              if (!bs || bs.total < 3) {
                return (
                  <div key={band} className="flex items-center gap-2 text-[10px] text-gray-600">
                    <span className="w-24 text-right">{BAND_LABELS[band]}</span>
                    <span className="text-gray-600">insufficient data (n={bs?.total ?? 0})</span>
                  </div>
                );
              }
              return (
                <div key={band} className="flex items-center gap-2 text-[10px]">
                  <span className="w-24 text-right text-gray-400">{BAND_LABELS[band]}</span>
                  <div className="flex-1 h-4 bg-[#1a1a2e] rounded-sm relative overflow-hidden">
                    <div
                      className="h-full bg-emerald-600/70 rounded-sm"
                      style={{ width: `${Math.min(100, bs.rate)}%` }}
                    />
                    <div
                      className="absolute top-0 h-full border-r border-dashed border-gray-500/50"
                      style={{ left: "50%" }}
                    />
                  </div>
                  <span className="text-gray-300 tabular-nums w-12">{bs.rate}%</span>
                  <span className="text-gray-600">(n={bs.total})</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-2 text-[10px] text-gray-500 text-center">
        Positive = negative split (2nd half faster). GAP removes elevation bias from rolling hills.
      </div>
    </div>
  );
}
