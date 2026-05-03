"use client";

import { useMemo, useState } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement, TimeScale, Title, Tooltip, Legend, Filler } from "chart.js";
import "chartjs-adapter-luxon";
import { Line } from "react-chartjs-2";
import type { Aggregate, BestEffortProgression as BEPType } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, TimeScale, Title, Tooltip, Legend, Filler);

const SPORT_KEY: Record<string, string> = { Run: "run", Ride: "ride", Swim: "swim", Hike: "hike" };
const SPORT_LABEL: Record<string, string> = { Run: "Running", Ride: "Cycling", Swim: "Swimming", Hike: "Hiking" };
const SPORT_COLOR: Record<string, string> = { Run: "#ff6b35", Ride: "#3da5d9", Swim: "#00d4d4", Hike: "#7fb069" };

// Human-readable target labels
function targetLabel(key: string, sport: string): string {
  const num = parseInt(key);
  if (key.endsWith("m")) {
    if (num >= 1000) return `${num / 1000}km`;
    return `${num}m`;
  }
  if (sport === "Run" || sport === "Hike") {
    if (num >= 3600) return `${num / 3600}h`;
    if (num >= 60) return `${num / 60}min`;
    return `${num}s`;
  }
  // Ride/Swim: time targets
  if (num >= 3600) return `${num / 3600}h`;
  if (num >= 60) return `${num / 60}min`;
  return `${num}s`;
}

function bestDistanceTargets(sport: string): string[] {
  // Prioritize: distance targets first, then key time targets
  if (sport === "Run") return ["1000m", "5000m", "10000m", "21097m", "1200s", "3600s"];
  if (sport === "Ride") return ["300s", "600s", "1800s", "3600s", "5400s"];
  if (sport === "Swim") return ["100m", "400m", "1500m"];
  if (sport === "Hike") return ["3600s", "7200s", "14400s"];
  return [];
}

function fmtPace(minPerKm: number | null): string {
  if (!minPerKm || minPerKm <= 0) return "--";
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

function fmtSpeed(speedKmh: number): string {
  return `${speedKmh.toFixed(1)} km/h`;
}

interface PRCallout {
  pace: string;
  date: string;
  name: string;
}

export default function BestEffortProgression({ aggregate }: { aggregate?: Aggregate }) {
  const [sport, setSport] = useState("Run");
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const progression = (aggregate?.best_effort_progression ?? {}) as BEPType;
  const sportData = progression[sport] ?? {};

  // Pick best targets to show
  const targets = useMemo(() => {
    const all = bestDistanceTargets(sport);
    return all.filter((t) => (sportData[t]?.length ?? 0) >= 3);
  }, [sportData, sport]);

  // Auto-select first target
  const activeTarget = selectedTarget && sportData[selectedTarget] ? selectedTarget : targets[0] ?? null;

  const targetEntries = activeTarget ? (sportData[activeTarget] ?? []) : [];
  const prCallout: PRCallout | null = useMemo(() => {
    if (!activeTarget) return null;
    const prs = targetEntries.filter((e) => e.is_pr);
    if (prs.length === 0) return null;
    const last = prs[prs.length - 1];
    return {
      pace: sport === "Run" ? fmtPace(last.pace_min_km) : fmtSpeed(last.speed_kmh),
      date: last.date?.slice(0, 10) ?? "",
      name: last.activity_name ?? "",
    };
  }, [targetEntries, activeTarget, sport]);

  // Chart data
  const datasets: any[] = [];
  if (activeTarget) {
    const isRun = sport === "Run";
    const yVals = targetEntries.map((e) => ({
      x: new Date(e.date).getTime(),
      y: isRun ? e.pace_min_km ?? 0 : e.speed_kmh ?? 0,
      activity_name: e.activity_name,
      is_pr: e.is_pr,
    }));
    const color = SPORT_COLOR[sport] ?? "#888";

    // Main line (all efforts)
    datasets.push({
      label: `${targetLabel(activeTarget, sport)} best effort`,
      data: yVals,
      borderColor: color,
      backgroundColor: `${color}20`,
      fill: false,
      pointRadius: 2,
      pointHoverRadius: 5,
      pointBackgroundColor: color,
      tension: 0.1,
      borderWidth: 1.5,
    });

    // PR stars
    const prPoints = yVals.filter((p: any) => p.is_pr);
    if (prPoints.length > 0) {
      datasets.push({
        label: "Personal Record",
        data: prPoints,
        borderColor: "#fbbf24",
        backgroundColor: "#fbbf24",
        pointRadius: 6,
        pointHoverRadius: 8,
        pointStyle: "star",
        showLine: false,
        borderWidth: 0,
        order: 0,
      });
    }
  }

  if (targets.length === 0) {
    return (
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <div className="flex items-center gap-1 mb-3">
          {Object.entries(SPORT_LABEL).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setSport(key); setSelectedTarget(null); }}
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
          Not enough best-effort data for {SPORT_LABEL[sport] ?? sport} — need 3+ qualifying activities per distance target.
        </div>
      </div>
    );
  }

  const sportProgression = sportData[activeTarget] ?? [];

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
      <div className="flex items-center gap-1 mb-3">
        {Object.entries(SPORT_LABEL).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setSport(key); setSelectedTarget(null); }}
            className={`px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
              sport === key ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:text-white border border-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
        Best Effort Progression — {SPORT_LABEL[sport]}
      </h3>
      <p className="text-[10px] text-gray-500 mb-2">
        How your best {activeTarget ? targetLabel(activeTarget, sport) : ""} effort has improved over time. Star = new PR.
      </p>

      {/* Target selector */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {targets.map((t) => (
          <button
            key={t}
            onClick={() => setSelectedTarget(t)}
            className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all cursor-pointer ${
              activeTarget === t ? "bg-violet-600/30 text-violet-200 border border-violet-500/50" : "bg-white/5 text-gray-400 hover:text-white border border-white/10"
            }`}
          >
            {targetLabel(t, sport)}
          </button>
        ))}
      </div>

      {/* PR callout */}
      {prCallout && (
        <div className="flex items-center gap-4 mb-3 text-xs">
          <span className="text-gray-500">Current PR:</span>
          <span className="text-yellow-400 font-bold tabular-nums">{prCallout.pace}</span>
          <span className="text-gray-500">{prCallout.date}</span>
          <span className="text-gray-600 text-[10px] truncate max-w-[180px]">{prCallout.name}</span>
        </div>
      )}

      <div className="h-[350px]">
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
                    if (!raw) return "";
                    const y = raw.y;
                    const lines = [];
                    if (sport === "Run") lines.push(`Pace: ${fmtPace(y)}`);
                    else lines.push(`Speed: ${fmtSpeed(y)}`);
                    if (raw.activity_name) lines.push(`Activity: ${raw.activity_name}`);
                    if (raw.is_pr) lines.push("★ Personal Record");
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
                reverse: sport === "Run",
                title: {
                  display: true,
                  text: sport === "Run" ? "Pace (min/km — faster ↑)" : "Speed (km/h)",
                  color: "#8888a0",
                  font: { size: 10 },
                },
                ticks: { color: "#8888a0", font: { size: 10 } },
                grid: { color: "#2a2a3a55" },
              },
            },
          }}
        />
      </div>
    </div>
  );
}
