"""Text cleaning + reconstruction utilities for the FIR extract.

Covers: header normalization (incl. the tab-mangled ``Arrested Count\\tNo.`` header),
categorical trimming, ``ActSection`` -> act/section parsing, officer rank extraction
from ``IOName``, and a name normalizer used for station/place fuzzy matching.
"""
from __future__ import annotations

import re
import unicodedata

# ---------------------------------------------------------------------------
# Header normalization
# ---------------------------------------------------------------------------
# Map of *normalized* raw header (BOM stripped, tabs/newlines -> space,
# whitespace collapsed) -> clean snake_case name used throughout the pipeline.
_HEADER_MAP = {
    "District_Name": "district_name",
    "UnitName": "unit_name",
    "FIR_YEAR": "year",
    "FIR_MONTH": "month",
    "Offence_Duration": "offence_duration",
    "FIR_Day": "day",
    "FIR Type": "gravity_raw",          # Heinous / Non Heinous
    "FIR_Stage": "status_raw",          # case status
    "Complaint_Mode": "complaint_mode",
    "CrimeGroup_Name": "major_head",    # major head (crime_head)
    "CrimeHead_Name": "sub_head",       # sub head (crime_subhead)
    "Latitude": "latitude",
    "Longitude": "longitude",
    "ActSection": "act_section",
    "IOName": "io_name",
    "KGID": "kgid",
    "Internal_IO": "internal_io",
    "Place of Offence": "place_of_offence",
    "Distance from PS": "distance_from_ps",
    "Beat_Name": "beat_name",
    "Village_Area_Name": "village_area",
    "Male": "v_male",
    "Female": "v_female",
    "Boy": "v_boy",
    "Girl": "v_girl",
    "Age 0": "age_0",
    "VICTIM COUNT": "victim_count",
    "Accused Count": "accused_count",
    "Arrested Male": "arrested_male",
    "Arrested Female": "arrested_female",
    "Arrested Count No.": "arrested_count",   # raw header has an embedded TAB
    "Accused_ChargeSheeted Count": "chargesheeted_count",
    "Conviction Count": "conviction_count",
    "Unit_ID": "unit_id",
}


def _norm_header(h: str) -> str:
    h = h.replace("\ufeff", "")                 # strip UTF-8 BOM if present
    h = h.replace("\t", " ").replace("\n", " ")  # fix the tab-mangled header
    return re.sub(r"\s+", " ", h).strip()


def build_rename_map(raw_headers) -> dict:
    """Return {raw_header_as_read: clean_name} for a list of raw headers.

    Raises if any header is unrecognized so schema drift is caught loudly.
    """
    rename, unknown = {}, []
    for raw in raw_headers:
        key = _norm_header(raw)
        if key in _HEADER_MAP:
            rename[raw] = _HEADER_MAP[key]
        else:
            unknown.append(raw)
    if unknown:
        raise ValueError(f"Unrecognized FIR headers (schema drift?): {unknown!r}")
    return rename


CLEAN_COLUMNS = list(_HEADER_MAP.values())


# ---------------------------------------------------------------------------
# Categorical cleaning
# ---------------------------------------------------------------------------
def clean_cat(s) -> str:
    """Trim, collapse internal whitespace. Fixes ' CYBER CRIME', 'COMMUNAL   '."""
    if s is None:
        return ""
    return re.sub(r"\s+", " ", str(s)).strip()


def normalize_status(raw: str) -> str:
    """Collapse the long 'Transfered :UI( <circle> )' tail into one status."""
    s = clean_cat(raw)
    if not s:
        return "Unknown"
    if s.lower().startswith("transfered") or s.lower().startswith("transferred"):
        return "Transferred"
    return s


def normalize_gravity(raw: str) -> str:
    s = clean_cat(raw).lower()
    if s.startswith("heinous"):
        return "Heinous"
    if "non" in s and "heinous" in s:
        return "Non-Heinous"
    return clean_cat(raw) or "Unknown"


