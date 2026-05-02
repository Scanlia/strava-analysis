"use client";

import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from "chart.js";
import { Bar } from "react-chartjs-2";
import type { Aggregate } from "@/lib/data";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function GearCharts({ aggregate }: { aggregate: Aggregate }) {
  const gear = aggregate.gear;

  // Replacement thresholds
  const getThreshold = (name: string): { label: string; km: number } | null => {
    const lower = name.toLowerCase();
    if (lower.includes("shoe") || lower.includes("targhee")) return { label: "Shoes", km: 700 };
    if (lower.includes("chain")) return { label: "Chain", km: 3000 };
    if (lower.includes("cassette")) return { label: "Cassette", km: 9000 };
    if (lower.includes("tyre") || lower.includes("tire")) return { label: "Tyre", km: 5000 };
    if (lower.includes("bike") || lower.includes("hasa") || lower.includes("neuron") || lower.includes("giant")) {
      return null;  // Full bike — components tracked separately
    }
    return null;
  };

  const getStatus = (dist: number, threshold: number) => {
    const pct = (dist / threshold) * 100;
    if (pct > 100) return { color: "bg-red-500", text: "Replace", pct };
    if (pct > 70) return { color: "bg-yellow-500", text: "Soon", pct };
    return { color: "bg-green-500", text: "Good", pct };
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5">
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">Distance by Gear</h3>
        <div className="h-72">
          <Bar
            data={{
              labels: gear.map((g) => g.name),
              datasets: [{ label: "Distance (km)", data: gear.map((g) => g.distance_km), backgroundColor: ["#4ecdc4", "#ff6b6b", "#96ceb4", "#45b7d1"], borderRadius: 6 }],
            }}
            options={{
              indexAxis: "y",
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { title: { display: true, text: "km", color: "#8888a0" }, ticks: { color: "#8888a0" }, grid: { color: "#2a2a3a55" } },
                y: { ticks: { color: "#e0e0ea" }, grid: { color: "#2a2a3a55" } },
              },
            }}
          />
        </div>
      </div>
      <div className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-5 overflow-x-auto">
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">Gear Details</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase">
              <th className="text-left p-2">Gear</th>
              <th className="text-left p-2">Activities</th>
              <th className="text-left p-2">Distance</th>
              <th className="text-left p-2">Wear</th>
              <th className="text-left p-2">Sports</th>
            </tr>
          </thead>
          <tbody>
            {gear.map((g) => {
              const threshold = getThreshold(g.name);
              const status = threshold ? getStatus(g.distance_km, threshold.km) : null;
              return (
              <tr key={g.name} className="border-t border-[#2a2a3a] hover:bg-white/5">
                <td className="p-2 font-medium">{g.name}</td>
                <td className="p-2 text-gray-400">{g.activities}</td>
                <td className="p-2">{g.distance_km} km</td>
                <td className="p-2">
                  {status ? (
                    <span className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${status.color}`} />
                      <span className="text-[11px]">{status.text}</span>
                      <span className="text-[10px] text-gray-500">({Math.round(status.pct)}%)</span>
                    </span>
                  ) : <span className="text-[10px] text-gray-600">N/A</span>}
                </td>
                <td className="p-2 text-gray-400">{g.sports.join(", ")}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
