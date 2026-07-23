"""Phase 2 — Spatiotemporal hotspot model (offline).

Reads the Phase-0 grid (etl/out/agg_hotspots.csv) + station rollup (agg_unit.csv),
computes a Gaussian KDE density surface and weighted DBSCAN clusters, and writes:
  ml/out/hotspot_cells.csv    (lat, lng, count, density, cluster_id, geo_precision, year)
  ml/out/hotspot_clusters.csv (cluster_id, centroid_lat, centroid_lng, n_points,
                               total_count, canonical_name, radius_km, top_category,
                               deployment_note)

ACCURACY GUARD: only `point`, `station`, `place` precisions feed the point/heat/cluster
layers. The 131k `district`-centroid rows (all piled at district centres) and any `none`
are EXCLUDED — they would render as fake hotspots. District-centroid data belongs on the
aggregate choropleth, not here.

No runtime ML: this runs offline; the API serves the CSV outputs. Re-runnable.
Run:  python ml/hotspots.py
"""
from __future__ import annotations

import os
import time

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from sklearn.metrics import silhouette_score
from sklearn.neighbors import BallTree

EARTH_KM = 6371.0
KEEP_PRECISION = {"point", "station", "place"}   # excludes district-centroid + none
BW_KM = 2.0          # KDE Gaussian bandwidth
EPS_KM = 3.0         # DBSCAN neighbourhood radius
MIN_WEIGHT = 400     # DBSCAN min_samples (weighted): incidents needed for a core area

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IN_DIR = os.path.join(ROOT, "etl", "out")
OUT_DIR = os.path.join(ROOT, "ml", "out")


def haversine_km(lat1, lon1, lat2, lon2):
    r1, r2 = np.radians(lat1), np.radians(lat2)
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = np.sin(dlat / 2) ** 2 + np.cos(r1) * np.cos(r2) * np.sin(dlon / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(a))


def main():
    t0 = time.time()
    os.makedirs(OUT_DIR, exist_ok=True)

    # ---- load + ACCURACY GUARD filter ----
    df = pd.read_csv(os.path.join(IN_DIR, "agg_hotspots.csv"))
    before = len(df)
    df = df[df["geo_precision"].isin(KEEP_PRECISION)].copy()
    excluded = before - len(df)
    print(f"[hotspots] loaded {before:,} grid rows; kept {len(df):,} "
          f"(point/station/place); EXCLUDED {excluded:,} district-centroid/none rows")
    assert not (df["geo_precision"] == "district").any(), "district-centroid leaked into point layer!"

    # ---- aggregate over years per cell (for density + clustering) ----
    agg = df.groupby(["lat", "lng"], as_index=False).agg(count=("count", "sum"))
    # dominant precision per cell (for map styling of the aggregated view)
    dom = (df.groupby(["lat", "lng"])["geo_precision"]
             .agg(lambda s: s.value_counts().index[0]).rename("geo_precision").reset_index())
    agg = agg.merge(dom, on=["lat", "lng"], how="left")
    print(f"[hotspots] {len(agg):,} unique cells; total incidents {int(agg['count'].sum()):,}")

    coords = agg[["lat", "lng"]].to_numpy()
    coords_rad = np.radians(coords)
    counts = agg["count"].to_numpy(dtype=float)

    # ---- Gaussian KDE density surface (BallTree, haversine) ----
    tree = BallTree(coords_rad, metric="haversine")
    bw_rad = BW_KM / EARTH_KM
    cutoff = 3.0 * bw_rad
    ind, dist = tree.query_radius(coords_rad, r=cutoff, return_distance=True)
    density = np.empty(len(agg))
    for i, (nbrs, d) in enumerate(zip(ind, dist)):
        w = counts[nbrs] * np.exp(-(d ** 2) / (2 * bw_rad ** 2))
        density[i] = w.sum()
    agg["density"] = np.round(density, 2)
    print(f"[hotspots] KDE density computed (bw={BW_KM} km)  [{time.time()-t0:.0f}s]")

    # ---- weighted DBSCAN clustering ----
    db = DBSCAN(eps=EPS_KM / EARTH_KM, min_samples=MIN_WEIGHT, metric="haversine")
    labels = db.fit_predict(coords_rad, sample_weight=counts)
    agg["cluster_id"] = labels
    core = labels != -1
    n_clusters = int(len(set(labels[core])))
    noise_cells = int((~core).sum())
    clustered_incidents = int(counts[core].sum())
    print(f"[hotspots] DBSCAN (eps={EPS_KM} km, min_weight={MIN_WEIGHT}): "
          f"{n_clusters} clusters, {noise_cells:,} noise cells, "
          f"{clustered_incidents:,} incidents clustered ({100*clustered_incidents/counts.sum():.1f}%)")

    # quality metric (silhouette on a non-noise sample)
    sil = float("nan")
    if n_clusters >= 2:
        m = core
        sil = float(silhouette_score(coords_rad[m], labels[m], metric="haversine",
                                     sample_size=min(5000, int(m.sum())), random_state=0))
        print(f"[hotspots] silhouette (haversine, sampled): {sil:.3f}")

    # ---- per-year cells output (guard-filtered) ----
    cells = df.merge(agg[["lat", "lng", "density", "cluster_id"]], on=["lat", "lng"], how="left")
    cells = cells[["lat", "lng", "count", "density", "cluster_id", "geo_precision", "year"]]
    cells.to_csv(os.path.join(OUT_DIR, "hotspot_cells.csv"), index=False)

    # ---- cluster summaries + deployment notes ----
    write_clusters(agg, labels, core)

    print(f"[hotspots] wrote hotspot_cells.csv ({len(cells):,} rows) + "
          f"hotspot_clusters.csv ({n_clusters} clusters)  [{time.time()-t0:.0f}s]")
    print(f"[hotspots] DONE. clusters={n_clusters}  silhouette={sil:.3f}")


