#!/usr/bin/env python3
"""V3 Heatmap Tile Generator — Standalone raster PNG tile generation.

Reads densified point cloud from heatmap_points.json, generates
per-zoom PNG tiles with Gaussian kernel density + colour LUT.

Usage: python3 generate_tiles.py [--zoom-min 2] [--zoom-max 16] [--cores 4]
"""

import json
import os
import sys
import time
import numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image
import mercantile
from concurrent.futures import ProcessPoolExecutor, as_completed
from collections import defaultdict

DATA_DIR = "data"
OUTPUT_DIR = os.path.join(DATA_DIR, "tiles")
POINTS_FILE = os.path.join(DATA_DIR, "heatmap_points.json")
ZOOM_MIN = 2
ZOOM_MAX = 16
TARGET_SIGMA_METRES = 30
TILE_SIZE = 256

# --- V3.1: Zoom-dependent kernel target metres ---
def kernel_target_metres(zoom):
    if zoom <= 4:
        return 50000
    elif zoom == 5:
        return 25000
    elif zoom == 6:
        return 12000
    elif zoom == 7:
        return 6000
    elif zoom == 8:
        return 3000
    elif zoom == 9:
        return 1500
    elif zoom == 10:
        return 800
    elif zoom == 11:
        return 400
    elif zoom == 12:
        return 200
    elif zoom == 13:
        return 100
    elif zoom == 14:
        return 60
    elif zoom == 15:
        return 40
    else:
        return 30


def kernel_sigma(zoom):
    mpp = metres_per_pixel(zoom)
    return max(kernel_target_metres(zoom) / mpp, 1.0)


# --- V3.2: Colour LUT with gradual alpha ramp ---
def build_colour_lut():
    lut = np.zeros((256, 4), dtype=np.uint8)
    stops = [
        (0.000, (0, 0, 0, 0)),         # truly empty: transparent
        (0.005, (30, 60, 180, 20)),     # barely visible: faint blue, low alpha
        (0.020, (40, 90, 230, 100)),    # slight trace: more visible blue
        (0.080, (30, 150, 255, 190)),   # visible blue
        (0.220, (0, 210, 230, 220)),    # cyan
        (0.450, (250, 225, 40, 240)),   # yellow
        (0.700, (255, 120, 0, 250)),    # orange
        (1.000, (220, 30, 0, 255)),     # red
    ]
    for i in range(256):
        v = i / 255.0
        if v == 0:
            lut[i] = [0, 0, 0, 0]
            continue
        lo, hi = 0, len(stops) - 1
        for j in range(len(stops)):
            if stops[j][0] <= v:
                lo = j
            if stops[len(stops) - 1 - j][0] >= v:
                hi = len(stops) - 1 - j
        if lo == hi:
            r, g, b, a = stops[lo][1]
        else:
            t = (v - stops[lo][0]) / (stops[hi][0] - stops[lo][0])
            r = int(stops[lo][1][0] + t * (stops[hi][1][0] - stops[lo][1][0]))
            g = int(stops[lo][1][1] + t * (stops[hi][1][1] - stops[lo][1][1]))
            b = int(stops[lo][1][2] + t * (stops[hi][1][2] - stops[lo][1][2]))
            a = int(stops[lo][1][3] + t * (stops[hi][1][3] - stops[lo][1][3]))
        lut[i] = [r, g, b, a]
    return lut


COLOUR_LUT = build_colour_lut()

# Web Mercator: metres per pixel at equator
def metres_per_pixel(zoom):
    return 156543.03392 / (2 ** zoom)

# --- V3.2: Power curve ---
GAMMA = 0.50


def apply_power_curve(density_norm):
    """Compress faint values upward, leave hot values mostly intact."""
    return np.power(density_norm, GAMMA)


def apply_lut(density_norm):
    indices = np.clip(density_norm * 255, 0, 255).astype(np.uint8)
    return COLOUR_LUT[indices]


