#!/usr/bin/env python3
"""Strava Data Processor - Parses activities.csv and GPX/TCX files, computes all metrics."""

import csv
import json
import gzip
import math
import os
import io
import fitparse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from collections import defaultdict

# --- Configuration ---
EXPORT_DIR = "strava_export"
OUTPUT_DIR = "data"
ACTIVITIES_CSV = os.path.join(EXPORT_DIR, "activities.csv")
ACTIVITIES_DIR = os.path.join(EXPORT_DIR, "activities")

# Namespaces for GPX parsing
NS = {
    "": "http://www.topografix.com/GPX/1/1",
    "gpxtpx": "http://www.garmin.com/xmlschemas/TrackPointExtension/v1",
    "gpxx": "http://www.garmin.com/xmlschemas/GpxExtensions/v3",
}

# Sport type mapping for our target sports
TARGET_SPORTS = {"Run", "Ride", "Hike", "Swim"}

# HR zones as percentages of max HR
ZONE_RANGES = {
    "Z1 (Recovery)": (0, 60),
    "Z2 (Endurance)": (60, 70),
    "Z3 (Tempo)": (70, 80),
    "Z4 (Threshold)": (80, 90),
    "Z5 (Max)": (90, 100),
}

os.makedirs(OUTPUT_DIR, exist_ok=True)


def parse_csv_date_utc(date_str):
    """Parse the Strava CSV date string (assumed local time) and return UTC ISO string."""
    if not date_str:
        return None
    try:
        # Format: "Apr 29, 2026, 5:31:44 PM"
        dt = datetime.strptime(date_str, "%b %d, %Y, %I:%M:%S %p")
        # Assume it's local time (guess based on activities being in Australia)
        # Try common Australian timezones
        for tz_offset in [10, 11, 8, 9.5]:  # AEST, AEDT, AWST, ACST
            try:
                tz = timezone(timedelta(hours=tz_offset))
                dt_tz = dt.replace(tzinfo=tz)
                return dt_tz.isoformat()
            except:
                continue
        # Fallback: treat as UTC
        dt_utc = dt.replace(tzinfo=timezone.utc)
        return dt_utc.isoformat()
    except (ValueError, TypeError):
        return None


# --- Haversine distance calculation ---
def haversine(lat1, lon1, lat2, lon2):
    R = 6371000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# --- Grade calculation ---
def calc_grade(elev_change, distance):
    if distance == 0:
        return 0
    return (elev_change / distance) * 100


# --- GPX file parsing ---
def parse_gpx(filepath):
    """Parse a GPX file returning list of track points with time, lat, lon, ele, hr, cadence, temp."""
    points = []
    try:
        if filepath.endswith(".gz"):
            f = gzip.open(filepath, "r")
            content = f.read()
            f.close()
            root = ET.fromstring(content)
        else:
            tree = ET.parse(filepath)
            root = tree.getroot()

        for trkseg in root.iterfind(".//{http://www.topografix.com/GPX/1/1}trkseg"):
            for trkpt in trkseg.findall("{http://www.topografix.com/GPX/1/1}trkpt"):
                lat = float(trkpt.get("lat"))
                lon = float(trkpt.get("lon"))
                ele_el = trkpt.find("{http://www.topografix.com/GPX/1/1}ele")
                time_el = trkpt.find("{http://www.topografix.com/GPX/1/1}time")
                ele = float(ele_el.text) if ele_el is not None else None
                time_str = time_el.text if time_el is not None else None

                # Extensions (HR, cadence, temp)
                hr = None
                cadence = None
                temp = None
                for ext in trkpt.iter():
                    tag = ext.tag.split("}")[-1] if "}" in ext.tag else ext.tag
                    if tag == "hr" and ext.text:
                        try:
                            hr = int(float(ext.text))
                        except ValueError:
                            pass
                    if tag == "cad" and ext.text:
                        try:
                            cadence = int(float(ext.text))
                        except ValueError:
                            pass
                    if tag == "atemp" and ext.text:
                        try:
                            temp = float(ext.text)
                        except ValueError:
                            pass

                points.append({
                    "lat": lat, "lon": lon, "ele": ele,
                    "time": time_str, "hr": hr, "cadence": cadence, "temp": temp
                })
    except Exception as e:
        print(f"  WARNING: Failed to parse GPX {filepath}: {e}")
        return []
    return points


# --- TCX file parsing ---
def parse_tcx(filepath):
    """Parse a TCX file returning list of track points."""
    points = []
    try:
        if filepath.endswith(".gz"):
            f = gzip.open(filepath, "r")
            content = f.read()
            f.close()
            root = ET.fromstring(content)
        else:
            tree = ET.parse(filepath)
            root = tree.getroot()

        tcx_ns = "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
        for track in root.iter(f"{{{tcx_ns}}}Trackpoint"):
            time_el = track.find(f"{{{tcx_ns}}}Time")
            dist_el = track.find(f"{{{tcx_ns}}}DistanceMeters")
            hr_el = track.find(f"{{{tcx_ns}}}HeartRateBpm")
            cad_el = track.find(f"{{{tcx_ns}}}Cadence")
            pos_el = track.find(f"{{{tcx_ns}}}Position")
            alt_el = track.find(f"{{{tcx_ns}}}AltitudeMeters")

            time_str = time_el.text if time_el is not None else None
            distance = float(dist_el.text) if dist_el is not None else None
            hr = None
            if hr_el is not None:
                hr_v = hr_el.find(f"{{{tcx_ns}}}Value")
                if hr_v is not None:
                    hr = int(float(hr_v.text))
            cadence = int(float(cad_el.text)) if cad_el is not None and cad_el.text else None

            lat, lon = None, None
            if pos_el is not None:
                lat_el = pos_el.find(f"{{{tcx_ns}}}LatitudeDegrees")
                lon_el = pos_el.find(f"{{{tcx_ns}}}LongitudeDegrees")
                lat = float(lat_el.text) if lat_el is not None else None
                lon = float(lon_el.text) if lon_el is not None else None

            ele = float(alt_el.text) if alt_el is not None else None

            points.append({
                "lat": lat, "lon": lon, "ele": ele,
                "time": time_str, "hr": hr, "cadence": cadence,
                "distance_cum": distance
            })
    except Exception as e:
        print(f"  WARNING: Failed to parse TCX {filepath}: {e}")
        return []
    return points


# --- FIT file parsing ---
SEMICIRCLE_TO_DEG = 180.0 / (2**31)


def parse_fit(filepath):
    """Parse a FIT binary file returning list of track points with time, lat, lon, ele, hr, cadence, speed."""
    points = []
    try:
        if filepath.endswith(".gz"):
            f = gzip.open(filepath, "rb")
            fit = fitparse.FitFile(f)
        else:
            fit = fitparse.FitFile(filepath)

        for rec in fit:
            if rec.name != "record":
                continue
            vals = {}
            for field in rec.fields:
                try:
                    vals[field.name] = rec.get_value(field.name)
                except Exception:
                    pass

            ts = vals.get("timestamp")
            if ts is None:
                continue

            lat = vals.get("position_lat")
            lon = vals.get("position_long")
            if lat is not None:
                lat = lat * SEMICIRCLE_TO_DEG
            if lon is not None:
                lon = lon * SEMICIRCLE_TO_DEG

            ele = vals.get("enhanced_altitude") or vals.get("altitude")
            hr = vals.get("heart_rate")
            cadence = vals.get("cadence")
            speed = vals.get("enhanced_speed") or vals.get("speed")
            temp = vals.get("temperature")
            moving = vals.get("moving")  # Strava app FIT includes this boolean

            points.append({
                "lat": lat,
                "lon": lon,
                "ele": float(ele) if ele is not None else None,
                "time": ts.isoformat() if isinstance(ts, datetime) else str(ts),
                "hr": int(hr) if hr is not None else None,
                "cadence": int(cadence) if cadence is not None else None,
                "temp": float(temp) if temp is not None else None,
                "speed_ms": float(speed) if speed is not None else None,
                "moving": bool(moving) if moving is not None else None,
            })
    except Exception as e:
        print(f"  WARNING: Failed to parse FIT {filepath}: {e}")
        return []
    return points


