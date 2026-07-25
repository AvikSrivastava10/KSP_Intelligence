"""SYNTHETIC person/relationship demo layer — every record fabricated, every record labelled.

WHY THIS EXISTS (decision log 2026-07-25): suspect<->victim mapping and repeat-offender tracking
are impossible on the real extract — person identities are confidential under Indian law and the
data carries only aggregate counts. The user explicitly chose (AskUserQuestion) to demo the
capability with a CLEARLY-LABELLED synthetic layer + a real PPRL linkage engine, reversing the
earlier blanket "no fake data" call under strict guardrails:

  GUARDRAILS (enforced, not aspirational)
  1. Separate data plane: every table is `syn_*`-prefixed; every id starts "SYN-".
  2. Every API payload carrying this data is data_class="synthetic"; the UI shows a permanent
     SYNTHETIC banner. Jest tests assert both.
  3. NEVER used to train or validate any predictive model, and never mixed into any real table.
  4. The SHAPE is real, the PEOPLE are not: case volumes are sampled from the real
     district x year x crime-head distribution (agg_district_month), group sizes follow the
     legal definition where one exists (dacoity = 5+ offenders, IPC 391), and the repeat-offender
     concentration follows the well-established criminological finding that a small share of
     offenders accounts for a disproportionate share of property crime. The exact parameters
     below are DEMO ASSUMPTIONS, documented, not measurements.

  DUAL PURPOSE: each person's case-appearances are emitted with realistic recording noise
  (initials, transliteration variants, missing father's name, age drift). Because the true
  person_id is known, this doubles as GROUND TRUTH for validating the real PPRL linkage engine
  (ml/person_linkage.py) with honest precision/recall — the engine metric is real even though
  the people are not.

Outputs -> ml/out/
  syn_persons.csv           person_id, name, gender, age, home_district, is_repeat_offender, n_cases
  syn_cases.csv             case_id, district, year, crime_head
  syn_person_case.csv       appearance-level records incl. name_as_recorded (linkage input)
  syn_network_edges.csv     person<->person edges (co_accused / accused_victim)
  syn_offender_profiles.csv repeat offenders: cases, districts touched, MO summary

Run:  python ml/synthetic_persons.py     (deterministic, seed=7)
"""
from __future__ import annotations

import os
import random

import numpy as np
import pandas as pd
from faker import Faker

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IN_DIR = os.path.join(ROOT, "etl", "out")
OUT_DIR = os.path.join(ROOT, "ml", "out")

SEED = 7
N_CASES = 1500
DISTRICTS = ["Bengaluru Urban", "Mysuru", "Belagavi", "Tumakuru", "Kalaburagi"]
YEARS = [2019, 2020, 2021, 2022, 2023]
# crime heads chosen for the demo story; (min,max) co-accused per case.
# Dacoity is 5+ BY LEGAL DEFINITION (IPC s.391) — the demo honours that.
HEADS = {
    "THEFT": (1, 2),
    "BURGLARY - NIGHT": (1, 3),
    "ROBBERY": (2, 4),
    "DACOITY": (5, 7),
    "CHEATING": (1, 2),
    "MURDER": (1, 3),
}
VICTIMS_PER_CASE = {"THEFT": (1, 1), "BURGLARY - NIGHT": (1, 2), "ROBBERY": (1, 2),
                    "DACOITY": (1, 4), "CHEATING": (1, 3), "MURDER": (1, 2)}
# Demo assumptions (documented): ~8% of offenders are repeaters; repeaters draw 3-8 cases;
# ~35% of repeaters offend across more than one district ("across jurisdictions" per the PS).
REPEAT_SHARE = 0.08
REPEAT_CASES = (3, 8)
CROSS_DISTRICT_SHARE = 0.35


def sample_case_frame(rng):
    """Sample N_CASES from the REAL district x year x head distribution (shape real, cases not)."""
    dm = pd.read_csv(os.path.join(IN_DIR, "agg_district_month.csv"))
    dim = pd.read_csv(os.path.join(IN_DIR, "dim_district.csv"), dtype=str).fillna("")
    geo = dim[dim["is_geographic"].str.lower() == "true"]
    parent = {r["canonical_name"]: (r["parent_district"] or r["canonical_name"])
              for _, r in geo.iterrows()}
    dm = dm[dm["canonical_name"].isin(parent)].copy()
    dm["district"] = dm["canonical_name"].map(parent)
    pool = dm[(dm["district"].isin(DISTRICTS)) & (dm["year"].isin(YEARS))
              & (dm["major_head"].isin(HEADS))]
    g = pool.groupby(["district", "year", "major_head"])["count"].sum().reset_index()
    p = g["count"] / g["count"].sum()
    picks = rng.choice(len(g), size=N_CASES, p=p)
    rows = [{"case_id": f"SYN-C-{i:05d}",
             "district": g.iloc[k]["district"],
             "year": int(g.iloc[k]["year"]),
             "crime_head": g.iloc[k]["major_head"]} for i, k in enumerate(picks)]
    return pd.DataFrame(rows)


