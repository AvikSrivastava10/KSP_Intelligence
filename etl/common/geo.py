"""Geocoding: multi-tier resolution of FIR incidents to coordinates.

Tiers (each row tagged with ``geo_precision`` + ``geo_source``):
  1. ``point``    real Latitude/Longitude in the FIR (validated to Karnataka bbox)
  2. ``station``  KGIS police-station coords matched via UnitName (+ district census
                  code disambiguation, then name-only, then fuzzy within district)
  3. ``place``    GeoNames populated-place coords matched via Village_Area_Name /
                  Place of Offence (nearest same-name place to the district centroid)
  4. ``district`` district polygon representative-point centroid (2021 KGIS)
  5. ``none``     no coordinate (e.g. non-geographic units with no station match)

All indexes are built once; per-row resolution is memoized by (district, unit) and
(district, place) so the 1.67M-row stream stays fast.
"""
from __future__ import annotations

import json
import xml.etree.ElementTree as ET

from rapidfuzz import process, fuzz
from shapely.geometry import shape

from . import paths
from .textutils import norm_name

# Karnataka bounding box (lon/lat) with a small margin.
KA_LON = (73.8, 78.9)
KA_LAT = (11.4, 18.7)
VALID_CENSUS = {str(c) for c in range(555, 585)}  # 2011 KA district census codes


def _localname(el) -> str:
    return el.tag.split("}")[-1]


def valid_coord(lat, lon):
    """Return (lat, lon) if a plausible KA coordinate (auto-unswaps), else None."""
    try:
        lat = float(lat); lon = float(lon)
    except (TypeError, ValueError):
        return None
    if lat == 0 and lon == 0:
        return None
    if KA_LAT[0] <= lat <= KA_LAT[1] and KA_LON[0] <= lon <= KA_LON[1]:
        return (lat, lon)
    # try swapped (some rows store lon in Latitude)
    if KA_LAT[0] <= lon <= KA_LAT[1] and KA_LON[0] <= lat <= KA_LON[1]:
        return (lon, lat)
    return None


