"use client";

import { useMemo, useState } from "react";
import type { Aggregate } from "@/lib/data";

interface Props {
  aggregate: Aggregate;
}

interface CellData {
  count: number;
  trimp: number;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const CELL_W = 16;
const CELL_H = 14;
const GAP = 2;
const CELL_TOTAL_W = CELL_W + GAP;
const CELL_TOTAL_H = CELL_H + GAP;

const LEFT = 34;
const TOP = 22;
const RIGHT = 8;
const BOTTOM = 28;
const GRID_W = 24 * CELL_TOTAL_W;
const GRID_H = 7 * CELL_TOTAL_H;
const SVG_W = LEFT + GRID_W + RIGHT;
const SVG_H = TOP + GRID_H + BOTTOM;

const HOUR_LABELS = [0, 6, 12, 18];

function getColor(count: number): string {
  if (count === 0) return "#1a1a2e";
  if (count <= 2) return "#1a3a1a";
  if (count <= 5) return "#2a5a2a";
  if (count <= 10) return "#3a7a3a";
  return "#4a9a4a";
}

function formatHour(h: number): string {
  return `${h}${h === 0 ? "am" : h < 12 ? "am" : h === 12 ? "pm" : "pm"}`;
}

function isNumericArray(data: unknown): data is number[][] {
  return Array.isArray(data) && data.length === 7 && data.every(
    (row) => Array.isArray(row) && row.length === 24 && row.every((v) => typeof v === "number")
  );
}

function isCellDataArray(data: unknown): data is CellData[][] {
  return Array.isArray(data) && data.length === 7 && data.every(
    (row) => Array.isArray(row) && row.length === 24 &&
      row.every(
        (v) => v !== null && typeof v === "object" && "count" in v && "trimp" in v
      )
  );
}

interface PerSportData {
  [sport: string]: {
    count?: number[][];
    trimp?: number[][];
  };
}

function buildCells(raw: unknown): CellData[][] {
  const cells: CellData[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ count: 0, trimp: 0 }))
  );

  if (!raw) return cells;

  if (isCellDataArray(raw)) {
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        cells[d][h] = { ...raw[d][h] };
      }
    }
    return cells;
  }

  if (isNumericArray(raw)) {
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        cells[d][h] = { count: raw[d][h], trimp: 0 };
      }
    }
    return cells;
  }

  if (typeof raw === "object" && raw !== null) {
    const perSport = raw as PerSportData;
    const merged: CellData[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ count: 0, trimp: 0 }))
    );
    for (const sport of Object.keys(perSport)) {
      const s = perSport[sport];
      const countGrid = s?.count;
      const trimpGrid = s?.trimp;
      if (countGrid && Array.isArray(countGrid)) {
        for (let d = 0; d < 7 && d < countGrid.length; d++) {
          const row = countGrid[d];
          if (row) {
            for (let h = 0; h < 24 && h < row.length; h++) {
              merged[d][h].count += row[h] ?? 0;
            }
          }
        }
      }
      if (trimpGrid && Array.isArray(trimpGrid)) {
        for (let d = 0; d < 7 && d < trimpGrid.length; d++) {
          const row = trimpGrid[d];
          if (row) {
            for (let h = 0; h < 24 && h < row.length; h++) {
              merged[d][h].trimp += row[h] ?? 0;
            }
          }
        }
      }
    }
    return merged;
  }

  return cells;
}

function getSportKeys(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.every((k) => typeof obj[k] === "object" && obj[k] !== null && ("count" in (obj[k] as object) || "trimp" in (obj[k] as object)))) {
    return keys;
  }
  return [];
}

function getSportCells(data: unknown, sport: string): CellData[][] | null {
  if (!data || typeof data !== "object") return null;
  const perSport = data as PerSportData;
  const s = perSport[sport];
  if (!s) return null;

  const cells: CellData[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ count: 0, trimp: 0 }))
  );

  const countGrid = s.count;
  const trimpGrid = s.trimp;

  if (countGrid) {
    for (let d = 0; d < 7 && d < countGrid.length; d++) {
      const row = countGrid[d];
      if (row) {
        for (let h = 0; h < 24 && h < row.length; h++) {
          cells[d][h].count = row[h] ?? 0;
        }
      }
    }
  }
  if (trimpGrid) {
    for (let d = 0; d < 7 && d < trimpGrid.length; d++) {
      const row = trimpGrid[d];
      if (row) {
        for (let h = 0; h < 24 && h < row.length; h++) {
          cells[d][h].trimp = row[h] ?? 0;
        }
      }
    }
  }
  return cells;
}

