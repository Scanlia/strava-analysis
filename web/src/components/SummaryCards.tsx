import type { Summary } from "@/lib/data";

export default function SummaryCards({ summary }: { summary: Summary }) {
  const sports = [
    { key: "run" as const, label: "Running", icon: "🏃", bg: "rgba(255,107,107,0.15)", color: "#ff6b6b" },
    { key: "ride" as const, label: "Cycling", icon: "🚴", bg: "rgba(78,205,196,0.15)", color: "#4ecdc4" },
    { key: "swim" as const, label: "Swimming", icon: "🏊", bg: "rgba(69,183,209,0.15)", color: "#45b7d1" },
    { key: "hike" as const, label: "Hiking", icon: "🥾", bg: "rgba(150,206,180,0.15)", color: "#96ceb4" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {sports.map((s) => {
        const d = summary[s.key];
        return (
          <div key={s.key} className="bg-[#141420] border border-[#2a2a3a] hover:border-violet-600/50 rounded-xl p-4 flex items-center gap-3 transition-all">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ backgroundColor: s.bg, color: s.color }}>{s.icon}</div>
            <div>
              <div className="text-2xl font-bold" style={{ color: s.color }}>{d?.count ?? 0}</div>
              <div className="text-xs text-gray-400">{s.label}</div>
              <div className="text-[10px] text-gray-500">
                {d ? `${d.total_distance_km.toFixed(0)} km · ${d.total_time_hours.toFixed(0)} hrs` : "No data"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