def lnglat_to_pixel(lng, lat, zoom, tx, ty, tile_size=TILE_SIZE):
    """Returns (px, py) pixel coordinates within tile (tx,ty) at zoom.
    
    The tile_size parameter supports overscan rendering where we project
    to a larger grid then crop to 256×256.
    """
    bounds = mercantile.bounds(tx, ty, zoom)
    dw = bounds.east - bounds.west
    dn = bounds.north - bounds.south
    if dw == 0 or dn == 0:
        return tile_size / 2, tile_size / 2
    px = (lng - bounds.west) / dw * tile_size
    py = (bounds.north - lat) / dn * tile_size
    return px, py


def tiles_for_point(lng, lat, zoom, radius=3):
    """Return set of (tx, ty) tiles around a point (including buffer)."""
    t = mercantile.tile(lng, lat, zoom)
    max_tile = (1 << zoom) - 1
    tiles = set()
    for dx in range(-radius, radius + 1):
        for dy in range(-radius, radius + 1):
            tx = t.x + dx
            ty = t.y + dy
            if 0 <= tx <= max_tile and 0 <= ty <= max_tile:
                tiles.add((tx, ty, zoom))
    return tiles


def tiles_for_points(points, zoom, radius=3):
    """Return set of (tx, ty) tiles for all points at a zoom level."""
    tiles = set()
    for pt in points:
        lng, lat = pt["lng"], pt["lat"]
        tiles.update(tiles_for_point(lng, lat, zoom, radius))
    return tiles


def build_spatial_index(points, zoom):
    """Build a grid of tile->point indices for fast lookup."""
    index = defaultdict(list)
    for i, pt in enumerate(points):
        try:
            t = mercantile.tile(pt["lng"], pt["lat"], zoom)
            index[(t.x, t.y)].append(i)
        except Exception:
            continue
    return index


def overscan_margin(sigma):
    """Pixels of margin to render beyond the 256x256 tile, so kernel tails
    aren't clipped at tile boundaries. Returns 0 if sigma <= 1."""
    if sigma <= 1.0:
        return 0
    return int(3.0 * sigma) + 1