# ---------------------------------------------------------------------------
# ActSection parsing:  "<ACT NAME> U/s: <sec,sec> <ACT NAME> U/s: <sec> ..."
# ---------------------------------------------------------------------------
# A leading section list = comma/space separated tokens like 279 , 304(A) , 3(1) , 134(a&b)
_LEADING_SECTIONS = re.compile(
    r"^\s*((?:\d+[A-Za-z]?(?:\([^)]*\))?[,\s]*)+)"
)
_SPLIT_US = re.compile(r"U/[sS]\s*:")


def parse_act_section(raw: str):
    """Parse an ActSection string.

    Returns (first_act, first_section, acts, section_pairs) where
    ``acts`` is the ordered list of distinct act names and ``section_pairs`` is a
    list of (act, section) tuples. Robust to sub-parts like ``304(A)``/``134(a&b)``.
    """
    text = clean_cat(raw)
    if not text:
        return "", "", [], []
    segments = _SPLIT_US.split(text)
    if len(segments) == 1:
        # No "U/s:" delimiter -> treat whole string as an act name.
        act = clean_cat(segments[0])
        return act, "", ([act] if act else []), []

    acts = []
    first = clean_cat(segments[0]).rstrip(",")
    if first:
        acts.append(first)
    # trailing act name inside each middle segment (after its leading section list)
    for seg in segments[1:-1]:
        m = _LEADING_SECTIONS.match(seg)
        tail = seg[m.end():] if m else seg
        act = clean_cat(tail).rstrip(",")
        if act:
            acts.append(act)

    # sections: leading list of each segment after the first, paired with its act
    section_pairs = []
    for i, seg in enumerate(segments[1:]):
        m = _LEADING_SECTIONS.match(seg)
        sec_blob = m.group(1) if m else ""
        act_for = acts[i] if i < len(acts) else (acts[-1] if acts else "")
        for tok in re.split(r"[,\s]+", sec_blob.strip()):
            tok = tok.strip().rstrip(",")
            if tok:
                section_pairs.append((act_for, tok))

    first_act = acts[0] if acts else ""
    first_section = section_pairs[0][1] if section_pairs else ""
    # de-dupe acts preserving order
    seen, uacts = set(), []
    for a in acts:
        if a not in seen:
            seen.add(a)
            uacts.append(a)
    return first_act, first_section, uacts, section_pairs


# ---------------------------------------------------------------------------
# Officer rank from IOName, e.g. "R S BIRADAR   (PI)" -> "PI"
# ---------------------------------------------------------------------------
_RANK_RE = re.compile(r"\(([^)]+)\)\s*$")
# canonical rank code -> full label (documented; extend as needed)
RANK_LABELS = {
    "PC": "Police Constable", "HC": "Head Constable", "ASI": "Assistant Sub-Inspector",
    "PSI": "Police Sub-Inspector", "SI": "Sub-Inspector", "PI": "Police Inspector",
    "CPI": "Circle Police Inspector", "DYSP": "Deputy Superintendent of Police",
    "ACP": "Assistant Commissioner of Police", "DCP": "Deputy Commissioner of Police",
    "SP": "Superintendent of Police", "ADGP": "Additional Director General of Police",
}


def extract_rank(io_name: str):
    """Return (rank_code, officer_name) from an IOName string."""
    s = clean_cat(io_name)
    if not s:
        return "", ""
    m = _RANK_RE.search(s)
    if not m:
        return "", s
    rank = m.group(1).strip().upper().replace(".", "").replace(" ", "")
    name = clean_cat(s[: m.start()])
    return rank, name


# ---------------------------------------------------------------------------
# Name normalizer for station / place matching
# ---------------------------------------------------------------------------
_PS_SUFFIX = re.compile(r"\b(POLICE STATION|P\.?S\.?|PS)\b")
_NONALNUM = re.compile(r"[^A-Z0-9 ]")
_MULTISPACE = re.compile(r"\s+")


def norm_name(s: str, drop_ps: bool = True) -> str:
    """Uppercase, strip accents/punctuation, optionally drop PS suffix words."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    s = s.upper()
    s = _NONALNUM.sub(" ", s)
    if drop_ps:
        s = _PS_SUFFIX.sub(" ", s)
    return _MULTISPACE.sub(" ", s).strip()