# --- Compute time-series metrics from points ---
def compute_stream_metrics(points, is_tcx=False, is_fit=False, sport=""):
    """Compute detailed per-second metrics from track points."""
    result = {
        "times": [],
        "distances": [],
        "lats": [],
        "lons": [],
        "elevations": [],
        "speeds": [],
        "heartrates": [],
        "cadences": [],
        "grades": [],
        "cumulative_distance": 0,
        "total_elevation_gain": 0,
        "total_elevation_loss": 0,
        "max_speed": 0,
        "avg_speed": 0,
        "max_hr": None,
        "avg_hr": None,
        "avg_cadence": 0,
        "max_cadence": 0,
        "moving_time": 0,
        "elapsed_time": 0,
        "start_time": None,
        "end_time": None,
        "start_lat": None,
        "start_lon": None,
        "end_lat": None,
        "end_lon": None,
        "avg_temp": None,
        "hr_zones": {},
        "hr_samples": 0,
        "grade_positive_sum": 0,
        "grade_negative_sum": 0,
        "grade_positive_count": 0,
        "grade_negative_count": 0,
        "raw_points": [],  # simplified points for dashboard
        "is_moving": [],   # boolean per segment: True = moving, False = stopped
        "long_stops": [],  # [(start_idx, end_idx, duration_sec), ...]
    }

    if len(points) < 2:
        return result

    # --- Stop detection speed thresholds (m/s) ---
    threshold = {"Run": 0.5, "Ride": 1.0, "Hike": 0.3, "Swim": 0.2}.get(sport, 0.5)
    # Hysteresis: require N consecutive seconds below threshold to trigger stop
    STOP_T = 10  # seconds
    RESUME_T = 3  # seconds

    cum_dist = 0
    prev_point = None
    prev_time = None
    speeds = []
    heart_rates = []
    hr_seg_ids = []  # segment index for each HR value (for stop filtering)
    cadences = []
    temps = []
    grades_smooth = []
    last_elevation = None
    last_grade_distance = 0
    rolling_grades = []
    seg_speeds = []      # per-segment GPS speed (m/s)
    seg_dt = []          # per-segment time delta (s)
    seg_fit_moving = []  # per-segment FIT moving flag (None if unavailable)

    for i, p in enumerate(points):
        cur_time = None
        if p["time"]:
            try:
                if "T" in p["time"]:
                    cur_time = datetime.fromisoformat(p["time"].replace("Z", "+00:00"))
                else:
                    cur_time = datetime.fromisoformat(p["time"].replace("Z", "+00:00"))
            except (ValueError, TypeError):
                continue

        if result["start_time"] is None and cur_time:
            result["start_time"] = cur_time.isoformat()
        if cur_time:
            result["end_time"] = cur_time.isoformat()

        if i == 0 and p["lat"] is not None and p["lon"] is not None:
            result["start_lat"] = p["lat"]
            result["start_lon"] = p["lon"]

        if p["lat"] is not None and p["lon"] is not None:
            result["end_lat"] = p["lat"]
            result["end_lon"] = p["lon"]

        # Distance calculation
        if is_tcx and p.get("distance_cum") is not None:
            cum_dist = p["distance_cum"]
        elif prev_point and p["lat"] is not None and prev_point.get("lat") is not None:
            seg_dist = haversine(prev_point["lat"], prev_point["lon"], p["lat"], p["lon"])
            cum_dist += seg_dist
        else:
            seg_dist = 0

        result["distances"].append(cum_dist)

        # Speed: always use GPS-derived (position delta) for consistency
        if prev_point and cur_time and prev_time:
            td = (cur_time - prev_time).total_seconds()
            if td > 0:
                d = cum_dist - result["distances"][-2] if len(result["distances"]) > 1 else 0
                spd = d / td
                speeds.append(spd)
                seg_speeds.append(spd)
                seg_dt.append(td)
                fit_mv = p.get("moving")  # None if not a FIT file or flag absent
                seg_fit_moving.append(fit_mv)
                result["max_speed"] = max(result["max_speed"], spd)
                if spd > 0.3:
                    result["moving_time"] += td

        # Elevation gain/loss
        if p["ele"] is not None and last_elevation is not None:
            diff = p["ele"] - last_elevation
            if diff > 0:
                result["total_elevation_gain"] += diff
            else:
                result["total_elevation_loss"] += abs(diff)

        if p["ele"] is not None:
            last_elevation = p["ele"]
            result["elevations"].append(p["ele"])
        else:
            result["elevations"].append(None)

        # Grade calculation (using rolling 30m distance)
        if not is_tcx and prev_point and p["lat"] is not None and prev_point.get("lat") is not None:
            seg_dist = haversine(prev_point["lat"], prev_point["lon"], p["lat"], p["lon"])
            last_grade_distance += seg_dist
            if last_grade_distance >= 30:
                if len(result["elevations"]) >= 2:
                    ele_start = None
                    for e in reversed(result["elevations"]):
                        if e is not None:
                            ele_start = e
                            break
                    if ele_start is not None and p["ele"] is not None:
                        grd = calc_grade(p["ele"] - ele_start, last_grade_distance)
                        grades_smooth.append(grd)
                        if grd > 0:
                            result["grade_positive_sum"] += grd
                            result["grade_positive_count"] += 1
                        elif grd < 0:
                            result["grade_negative_sum"] += abs(grd)
                            result["grade_negative_count"] += 1
                last_grade_distance = 0
        result["grades"].append(grades_smooth[-1] if grades_smooth else None)

        # HR
        if p["hr"] is not None:
            heart_rates.append(p["hr"])
            hr_seg_ids.append(len(seg_speeds) - 1)  # segment index of preceding segment
            result["hr_samples"] += 1

        # Cadence
        if p.get("cadence") is not None:
            cadences.append(p["cadence"])

        # Temperature
        if p.get("temp") is not None:
            temps.append(p["temp"])

        result["times"].append(cur_time.isoformat() if cur_time else None)
        result["lats"].append(p["lat"])
        result["lons"].append(p["lon"])
        result["heartrates"].append(p["hr"])
        result["cadences"].append(p.get("cadence"))

        # Store simplified point for dashboard (1 per 10s)
        if i % 10 == 0:
            result["raw_points"].append({
                "t": cur_time.isoformat() if cur_time else None,
                "d": round(cum_dist, 1),
                "e": round(p["ele"], 1) if p["ele"] else None,
                "hr": p["hr"],
                "s": round(speeds[-1], 2) if speeds else None,
                "lat": p["lat"],
                "lon": p["lon"],
                "_pi": i,  # original point index for stop-detection mapping
            })

        prev_point = p
        prev_time = cur_time

    # --- Hysteresis stop detection ---
    # Use FIT moving flag if available; otherwise GPS speed threshold + hysteresis
    has_fit_moving = any(mv is not None for mv in seg_fit_moving)
    is_moving = [True] * len(seg_speeds)
    stop_state = False
    stop_timer = 0.0
    move_timer = 0.0
    long_stops = []
    current_stop_start = -1

    for si in range(len(seg_speeds)):
        spd = seg_speeds[si]
        dt = seg_dt[si]
        fit_mv = seg_fit_moving[si] if si < len(seg_fit_moving) else None

        if has_fit_moving and fit_mv is not None:
            moving_now = bool(fit_mv)
        else:
            if spd < threshold:
                stop_timer += dt
                move_timer = 0.0
            else:
                move_timer += dt
                stop_timer = 0.0

            if not stop_state:
                if stop_timer >= STOP_T:
                    stop_state = True
                    stop_timer = 0.0
                    current_stop_start = si
                    move_timer = 0.0
            else:
                if move_timer >= RESUME_T:
                    stop_state = False
                    move_timer = 0.0
                    if current_stop_start >= 0:
                        stop_dur = sum(seg_dt[current_stop_start:si])
                        if stop_dur > 300:
                            long_stops.append((current_stop_start, si, round(stop_dur, 1)))
                        current_stop_start = -1

            moving_now = not stop_state

        is_moving[si] = moving_now

    # Flush any trailing long stop
    if stop_state and current_stop_start >= 0:
        stop_dur = sum(seg_dt[current_stop_start:])
        if stop_dur > 300:
            long_stops.append((current_stop_start, len(seg_speeds) - 1, round(stop_dur, 1)))

    result["is_moving"] = is_moving
    result["long_stops"] = long_stops

    # Tag raw_points with moving flag (raw_points stored every 10th original point)
    for rp in result["raw_points"]:
        pi = rp.get("_pi", 0)
        seg_idx = pi - 1
        rp["m"] = is_moving[seg_idx] if 0 <= seg_idx < len(is_moving) else True

    # Recompute moving_time from hysteresis (more accurate than threshold alone)
    result["moving_time"] = sum(seg_dt[i] for i in range(len(seg_speeds)) if is_moving[i])

    result["cumulative_distance"] = cum_dist
    result["speeds"] = speeds  # Store full speeds for decoupling analysis
    result["_seg_dt"] = seg_dt  # time deltas for moving-filtered analysis

    # Compute avg_speed and avg_hr over moving segments only
    moving_speeds = [seg_speeds[i] for i in range(len(seg_speeds)) if is_moving[i]]
    result["avg_speed"] = sum(moving_speeds) / len(moving_speeds) if moving_speeds else 0

    result["avg_cadence"] = round(sum(cadences) / len(cadences), 1) if cadences else 0
    result["max_cadence"] = max(cadences) if cadences else 0
    result["avg_temp"] = round(sum(temps) / len(temps), 1) if temps else 0

    if heart_rates:
        # Filter HR to moving segments only
        moving_hr = [heart_rates[k] for k in range(len(heart_rates)) if hr_seg_ids[k] < 0 or (0 <= hr_seg_ids[k] < len(is_moving) and is_moving[hr_seg_ids[k]])]
        result["avg_hr"] = round(sum(moving_hr) / len(moving_hr), 1) if moving_hr else round(sum(heart_rates) / len(heart_rates), 1)
        result["max_hr"] = max(heart_rates)
    else:
        result["avg_hr"] = 0
        result["max_hr"] = 0

    if result["start_time"] and result["end_time"]:
        try:
            st = datetime.fromisoformat(result["start_time"])
            et = datetime.fromisoformat(result["end_time"])
            result["elapsed_time"] = (et - st).total_seconds()
        except:
            pass

    # HR zone distribution (using max HR from points or estimated) — moving only
    max_hr = result["max_hr"] or 190  # fallback
    zones = {"Z1": 0, "Z2": 0, "Z3": 0, "Z4": 0, "Z5": 0}
    hr_vals = moving_hr if heart_rates else heart_rates
    for hr in hr_vals:
        pct = (hr / max_hr) * 100 if max_hr > 0 else 0
        if pct < 60:
            zones["Z1"] += 1
        elif pct < 70:
            zones["Z2"] += 1
        elif pct < 80:
            zones["Z3"] += 1
        elif pct < 90:
            zones["Z4"] += 1
        else:
            zones["Z5"] += 1
    result["hr_zones"] = zones

    return result