def render_tile(points, spatial_index, zoom, tx, ty, sigma, norm_factor):
    """Render a single 256x256 PNG tile with overscan for seamless edges.

    Uses overscan: renders at (256 + 2*margin)² then crops to 256² so
    Gaussian kernel tails aren't clipped at tile boundaries.
    Returns bytes or None.
    """
    margin = overscan_margin(sigma)
    full_size = TILE_SIZE + 2 * margin

    # Collect points from this tile and wider neighbors (enough for margin)
    neighbor_range = max(2, int(margin / TILE_SIZE) + 2)
    relevant_indices = set()
    for dx in range(-neighbor_range, neighbor_range + 1):
        for dy in range(-neighbor_range, neighbor_range + 1):
            key = (tx + dx, ty + dy)
            if key in spatial_index:
                relevant_indices.update(spatial_index[key])

    if not relevant_indices:
        return None

    counts = np.zeros((full_size, full_size), dtype=np.float32)

    # When margin > 0, project points relative to the overscanned tile:
    # the geographic area is the same, but pixel coordinates extend beyond 0..255
    # by 'margin' pixels on each side. We shift by -margin so that the original
    # tile's (0,0) pixel becomes (margin, margin) in the overscanned grid.
    for idx in relevant_indices:
        pt = points[idx]
        px, py = lnglat_to_pixel(pt["lng"], pt["lat"], zoom, tx, ty, full_size)
        # px,py are in [0, full_size) for the overscanned tile
        # Adjust: original tile pixels are [margin, margin+TILE_SIZE)
        ix, iy = int(px), int(py)
        if 0 <= ix < full_size and 0 <= iy < full_size:
            fx = px - ix
            fy = py - iy
            w00 = (1 - fx) * (1 - fy)
            w10 = fx * (1 - fy)
            w01 = (1 - fx) * fy
            w11 = fx * fy
            if 0 <= iy < full_size and 0 <= ix < full_size:
                counts[iy, ix] += w00
            if 0 <= iy < full_size and ix + 1 < full_size:
                counts[iy, ix + 1] += w10
            if iy + 1 < full_size and 0 <= ix < full_size:
                counts[iy + 1, ix] += w01
            if iy + 1 < full_size and ix + 1 < full_size:
                counts[iy + 1, ix + 1] += w11

    # Apply Gaussian kernel on the full overscanned grid
    if sigma > 0.5:
        density_full = gaussian_filter(counts, sigma=sigma, mode="constant", cval=0.0)
    else:
        density_full = counts

    # Crop to center 256x256
    if margin > 0:
        density = density_full[margin:margin + TILE_SIZE, margin:margin + TILE_SIZE]
    else:
        density = density_full

    # Normalise
    if norm_factor > 0:
        density_norm = np.clip(density / norm_factor, 0.0, 1.0)
    else:
        density_norm = np.clip(density, 0.0, 1.0)

    # Power curve
    density_curved = apply_power_curve(density_norm)

    if density_curved.max() < 0.001:
        return None

    rgba = apply_lut(density_curved)
    img = Image.fromarray(rgba, "RGBA")
    from io import BytesIO
    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def render_tile_set(name, points, base_dir, zooms, p99_dict):
    """Render all tiles for one dataset. Saves tiles in XYZ scheme for MapLibre."""
    set_dir = os.path.join(base_dir, name)
    total = 0

    for zoom in zooms:
        sigma = kernel_sigma(zoom)
        norm = p99_dict.get(zoom, 1.0)
        t0 = time.time()

        # Build spatial index for this zoom (uses TMS internally)
        print(f"    {name} z{zoom}: building spatial index...", end=" ", flush=True)
        sidx = build_spatial_index(points, zoom)
        tiles = set()
        for (tx, ty) in sidx.keys():
            tiles.add((tx, ty, zoom))
        print(f"{len(tiles)} tiles, ", end="", flush=True)

        # Render each tile (mercantile.tile() already returns XYZ coords)
        zoom_dir = os.path.join(set_dir, str(zoom))
        os.makedirs(zoom_dir, exist_ok=True)

        rendered = 0
        for tx, ty, z in sorted(tiles):
            x_dir = os.path.join(zoom_dir, str(tx))
            os.makedirs(x_dir, exist_ok=True)
            filepath = os.path.join(x_dir, f"{ty}.png")

            if os.path.exists(filepath):
                rendered += 1
                continue

            png = render_tile(points, sidx, zoom, tx, ty, sigma, norm)
            if png:
                with open(filepath, "wb") as f:
                    f.write(png)
                rendered += 1

        elapsed = time.time() - t0
        print(f"{rendered} rendered ({elapsed:.1f}s)")
        total += rendered

    return total