def write_clusters(agg, labels, core):
    # district labelling via nearest police station (agg_unit)
    units = pd.read_csv(os.path.join(IN_DIR, "agg_unit.csv"))
    units = units.dropna(subset=["mean_lat", "mean_lng"])
    units = units[(units["mean_lat"] != "") & (units["mean_lng"] != "")]
    u_lat = pd.to_numeric(units["mean_lat"], errors="coerce")
    u_lng = pd.to_numeric(units["mean_lng"], errors="coerce")
    umask = u_lat.notna() & u_lng.notna()
    units = units[umask].reset_index(drop=True)
    unit_coords = np.radians(np.c_[u_lat[umask].to_numpy(), u_lng[umask].to_numpy()])
    unit_tree = BallTree(unit_coords, metric="haversine")

    # top crime head per parent district (from agg_district_month + dim_district)
    top_cat = top_category_by_parent()

    rows = []
    for cid in sorted(set(labels[core])):
        m = labels == cid
        sub = agg[m]
        w = sub["count"].to_numpy(dtype=float)
        clat = float(np.average(sub["lat"], weights=w))
        clng = float(np.average(sub["lng"], weights=w))
        _, idx = unit_tree.query(np.radians([[clat, clng]]), k=1)
        nearest = units.iloc[int(idx[0][0])]
        district = (nearest.get("parent_district") or nearest.get("canonical_name") or "").strip()
        dists = haversine_km(clat, clng, sub["lat"].to_numpy(), sub["lng"].to_numpy())
        radius_km = round(float(np.percentile(dists, 90)), 2)
        total = int(sub["count"].sum())
        cat = top_cat.get(district, "")
        note = (f"~{total:,} FIRs concentrated near {district} "
                f"(radius ~{radius_km} km). Dominant crime head in {district}: "
                f"{cat.title() if cat else 'n/a'}. Prioritise patrol / resource deployment.")
        rows.append([cid, round(clat, 5), round(clng, 5), int(m.sum()), total,
                     district, radius_km, cat, note])

    out = pd.DataFrame(rows, columns=["cluster_id", "centroid_lat", "centroid_lng",
                                      "n_points", "total_count", "canonical_name",
                                      "radius_km", "top_category", "deployment_note"])
    out = out.sort_values("total_count", ascending=False)
    out.to_csv(os.path.join(OUT_DIR, "hotspot_clusters.csv"), index=False)


def top_category_by_parent():
    """parent_district -> dominant major_head (from agg_district_month via dim_district)."""
    dim = pd.read_csv(os.path.join(IN_DIR, "dim_district.csv"))
    canon_to_parent = {}
    for _, r in dim.iterrows():
        canon_to_parent[str(r["canonical_name"])] = str(r["parent_district"] or r["canonical_name"])
    dm = pd.read_csv(os.path.join(IN_DIR, "agg_district_month.csv"))
    dm["parent"] = dm["canonical_name"].map(lambda c: canon_to_parent.get(str(c), str(c)))
    g = dm.groupby(["parent", "major_head"], as_index=False)["count"].sum()
    idx = g.groupby("parent")["count"].idxmax()
    return {row["parent"]: row["major_head"] for _, row in g.loc[idx].iterrows()}


if __name__ == "__main__":
    main()
