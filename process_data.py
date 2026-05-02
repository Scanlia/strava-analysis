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

            points.append({
                "lat": lat,
                "lon": lon,
                "ele": float(ele) if ele is not None else None,
                "time": ts.isoformat() if isinstance(ts, datetime) else str(ts),
                "hr": int(hr) if hr is not None else None,
                "cadence": int(cadence) if cadence is not None else None,
                "temp": float(temp) if temp is not None else None,
                "speed_ms": float(speed) if speed is not None else None,
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
        "raw_points": []  # simplified points for dashboard
    }

    if len(points) < 2:
        return result

    cum_dist = 0
    prev_point = None
    prev_time = None
    speeds = []
    heart_rates = []
    cadences = []
    temps = []
    grades_smooth = []
    last_elevation = None
    last_grade_distance = 0
    rolling_grades = []

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

        # Speed: prefer device speed for cycling (power meter/wheel sensor),
        # but use GPS-derived speed for running (WHOOP accelerometer overestimates)
        use_device_speed = is_fit and sport != "Run"
        if use_device_speed and p.get("speed_ms") is not None and p["speed_ms"] > 0:
            spd = p["speed_ms"]
            speeds.append(spd)
            result["max_speed"] = max(result["max_speed"], spd)
            if prev_point and cur_time and prev_time:
                td = (cur_time - prev_time).total_seconds()
                if td > 0 and spd > 0.3:
                    result["moving_time"] += td
        elif prev_point and cur_time and prev_time:
            td = (cur_time - prev_time).total_seconds()
            if td > 0:
                d = cum_dist - result["distances"][-2] if len(result["distances"]) > 1 else 0
                spd = d / td
                speeds.append(spd)
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
                "lon": p["lon"]
            })

        prev_point = p
        prev_time = cur_time

    result["cumulative_distance"] = cum_dist
    result["speeds"] = speeds  # Store for decoupling analysis

    result["avg_speed"] = sum(speeds) / len(speeds) if speeds else 0
    result["avg_cadence"] = round(sum(cadences) / len(cadences), 1) if cadences else 0
    result["max_cadence"] = max(cadences) if cadences else 0
    result["avg_temp"] = round(sum(temps) / len(temps), 1) if temps else 0

    if heart_rates:
        result["avg_hr"] = round(sum(heart_rates) / len(heart_rates), 1)
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

    # HR zone distribution (using max HR from points or estimated)
    max_hr = result["max_hr"] or 190  # fallback
    zones = {"Z1": 0, "Z2": 0, "Z3": 0, "Z4": 0, "Z5": 0}
    for hr in heart_rates:
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