def compute_percentiles(points, zooms, sample_frac=0.1):
    """Compute per-zoom 99th percentile density for normalisation."""
    print("Computing density percentiles...")
    p99 = {}

    for zoom in zooms:
        sigma = kernel_sigma(zoom)
        sidx = build_spatial_index(points, zoom)
        tiles = sorted(sidx.keys())
        sample = tiles[::max(1, int(len(tiles) * sample_frac) + 1)]

        if len(sample) > 300:
            import random
            sample = random.sample(sample, 300)

        densities = []
        margin = overscan_margin(sigma)
        neighbor_range = max(2, int(margin / TILE_SIZE) + 2)
        full_size = TILE_SIZE + 2 * margin

        for (tx, ty) in sample:
            relevant = set()
            for dx in range(-neighbor_range, neighbor_range + 1):
                for dy in range(-neighbor_range, neighbor_range + 1):
                    key = (tx + dx, ty + dy)
                    if key in sidx:
                        relevant.update(sidx[key])
            if not relevant:
                continue

            counts = np.zeros((full_size, full_size), dtype=np.float32)
            for idx in relevant:
                pt = points[idx]
                px, py = lnglat_to_pixel(pt["lng"], pt["lat"], zoom, tx, ty, full_size)
                ix, iy = int(px), int(py)
                if 0 <= ix < full_size and 0 <= iy < full_size:
                    counts[iy, ix] += 1.0

            if sigma > 0.5:
                density_full = gaussian_filter(counts, sigma=sigma, mode="constant", cval=0.0)
            else:
                density_full = counts

            if margin > 0:
                density = density_full[margin:margin + TILE_SIZE, margin:margin + TILE_SIZE]
            else:
                density = density_full

            nz = density[density > 0]
            if len(nz) > 0:
                densities.append(float(np.percentile(nz, 99)))

        p99[zoom] = float(np.median(densities)) if densities else 1.0
        print(f"  z{zoom}: p99={p99[zoom]:.1f} (sigma={sigma:.1f}px, {len(densities)} samples)")

    return p99


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--zoom-min", type=int, default=ZOOM_MIN)
    ap.add_argument("--zoom-max", type=int, default=ZOOM_MAX)
    ap.add_argument("--cores", type=int, default=None)
    ap.add_argument("--skip-percentiles", action="store_true")
    ap.add_argument("--p99-file", type=str, default=None)
    args = ap.parse_args()

    # Load points
    print(f"Loading points from {POINTS_FILE}...")
    with open(POINTS_FILE) as f:
        raw_pts = json.load(f)
    print(f"  {len(raw_pts):,} points loaded")

    # Convert to dicts for convenience
    all_points = []
    sports_set = set()
    points_by_sport = defaultdict(list)
    for pt in raw_pts:
        lng, lat, sport, year = pt[0], pt[1], pt[2], pt[3]
        p = {"lng": lng, "lat": lat, "sport": sport, "year": year}
        all_points.append(p)
        points_by_sport[sport].append(p)
        sports_set.add(sport)

    zooms = list(range(args.zoom_min, args.zoom_max + 1))
    print(f"Zooms: {args.zoom_min}-{args.zoom_max} ({len(zooms)} levels)")
    print(f"Sports: {sorted(sports_set)}")

    # Pass 1: percentiles
    if not args.skip_percentiles or args.p99_file:
        p99_all = compute_percentiles(all_points, zooms)
        p99_sport = {}
        for sport, pts in points_by_sport.items():
            print(f"\n  {sport}:")
            p99_sport[sport] = compute_percentiles(pts, zooms)

        # Save percentiles for reuse
        p99_data = {"all": {str(k): round(v, 2) for k, v in p99_all.items()}}
        for s, d in p99_sport.items():
            p99_data[s] = {str(k): round(v, 2) for k, v in d.items()}

        p99_path = args.p99_file or os.path.join(OUTPUT_DIR, "percentiles.json")
        os.makedirs(os.path.dirname(p99_path) if os.path.dirname(p99_path) else OUTPUT_DIR, exist_ok=True)
        with open(p99_path, "w") as f:
            json.dump(p99_data, f, indent=2)
        print(f"Percentiles saved to {p99_path}")
    else:
        p99_path = args.p99_file or os.path.join(OUTPUT_DIR, "percentiles.json")
        if os.path.exists(p99_path):
            with open(p99_path) as f:
                p99_data = json.load(f)
            p99_all = {int(k): v for k, v in p99_data["all"].items()}
            p99_sport = {}
            for s in sports_set:
                if s in p99_data:
                    p99_sport[s] = {int(k): v for k, v in p99_data[s].items()}
            print(f"Loaded percentiles from {p99_path}")
        else:
            print("ERROR: --skip-percentiles but no p99 file found")
            sys.exit(1)

    # Pass 2: render tiles
    print("\nPass 2: rendering tiles...")

    print("\n--- All activities ---")
    total = render_tile_set("all", all_points, OUTPUT_DIR, zooms, p99_all)
    print(f"  All: {total} tiles")

    for sport, pts in points_by_sport.items():
        if sport not in p99_sport:
            continue
        sk = sport.lower()
        sport_dir = os.path.join("sport", sk)
        print(f"\n--- {sport} ---")
        total = render_tile_set(sport_dir, pts, OUTPUT_DIR, zooms, p99_sport[sport])
        print(f"  {sk}: {total} tiles")

    # Manifest
    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "point_count": len(all_points),
        "zoom_range": [args.zoom_min, args.zoom_max],
        "percentiles_url": "/data/tiles/percentiles.json",
    }
    with open(os.path.join(OUTPUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nDone. Tiles written to {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
