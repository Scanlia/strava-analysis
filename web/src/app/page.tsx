import { getAggregate, getAllActivities, getSummary } from "@/lib/data";
import SummaryCards from "@/components/SummaryCards";
import VolumeCharts from "@/components/VolumeCharts";
import YearOverYearChart from "@/components/YearOverYearChart";
import DOWHourHeatmap from "@/components/DOWHourHeatmap";
import HRCharts from "@/components/HRCharts";
import PaceHRScatter from "@/components/PaceHRScatter";
import GAPCharts from "@/components/GAPCharts";
import NegativeSplitChart from "@/components/NegativeSplitChart";
import NaismithChart from "@/components/NaismithChart";
import CTLChart from "@/components/CTLChart";
import SpeedDurationChart from "@/components/SpeedDurationChart";
import RacePredictor from "@/components/RacePredictor";
import CalendarHeatmap from "@/components/CalendarHeatmap";
import GPSHeatmap from "@/components/GPSHeatmap";
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
      <header className="sticky top-0 z-50 bg-[#141420]/90 backdrop-blur-xl border-b border-[#2a2a3a]">
        <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-bold animated-gradient">
              Strava Multisport Analysis
            </h1>
            <p className="text-sm text-gray-400">Run · Ride · Swim · Hike — Comprehensive fitness tracking</p>
          </div>
          <div className="text-sm text-gray-500 hidden md:block">
            {aggregate.total_activities} activities · {firstDate} — {lastDate}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 md:px-8 py-8 space-y-10">
        <SummaryCards summary={summary} activities={activities.length} />

        <section>
          <h2 className="text-xl font-bold mb-5">Activity Calendar &amp; Patterns</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1"><DOWHourHeatmap aggregate={aggregate} /></div>
            <div className="lg:col-span-2"><CalendarHeatmap activities={activities} /></div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Training Volume</h2>
          <VolumeCharts monthly={aggregate.monthly} weekly={aggregate.weekly} yearly={aggregate.yearly} />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Heart Rate Analysis</h2>
          <HRCharts activities={activities} />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Grade Adjusted Pace &amp; Speed</h2>
          <GAPCharts activities={activities} trends={aggregate.gap_trends || {}} />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Pace vs Heart Rate Efficiency</h2>
          <PaceHRScatter activities={activities} aggregate={aggregate} />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Year-over-Year Comparison</h2>
          <YearOverYearChart activities={activities} />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Training Load (CTL / ATL / TSB)</h2>
          <CTLChart aggregate={aggregate} />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Speed-Duration Curve (Critical Pace / Power)</h2>
          <SpeedDurationChart aggregate={aggregate} />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Race Predictor</h2>
          <RacePredictor activities={activities} />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Sport-Specific</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <NegativeSplitChart activities={activities} />
            <NaismithChart activities={activities} />
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Best Efforts & Records</h2>
          <BestEfforts aggregate={aggregate} />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Gear Mileage</h2>
          <GearCharts aggregate={aggregate} />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">GPS Activity Map</h2>
          <GPSHeatmap activities={activities} />
        </section>

        <section>
          <h2 className="text-xl font-bold mb-5">Activity Explorer</h2>
          <ActivityTable activities={activities} />
        </section>
      </main>

      <footer className="text-center py-8 text-xs text-gray-600 border-t border-[#2a2a3a] mt-8">
        Strava Analysis Dashboard · Data exported May 2026 · {aggregate.total_activities} activities analyzed
      </footer>
    </div>
  );
}