# --- HR cleaning ---
def clean_hr(hr_values, observed_max_hr):
    """Clean HR stream: cap, rate-of-change filter, trim zeros, sport ceiling."""
    if not hr_values:
        return hr_values, 0

    n = len(hr_values)
    cleaned = [min(max(h, 30), 220) for h in hr_values]  # Hard cap

    # Rate-of-change: HR can't jump >20 bpm between consecutive reads
    for i in range(1, n):
        if abs(cleaned[i] - cleaned[i - 1]) > 20:
            cleaned[i] = cleaned[i - 1]

    # Sport-specific ceiling
    if observed_max_hr:
        cleaned = [min(h, observed_max_hr + 5) for h in cleaned]

    # Trim leading/trailing values below 30 (sensor dropout)
    start = 0
    while start < n and cleaned[start] < 30:
        start += 1
    end = n
    while end > start and cleaned[end - 1] < 30:
        end -= 1

    cleaned = cleaned[start:end]
    dropped = n - len(cleaned)
    return cleaned, dropped


# --- Per-sport HR max calibration ---
def compute_sport_max_hr(all_activities, sport, n_months=18):
    """99th percentile of cleaned HR across recent activities for the sport."""
    import numpy as np
    cutoff = datetime.now(timezone.utc) - timedelta(days=n_months * 30)
    all_hr = []
    for a in all_activities:
        if a.get("sport") != sport:
            continue
        st = a.get("start_time_utc")
        if not st:
            continue
        try:
            dt_str = str(st).replace("Z", "+00:00")
            if "+" in dt_str or dt_str.count("-") > 2:
                dt = datetime.fromisoformat(dt_str)
            else:
                dt = datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc)
        except:
            continue
        if dt < cutoff:
            continue
        hrs = a.get("_raw_hr_values", [])
        if hrs:
            all_hr.extend(hrs)
    if len(all_hr) < 50:
        return None
    return float(np.percentile(all_hr, 99))


def compute_karvonen_zones(max_hr, resting_hr=50):
    """5-zone Karvonen model. Returns list of (zone_name, low%, high%, low_bpm, high_bpm)."""
    hrr = max_hr - resting_hr
    return [
        ("Z1 Recovery",     50, 60, int(resting_hr + 0.50 * hrr), int(resting_hr + 0.60 * hrr)),
        ("Z2 Endurance",    60, 70, int(resting_hr + 0.60 * hrr), int(resting_hr + 0.70 * hrr)),
        ("Z3 Tempo",        70, 80, int(resting_hr + 0.70 * hrr), int(resting_hr + 0.80 * hrr)),
        ("Z4 Threshold",    80, 90, int(resting_hr + 0.80 * hrr), int(resting_hr + 0.90 * hrr)),
        ("Z5 VO2max",       90, 100, int(resting_hr + 0.90 * hrr), int(resting_hr + 1.00 * hrr)),
    ]


