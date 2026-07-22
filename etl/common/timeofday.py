"""Modeled (estimated) time-of-day layer.

The FIR extract has NO clock time (only Year/Month/Day), so true time-of-day is
unrecoverable. We construct an *estimated* time-of-day bucket per incident,
conditioned on crime type, using two clearly-separated methods:

  1. ``category_encoded`` -- REAL signal already embedded in the crime classification.
     Some major heads encode day/night directly, e.g. "BURGLARY - NIGHT" /
     "BURGLARY - DAY", "HOUSE BREAKING BY NIGHT". Used verbatim.
  2. ``criminological_prior`` -- documented per-category priors for the rest
     (e.g. road accidents skew to evening/commute, riots/affray to evening,
     robbery/dacoity to night). These are illustrative assumptions, not observations.
  3. ``default_distributed`` -- no reliable prior -> "Distributed".

HONESTY: every output carries data_class="modeled" and the method used. This layer is
for the illustrative time x location view ONLY. It is NEVER used to train real models.

Buckets: Night, Daytime, Morning, Afternoon, Evening, Distributed.
"""
from __future__ import annotations

BUCKETS = ["Night", "Daytime", "Morning", "Afternoon", "Evening", "Distributed"]

# Keyword (substring, matched against the cleaned UPPER major head) -> bucket.
# Order matters: first match wins. Rationale noted inline.
_PRIORS = [
    # --- REAL signal encoded in the category (method = category_encoded) ---
    ("BURGLARY - NIGHT", "Night", "category_encoded"),
    ("BURGLARY - DAY", "Daytime", "category_encoded"),
    ("BY NIGHT", "Night", "category_encoded"),
    ("BY DAY", "Daytime", "category_encoded"),
    # --- criminological priors (method = criminological_prior) ---
    ("ROBBERY", "Night", "criminological_prior"),        # street robbery skews night
    ("DACOITY", "Night", "criminological_prior"),
    ("BURGLARY", "Night", "criminological_prior"),       # unspecified burglary -> night lean
    ("HOUSE BREAK", "Night", "criminological_prior"),
    ("MURDER", "Night", "criminological_prior"),          # incl. ATTEMPT TO MURDER
    ("MOTOR VEHICLE ACCIDENT", "Evening", "criminological_prior"),  # commute/night driving
    ("NEGLIGENT", "Evening", "criminological_prior"),
    ("RIOT", "Evening", "criminological_prior"),
    ("AFFRAY", "Evening", "criminological_prior"),
    ("UNLAWFUL ASSEMBLY", "Evening", "criminological_prior"),
    ("PUBLIC SAFETY", "Evening", "criminological_prior"),
    ("PUBLIC NUISANCE", "Evening", "criminological_prior"),
    ("NARCOTIC", "Night", "criminological_prior"),
    ("EXCISE", "Evening", "criminological_prior"),
    ("KARNATAKA POLICE ACT", "Evening", "criminological_prior"),  # gambling/liquor/order
    ("GAMBLING", "Evening", "criminological_prior"),
    ("COTPA", "Evening", "criminological_prior"),
    ("IMMORAL TRAFFIC", "Night", "criminological_prior"),
    ("THEFT", "Afternoon", "criminological_prior"),       # opportunistic, daytime lean
    ("TRESPASS", "Afternoon", "criminological_prior"),
]

_DEFAULT = ("Distributed", "default_distributed")


def assign(major_head_clean: str):
    """Return (bucket, method) for a cleaned major head string."""
    h = (major_head_clean or "").upper()
    if not h:
        return _DEFAULT[0], _DEFAULT[1]
    for kw, bucket, method in _PRIORS:
        if kw in h:
            return bucket, method
    return _DEFAULT[0], _DEFAULT[1]