def perturb_name(fake, rng, full_name, father):
    """How the same person's name realistically varies across FIR records."""
    parts = full_name.split()
    style = rng.random()
    if style < 0.25 and len(parts) >= 2:                       # first-name initial: "R. Kumar"
        name = f"{parts[0][0]}. {' '.join(parts[1:])}"
    elif style < 0.40:                                          # transliteration variants
        name = (full_name.replace("v", "w").replace("V", "W")
                if rng.random() < 0.5 else full_name.replace("ee", "i"))
    elif style < 0.50 and len(parts) >= 2:                      # parts swapped
        name = f"{parts[-1]} {' '.join(parts[:-1])}"
    else:
        name = full_name
    father_rec = father if rng.random() > 0.30 else ""          # father's name missing 30%
    return name.upper(), father_rec.upper()


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    rng = np.random.default_rng(SEED)
    random.seed(SEED)
    fake = Faker("en_IN")
    Faker.seed(SEED)

    cases = sample_case_frame(rng)

    # ---- offender pool ----
    # rough sizing: total accused slots / average cases per offender
    slots = int(sum(rng.integers(lo, hi + 1) for lo, hi in
                    (HEADS[h] for h in cases["crime_head"])))
    n_offenders = max(400, int(slots / (1 + REPEAT_SHARE * (np.mean(REPEAT_CASES) - 1))))
    offenders = []
    for i in range(n_offenders):
        gender = "M" if rng.random() < 0.86 else "F"
        name = fake.name_male() if gender == "M" else fake.name_female()
        offenders.append({
            "person_id": f"SYN-P-{i:05d}",
            "name": name, "father_name": fake.name_male(),
            "gender": gender, "age": int(rng.integers(18, 55)),
            "home_district": DISTRICTS[int(rng.integers(0, len(DISTRICTS)))],
            "is_repeat_offender": rng.random() < REPEAT_SHARE,
        })
    repeaters = [o for o in offenders if o["is_repeat_offender"]]
    singles = [o for o in offenders if not o["is_repeat_offender"]]
    for o in repeaters:
        o["target_cases"] = int(rng.integers(*REPEAT_CASES))
        o["cross_district"] = rng.random() < CROSS_DISTRICT_SHARE

    # ---- assign accused to cases (repeaters preferentially within their home district
    #      unless flagged cross-district — that is the "across jurisdictions" story) ----
    appearances = []          # person-case rows
    case_accused = {}         # case_id -> [person_id]
    single_iter = iter(rng.permutation(len(singles)))
    rep_budget = {o["person_id"]: o["target_cases"] for o in repeaters}

    for _, c in cases.iterrows():
        lo, hi = HEADS[c["crime_head"]]
        k = int(rng.integers(lo, hi + 1))
        chosen = []
        # try to seat eligible repeaters first
        elig = [o for o in repeaters if rep_budget[o["person_id"]] > 0
                and (o["cross_district"] or o["home_district"] == c["district"])]
        rng.shuffle(elig)
        for o in elig[: max(1, k // 2)]:
            chosen.append(o)
            rep_budget[o["person_id"]] -= 1
            if len(chosen) >= k:
                break
        while len(chosen) < k:
            try:
                o = singles[next(single_iter)]
            except StopIteration:
                o = singles[int(rng.integers(0, len(singles)))]
            if o not in chosen:
                chosen.append(o)
        case_accused[c["case_id"]] = [o["person_id"] for o in chosen]
        for o in chosen:
            nm, fn = perturb_name(fake, rng, o["name"], o["father_name"])
            appearances.append({
                "case_id": c["case_id"], "person_id": o["person_id"], "role": "accused",
                "name_as_recorded": nm, "father_name_as_recorded": fn,
                "age_as_recorded": o["age"] + int(rng.integers(-2, 3)),
                "gender": o["gender"], "district": c["district"], "year": c["year"],
            })

    # ---- victims (fresh persons; overlap with the offender pool is not modelled) ----
    victims = []
    vid = 0
    for _, c in cases.iterrows():
        lo, hi = VICTIMS_PER_CASE[c["crime_head"]]
        for _ in range(int(rng.integers(lo, hi + 1))):
            gender = "M" if rng.random() < 0.55 else "F"
            name = fake.name_male() if gender == "M" else fake.name_female()
            p = {"person_id": f"SYN-V-{vid:05d}", "name": name,
                 "father_name": fake.name_male(), "gender": gender,
                 "age": int(rng.integers(16, 75)), "home_district": c["district"],
                 "is_repeat_offender": False}
            victims.append(p)
            vid += 1
            nm, fn = perturb_name(fake, rng, p["name"], p["father_name"])
            appearances.append({
                "case_id": c["case_id"], "person_id": p["person_id"], "role": "victim",
                "name_as_recorded": nm, "father_name_as_recorded": fn,
                "age_as_recorded": p["age"] + int(rng.integers(-1, 2)),
                "gender": gender, "district": c["district"], "year": c["year"],
            })

    app = pd.DataFrame(appearances)
    used_ids = set(app["person_id"])
    persons = pd.DataFrame([o for o in offenders if o["person_id"] in used_ids] +
                           [v for v in victims if v["person_id"] in used_ids])
    n_cases_by_person = app.groupby("person_id")["case_id"].nunique()
    persons["n_cases"] = persons["person_id"].map(n_cases_by_person).fillna(0).astype(int)
    persons = persons.drop(columns=["target_cases", "cross_district"], errors="ignore")

    # ---- person<->person edges ----
    edges = []
    for cid, acc in case_accused.items():
        for i in range(len(acc)):
            for j in range(i + 1, len(acc)):
                edges.append({"src": acc[i], "dst": acc[j], "edge_type": "co_accused", "case_id": cid})
    for cid, grp in app.groupby("case_id"):
        accs = grp[grp["role"] == "accused"]["person_id"].tolist()
        vics = grp[grp["role"] == "victim"]["person_id"].tolist()
        for a in accs:
            for v in vics:
                edges.append({"src": a, "dst": v, "edge_type": "accused_victim", "case_id": cid})
    edf = pd.DataFrame(edges)

    # ---- repeat-offender profiles (the PS's "visual profiles... MO across jurisdictions") ----
    profs = []
    for _, p in persons[persons["is_repeat_offender"] & (persons["n_cases"] >= 2)].iterrows():
        mine = app[(app["person_id"] == p["person_id"]) & (app["role"] == "accused")]
        case_ids = mine["case_id"].tolist()
        heads = cases[cases["case_id"].isin(case_ids)]["crime_head"]
        dists = sorted(mine["district"].unique().tolist())
        profs.append({
            "person_id": p["person_id"], "name": p["name"], "gender": p["gender"],
            "age": p["age"], "n_cases": len(case_ids),
            "districts": "; ".join(dists), "n_districts": len(dists),
            "mo_summary": "; ".join(f"{h} x{n}" for h, n in heads.value_counts().items()),
            "case_ids": "; ".join(case_ids),
            "years": f"{mine['year'].min()}-{mine['year'].max()}",
        })
    pf = pd.DataFrame(profs).sort_values(["n_districts", "n_cases"], ascending=False)

    persons.to_csv(os.path.join(OUT_DIR, "syn_persons.csv"), index=False)
    cases.to_csv(os.path.join(OUT_DIR, "syn_cases.csv"), index=False)
    app.to_csv(os.path.join(OUT_DIR, "syn_person_case.csv"), index=False)
    edf.to_csv(os.path.join(OUT_DIR, "syn_network_edges.csv"), index=False)
    pf.to_csv(os.path.join(OUT_DIR, "syn_offender_profiles.csv"), index=False)

    print("=" * 70)
    print("SYNTHETIC PERSON DEMO LAYER  (data_class=synthetic, ids SYN-*)")
    print("=" * 70)
    print(f"cases        : {len(cases):,} sampled from the REAL district x year x head mix")
    print(f"persons      : {len(persons):,} ({int(persons['is_repeat_offender'].sum())} repeat offenders)")
    print(f"appearances  : {len(app):,}  |  edges: {len(edf):,} "
          f"({(edf['edge_type']=='co_accused').sum():,} co-accused / "
          f"{(edf['edge_type']=='accused_victim').sum():,} accused-victim)")
    cross = pf[pf["n_districts"] > 1]
    print(f"repeat profiles: {len(pf):,}  ({len(cross):,} span multiple districts)")
    if len(cross):
        top = cross.iloc[0]
        print(f"  e.g. {top['person_id']}: {top['n_cases']} cases across {top['districts']} ({top['mo_summary']})")
    print("EVERY record here is fabricated; only the DISTRIBUTION SHAPE comes from real data.")


if __name__ == "__main__":
    main()