def compute_gap_segments(streams, activity_type, grade_points):
    """Split an activity into distance-based segments and compute GAP/GAS per segment.

    Grade-adjusted pace/speed uses the Minetti metabolic cost model:
      - Running: GAP = pace / (1 + k * grade) where k=0.033 uphill, k=0.017 downhill
        Reference: Minetti et al. (2002) J. Applied Physiology
      - Cycling: simplified gravitational + aerodynamic model
        GAS = speed / (1 + 0.033 * grade) for uphill adjustments
    """
    segment_length = 2000 if activity_type == "Run" else 5000  # 2km runs, 5km rides

    points = streams.get("raw_points", [])
    if len(points) < 3:
        return []

    segments = []
    seg_start_idx = 0
    seg_start_dist = points[0].get("d", 0)
    seg_speeds = []
    seg_grades = []
    seg_hrs = []
    seg_ele_start = points[0].get("e")
    seg_ele_end = seg_ele_start

    # Speed caps per sport to filter GPS/accelerometer noise
    max_speed = 4.5 if activity_type == "Run" else 22.0  # m/s: ~3:42/km run, ~80km/h ride

    for i, pt in enumerate(points):
        d = pt.get("d", 0)
        s = pt.get("s")
        hr = pt.get("hr")
        e = pt.get("e")

        if s is not None and 0.3 < s < max_speed:
            seg_speeds.append(s)
        if hr is not None:
            seg_hrs.append(hr)
        if e is not None:
            seg_ele_end = e

        # Check if we've covered enough distance for a segment
        dist_covered = d - seg_start_dist
        if dist_covered >= segment_length and seg_speeds:
            # Compute grade for this segment
            dist_covered = d - seg_start_dist
            ele_change = (seg_ele_end - seg_ele_start) if seg_ele_start is not None and seg_ele_end is not None else 0
            avg_grade = (ele_change / dist_covered) * 100 if dist_covered > 0 else 0

            avg_speed = sum(seg_speeds) / len(seg_speeds)
            avg_hr = sum(seg_hrs) / len(seg_hrs) if seg_hrs else None

            # GAP computation
            if activity_type == "Run":
                if avg_grade > 0:
                    gap_factor = 1 + 0.033 * avg_grade  # uphill: slower metabolic cost
                elif avg_grade < -1:
                    gap_factor = 1 - 0.017 * abs(avg_grade)  # downhill: faster, but diminishing returns
                else:
                    gap_factor = 1.0
                gap_speed = avg_speed * gap_factor
                gap_pace = (1000 / gap_speed) / 60 if gap_speed > 0 else None
                gas = None
            else:  # Ride
                if avg_grade > 0:
                    gap_factor = 1 + 0.033 * avg_grade
                elif avg_grade < -1:
                    gap_factor = 1 - 0.012 * abs(avg_grade)
                else:
                    gap_factor = 1.0
                gap_speed = avg_speed * gap_factor
                gas = gap_speed * 3.6
                gap_pace = None

            segments.append({
                "dist_km": round(d / 1000, 2),
                "grade_pct": round(avg_grade, 2),
                "speed_ms": round(avg_speed, 2),
                "speed_kmh": round(avg_speed * 3.6, 1),
                "gap_pace_min_km": round(gap_pace, 2) if gap_pace else None,
                "gap_speed_kmh": round(gas, 1) if gas else None,
                "avg_hr": round(avg_hr, 1) if avg_hr else None,
                "ele_gain": round(max(0, ele_change), 1),
            })

            # Reset for next segment
            seg_start_idx = i
            seg_start_dist = d
            seg_speeds = []
            seg_grades = []
            seg_hrs = []
            seg_ele_start = e

    # Include trailing partial segment if it has meaningful distance
    # Runs: ≥1000m (half a segment), Rides: ≥2000m to avoid grade bias
    min_tail = 1000 if activity_type == "Run" else 2000
    last_pt = points[-1] if points else None
    if last_pt and seg_speeds:
        d = last_pt.get("d", 0)
        dist_covered = d - seg_start_dist
        if dist_covered >= min_tail:
            ele_change = (seg_ele_end - seg_ele_start) if seg_ele_start is not None and seg_ele_end is not None else 0
            avg_grade = (ele_change / dist_covered) * 100 if dist_covered > 0 else 0
            avg_speed = sum(seg_speeds) / len(seg_speeds)
            avg_hr = sum(seg_hrs) / len(seg_hrs) if seg_hrs else None

            if activity_type == "Run":
                if avg_grade > 0:
                    gap_factor = 1 + 0.033 * avg_grade
                elif avg_grade < -1:
                    gap_factor = 1 - 0.017 * abs(avg_grade)
                else:
                    gap_factor = 1.0
                gap_speed = avg_speed * gap_factor
                gap_pace = (1000 / gap_speed) / 60 if gap_speed > 0 else None
                gas = None
            else:
                if avg_grade > 0:
                    gap_factor = 1 + 0.033 * avg_grade
                elif avg_grade < -1:
                    gap_factor = 1 - 0.012 * abs(avg_grade)
                else:
                    gap_factor = 1.0
                gap_speed = avg_speed * gap_factor
                gas = gap_speed * 3.6
                gap_pace = None

            segments.append({
                "dist_km": round(d / 1000, 2),
                "grade_pct": round(avg_grade, 2),
                "speed_ms": round(avg_speed, 2),
                "speed_kmh": round(avg_speed * 3.6, 1),
                "gap_pace_min_km": round(gap_pace, 2) if gap_pace else None,
                "gap_speed_kmh": round(gas, 1) if gas else None,
                "avg_hr": round(avg_hr, 1) if avg_hr else None,
                "ele_gain": round(max(0, ele_change), 1),
            })

    return segments