class GeoResolver:
    def __init__(self):
        self.district_centroid = {}      # kgis_code -> (lat, lon)
        self.stations_by_dc = {}         # (census_code, norm_name) -> [(lat, lon), ...]
        self.stations_by_name = {}       # norm_name -> [(lat, lon), ...]
        self.stations_names_by_dc = {}   # census_code -> [norm_name, ...] (fuzzy pool)
        self.station_records = []        # [{name, census, lat, lon}] (for agg_unit enrich)
        self.geonames = {}               # norm_name -> [(lat, lon), ...]
        self._unit_cache = {}            # (parent, census, unit) -> (lat, lon, prec, src)
        self._place_cache = {}           # (census, place) -> (lat, lon) | None
        self.stats = {"point": 0, "station": 0, "place": 0, "district": 0, "none": 0}

    # ---- index builders -------------------------------------------------
    def load_all(self, verbose=True):
        self._load_centroids()
        self._load_stations()
        self._load_geonames()
        if verbose:
            print(f"[geo] district centroids: {len(self.district_centroid)} | "
                  f"stations: {len(self.station_records)} | "
                  f"geoname place-names: {len(self.geonames)}")
        return self

    def _load_centroids(self):
        with open(paths.KGIS_GEOJSON, encoding="utf-8") as f:
            gj = json.load(f)
        for ft in gj["features"]:
            code = str(ft["properties"].get("kgis_code", "")).zfill(2)
            geom = shape(ft["geometry"])
            pt = geom.representative_point()  # guaranteed inside the polygon
            self.district_centroid[code] = (pt.y, pt.x)

    def _load_stations(self):
        root = ET.parse(paths.kml_path()).getroot()
        for pm in (e for e in root.iter() if _localname(e) == "Placemark"):
            name = kgiscode = coord_text = None
            for el in pm.iter():
                ln = _localname(el)
                if ln == "SimpleData" and el.get("name") == "POL_STAName":
                    name = el.text
                elif ln == "SimpleData" and el.get("name") == "KGISCode":
                    kgiscode = el.text
                elif ln == "coordinates":
                    coord_text = el.text
            if not (name and coord_text):
                continue
            try:
                lon, lat = (float(x) for x in coord_text.strip().split(",")[:2])
            except ValueError:
                continue
            if valid_coord(lat, lon) is None:
                continue
            census = (kgiscode or "")[2:5]
            if census not in VALID_CENSUS:
                census = ""
            nm = norm_name(name)
            self.station_records.append({"name": name, "census": census, "lat": lat, "lon": lon})
            self.stations_by_name.setdefault(nm, []).append((lat, lon))
            if census:
                self.stations_by_dc.setdefault((census, nm), []).append((lat, lon))
                self.stations_names_by_dc.setdefault(census, []).append(nm)

    def _load_geonames(self):
        # Karnataka = admin1 '19', populated places feature_class 'P'
        with open(paths.GEONAMES_IN, encoding="utf-8") as f:
            for line in f:
                p = line.rstrip("\n").split("\t")
                if len(p) < 11 or p[10] != "19" or p[6] != "P":
                    continue
                try:
                    lat, lon = float(p[4]), float(p[5])
                except ValueError:
                    continue
                if valid_coord(lat, lon) is None:
                    continue
                for nm in {norm_name(p[1], drop_ps=False), norm_name(p[2], drop_ps=False)}:
                    if nm:
                        self.geonames.setdefault(nm, []).append((lat, lon))

    # ---- helpers --------------------------------------------------------
    @staticmethod
    def _nearest(cands, ref):
        if ref is None:
            return cands[0]
        rlat, rlon = ref
        return min(cands, key=lambda c: (c[0] - rlat) ** 2 + (c[1] - rlon) ** 2)

    def _match_station(self, unit_norm, census, ref):
        if not unit_norm:
            return None
        if census:
            hit = self.stations_by_dc.get((census, unit_norm))
            if hit:
                return self._nearest(hit, ref)
        hit = self.stations_by_name.get(unit_norm)
        if hit:
            return self._nearest(hit, ref)
        # fuzzy within district
        if census and census in self.stations_names_by_dc:
            pool = self.stations_names_by_dc[census]
            m = process.extractOne(unit_norm, pool, scorer=fuzz.token_sort_ratio,
                                    score_cutoff=88)
            if m:
                cand = self.stations_by_dc.get((census, m[0]))
                if cand:
                    return self._nearest(cand, ref)
        return None

    def _match_place(self, place_raw, census, ref):
        key = (census, place_raw)
        if key in self._place_cache:
            return self._place_cache[key]
        result = None
        # try full value then the leading segment before a comma
        for cand in (place_raw, place_raw.split(",")[0] if place_raw else ""):
            nm = norm_name(cand, drop_ps=False)
            if nm and nm in self.geonames:
                result = self._nearest(self.geonames[nm], ref)
                break
        self._place_cache[key] = result
        return result

    # ---- main resolve ---------------------------------------------------
    def resolve(self, *, lat_raw, lon_raw, dist_attrs, unit_name, village_area,
                place_of_offence):
        """Return (lat, lon, geo_precision, geo_source)."""
        # tier 1: real point
        pt = valid_coord(lat_raw, lon_raw)
        if pt is not None:
            self.stats["point"] += 1
            return pt[0], pt[1], "point", "fir_latlong"

        kgis = dist_attrs["kgis_code"] if dist_attrs else ""
        census = dist_attrs["census_code_2011"] if dist_attrs else ""
        parent = dist_attrs["parent_district"] if dist_attrs else ""
        ref = self.district_centroid.get(kgis.zfill(2)) if kgis else None

        # tier 2: station (memoized by parent+census+unit)
        ukey = (parent, census, unit_name)
        cached = self._unit_cache.get(ukey)
        if cached is None:
            st = self._match_station(norm_name(unit_name), census, ref)
            cached = (st, bool(st))
            self._unit_cache[ukey] = cached
        st = cached[0]
        if st is not None:
            self.stats["station"] += 1
            return st[0], st[1], "station", "kgis_police_station"

        # tier 3: GeoNames place
        for src_val in (village_area, place_of_offence):
            if src_val:
                pl = self._match_place(src_val, census, ref)
                if pl is not None:
                    self.stats["place"] += 1
                    return pl[0], pl[1], "place", "geonames"

        # tier 4: district centroid
        if ref is not None:
            self.stats["district"] += 1
            return ref[0], ref[1], "district", "kgis_centroid"

        # tier 5: nothing (non-geographic unit with no station match)
        self.stats["none"] += 1
        return None, None, "none", ""
