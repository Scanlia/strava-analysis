import type { Aggregate } from "@/lib/data";

export default function BestEfforts({ aggregate }: { aggregate: Aggregate }) {
  const be = aggregate.best_efforts;
  const cards = [
    { key: "run", label: "Running", icon: "🏃", color: "#ff6b6b" },
    { key: "ride", label: "Cycling", icon: "🚴", color: "#4ecdc4" },
    { key: "hike", label: "Hiking", icon: "🥾", color: "#96ceb4" },
    { key: "swim", label: "Swimming", icon: "🏊", color: "#45b7d1" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => {
        const d = be[c.key];
        if (!d) return null;
        return (
          <div key={c.key} className="bg-[#141420] border border-[#2a2a3a] rounded-xl p-4">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">{c.label}</div>
            <div className="text-xl font-bold" style={{ color: c.color }}>{d.longest_distance_km} km</div>
            <div className="text-xs text-gray-400 mb-2 truncate">{d.longest_name}</div>
            <div className="text-xs text-gray-400">
              Most elevation: <strong className="text-gray-300">{d.most_elevation_m} m</strong>
            </div>
            <div className="text-[10px] text-gray-500 mb-1 truncate">{d.most_elev_name}</div>
            {d.highest_max_hr && (
              <div className="text-xs text-gray-400">Max HR: <strong className="text-gray-300">{d.highest_max_hr} bpm</strong></div>
            )}
          </div>
        );
      })}
    </div>
  );
}
