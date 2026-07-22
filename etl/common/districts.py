"""Canonical district dimension for the 41 FIR ``District_Name`` units.

The FIR extract mixes district police units with city commissionerates and 4
non-geographic special units. This module is the single source of truth that maps
each raw FIR name to a canonical name, its geographic parent district, and the join
codes to the three external references:

  * ``kgis_code``       -> 2021 KGIS district polygon (boundaries GeoJSON)
  * ``lgd_code``        -> Local Government Directory district code
  * ``census_code_2011``-> 2011 Census district code (DataMeet SHP ``censuscode`` /
                           Census PCA ``District`` field)

Codes were hand-verified against the actual external files (see build_dim_district.py,
which cross-checks this map with rapidfuzz + exact code lookups).

Notes / decisions baked in:
  * City commissionerates (Bengaluru City, Mysuru City, Belagavi City, Mangaluru City,
    Hubballi-Dharwad City, Kalaburagi City) and K.G.F share their parent district's
    polygon/codes, so a choropleth grouped by ``kgis_code`` merges them correctly.
  * "Bengaluru Dist" -> Bengaluru Rural; the "* Dist" city-pair units -> the district.
  * Ramanagara: the 2021 KGIS polygon is labelled "Bengaluru South" (kgis 29, lgd 631)
    after the 2024 rename; the 2011 census code stays Ramanagara (584).
  * Vijayanagara (2021, carved from Ballari) has NO 2011 census code -> blank; combine
    with Ballari (565) for any 2011-based per-capita normalization.
  * 4 non-geographic units flagged is_geographic=False with no codes.
"""
from __future__ import annotations

# raw FIR District_Name -> (canonical_name, parent_district, kgis_code, lgd_code,
#                            census_code_2011, is_geographic)
DISTRICT_MAP = {
    # --- Bengaluru ---
    "Bengaluru City":          ("Bengaluru City", "Bengaluru Urban", "20", "525", "572", True),
    "Bengaluru Dist":          ("Bengaluru Rural", "Bengaluru Rural", "21", "526", "583", True),
    # --- rest of the districts (city commissionerates share parent codes) ---
    "Tumakuru":                ("Tumakuru", "Tumakuru", "18", "548", "571", True),
    "Shivamogga":              ("Shivamogga", "Shivamogga", "15", "547", "568", True),
    "Mandya":                  ("Mandya", "Mandya", "22", "544", "573", True),
    "Belagavi Dist":           ("Belagavi", "Belagavi", "01", "527", "555", True),
    "Belagavi City":           ("Belagavi City", "Belagavi", "01", "527", "555", True),
    "Hassan":                  ("Hassan", "Hassan", "23", "539", "574", True),
    "Mysuru Dist":             ("Mysuru", "Mysuru", "26", "545", "577", True),
    "Mysuru City":             ("Mysuru City", "Mysuru", "26", "545", "577", True),
    "Chitradurga":             ("Chitradurga", "Chitradurga", "13", "533", "566", True),
    "Ramanagara":              ("Ramanagara", "Ramanagara", "29", "631", "584", True),
    "Vijayapur":               ("Vijayapura", "Vijayapura", "03", "530", "557", True),
    "Davanagere":              ("Davanagere", "Davanagere", "14", "535", "567", True),
    "Bidar":                   ("Bidar", "Bidar", "05", "529", "558", True),
    "Chickballapura":          ("Chikkaballapura", "Chikkaballapura", "28", "630", "582", True),
    "Raichur":                 ("Raichur", "Raichur", "06", "546", "559", True),
    "Chikkamagaluru":          ("Chikkamagaluru", "Chikkamagaluru", "17", "532", "570", True),
    "Uttara Kannada":          ("Uttara Kannada", "Uttara Kannada", "10", "550", "563", True),
    "Mangaluru City":          ("Mangaluru City", "Dakshina Kannada", "24", "534", "575", True),
    "Dakshina Kannada":        ("Dakshina Kannada", "Dakshina Kannada", "24", "534", "575", True),
    "Kalaburagi":              ("Kalaburagi", "Kalaburagi", "04", "538", "579", True),
    "Kalaburagi City":         ("Kalaburagi City", "Kalaburagi", "04", "538", "579", True),
    "Haveri":                  ("Haveri", "Haveri", "11", "540", "564", True),
    "Udupi":                   ("Udupi", "Udupi", "16", "549", "569", True),
    "Ballari":                 ("Ballari", "Ballari", "12", "528", "565", True),
    "Bagalkot":                ("Bagalkote", "Bagalkote", "02", "524", "556", True),
    "Vijayanagara":            ("Vijayanagara", "Vijayanagara", "31", "738", "", True),
    "Koppal":                  ("Koppal", "Koppal", "07", "543", "560", True),
    "Hubballi Dharwad City":   ("Hubballi-Dharwad City", "Dharwad", "09", "536", "562", True),
    "Dharwad":                 ("Dharwad", "Dharwad", "09", "536", "562", True),
    "Kolar":                   ("Kolar", "Kolar", "19", "542", "581", True),
    "K.G.F":                   ("K.G.F", "Kolar", "19", "542", "581", True),
    "Chamarajanagar":          ("Chamarajanagar", "Chamarajanagar", "27", "531", "578", True),
    "Yadgir":                  ("Yadgir", "Yadgir", "30", "635", "580", True),
    "Kodagu":                  ("Kodagu", "Kodagu", "25", "541", "576", True),
    "Gadag":                   ("Gadag", "Gadag", "08", "537", "561", True),
    # --- 4 NON-geographic special units ---
    "Karnataka Railways":      ("Karnataka Railways", "", "", "", "", False),
    "Coastal Security Police": ("Coastal Security Police", "", "", "", "", False),
    "CID":                     ("CID", "", "", "", "", False),
    "ISD Bengaluru":           ("ISD Bengaluru", "", "", "", "", False),
}

FIELDS = ["canonical_name", "kgis_code", "lgd_code", "census_code_2011",
          "is_geographic", "parent_district"]


def resolve(raw_district_name: str):
    """Return the attribute dict for a raw FIR District_Name (or None if unknown)."""
    v = DISTRICT_MAP.get((raw_district_name or "").strip())
    if v is None:
        return None
    canonical, parent, kgis, lgd, census, is_geo = v
    return {
        "canonical_name": canonical,
        "kgis_code": kgis,
        "lgd_code": lgd,
        "census_code_2011": census,
        "is_geographic": is_geo,
        "parent_district": parent,
    }


def as_rows():
    """Yield dim_district rows (one per raw FIR unit) in FIELDS order."""
    for raw in DISTRICT_MAP:
        r = resolve(raw)
        yield {k: r[k] for k in FIELDS}