export default function DOWHourHeatmap({ aggregate }: Props) {
  const raw = (aggregate as any).dow_hour;

  const sportKeys = useMemo(() => getSportKeys(raw), [raw]);
  const [activeSport, setActiveSport] = useState<string | null>(null);

  const allCells = useMemo(() => buildCells(raw), [raw]);
  const sportCells = useMemo(() => {
    if (!activeSport || !raw) return null;
    return getSportCells(raw, activeSport);
  }, [raw, activeSport]);

  const cells = activeSport ? sportCells : allCells;
  const isEmpty = !cells || cells.every((row) => row.every((c) => c.count === 0));

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5 text-gray-300 h-full flex flex-col">
      <h3 className="text-sm uppercase tracking-wider text-gray-300 font-semibold mb-1">
        Day-of-Week × Hour Heatmap
      </h3>
      <p className="text-[10px] text-gray-500 mb-2">
        Activity frequency by day-of-week and hour-of-day.
      </p>

      {sportKeys.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => setActiveSport(null)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
              activeSport === null
                ? "bg-violet-600 text-white"
                : "bg-white/5 text-gray-400 hover:text-white border border-white/10"
            }`}
          >
            All
          </button>
          {sportKeys.map((s) => (
            <button
              key={s}
              onClick={() => setActiveSport(s)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                activeSport === s
                  ? "bg-violet-600 text-white"
                  : "bg-white/5 text-gray-400 hover:text-white border border-white/10"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {isEmpty ? (
        <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
          No day-of-week/hour data available
        </div>
      ) : (
        <div className="flex-1 min-h-0 w-full">
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="w-full h-auto"
            role="img"
            aria-label="Day-of-week hour heatmap"
            preserveAspectRatio="xMidYMid meet"
          >
            {HOUR_LABELS.map((h) => {
              const col = h;
              const x = LEFT + col * CELL_TOTAL_W + CELL_W / 2;
              return (
                <text
                  key={h}
                  x={x}
                  y={TOP - 6}
                  fill="#6b7280"
                  fontSize="9"
                  fontFamily="system-ui, sans-serif"
                  textAnchor="middle"
                >
                  {h}
                </text>
              );
            })}

            {DAYS.map((day, idx) => (
              <text
                key={day}
                x={LEFT - 6}
                y={TOP + idx * CELL_TOTAL_H + CELL_H / 2 + 3}
                fill="#6b7280"
                fontSize="9"
                fontFamily="system-ui, sans-serif"
                textAnchor="end"
              >
                {day}
              </text>
            ))}

            {cells && cells.map((row, dayIdx) =>
              row.map((cell, hourIdx) => {
                const x = LEFT + hourIdx * CELL_TOTAL_W;
                const y = TOP + dayIdx * CELL_TOTAL_H;
                const fill = getColor(cell.count);
                const dayName = DAYS[dayIdx];
                const hourLabel = formatHour(hourIdx);
                const actLabel = cell.count === 1 ? "activity" : "activities";

                return (
                  <g key={`${dayIdx}-${hourIdx}`}>
                    <rect
                      x={x}
                      y={y}
                      width={CELL_W}
                      height={CELL_H}
                      rx={2}
                      ry={2}
                      fill={fill}
                    >
                      <title>{`${dayName} ${hourLabel} — ${cell.count} ${actLabel}, ${cell.trimp} TRIMP`}</title>
                    </rect>
                  </g>
                );
              })
            )}

            <g transform={`translate(${LEFT}, ${TOP + GRID_H + 14})`}>
              <text x={0} y={8} fill="#6b7280" fontSize="9" fontFamily="system-ui, sans-serif">
                Less
              </text>
              {[
                { label: "0", color: "#1a1a2e" },
                { label: "1-2", color: "#1a3a1a" },
                { label: "3-5", color: "#2a5a2a" },
                { label: "6-10", color: "#3a7a3a" },
                { label: "11+", color: "#4a9a4a" },
              ].map((l, i) => (
                <g key={i}>
                  <rect
                    x={32 + i * (CELL_W + 4)}
                    y={0}
                    width={CELL_W}
                    height={CELL_H}
                    rx={2}
                    ry={2}
                    fill={l.color}
                  />
                  <text
                    x={32 + i * (CELL_W + 4) + CELL_W / 2}
                    y={CELL_H + 12}
                    fill="#6b7280"
                    fontSize="7"
                    fontFamily="system-ui, sans-serif"
                    textAnchor="middle"
                  >
                    {l.label}
                  </text>
                </g>
              ))}
              <text
                x={32 + 5 * (CELL_W + 4) + 4}
                y={8}
                fill="#6b7280"
                fontSize="9"
                fontFamily="system-ui, sans-serif"
              >
                More
              </text>
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}
