import { getAggregate, getAllActivities, getSummary } from "@/lib/data";
import SummaryCards from "@/components/SummaryCards";
import VolumeCharts from "@/components/VolumeCharts";
import HRCharts from "@/components/HRCharts";
import GAPCharts from "@/components/GAPCharts";
import BestEfforts from "@/components/BestEfforts";
import GearCharts from "@/components/GearCharts";
import ActivityTable from "@/components/ActivityTable";

export default function Dashboard() {
  const aggregate = getAggregate();
  const activities = getAllActivities();
  const summary = getSummary();

  const firstDate = aggregate.date_range.first ? new Date(aggregate.date_range.first).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "N/A";
  const lastDate = aggregate.date_range.last ? new Date(aggregate.date_range.last).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "N/A";

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#e0e0ea]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#141420]/90 backdrop-blur-xl border-b border-[#2a2a3a]">
        <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg md:text-xl font-bold bg-gradient-to-r from-red-400 via-teal-400 to-green-400 bg-clip-text text-transparent">
              Strava Multisport Analysis
            </h1>
            <p className="text-xs text-gray-500">Run · Ride · Swim · Hike — Comprehensive fitness tracking</p>
          </div>
          <div className="text-xs text-gray-500 hidden md:block">
            {aggregate.total_activities} activities · {firstDate} — {lastDate}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 md:px-8 py-6 space-y-8">
        {/* Summary Cards */}
        <SummaryCards summary={summary} />

        {/* Volume Section */}
        <section>
          <h2 className="text-lg font-bold mb-4">Training Volume</h2>
          <VolumeCharts monthly={aggregate.monthly} weekly={aggregate.weekly} yearly={aggregate.yearly} />
        </section>

        {/* HR Section */}
        <section>
          <h2 className="text-lg font-bold mb-4">Heart Rate Analysis</h2>
          <HRCharts activities={activities} />
        </section>

        {/* Grade Adjusted Pace / Speed */}
        <section>
          <h2 className="text-lg font-bold mb-4">Grade Adjusted Performance</h2>
          <GAPCharts activities={activities} />
        </section>

        {/* Best Efforts */}
        <section>
          <h2 className="text-lg font-bold mb-4">Best Efforts & Records</h2>
          <BestEfforts aggregate={aggregate} />
        </section>

        {/* Gear */}
        <section>
          <h2 className="text-lg font-bold mb-4">Gear Mileage</h2>
          <GearCharts aggregate={aggregate} />
        </section>

        {/* Activity Explorer */}
        <section>
          <h2 className="text-lg font-bold mb-4">Activity Explorer</h2>
          <ActivityTable activities={activities} />
        </section>
      </main>

      <footer className="text-center py-8 text-xs text-gray-600 border-t border-[#2a2a3a] mt-8">
        Strava Analysis Dashboard · Data exported May 2026 · {aggregate.total_activities} activities analyzed
      </footer>
    </div>
  );
}
