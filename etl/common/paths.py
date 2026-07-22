"""Resolved filesystem paths for the pipeline (repo-relative, no hardcoding)."""
from __future__ import annotations

import os

# etl/common/paths.py -> repo root is three levels up
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATASETS = os.path.join(REPO_ROOT, "datasets")
EXTERNAL = os.path.join(DATASETS, "external")

FIR_CSV = os.path.join(DATASETS, "FIR_Details_Data.csv")
ER_PDF = os.path.join(DATASETS, "Police_FIR_ER_Diagram.pdf")

BOUNDARIES = os.path.join(EXTERNAL, "boundaries")
KGIS_GEOJSON = os.path.join(BOUNDARIES, "karnataka_districts_2021_kgis.geojson")
KGIS_GEOJSON_SIMPLE = os.path.join(BOUNDARIES, "karnataka_districts_2021_kgis.simplified.geojson")
CENSUS_SHP = os.path.join(BOUNDARIES, "india_districts_2011_datameet", "2011_Dist.shp")

CENSUS_PCA = os.path.join(EXTERNAL, "census", "DDW_PCA0000_2011_Indiastatedist.csv")
GEONAMES_IN = os.path.join(EXTERNAL, "geonames", "IN.txt")
POLICE_STATIONS_DIR = os.path.join(EXTERNAL, "police_stations")
LGD_DISTRICTS_XLS = os.path.join(EXTERNAL, "lgd", "karnataka_districts.xls")

OUT_DIR = os.path.join(REPO_ROOT, "etl", "out")


def kml_path() -> str:
    for fn in os.listdir(POLICE_STATIONS_DIR):
        if fn.lower().endswith(".kml"):
            return os.path.join(POLICE_STATIONS_DIR, fn)
    raise FileNotFoundError("No .kml in police_stations/")


def ensure_out() -> str:
    os.makedirs(OUT_DIR, exist_ok=True)
    return OUT_DIR
