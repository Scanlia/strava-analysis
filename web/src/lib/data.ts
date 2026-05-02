import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "public/data");

export interface GapSegment {
  dist_km: number;
  split_dist_km: number;
  split_moving_time_s: number;
  grade_pct: number;
  speed_ms: number;
  speed_kmh: number;
  gap_pace_min_km: number | null;
  gap_pace_str: string | null;
  gap_speed_kmh: number | null;
  avg_hr: number | null;
  ele_gain: number;
}

export interface Activity {
  id: string;
  name: string;
  description: string;
  sport: string;
  start_time_local: string;
  start_time_utc: string | null;
  elapsed_time_sec: number;
  moving_time_sec: number;
  distance_m: number;
  csv_distance_m: number;
  max_speed: number;
  avg_speed: number;
  max_speed_kmh: number;
  avg_speed_kmh: number;
  elevation_gain_m: number;
  elevation_loss_m: number;
  max_hr: number | null;
  avg_hr: number;
  calories: number;
  relative_effort: number;
  gear: string | null;
  commute: boolean;
  average_temp: number;
  max_cadence: number;
  avg_cadence: number;
  has_hr: boolean;
  hr_zones: Record<string, number>;
  efficiency_factor: number | null;
  aerobic_decoupling_pct: number | null;
  avg_pace_min_per_km: number | null;
  gap_avg_pace_min_per_km: number | null;
  grade_adjusted_speed_kmh: number | null;
  gap_segments: GapSegment[] | null;
  trimp: number | null;
  elevation_per_km: number | null;
  vam: number | null;
  splits_km: { km: number; time_sec: number; pace_min_per_km: number; avg_hr: number | null; elev_gain: number }[] | null;
  stream_points: number;
}

export interface MonthlyEntry {
  month: string;
  run: SportVolume;
  ride: SportVolume;
  hike: SportVolume;
  swim: SportVolume;
  total: SportVolume;
}

export interface WeeklyEntry {
  week: string;
  run: SportVolume & { avg_hr: number | null };
  ride: SportVolume & { avg_hr: number | null };
  hike: SportVolume & { avg_hr: number | null };
  swim: SportVolume & { avg_hr: number | null };
  total: { count: number; distance_km: number; time_hours: number; elevation_m: number; relative_effort: number };
}

export interface YearlyEntry {
  year: number;
  run: SportVolume;
  ride: SportVolume;
  hike: SportVolume;
  swim: SportVolume;
}

export interface SportVolume {
  count: number;
  distance_km: number;
  time_hours: number;
  elevation_m: number;
  relative_effort?: number;
  trimp?: number;
}

export interface Aggregate {
  monthly: MonthlyEntry[];
  weekly: WeeklyEntry[];
  yearly: YearlyEntry[];
  best_efforts: Record<string, BestEffort>;
  gear: GearEntry[];
  gap_trends: Record<string, GapTrends>;
  sport_counts: Record<string, number>;
  total_activities: number;
  date_range: { first: string | null; last: string | null };
}

export interface GapTrends {
  ref_date: string;
  loess_split: { days: number; value: number }[];
  loess_act: { days: number; value: number }[];
  linear_split: { slope_per_month: number; intercept: number };
  linear_act: { slope_per_month: number; intercept: number };
  n_splits: number;
  n_activities: number;
}

export interface BestEffort {
  longest_distance_km: number;
  longest_name: string;
  most_elevation_m: number;
  most_elev_name: string;
  highest_max_hr: number | null;
  best_avg_speed_kmh: number;
  best_speed_name: string;
}

export interface GearEntry {
  name: string;
  activities: number;
  distance_km: number;
  sports: string[];
}

export interface Summary {
  run: SportSummary;
  ride: SportSummary;
  hike: SportSummary;
  swim: SportSummary;
}

export interface SportSummary {
  count: number;
  total_distance_km: number;
  total_time_hours: number;
  total_elevation_m: number;
  avg_hr: number | null;
  activities_with_hr: number;
}

function readJson<T>(filename: string): T {
  const filePath = path.join(DATA_DIR, filename);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export function getAggregate(): Aggregate {
  return readJson<Aggregate>("aggregate.json");
}

export function getAllActivities(): Activity[] {
  return readJson<Activity[]>("all_activities.json");
}

export function getSummary(): Summary {
  return readJson<Summary>("summary.json");
}

export function getActivitiesBySport(sport: string): Activity[] {
  return readJson<Activity[]>(`${sport.toLowerCase()}_activities.json`);
}