# --- Compute derived metrics ---
def compute_derived_metrics(act, streams):
    """Compute sport-specific and derived metrics."""
    d = {}

    # Aerobic decoupling (pace/HR drift first half vs second half)
    if streams["hr_samples"] > 10 and len(streams["speeds"]) > 10:
        mid = len(streams["speeds"]) // 2
        speeds = streams["speeds"]
        hrs = streams["heartrates"]
        first_half_speeds = speeds[:mid]
        second_half_speeds = speeds[mid:]
        first_half_hrs = [h for h in hrs[:mid] if h]
        second_half_hrs = [h for h in hrs[mid:] if h]
        if first_half_speeds and second_half_speeds and first_half_hrs and second_half_hrs:
            avg_speed_1 = sum(first_half_speeds) / len(first_half_speeds)
            avg_speed_2 = sum(second_half_speeds) / len(second_half_speeds)
            avg_hr_1 = sum(first_half_hrs) / len(first_half_hrs)
            avg_hr_2 = sum(second_half_hrs) / len(second_half_hrs)
            if avg_speed_1 > 0 and avg_hr_1 > 0:
                # EF = speed / HR. Decoupling = (EF1 - EF2) / EF1 * 100
                ef1 = avg_speed_1 / avg_hr_1
                ef2 = avg_speed_2 / avg_hr_2 if avg_hr_2 > 0 else ef1
                decoupling = ((ef1 - ef2) / ef1 * 100) if ef1 > 0 else 0
                d["aerobic_decoupling_pct"] = round(decoupling, 2)
                d["ef_first_half"] = round(ef1 * 100, 3)
                d["ef_second_half"] = round(ef2 * 100, 3)

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
    if streams["avg_hr"] and streams["moving_time"] > 60:
        max_hr = streams["max_hr"] or 190
        hr_pct = streams["avg_hr"] / max_hr
        # Intensity factor scaling (exponential relationship)
        intensity = 0.64 * math.exp(1.92 * hr_pct)
        trimp = streams["moving_time"] / 60 * hr_pct * intensity
        d["trimp"] = round(trimp, 1)

    return d


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
        if filepath:
            ext_lower = filepath.lower()
            if ext_lower.endswith(".gpx") or ext_lower.endswith(".gpx.gz"):
                points = parse_gpx(filepath)
            elif ext_lower.endswith(".tcx") or ext_lower.endswith(".tcx.gz"):
                points = parse_tcx(filepath)
                is_tcx = True
            elif ext_lower.endswith(".fit") or ext_lower.endswith(".fit.gz"):
                points = parse_fit(filepath)
                is_fit = True

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
            "stream": streams["raw_points"][:500],  # Limit stream points for dashboard
        }

        # Segment-level GAP computation (1km runs, 3km rides)
        if sport in ["Run", "Ride"] and streams["raw_points"]:
            segments = compute_gap_segments(streams, sport, points)
            act_data["gap_segments"] = segments

        # Derived metrics
        derived = compute_derived_metrics(act, streams)
        act_data.update(derived)

        all_activities.append(act_data)
        by_sport[sport].append(act_data)
        sport_counts[sport] += 1

    print(f"\nProcessed: {sport_counts}")

    # Sort by date
    for sport in by_sport:
        by_sport[sport].sort(key=lambda x: x.get("start_time_utc") or "")

    all_activities.sort(key=lambda x: x.get("start_time_utc") or "")

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