def compute_gap_segments(streams, activity_type, grade_points):
    """Compute grade-adjusted pace/speed at per-point level, then aggregate to 1km splits.

    Algorithm:
      1. Smooth elevation with a rolling-median over 15-point window (~15s at 1Hz)
      2. Compute grade per point using ±25m horizontal window (50m total)
      3. Clamp grade to [-25%, +25%] to reject residual noise
      4. Apply Minetti GAP multiplier per point: gap_speed = actual_speed * factor(grade)
      5. Aggregate to 1km splits by distance-weighted average of gap_speed
      6. Convert to pace (mm:ss) at the end

    Reference: Minetti et al. (2002) J. Applied Physiology
    """
    points = streams.get("raw_points", [])
    if len(points) < 10:
        return []

    n = len(points)

    # Step 1: Extract arrays (distance, elevation, speed, HR) with valid data
    dists = [p.get("d", 0) for p in points]
    eles = [p.get("e") for p in points]
    speeds = [p.get("s") for p in points]
    hrs = [p.get("hr") for p in points]

    # Step 1a: Smooth elevation with rolling median (window=15 points)
    def rolling_median(values, window):
        result = [None] * len(values)
        valid = [(i, v) for i, v in enumerate(values) if v is not None]
        half = window // 2
        for idx in range(len(values)):
            start = max(0, idx - half)
            end = min(len(values), idx + half + 1)
            win = [values[j] for j in range(start, end) if values[j] is not None]
            if win:
                win.sort()
                result[idx] = win[len(win) // 2]
        return result

    eles_smooth = rolling_median(eles, 15)
    speeds_smooth = rolling_median(speeds, 15)  # Also smooth GPS speed to remove spikes

    # Step 2: Compute grade per point using ±35m horizontal window
    grades = [None] * n
    for i in range(n):
        if eles_smooth[i] is None:
            continue
        d_cur = dists[i]
        # Find point ~35m before
        j_before = i
        while j_before > 0 and d_cur - dists[j_before] < 35:
            j_before -= 1
        # Find point ~35m after
        j_after = i
        while j_after < n - 1 and dists[j_after] - d_cur < 35:
            j_after += 1
        # Compute grade
        ele_before = eles_smooth[j_before]
        ele_after = eles_smooth[j_after]
        h_dist = dists[j_after] - dists[j_before]
        if h_dist > 5 and ele_before is not None and ele_after is not None:
            grade_pct = ((ele_after - ele_before) / h_dist) * 100
            # Step 3: Clamp to ±25%
            grades[i] = max(-25.0, min(25.0, grade_pct))

    # Step 4: Apply Minetti multiplier per point
    def minetti_factor(grade_pct, is_run):
        if is_run:
            if grade_pct > 1.0:
                return 1.0 + 0.033 * grade_pct
            elif grade_pct < -2.0:
                return 1.0 - 0.017 * abs(grade_pct)
            else:
                return 1.0
        else:
            if grade_pct > 0:
                return 1.0 + 0.033 * grade_pct
            elif grade_pct < -1.0:
                return 1.0 - 0.012 * abs(grade_pct)
            else:
                return 1.0

    is_run = (activity_type == "Run")
    gap_speeds = []
    for i in range(n):
        s = speeds_smooth[i] if speeds_smooth[i] is not None else speeds[i]
        if s is not None and s > 0.3 and grades[i] is not None:
            factor = minetti_factor(grades[i], is_run)
            gap_speeds.append(s * factor)
        else:
            gap_speeds.append(None)

    # Step 5: Aggregate to splits — distance-based for run (1km), moving-time-based for ride (5min)
    movings = [p.get("m", True) for p in points]  # is_moving flag per point
    is_ride = (activity_type == "Ride")
    SEGMENT_DIST = 1000 if is_run else 5000   # metres for run path detection only
    SEGMENT_TIME = 300  # seconds moving time for cycling (5 min)
    MIN_MOVING_DIST = 250  # metres minimum moving distance for a valid split
    MIN_MOVING_TIME = 150  # seconds minimum moving time for a valid cycling split

    # Compute time deltas between consecutive raw points
    time_deltas = [0.0] * n
    for i in range(1, n):
        try:
            t1 = datetime.fromisoformat(points[i - 1]["t"].replace("Z", "+00:00") if points[i - 1].get("t") else "")
            t2 = datetime.fromisoformat(points[i]["t"].replace("Z", "+00:00") if points[i].get("t") else "")
            time_deltas[i] = (t2 - t1).total_seconds()
            if time_deltas[i] < 0:
                time_deltas[i] = 0
        except:
            time_deltas[i] = 10  # fallback ~10s between raw points

    segments = []
    split_start = 0
    split_gap_sum = 0.0
    split_weight_sum = 0.0
    split_speed_sum = 0.0
    split_speed_count = 0
    split_hrs = []
    split_dist = 0.0      # distance covered in this split (moving only)
    split_moving_time = 0.0
    split_ele_start = eles_smooth[0]
    split_ele_end = split_ele_start

    for i in range(n):
        d = dists[i]
        delta = d - (dists[i - 1] if i > 0 else d)
        is_mv = movings[i] if i < len(movings) else True
        td = time_deltas[i]

        if is_mv and gap_speeds[i] is not None and delta > 0:
            split_gap_sum += gap_speeds[i] * delta
            split_weight_sum += delta
            split_dist += delta
            split_moving_time += td
        s = speeds_smooth[i] if speeds_smooth[i] is not None else speeds[i]
        if s is not None and s > 0.3:
            split_speed_sum += s
            split_speed_count += 1
        if hrs[i] is not None:
            split_hrs.append(hrs[i])
        if eles_smooth[i] is not None:
            split_ele_end = eles_smooth[i]

        should_cut = False
        if is_ride:
            should_cut = split_moving_time >= SEGMENT_TIME and split_dist >= MIN_MOVING_DIST
        else:
            should_cut = d - dists[split_start] >= SEGMENT_DIST and split_dist >= MIN_MOVING_DIST

        if should_cut and split_weight_sum > 0:
            gap_speed = split_gap_sum / split_weight_sum
            raw_speed = split_speed_sum / split_speed_count if split_speed_count > 0 else 0
            avg_grade = grades[i] if i < n and grades[i] is not None else 0
            avg_hr = sum(split_hrs) / len(split_hrs) if split_hrs else None
            ele_change = (split_ele_end - split_ele_start) if split_ele_start is not None and split_ele_end is not None else 0

            segments.append({
                "dist_km": round(d / 1000, 2),
                "split_dist_km": round(split_dist / 1000, 2),
                "split_moving_time_s": round(split_moving_time, 1),
                "grade_pct": round(avg_grade, 2),
                "speed_ms": round(raw_speed, 2),
                "speed_kmh": round(raw_speed * 3.6, 1),
                "gap_pace_min_km": round((1000 / gap_speed) / 60, 2) if is_run and gap_speed > 0 else None,
                "gap_pace_str": format_pace(gap_speed) if is_run and gap_speed > 0 else None,
                "gap_speed_kmh": round(gap_speed * 3.6, 1) if not is_run else None,
                "avg_hr": round(avg_hr, 1) if avg_hr else None,
                "ele_gain": round(max(0, ele_change), 1),
            })

            # Reset
            split_start = i
            split_gap_sum = 0.0
            split_weight_sum = 0.0
            split_speed_sum = 0.0
            split_speed_count = 0
            split_hrs = []
            split_dist = 0.0
            split_moving_time = 0.0
            split_ele_start = eles_smooth[i] if eles_smooth[i] is not None else split_ele_start

    # Include trailing partial split
    include_tail = False
    if is_ride:
        include_tail = split_moving_time >= MIN_MOVING_TIME and split_dist >= MIN_MOVING_DIST
    else:
        include_tail = dists[-1] - dists[split_start] >= 500 and split_dist >= MIN_MOVING_DIST

    if split_weight_sum > 0 and include_tail:
        d_last = dists[-1]
        gap_speed = split_gap_sum / split_weight_sum
        raw_speed = split_speed_sum / split_speed_count if split_speed_count > 0 else 0
        avg_hr = sum(split_hrs) / len(split_hrs) if split_hrs else None
        ele_change = (split_ele_end - split_ele_start) if split_ele_start is not None and split_ele_end is not None else 0
        tail_grade = grades[n - 1] if grades[n - 1] is not None else 0

        segments.append({
            "dist_km": round(d_last / 1000, 2),
            "split_dist_km": round(split_dist / 1000, 2),
            "split_moving_time_s": round(split_moving_time, 1),
            "grade_pct": round(tail_grade, 2),
            "speed_ms": round(raw_speed, 2),
            "speed_kmh": round(raw_speed * 3.6, 1),
            "gap_pace_min_km": round((1000 / gap_speed) / 60, 2) if is_run and gap_speed > 0 else None,
            "gap_pace_str": format_pace(gap_speed) if is_run and gap_speed > 0 else None,
            "gap_speed_kmh": round(gap_speed * 3.6, 1) if not is_run else None,
            "avg_hr": round(avg_hr, 1) if avg_hr else None,
            "ele_gain": round(max(0, ele_change), 1),
        })

    return segments


def format_pace(gap_speed_ms):
    """Format pace as m:ss per km from speed in m/s."""
    if not gap_speed_ms or gap_speed_ms <= 0:
        return None
    secs_per_km = 1000 / gap_speed_ms
    mins = int(secs_per_km // 60)
    secs = int(secs_per_km % 60)
    return f"{mins}:{secs:02d}"


# --- Compute derived metrics ---
def compute_derived_metrics(act, streams):
    """Compute sport-specific and derived metrics."""
    d = {}

    # Aerobic decoupling (pace/HR drift first half vs second half)
    # Trim warmup, filter to moving-only, split by moving time
    if streams.get("is_moving") and len(streams["is_moving"]) > 10 and streams["hr_samples"] > 10:
        is_mv = streams["is_moving"]
        seg_dt_arr = streams.get("_seg_dt", [])
        speeds = streams["speeds"]
        hrs = streams["heartrates"]

        if seg_dt_arr and len(seg_dt_arr) == len(is_mv) and len(speeds) == len(is_mv):
            mv_speeds = [speeds[i] for i in range(len(speeds)) if is_mv[i]]
            mv_dt = [seg_dt_arr[i] for i in range(len(seg_dt_arr)) if is_mv[i]]

            cum_t = 0; start_idx = 0
            while start_idx < len(mv_dt) and cum_t < 5 * 60:
                cum_t += mv_dt[start_idx]; start_idx += 1
            cum_t = 0; end_idx = len(mv_dt)
            for j in range(len(mv_dt) - 1, -1, -1):
                cum_t += mv_dt[j]
                if cum_t >= 1 * 60: end_idx = j; break

            if start_idx < end_idx and sum(mv_dt[start_idx:end_idx]) >= 20 * 60:
                core_speeds = mv_speeds[start_idx:end_idx]
                mv_hrs = [hrs[idx + 1] for idx in range(start_idx, end_idx) if idx + 1 < len(hrs) and hrs[idx + 1] is not None]

                if len(core_speeds) > 5 and len(mv_hrs) > 5:
                    mid = len(core_speeds) // 2
                    s1 = core_speeds[:mid]; s2 = core_speeds[mid:]
                    h1 = mv_hrs[:mid] if len(mv_hrs) > mid else mv_hrs
                    h2 = mv_hrs[mid:] if len(mv_hrs) > mid else mv_hrs
                    if s1 and s2 and h1 and h2:
                        avg_s1 = sum(s1) / len(s1); avg_s2 = sum(s2) / len(s2)
                        avg_h1 = sum(h1) / len(h1); avg_h2 = sum(h2) / len(h2)
                        if avg_s1 > 0 and avg_h1 > 0:
                            ef1 = avg_s1 / avg_h1
                            ef2 = avg_s2 / avg_h2 if avg_h2 > 0 else ef1
                            decoupling = ((ef1 - ef2) / ef1 * 100) if ef1 > 0 else 0
                            long_stops = streams.get("long_stops", [])
                            max_stop = max([s[2] for s in long_stops], default=0)
                            if max_stop <= 15 * 60:
                                d["aerobic_decoupling_pct"] = round(decoupling, 2)
                                d["ef_first_half"] = round(ef1, 4)
                                d["ef_second_half"] = round(ef2, 4)

    # Efficiency Factor (overall)
    if streams["avg_speed"] and streams["avg_hr"]:
        d["efficiency_factor"] = round((streams["avg_speed"] / streams["avg_hr"]) * 1000, 2)

    # Elevation gain per km
    if streams["cumulative_distance"] > 0:
        d["elevation_per_km"] = round(streams["total_elevation_gain"] / (streams["cumulative_distance"] / 1000), 1)

    # VAM (for cycling on climbs, but compute for all)
    if streams["moving_time"] > 0 and streams["total_elevation_gain"] > 0:
        d["vam"] = round(streams["total_elevation_gain"] / (streams["moving_time"] / 3600), 1)

    # Moving time ratio
    if streams["elapsed_time"] > 0:
        d["moving_time_pct"] = round((streams["moving_time"] / streams["elapsed_time"]) * 100, 1)

    # Pace metrics (for running)
    if streams["avg_speed"] and streams["avg_speed"] > 0:
        pace_per_km = (1000 / streams["avg_speed"]) / 60  # min/km
        d["avg_pace_min_per_km"] = round(pace_per_km, 2)
        if streams["max_speed"] > 0:
            d["max_pace_min_per_km"] = round((1000 / streams["max_speed"]) / 60, 2)

    # Grade Adjusted Pace (GAP) for running and Grade Adjusted Speed for cycling
    avg_pos_g = streams["grade_positive_sum"] / streams["grade_positive_count"] if streams["grade_positive_count"] > 0 else 0
    avg_neg_g = streams["grade_negative_sum"] / streams["grade_negative_count"] if streams["grade_negative_count"] > 0 else 0

    if streams["avg_speed"] and streams["avg_speed"] > 0:
        # GAP factor: uphill makes you slower (negative grade = faster)
        gap_factor = 1 - 0.033 * avg_pos_g + 0.017 * abs(avg_neg_g)
        if act.get("Activity Type") in ["Run"]:
            gap_speed = streams["avg_speed"] / max(gap_factor, 0.3)
            d["gap_avg_pace_min_per_km"] = round((1000 / gap_speed) / 60, 2)
            d["gap_correction_pct"] = round((1 - gap_factor) * 100, 2)
        if act.get("Activity Type") in ["Ride"]:
            # Grade adjusted speed for cycling
            gap_speed = streams["avg_speed"] / max(gap_factor, 0.3)
            d["grade_adjusted_speed_kmh"] = round(gap_speed * 3.6, 1)

    # Splits for running (per km)
    if streams["distances"] and len(streams["distances"]) > 2 and act.get("Activity Type") in ["Run", "Walk"]:
        splits = []
        split_dist = 1000  # 1 km splits
        split_start_time = None
        split_start_dist = 0
        split_hrs = []
        split_elev = 0
        last_elev_for_split = None

        for i, dist in enumerate(streams["distances"]):
            if split_start_time is None and streams["times"][i]:
                split_start_time = streams["times"][i]
                split_start_dist = dist

            if streams["heartrates"][i]:
                split_hrs.append(streams["heartrates"][i])

            if streams["elevations"][i] is not None:
                if last_elev_for_split is not None and streams["elevations"][i] > last_elev_for_split:
                    split_elev += streams["elevations"][i] - last_elev_for_split
                last_elev_for_split = streams["elevations"][i]

            if dist - split_start_dist >= split_dist and split_start_time and streams["times"][i]:
                split_time = datetime.fromisoformat(streams["times"][i]) - datetime.fromisoformat(split_start_time)
                split_secs = split_time.total_seconds()
                splits.append({
                    "km": len(splits) + 1,
                    "time_sec": round(split_secs),
                    "pace_min_per_km": round(split_secs / 60, 2),
                    "avg_hr": round(sum(split_hrs) / len(split_hrs), 1) if split_hrs else None,
                    "elev_gain": round(split_elev, 1)
                })
                split_start_time = streams["times"][i]
                split_start_dist = dist
                split_hrs = []
                split_elev = 0
                last_elev_for_split = None

        if splits:
            d["splits_km"] = splits

    # Estimated TRIMP (Banister) - time in minutes * avg_hr_pct * intensity factor
    # TRIMP (Banister) — sex-adjusted weighting using heart-rate reserve
    if streams["avg_hr"] and streams["moving_time"] > 60:
        max_hr = streams["max_hr"] or 190
        resting_hr = 50  # default; overridden by per-sport calibration below
        if max_hr > resting_hr:
            hr_ratio = (streams["avg_hr"] - resting_hr) / (max_hr - resting_hr)
            hr_ratio = max(0, min(1, hr_ratio))
            # Sex-adjusted: male default
            a, b = (0.64, 1.92)  # (0.86, 1.67) for female
            weighting = a * math.exp(b * hr_ratio)
            trimp = streams["moving_time"] / 60 * hr_ratio * weighting
            d["trimp"] = round(trimp, 1)

    # --- Sport-specific metrics ---

    # Running: negative split rate
    if act.get("Activity Type") in ["Run"] and streams.get("is_moving"):
        is_mv = streams["is_moving"]
        dists = streams["distances"]
        total_moving_dist = sum(dists[i + 1] - dists[i] for i in range(len(is_mv)) if is_mv[i] and i + 1 < len(dists) and dists[i] is not None and dists[i + 1] is not None)
        if total_moving_dist > 3000:
            mid_dist = total_moving_dist / 2
            cd = 0; mid_idx = 0
            for i in range(len(is_mv)):
                if is_mv[i] and i + 1 < len(dists) and dists[i] is not None and dists[i + 1] is not None:
                    cd += dists[i + 1] - dists[i]
                if cd >= mid_dist:
                    mid_idx = i
                    break
            if mid_idx > 0:
                seg_dt = streams.get("_seg_dt", [])
                first_half_time = sum(seg_dt[i] for i in range(min(mid_idx, len(seg_dt))) if i < len(is_mv) and is_mv[i])
                second_half_time = sum(seg_dt[i] for i in range(mid_idx, len(seg_dt))) if seg_dt else 0
                if first_half_time > 0 and second_half_time > 0:
                    d["is_negative_split"] = second_half_time < first_half_time
                    d["neg_split_pct"] = round(((first_half_time - second_half_time) / first_half_time) * 100, 1)

    # Hiking: Naismith ratio (use CSV/Strava elevation — more reliable than GPS)
    if act.get("Activity Type") in ["Hike"] and streams["moving_time"] > 0 and streams["cumulative_distance"] > 0:
        dist_km = streams["cumulative_distance"] / 1000
        # Prefer CSV elevation (Strava barometric) over raw GPS elevation
        csv_elev_str = act.get("Elevation Gain", "").strip() if act.get("Elevation Gain") else ""
        csv_elev = float(csv_elev_str) if csv_elev_str else 0
        ascent_m = csv_elev if csv_elev > 0 else streams["total_elevation_gain"]
        naismith_minutes = (dist_km / 5) * 60 + (ascent_m / 600) * 60
        actual_minutes = streams["moving_time"] / 60
        if naismith_minutes > 0:
            d["naismith_ratio"] = round(actual_minutes / naismith_minutes, 3)

    return d


# --- Theil-Sen estimator (robust to outliers) ---
import numpy as np

def theil_sen_slope(x, y):
    """Theil-Sen slope estimate: median of all pairwise slopes."""
    n = len(x)
    if n < 2:
        return 0, float(np.median(y))
    slopes = []
    for i in range(n):
        for j in range(i + 1, n):
            if x[j] != x[i]:
                slopes.append((y[j] - y[i]) / (x[j] - x[i]))
    if not slopes:
        return 0, float(np.median(y))
    slope = float(np.median(slopes))
    intercept = float(np.median(y - slope * x))
    return slope, intercept


def theil_sen_ci(x, y, alpha=0.05):
    """95% confidence interval half-width for Theil-Sen slope."""
    n = len(x)
    slopes = []
    for i in range(n):
        for j in range(i + 1, n):
            if x[j] != x[i]:
                slopes.append((y[j] - y[i]) / (x[j] - x[i]))
    if len(slopes) < 20:
        return 0
    slopes.sort()
    z = 1.96  # 95% CI
    se = np.sqrt(n * (n - 1) * (2 * n + 5) / 18)
    lower = max(0, int((len(slopes) - z * se) / 2))
    upper = min(len(slopes) - 1, int((len(slopes) + z * se) / 2))
    if lower < len(slopes) and upper < len(slopes):
        return (slopes[upper] - slopes[lower]) / 2
    return 0


# --- Best-effort extraction ---
def compute_best_efforts(streams, sport):
    """Find best (fastest) sustained effort for each canonical distance/time target.
    Uses sliding window over moving-only cumulative arrays with binary search.
    """
    is_mv = streams.get("is_moving", [])
    distances = streams.get("distances", [])
    times = streams.get("times", [])
    speeds = streams.get("speeds", [])

    if len(distances) < 20 or len(is_mv) < 20:
        return {}

    # Build cumulative moving distance and time arrays
    cum_dist = []
    cum_time = []
    cd = 0.0; ct = 0.0
    for i in range(len(is_mv)):
        if i < len(is_mv) and is_mv[i]:
            # Segment i connects point i to i+1
            if i + 1 < len(distances) and distances[i] is not None and distances[i + 1] is not None:
                d = distances[i + 1] - distances[i]
            else:
                d = 0
            try:
                if i < len(times) and i + 1 < len(times) and times[i] and times[i + 1]:
                    t1 = datetime.fromisoformat(str(times[i]).replace("Z", "+00:00"))
                    t2 = datetime.fromisoformat(str(times[i + 1]).replace("Z", "+00:00"))
                    dt = (t2 - t1).total_seconds()
                else:
                    dt = 1
            except:
                dt = 1
            if d > 0 and dt > 0 and dt < 60:  # Skip gaps > 60s (likely GPS dropout)
                cd += d; ct += dt
                cum_dist.append(cd)
                cum_time.append(ct)

    if len(cum_dist) < 10:
        return {}

    # Target durations/distances per sport
    if sport == "Run":
        targets = [(30, "s"), (60, "s"), (120, "s"), (300, "s"), (600, "s"),
                   (1200, "s"), (1800, "s"), (2700, "s"), (3600, "s"),
                   (1000, "m"), (5000, "m"), (10000, "m"), (21097, "m")]
    elif sport == "Ride":
        targets = [(60, "s"), (120, "s"), (300, "s"), (600, "s"), (1200, "s"),
                   (1800, "s"), (2700, "s"), (3600, "s"), (5400, "s"), (7200, "s")]
    elif sport == "Swim":
        targets = [(30, "s"), (60, "s"), (120, "s"), (300, "s"), (600, "s"),
                   (100, "m"), (400, "m"), (1500, "m")]
    else:  # Hike
        targets = [(600, "s"), (1800, "s"), (3600, "s"), (7200, "s"), (14400, "s")]

    results = {}
    n = len(cum_dist)
    # Speed caps per sport to reject GPS artifacts
    speed_cap = {"Run": 7.0, "Ride": 22.0, "Swim": 3.0, "Hike": 3.0}.get(sport, 22.0)

    for target, unit in targets:
        # Skip targets that are too short relative to data resolution (~10s per point)
        if unit == "s" and target < 30:
            continue

        best_speed = 0
        best_start = 0
        best_end = 0
        min_points = max(5, target // 10)  # at least 5 data points per window

        if unit == "m":
            # Distance target: find min time over that distance
            best_time = float("inf")
            for i in range(n):
                d_start = cum_dist[i]
                # Binary search for end where cum_dist >= d_start + target
                lo, hi = i, n - 1
                while lo < hi:
                    mid = (lo + hi) // 2
                    if cum_dist[mid] - d_start >= target:
                        hi = mid
                    else:
                        lo = mid + 1
                j = lo
                if j < n and cum_dist[j] - d_start >= target:
                    t = cum_time[j] - cum_time[i]
                    if t < best_time and t > 0:
                        best_time = t
                        best_start = i
                        best_end = j
            if best_time < float("inf"):
                best_speed = target / best_time
                if best_speed > speed_cap or (best_end - best_start) < min_points:
                    continue  # GPS artifact or too few data points
                results[f"{target}m"] = {
                    "target": target, "unit": "m",
                    "time_s": round(best_time, 1),
                    "speed_ms": round(best_speed, 2),
                    "pace_min_km": round((1000 / best_speed) / 60, 2) if sport in ("Run", "Swim") else None,
                    "speed_kmh": round(best_speed * 3.6, 1),
                }
        else:
            # Time target: find max distance over that duration
            best_dist = 0
            for i in range(n):
                t_start = cum_time[i]
                lo, hi = i, n - 1
                while lo < hi:
                    mid = (lo + hi) // 2
                    if cum_time[mid] - t_start >= target:
                        hi = mid
                    else:
                        lo = mid + 1
                j = lo
                if j < n and cum_time[j] - t_start >= target:
                    d = cum_dist[j] - cum_dist[i]
                    if d > best_dist:
                        best_dist = d
                        best_start = i
                        best_end = j
            if best_dist > 0:
                best_speed = best_dist / target
                if best_speed > speed_cap or (best_end - best_start) < min_points:
                    continue  # GPS artifact or too few data points
                results[f"{target}s"] = {
                    "target": target, "unit": "s",
                    "distance_m": round(best_dist, 1),
                    "speed_ms": round(best_speed, 2),
                    "pace_min_km": round((1000 / best_speed) / 60, 2) if sport in ("Run", "Swim") else None,
                    "speed_kmh": round(best_speed * 3.6, 1),
                }

    return results


def compute_dow_hour_stats(all_activities):
    """7x24 grid: day-of-week (Mon-Sun) x hour-of-day (0-23) coloured by count/TRIMP."""
    grid = [[{"count": 0, "trimp": 0} for _ in range(24)] for _ in range(7)]
    for a in all_activities:
        st = a.get("start_time_utc")
        if not st:
            continue
        try:
            dt_str = str(st).replace("Z", "+00:00")
            dt = datetime.fromisoformat(dt_str)
            # Convert to local time: +10 for AEST approx
            local_dt = dt + timedelta(hours=10)
            dow = local_dt.weekday()  # 0=Mon, 6=Sun
            hour = local_dt.hour
            grid[dow][hour]["count"] += 1
            grid[dow][hour]["trimp"] += a.get("trimp", 0) or 0
        except:
            pass
    return [[{k: round(v, 1) if k == "trimp" else v for k, v in cell.items()} for cell in row] for row in grid]


# --- Main processing ---
def main():
    print("Loading activities CSV...")
    activities = []
    with open(ACTIVITIES_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            act_type = row.get("Activity Type", "").strip()
            if act_type in TARGET_SPORTS:
                activities.append(row)

    print(f"Found {len(activities)} activities for target sports (Run/Ride/Hike/Swim)")

    # Process each activity
    all_activities = []
    by_sport = defaultdict(list)
    sport_counts = defaultdict(int)

    for i, act in enumerate(activities):
        aid = act.get("Activity ID", "").strip()
        name = act.get("Activity Name", "").strip()
        sport = act.get("Activity Type", "").strip()
        description = act.get("Activity Description", "").strip()
        filename = act.get("Filename", "").strip()
        gear = act.get("Activity Gear", "").strip()
        commute = act.get("Commute", "").strip().lower() == "true"

        print(f"[{i+1}/{len(activities)}] Processing {sport}: {name} (ID: {aid})")

        # Find the activity file - try by filename first, then by activity ID
        filepath = None
        csv_filename = filename.replace("activities/", "") if filename else ""
        extensions = [".gpx", ".gpx.gz", ".tcx", ".tcx.gz", ".fit", ".fit.gz"]
        for base in [csv_filename, aid] if csv_filename else [aid]:
            for ext in extensions:
                # Try with extension appended
                candidate = os.path.join(ACTIVITIES_DIR, base if "." in os.path.splitext(base)[1] else base + ext)
                if os.path.exists(candidate):
                    filepath = candidate
                    break
            if filepath:
                break

        is_tcx = False
        is_fit = False
        points = []
        is_manual = True
        is_indoor = sport in ("Virtual Ride", "Virtual Run")

        if filepath:
            ext_lower = filepath.lower()
            if ext_lower.endswith(".gpx") or ext_lower.endswith(".gpx.gz"):
                points = parse_gpx(filepath)
                is_manual = False
            elif ext_lower.endswith(".tcx") or ext_lower.endswith(".tcx.gz"):
                points = parse_tcx(filepath)
                is_tcx = True
                is_manual = False
            elif ext_lower.endswith(".fit") or ext_lower.endswith(".fit.gz"):
                points = parse_fit(filepath)
                is_fit = True
                is_manual = False

        # Detect indoor: no valid GPS coords in any point
        if not is_indoor and not is_manual:
            has_gps = any(p.get("lat") is not None and p.get("lon") is not None for p in points)
            if not has_gps:
                is_indoor = True

        # Compute stream metrics
        streams = compute_stream_metrics(points, is_tcx, is_fit, sport)

        # Parse UTC from CSV start time as fallback
        csv_start_time = parse_csv_date_utc(act.get("Activity Date", "").strip())

        # Parse CSV numeric fields
        def safe_float(val, default=None):
            if val is None or val.strip() == "":
                return default
            try:
                return float(val.strip())
            except ValueError:
                return default

        def safe_int(val, default=None):
            if val is None or val.strip() == "":
                return default
            try:
                return int(float(val.strip()))
            except ValueError:
                return default

        # Build activity object
        act_data = {
            "id": aid,
            "name": name,
            "description": description,
            "sport": sport,
            "start_time_local": act.get("Activity Date", "").strip(),
            "start_time_utc": streams["start_time"] or csv_start_time,
            "elapsed_time_sec": safe_float(act.get("Elapsed Time", "0"), 0) or streams["elapsed_time"] or 0,
            "moving_time_sec": safe_float(act.get("Moving Time", "0"), 0) or streams["moving_time"] or 0,
            "distance_m": streams["cumulative_distance"] or safe_float(act.get("Distance", "0"), 0),
            "csv_distance_m": safe_float(act.get("Distance", "0"), 0),
            "max_speed": streams["max_speed"] or safe_float(act.get("Max Speed", "0")),
            "avg_speed": streams["avg_speed"] or safe_float(act.get("Average Speed", "0")),
            "max_speed_kmh": round((streams["max_speed"] or 0) * 3.6, 1),
            "avg_speed_kmh": round((streams["avg_speed"] or 0) * 3.6, 1),
            "elevation_gain_m": streams["total_elevation_gain"] or safe_float(act.get("Elevation Gain", "0")),
            "elevation_loss_m": streams["total_elevation_loss"] or safe_float(act.get("Elevation Loss", "0")),
            "elevation_low_m": safe_float(act.get("Elevation Low", "0")),
            "elevation_high_m": safe_float(act.get("Elevation High", "0")),
            "max_hr": streams["max_hr"] or safe_int(act.get("Max Heart Rate", "")),
            "avg_hr": streams["avg_hr"] or safe_float(act.get("Average Heart Rate", "0")),
            "calories": safe_float(act.get("Calories", "0")),
            "relative_effort": safe_int(act.get("Relative Effort", "0")),
            "gear": gear if gear else None,
            "commute": commute,
            "average_temp": streams["avg_temp"] or safe_float(act.get("Average Temperature", "0")),
            "max_temp": safe_float(act.get("Max Temperature", "0")),
            "max_cadence": streams.get("max_cadence") or safe_int(act.get("Max Cadence", "")),
            "avg_cadence": streams.get("avg_cadence") or safe_float(act.get("Average Cadence", "0")),
            "max_watts": safe_float(act.get("Max Watts", "0")),
            "avg_watts": safe_float(act.get("Average Watts", "0")),
            "weighted_avg_power": safe_float(act.get("Weighted Average Power", "0")),
            "start_lat": streams["start_lat"],
            "start_lon": streams["start_lon"],
            "end_lat": streams["end_lat"],
            "end_lon": streams["end_lon"],
            "hr_zones": streams["hr_zones"],
            "hr_samples": streams["hr_samples"],
            "has_hr": streams["hr_samples"] > 0,
            "stream_points": len(points),
            "stream": streams["raw_points"][:1500],  # More points for heatmap quality
            "is_manual": is_manual,
            "is_indoor": is_indoor,
            "_raw_hr_values": [p.get("hr") for p in points if p.get("hr") is not None],  # raw for recalibration
        }

        # Segment-level GAP computation (1km runs, 3km rides)
        if sport in ["Run", "Ride"] and streams["raw_points"]:
            segments = compute_gap_segments(streams, sport, points)
            act_data["gap_segments"] = segments

        # Derived metrics
        derived = compute_derived_metrics(act, streams)
        act_data.update(derived)

        # Best-effort computation per activity
        if sport in ("Run", "Ride", "Swim", "Hike") and not is_manual and not is_indoor:
            act_data["best_efforts"] = compute_best_efforts(streams, sport)

        all_activities.append(act_data)
        by_sport[sport].append(act_data)
        sport_counts[sport] += 1

    print(f"\nProcessed: {sport_counts}")

    # Sort by date
    for sport in by_sport:
        by_sport[sport].sort(key=lambda x: x.get("start_time_utc") or "")

    all_activities.sort(key=lambda x: x.get("start_time_utc") or "")

    # --- Phase 0.2-0.3: Per-sport HR max calibration & zone recalculation ---
    sport_max_hr = {}
    for sport_name in ["Run", "Ride", "Hike", "Swim"]:
        mx = compute_sport_max_hr(all_activities, sport_name)
        if mx:
            sport_max_hr[sport_name] = round(mx, 1)

    if sport_max_hr:
        for act in all_activities:
            sport = act["sport"]
            raw_hr = act.pop("_raw_hr_values", [])
            mx = sport_max_hr.get(sport)
            if mx and raw_hr:
                cleaned, dropped = clean_hr(raw_hr, mx)
                if len(cleaned) > 10:
                    zones = {"Z1": 0, "Z2": 0, "Z3": 0, "Z4": 0, "Z5": 0}
                    resting_hr = 50
                    hrr = mx - resting_hr
                    bounds = [
                        (resting_hr + 0.50 * hrr, 0),
                        (resting_hr + 0.60 * hrr, 1),
                        (resting_hr + 0.70 * hrr, 2),
                        (resting_hr + 0.80 * hrr, 3),
                        (resting_hr + 0.90 * hrr, 4),
                    ]
                    for h in cleaned:
                        zi = 4
                        for b, zi_cand in bounds:
                            if h < b:
                                zi = zi_cand
                                break
                        zones[f"Z{zi+1}"] += 1
                    act["hr_zones"] = zones
                    act["hr_samples"] = len(cleaned)
                    act["has_hr"] = len(cleaned) > 10
                    # Update avg_hr from cleaned data
                    act["avg_hr"] = round(sum(cleaned) / len(cleaned), 1)
                    act["max_hr"] = max(cleaned)
            act.pop("_raw_hr_values", None)  # clean up from output

    print(f"  HR calibration complete. Sport max HR: {sport_max_hr}")

    # --- Compute aggregate metrics ---
    monthly_data = defaultdict(lambda: defaultdict(lambda: {"count": 0, "distance": 0, "time": 0, "elevation": 0, "effort": 0, "trimp": 0}))
    weekly_data = defaultdict(lambda: defaultdict(lambda: {"count": 0, "distance": 0, "time": 0, "elevation": 0, "effort": 0, "hr": []}))

    for act in all_activities:
        sport = act["sport"]
        utc_time = act.get("start_time_utc")
        if not utc_time:
            continue
        try:
            dt = datetime.fromisoformat(utc_time)
            month_key = dt.strftime("%Y-%m")
            # ISO week
            week_key = f"{dt.isocalendar()[0]}-W{dt.isocalendar()[1]:02d}"
        except:
            continue

        md = monthly_data[month_key]
        md[sport]["count"] += 1
        md[sport]["distance"] += act["distance_m"]
        md[sport]["time"] += act["moving_time_sec"]
        md[sport]["elevation"] += act["elevation_gain_m"]
        md[sport]["effort"] += act.get("relative_effort", 0) or 0
        md[sport]["trimp"] += act.get("trimp", 0) or 0

        wd = weekly_data[week_key]
        wd[sport]["count"] += 1
        wd[sport]["distance"] += act["distance_m"]
        wd[sport]["time"] += act["moving_time_sec"]
        wd[sport]["elevation"] += act["elevation_gain_m"]
        wd[sport]["effort"] += act.get("relative_effort", 0) or 0
        if act["avg_hr"]:
            wd[sport]["hr"].append(act["avg_hr"])

    # Convert monthly/weekly to sorted lists
    sport_key_map = {"Run": "run", "Ride": "ride", "Hike": "hike", "Swim": "swim"}
    monthly_list = []
    for month in sorted(monthly_data.keys()):
        entry = {"month": month}
        for sport in TARGET_SPORTS:
            key = sport_key_map[sport]
            entry[key] = {
                "count": monthly_data[month][sport]["count"],
                "distance_km": round(monthly_data[month][sport]["distance"] / 1000, 1),
                "time_hours": round(monthly_data[month][sport]["time"] / 3600, 1),
                "elevation_m": round(monthly_data[month][sport]["elevation"], 1),
                "relative_effort": round(monthly_data[month][sport]["effort"], 1),
                "trimp": round(monthly_data[month][sport]["trimp"], 1),
            }
        # Totals across sports
        sport_keys = [sport_key_map[s] for s in TARGET_SPORTS]
        entry["total"] = {
            "count": sum(entry[s]["count"] for s in sport_keys if s in entry),
            "distance_km": round(sum(entry[s]["distance_km"] for s in sport_keys if s in entry), 1),
            "time_hours": round(sum(entry[s]["time_hours"] for s in sport_keys if s in entry), 1),
            "elevation_m": round(sum(entry[s]["elevation_m"] for s in sport_keys if s in entry), 1),
            "relative_effort": round(sum(entry[s]["relative_effort"] for s in sport_keys if s in entry), 1),
            "trimp": round(sum(entry[s]["trimp"] for s in sport_keys if s in entry), 1),
        }
        monthly_list.append(entry)

    weekly_list = []
    sport_keys = [sport_key_map[s] for s in TARGET_SPORTS]
    for week in sorted(weekly_data.keys()):
        entry = {"week": week}
        for sport in TARGET_SPORTS:
            key = sport_key_map[sport]
            wds = weekly_data[week][sport]
            avg_hr = round(sum(wds["hr"]) / len(wds["hr"]), 1) if wds["hr"] else None
            entry[key] = {
                "count": wds["count"],
                "distance_km": round(wds["distance"] / 1000, 1),
                "time_hours": round(wds["time"] / 3600, 1),
                "elevation_m": round(wds["elevation"], 1),
                "relative_effort": round(wds["effort"], 1),
                "avg_hr": avg_hr,
            }
        entry["total"] = {
            "count": sum(entry[s]["count"] for s in sport_keys if s in entry),
            "distance_km": round(sum(entry[s]["distance_km"] for s in sport_keys if s in entry), 1),
            "time_hours": round(sum(entry[s]["time_hours"] for s in sport_keys if s in entry), 1),
            "elevation_m": round(sum(entry[s]["elevation_m"] for s in sport_keys if s in entry), 1),
            "relative_effort": round(sum(entry[s]["relative_effort"] for s in sport_keys if s in entry), 1),
        }
        weekly_list.append(entry)

    # Yearly totals
    yearly_data = defaultdict(lambda: defaultdict(lambda: {"count": 0, "distance": 0, "time": 0, "elevation": 0, "effort": 0}))
    for act in all_activities:
        if act.get("start_time_utc"):
            try:
                yr = datetime.fromisoformat(act["start_time_utc"]).year
                sport = act["sport"]
                yearly_data[yr][sport]["count"] += 1
                yearly_data[yr][sport]["distance"] += act["distance_m"]
                yearly_data[yr][sport]["time"] += act["moving_time_sec"]
                yearly_data[yr][sport]["elevation"] += act["elevation_gain_m"]
                yearly_data[yr][sport]["effort"] += act.get("relative_effort", 0) or 0
            except:
                pass

    yearly_list = []
    for yr in sorted(yearly_data.keys()):
        entry = {"year": yr}
        for sport in TARGET_SPORTS:
            key = sport_key_map[sport]
            entry[key] = {
                "count": yearly_data[yr][sport]["count"],
                "distance_km": round(yearly_data[yr][sport]["distance"] / 1000, 1),
                "time_hours": round(yearly_data[yr][sport]["time"] / 3600, 1),
                "elevation_m": round(yearly_data[yr][sport]["elevation"], 1),
                "relative_effort": round(yearly_data[yr][sport]["effort"], 1),
            }
        yearly_list.append(entry)

    # Best efforts (for each sport, track best distances/time)
    best_efforts = {}
    for sport in TARGET_SPORTS:
        key = sport_key_map[sport]
        sport_acts = by_sport.get(sport, [])
        if not sport_acts:
            continue
        longest = max(sport_acts, key=lambda x: x["distance_m"] or 0)
        most_elev = max(sport_acts, key=lambda x: x["elevation_gain_m"] or 0)
        highest_hr = max((a for a in sport_acts if a["max_hr"]), key=lambda x: x["max_hr"] or 0, default=None)
        best_speed = max(sport_acts, key=lambda x: x["avg_speed"] or 0)

        best_efforts[key] = {
            "longest_distance_km": round(longest["distance_m"] / 1000, 1) if longest else 0,
            "longest_name": longest["name"] if longest else "",
            "most_elevation_m": round(most_elev["elevation_gain_m"], 1) if most_elev else 0,
            "most_elev_name": most_elev["name"] if most_elev else "",
            "highest_max_hr": highest_hr["max_hr"] if highest_hr else None,
            "best_avg_speed_kmh": round(best_speed["avg_speed_kmh"], 1) if best_speed else 0,
            "best_speed_name": best_speed["name"] if best_speed else "",
        }

    # Gear mileage
    gear_data = defaultdict(lambda: {"count": 0, "distance": 0, "sports": set()})
    for act in all_activities:
        if act["gear"]:
            gear_data[act["gear"]]["count"] += 1
            gear_data[act["gear"]]["distance"] += act["distance_m"]
            gear_data[act["gear"]]["sports"].add(act["sport"])

    gear_list = []
    for gear_name, data in gear_data.items():
        gear_list.append({
            "name": gear_name,
            "activities": data["count"],
            "distance_km": round(data["distance"] / 1000, 1),
            "sports": list(data["sports"]),
        })
    gear_list.sort(key=lambda x: x["distance_km"], reverse=True)

    # --- Compute LOESS trend data for runs and rides ---
    from statsmodels.nonparametric.smoothers_lowess import lowess
    import numpy as np

    gap_trends = {}
    for sport_key in ["run", "ride"]:
        sport_name = {"run": "Run", "ride": "Ride"}[sport_key]
        is_run = (sport_key == "run")
        sport_acts = [a for a in all_activities if a["sport"] == sport_name and a.get("gap_segments")]

        # Per-split data: (days since first, gap value)
        split_points = []
        for a in sport_acts:
            if not a.get("start_time_utc"):
                continue
            try:
                dt_str = a["start_time_utc"]
                if dt_str.endswith("Z"):
                    act_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
                elif "+" in dt_str or dt_str.count("-") > 2:
                    act_dt = datetime.fromisoformat(dt_str)
                else:
                    act_dt = datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc)
            except:
                continue
            for seg in a["gap_segments"]:
                val = seg.get("gap_pace_min_km") if is_run else seg.get("gap_speed_kmh")
                if val is not None and val > 0:
                    split_points.append((act_dt, val))

        if not split_points:
            continue

        split_points.sort(key=lambda x: x[0])
        ref_dt = split_points[0][0]
        xs_splits = np.array([(dt - ref_dt).total_seconds() / 86400 for dt, _ in split_points])
        ys_splits = np.array([v for _, v in split_points])

        # Per-activity collapsed: distance-weighted mean of split GAP speeds
        act_points = []
        for a in sport_acts:
            if not a.get("start_time_utc"):
                continue
            try:
                dt_str = a["start_time_utc"]
                if dt_str.endswith("Z"):
                    act_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
                elif "+" in dt_str or dt_str.count("-") > 2:
                    act_dt = datetime.fromisoformat(dt_str)
                else:
                    act_dt = datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc)
            except:
                continue
            total_weight = 0.0
            weighted_speed = 0.0
            for seg in a["gap_segments"]:
                val = seg.get("gap_pace_min_km") if is_run else seg.get("gap_speed_kmh")
                seg_d = seg.get("split_dist_km", 1) * 1000  # use actual split distance in metres
                if val is not None and val > 0 and seg_d > 0:
                    if is_run:
                        gap_speed = 1000 / (val * 60)  # min/km → m/s
                    else:
                        gap_speed = val / 3.6  # km/h → m/s
                    weighted_speed += gap_speed * seg_d
                    total_weight += seg_d
            if total_weight > 0:
                avg_gap_speed = weighted_speed / total_weight
                if is_run:
                    act_val = (1000 / avg_gap_speed) / 60  # m/s → min/km
                else:
                    act_val = avg_gap_speed * 3.6  # m/s → km/h
                act_points.append((act_dt, act_val))

        if not act_points:
            continue

        act_points.sort(key=lambda x: x[0])
        xs_acts = np.array([(dt - ref_dt).total_seconds() / 86400 for dt, _ in act_points])
        ys_acts = np.array([v for _, v in act_points])

        # LOESS on per-split data (evaluated on regular x-grid for smooth curves)
        try:
            loess_raw = lowess(ys_splits, xs_splits, frac=max(0.50, 30 / max(len(xs_splits), 1)), it=3, return_sorted=True)
            x_grid = np.linspace(xs_splits.min(), xs_splits.max(), 200)
            y_grid = np.interp(x_grid, loess_raw[:, 0], loess_raw[:, 1])
            loess_split_data = [{"days": float(x), "value": float(y)} for x, y in zip(x_grid, y_grid)]
        except Exception:
            loess_split_data = []

        # LOESS on per-activity data (fewer points, so larger fraction)
        try:
            loess_act = lowess(ys_acts, xs_acts, frac=max(0.55, 20 / max(len(xs_acts), 1)), it=3, return_sorted=True)
            x_grid_a = np.linspace(xs_acts.min(), xs_acts.max(), 200)
            y_grid_a = np.interp(x_grid_a, loess_act[:, 0], loess_act[:, 1])
            loess_act_data = [{"days": float(x), "value": float(y)} for x, y in zip(x_grid_a, y_grid_a)]
        except Exception:
            loess_act_data = []

        # Linear regression on per-split (Theil-Sen for robustness)
        if len(xs_splits) > 2:
            slope_split, intercept_split = theil_sen_slope(xs_splits, ys_splits)
            slope_per_month = slope_split * 30.44
            ci_split = theil_sen_ci(xs_splits, ys_splits)
        else:
            slope_split, intercept_split, slope_per_month, ci_split = 0, 0, 0, 0

        # Linear regression on per-activity (Theil-Sen)
        if len(xs_acts) > 2:
            slope_act, intercept_act = theil_sen_slope(xs_acts, ys_acts)
            slope_act_per_month = slope_act * 30.44
            ci_act = theil_sen_ci(xs_acts, ys_acts)
        else:
            slope_act, intercept_act, slope_act_per_month, ci_act = 0, 0, 0, 0

        gap_trends[sport_key] = {
            "ref_date": ref_dt.isoformat(),
            "loess_split": loess_split_data,
            "loess_act": loess_act_data,
            "linear_split": {
                "slope_per_month": round(slope_per_month, 4),
                "intercept": round(float(intercept_split), 4),
                "ci_95": round(float(ci_split), 4),
            },
            "linear_act": {
                "slope_per_month": round(slope_act_per_month, 4),
                "intercept": round(float(intercept_act), 4),
                "ci_95": round(float(ci_act), 4),
            },
            "n_splits": len(split_points),
            "n_activities": len(act_points),
        }

    # --- Phase 2.1: CTL / ATL / TSB from daily TRIMP ---
    # Aggregate TRIMP per calendar day
    daily_trimp = defaultdict(float)
    for a in all_activities:
        st = a.get("start_time_utc")
        trimp_val = a.get("trimp", 0) or 0
        if st and trimp_val > 0:
            try:
                dt_str = st
                if dt_str.endswith("Z"):
                    day = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).strftime("%Y-%m-%d")
                else:
                    day = datetime.fromisoformat(dt_str).strftime("%Y-%m-%d")
                daily_trimp[day] += trimp_val
            except:
                pass

    if daily_trimp:
        days = sorted(daily_trimp.keys())
        first_day = days[0]
        last_day = days[-1]
        all_days = []
        d = datetime.fromisoformat(first_day)
        end_d = datetime.fromisoformat(last_day)
        while d <= end_d:
            all_days.append(d.strftime("%Y-%m-%d"))
            d += timedelta(days=1)

        # Seed from average of first 28 days
        seed_days = all_days[:28]
        seed_trimp = [daily_trimp.get(day, 0) for day in seed_days]
        seed_avg = sum(seed_trimp) / max(1, len(seed_trimp))
        ctl = seed_avg
        atl = seed_avg

        ctl_atl_tsb = []
        ctla = 1 - math.exp(-1 / 42)  # CTL time constant = 42 days
        atla = 1 - math.exp(-1 / 7)   # ATL time constant = 7 days
        display_from = 28  # Don't show first 28 days

        for i, day in enumerate(all_days):
            t = daily_trimp.get(day, 0)
            ctl = ctl + ctla * (t - ctl)
            atl = atl + atla * (t - atl)
            tsb = ctl - atl
            if i >= display_from:
                ctl_atl_tsb.append({
                    "date": day,
                    "ctl": round(ctl, 1),
                    "atl": round(atl, 1),
                    "tsb": round(tsb, 1),
                })
    else:
        ctl_atl_tsb = []

    # --- Phase 3.1: Speed-Duration curve aggregation ---
    # Compile best-effort results across all activities per sport/year
    speed_duration = {}
    for sport_name in ["Run", "Ride", "Swim", "Hike"]:
        sport_acts = [a for a in all_activities if a["sport"] == sport_name and a.get("best_efforts")]
        if not sport_acts:
            continue

        # Collect all targets seen
        all_targets = set()
        for a in sport_acts:
            for key in a["best_efforts"]:
                all_targets.add(key)

        # Best-ever for each target
        best_ever = {}
        by_year = defaultdict(lambda: defaultdict(list))
        for target_key in all_targets:
            best = None
            for a in sport_acts:
                be = a["best_efforts"].get(target_key)
                if not be:
                    continue
                # Store by year
                st = a.get("start_time_utc", "")
                try:
                    yr = datetime.fromisoformat(st.replace("Z", "+00:00") if "Z" in str(st) else str(st)).year
                except:
                    continue
                speed = be.get("speed_ms", 0)
                if speed > 0:
                    by_year[target_key][yr].append({
                        "activity_id": a["id"],
                        "activity_name": a["name"],
                        "date": st,
                        "speed_ms": speed,
                        "speed": be,
                    })
                # Check if this is the best-ever
                if best is None:
                    best = {"activity_id": a["id"], "activity_name": a["name"], "date": st, "speed": be}
                else:
                    cur_best = best["speed"].get("speed_ms", 0)
                    if speed > cur_best:
                        best = {"activity_id": a["id"], "activity_name": a["name"], "date": st, "speed": be}
            if best:
                best_ever[target_key] = best

        # Sort targets numerically
        sorted_targets = sorted(all_targets, key=lambda x: int(x.replace("m", "").replace("s", "")))
        speed_duration[sport_name] = {
            "targets": sorted_targets,
            "best_ever": best_ever,
            "by_year": {str(yr): {k: v for k, v in t.items()} for yr, t in by_year.items()},
        }

    # Write output JSON files
    print("\nWriting output files...")

    # Full data
    with open(os.path.join(OUTPUT_DIR, "all_activities.json"), "w") as f:
        json.dump(all_activities, f, indent=1, default=str)

    # By sport
    for sport, acts in by_sport.items():
        with open(os.path.join(OUTPUT_DIR, f"{sport.lower()}_activities.json"), "w") as f:
            json.dump(acts, f, indent=1, default=str)

    # Aggregate data
    aggregate = {
        "monthly": monthly_list,
        "weekly": weekly_list,
        "yearly": yearly_list,
        "best_efforts": best_efforts,
        "gear": gear_list,
        "gap_trends": gap_trends,
        "sport_max_hr": sport_max_hr,
        "ctl_atl_tsb": ctl_atl_tsb,
        "speed_duration": speed_duration,
        "dow_hour": compute_dow_hour_stats(all_activities),
        "sport_counts": {s: len(acts) for s, acts in by_sport.items()},
        "total_activities": len(all_activities),
        "date_range": {
            "first": all_activities[0]["start_time_utc"] if all_activities else None,
            "last": all_activities[-1]["start_time_utc"] if all_activities else None,
        }
    }
    with open(os.path.join(OUTPUT_DIR, "aggregate.json"), "w") as f:
        json.dump(aggregate, f, indent=1, default=str)

    # Summary stats
    summary = {}
    for sport in TARGET_SPORTS:
        key = sport_key_map[sport]
        acts = by_sport.get(sport, [])
        if not acts:
            continue
        total_dist = sum(a["distance_m"] for a in acts)
        total_time = sum(a["moving_time_sec"] for a in acts)
        total_elev = sum(a["elevation_gain_m"] for a in acts)
        avg_hr_acts = [a["avg_hr"] for a in acts if a["avg_hr"]]
        summary[key] = {
            "count": len(acts),
            "total_distance_km": round(total_dist / 1000, 1),
            "total_time_hours": round(total_time / 3600, 1),
            "total_elevation_m": round(total_elev, 1),
            "avg_hr": round(sum(avg_hr_acts) / len(avg_hr_acts), 1) if avg_hr_acts else None,
            "activities_with_hr": sum(1 for a in acts if a["has_hr"]),
        }

    with open(os.path.join(OUTPUT_DIR, "summary.json"), "w") as f:
        json.dump(summary, f, indent=1)

    print("\n=== SUMMARY ===")
    for sport, stats in summary.items():
        print(f"  {sport}: {stats['count']} activities, {stats['total_distance_km']} km, "
              f"{stats['total_time_hours']} hrs, {stats['total_elevation_m']} m elev, "
              f"{stats['activities_with_hr']} with HR")

    print(f"\nTotal activities processed: {len(all_activities)}")
    print(f"Data files written to {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
