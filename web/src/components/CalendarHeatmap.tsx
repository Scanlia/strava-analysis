"use client";

import React, { useState, useMemo } from "react";
import type { Activity } from "@/lib/data";

interface CalendarHeatmapProps {
  activities: Activity[];
}

interface DayCell {
  date: Date;
  trimp: number;
  count: number;
}

const CELL_SIZE = 12;
const CELL_GAP = 2;
const CELL_TOTAL = CELL_SIZE + CELL_GAP;
const WEEKS = 53;
const DAYS = 7;

const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const COLOR_EMPTY = "#1a1a2e";
const COLOR_ZERO = "#1e2a3a";
const TRIMP_COLORS = [
  COLOR_ZERO,
  "#0e4429",
  "#006d32",
  "#26a641",
  "#39d353",
];

function formatDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function dateKey(d: Date): string { return formatDateStr(d); }

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

function getColor(trimp: number, count: number): string {
  if (count === 0) return COLOR_EMPTY;
  if (trimp <= 0) return COLOR_ZERO;
  if (trimp <= 20) return "#0e4429";
  if (trimp <= 50) return "#006d32";
  if (trimp <= 100) return "#26a641";
  return "#39d353";
}

export default function CalendarHeatmap({ activities }: CalendarHeatmapProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();

  const [year, setYear] = useState<number>(currentYear);

  const dailyMap = useMemo(() => {
    const map = new Map<string, { trimp: number; count: number }>();
    for (const a of activities) {
      if (!a.start_time_utc) continue;
      const d = new Date(a.start_time_utc);
      d.setHours(0, 0, 0, 0);
      const k = dateKey(d);
      const prev = map.get(k);
      if (prev) {
        prev.trimp += a.trimp ?? 0;
        prev.count += 1;
      } else {
        map.set(k, { trimp: a.trimp ?? 0, count: 1 });
      }
    }
    return map;
  }, [activities]);

  const todayKey = useMemo(() => dateKey(today), [today]);

  // Show Jan 1 – Dec 31 for the selected year, plus partial weeks before/after
  const { cells, monthLabels } = useMemo(() => {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const gridStart = getMonday(yearStart);
    const totalDays = daysBetween(addDays(yearEnd, 1), gridStart);
    const weekCount = Math.ceil(totalDays / 7);

    const cells: (DayCell | null)[][] = Array.from({ length: DAYS }, () =>
      Array(weekCount).fill(null)
    );

    for (let w = 0; w < weekCount; w++) {
      const colStart = addDays(gridStart, w * 7);
      for (let d = 0; d < DAYS; d++) {
        const cellDate = addDays(colStart, d);
        const k = dateKey(cellDate);
        const data = dailyMap.get(k);
        cells[d][w] = {
          date: cellDate,
          trimp: data?.trimp ?? 0,
          count: data?.count ?? 0,
        };
      }
    }

    const monthLabels: { label: string; x: number }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < weekCount; w++) {
      const d = cells[0][w]?.date;
      if (!d) continue;
      if (d.getMonth() !== lastMonth) {
        lastMonth = d.getMonth();
        monthLabels.push({ label: MONTHS[lastMonth], x: w * CELL_TOTAL });
      }
    }

    return { cells, monthLabels };
  }, [dailyMap, year]);

  const { currentStreak, longestStreak, totalTRIMP } = useMemo(() => {
    const activeDays = new Set<string>();
    let total = 0;
    for (const [k, v] of dailyMap) {
      if (v.trimp > 0) activeDays.add(k);
      total += v.trimp;
    }

    let cur = 0;
    let cursor = activeDays.has(todayKey)
      ? new Date(today)
      : new Date(today.getTime() - 86_400_000);

    while (activeDays.has(dateKey(cursor))) {
      cur++;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }

    let longest = 0;
    let run = 0;
    let prev: Date | null = null;
    const sorted = Array.from(activeDays)
      .map((s) => new Date(s))
      .sort((a, b) => a.getTime() - b.getTime());

    for (const d of sorted) {
      if (!prev) run = 1;
      else if (daysBetween(d, prev) === 1) run++;
      else run = 1;
      if (run > longest) longest = run;
      prev = d;
    }

    return { currentStreak: cur, longestStreak: longest, totalTRIMP: total };
  }, [dailyMap, todayKey, today]);

  const LEFT = 34;
  const TOP = 22;
  const BOTTOM = 34;
  const weekCount = cells[0]?.length || WEEKS;
  const GRID_W = weekCount * CELL_TOTAL;
  const GRID_H = DAYS * CELL_TOTAL;
  const SVG_W = LEFT + GRID_W + 8;
  const SVG_H = TOP + GRID_H + BOTTOM;

  return (
    <div className="bg-[#141420] border border-[#2a2a3a] rounded-lg p-4 text-gray-300 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setYear((y) => y - 1)}
            className="px-2 py-0.5 border border-[#2a2a3a] rounded cursor-pointer hover:bg-[#1a1a2e] transition-colors text-gray-400 hover:text-gray-200"
            aria-label="Previous year"
          >
            ←
          </button>
          <span className="text-gray-400 text-xs whitespace-nowrap font-medium">{year}</span>
          <button
            onClick={() => setYear((y) => Math.min(y + 1, currentYear))}
            disabled={year >= currentYear}
            className={`px-2 py-0.5 border border-[#2a2a3a] rounded cursor-pointer transition-colors text-gray-400 ${
              year < currentYear
                ? "hover:bg-[#1a1a2e] hover:text-gray-200"
                : "opacity-30 cursor-not-allowed"
            }`}
            aria-label="Next year"
          >
            →
          </button>
        </div>
        <span className="text-xs text-gray-600 shrink-0">
          {activities.filter((a) => a.start_time_utc).length} activities
        </span>
      </div>

      <div className="flex-1 min-h-0 w-full">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="TRIMP calendar heatmap"
        >
          {monthLabels.map((m, i) => (
            <text
              key={`${m.label}-${i}`}
              x={LEFT + m.x}
              y={TOP - 8}
              fill="#6b7280"
              fontSize="9"
              fontFamily="system-ui, sans-serif"
            >
              {m.label}
            </text>
          ))}

          {DAY_LABELS.map((lbl, i) =>
            lbl ? (
              <text
                key={i}
                x={LEFT - 6}
                y={TOP + i * CELL_TOTAL + CELL_SIZE - 2}
                fill="#6b7280"
                fontSize="9"
                fontFamily="system-ui, sans-serif"
                textAnchor="end"
              >
                {lbl}
              </text>
            ) : null
          )}

          {cells.map((row, dayIdx) =>
            row.map((cell, weekIdx) => {
              if (!cell) return null;
              const x = LEFT + weekIdx * CELL_TOTAL;
              const y = TOP + dayIdx * CELL_TOTAL;
              const fill = getColor(cell.trimp, cell.count);
              const isToday = dateKey(cell.date) === todayKey;
              const actLabel = cell.count === 1 ? "activity" : "activities";

              return (
                <g key={`${weekIdx}-${dayIdx}`}>
                  <rect
                    x={x}
                    y={y}
                    width={CELL_SIZE}
                    height={CELL_SIZE}
                    rx={2}
                    ry={2}
                    fill={fill}
                    stroke={isToday ? "#6b7280" : "none"}
                    strokeWidth={isToday ? 1 : 0}
                    style={isToday ? { strokeOpacity: 0.6 } : undefined}
                  >
                    <title>{`${formatDateStr(cell.date)} — TRIMP: ${cell.trimp} [${cell.count} ${actLabel}]`}</title>
                  </rect>
                </g>
              );
            })
          )}

          <g transform={`translate(${LEFT}, ${TOP + GRID_H + 14})`}>
            <text x={0} y={8} fill="#6b7280" fontSize="9" fontFamily="system-ui, sans-serif">
              Less
            </text>
            {TRIMP_COLORS.map((c, i) => (
              <rect
                key={i}
                x={32 + i * CELL_TOTAL}
                y={0}
                width={CELL_SIZE}
                height={CELL_SIZE}
                rx={2}
                ry={2}
                fill={c}
              />
            ))}
            <text
              x={32 + TRIMP_COLORS.length * CELL_TOTAL + 4}
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

      <div className="mt-3 pt-3 border-t border-[#2a2a3a] text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
        <span>Current streak: <span className="text-gray-300 font-medium">{currentStreak}</span>d</span>
        <span>Longest streak: <span className="text-gray-300 font-medium">{longestStreak}</span>d</span>
        <span>Total TRIMP: <span className="text-gray-300 font-medium">{totalTRIMP.toLocaleString()}</span></span>
      </div>
    </div>
  );
}
