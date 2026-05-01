# Strava Multisport Analysis Dashboard

Comprehensive analysis of Run, Ride, Swim & Hike activities from Strava export data.

## Data

Processed from a full Strava archive export (2020–2026):

| Sport   | Activities | Distance | Time   | Elevation |
|---------|-----------|----------|--------|-----------|
| Ride    | 145       | 903.7 km | 94.5 h | 12,151 m  |
| Run     | 34        | 36.5 km  | 16.1 h | 786 m     |
| Hike    | 23        | 265.8 km | 113.5 h| 16,655 m  |
| Swim    | 13        | 0.8 km   | 3.2 h  | —         |

## Metrics Computed

- **Time-series**: Distance, speed, HR, elevation from GPX tracks
- **HR Analysis**: Zone distribution, average HR trends, efficiency factor
- **Aerobic Decoupling**: Pace/HR drift first half vs second half
- **Training Load**: TRIMP (Banister HR-based), Relative Effort
- **Volume**: Monthly/weekly/yearly aggregations by sport
- **Best Efforts**: Longest distance, most elevation, best speed per sport
- **Gear Mileage**: Distance accumulated per bike/shoe

## Dashboard

Open `dashboard.html` in a browser, or serve locally:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000/dashboard.html

## Reprocessing Data

```bash
python3 process_data.py
```

Requires the `strava_export/` directory from a Strava bulk export.
