# Catalyst Data Store Schema — KSP Crime Intelligence Platform

> **Phase 0 deliverable.** Defines the Zoho Catalyst Data Store tables, modelled on the
> official KSP ER diagram (`datasets/Police_FIR_ER_Diagram.pdf`, ~27 normalized tables).
> Actual table creation + loading happens in **Phase 1** (`load_datastore.py` is a stub).
>
> The ER diagram is the **target/contract** schema. Our FIR extract is a **de-identified,
> denormalized** slice of it, so we populate the **subset we can** and keep the rest
> **designed-only** (present for fidelity + future real SCRB data + an anonymization layer).
>
> **2026-07-26 — this claim is now actually true, and previously was not.** A conformance audit
> found that none of the 28 ER entity names and none of its column names appeared anywhere in the
> generated schema; the "designed-only" tables described below existed in prose only, so nothing
> could ever have been loaded into them; `case_master` was described as materialized when it did
> not exist; and the surrogate `case_id` the whole mapping depends on had never been implemented.
> The contract is now **machine-readable** — see [§D](#d-er-contract-machine-readable) — with all
> 28 entities declared under their exact ER names in `datastore_schema.json`
> (`er_contract_tables`), full detail in `etl/out/er_conformance.json`, served at `GET /schema/er`
> and rendered on the Data Quality workspace. Source of truth: **`etl/er_schema.py`**.

## Data planes

| Plane | Meaning | `data_class` |
|---|---|---|
| **REAL** | Populated from the 1.67M-row FIR extract + verified external references | `real` |
| **MODELED** | Estimated, clearly labelled, never used to train models | `modeled` |
| **SYNTHETIC** | Generated (Phase 5), matched to real marginals, separate plane, always labelled | `synthetic` |
| **DESIGNED-ONLY** | In the ER diagram but NOT populatable from our data (confidential / absent) | — |

Every API payload carries a `data_class` field so the frontend can label panels automatically.

---

## A. REAL plane — Catalyst Data Store tables (populated)

The MVP API serves **precomputed** tables (the P2 precompute pattern): the heavy Python
pipeline emits compact aggregates + reference dimensions into `etl/out/`; those load into
the Data Store (and bundle as CSV fallback). Types use Catalyst Data Store column types
(`varchar`, `int`, `bigint`, `double`, `boolean`, `date`, `datetime`, `text`).

### A.1 Serving / aggregate tables (→ `etl/out/*.csv`)

**`agg_district_month`** — district × month × major-head series (forecasting base)
| Column | Type | Notes |
|---|---|---|
| canonical_name | varchar | FIR unit canonical name (→ `dim_district`) |
| year | int | 2016–2024 (2024 partial — exclude from training) |
| month | int | 1–12 |
| major_head | varchar | crime major head (→ `dim_crime_head`) |
| count | int | incident count |

**`agg_hotspots`** — spatiotemporal grid (~1.1 km cells); heat surface + emerging-hotspot base
| Column | Type | Notes |
|---|---|---|
| lat | double | latitude rounded to 2 dp (~1.1 km) |
| lng | double | longitude rounded to 2 dp |
| geo_precision | varchar | `point` \| `station` \| `place` \| `district` (filter to point/station for honest hotspots) |
| year | int | |
| count | int | |

**`agg_unit`** — per police-station rollup + mean coordinates
| Column | Type | Notes |
|---|---|---|
| unit_name | varchar | police station / unit |
| canonical_name | varchar | parent FIR unit |
| parent_district | varchar | geographic district |
| kgis_code | varchar | 2021 KGIS district code |
| count | int | |
| n_with_coord | int | rows with a resolved coordinate |
| mean_lat / mean_lng | double | mean of resolved coords |

**`agg_outcomes`** — per-district case-outcome analytics (Model 6 base)
| Column | Type | Notes |
|---|---|---|
| canonical_name | varchar | |
| total_cases | int | |
| heinous_cases | int | from gravity |
| victims | int | sum of Male+Female+Boy+Girl (a total; sex never used as a feature) |
| accused / arrested / chargesheeted / convicted | int | from FIR count columns |
| arrest_rate / chargesheet_rate / conviction_rate / detection_rate | double | derived; may exceed 1 for the 4 non-geographic special units (inconsistent source counts) |

**`agg_case_status`** — district × normalized status (long)
| Column | Type | Notes |
|---|---|---|
| canonical_name | varchar | |
| status | varchar | 13 statuses; ~300 `Transfered :UI(...)` variants collapsed → `Transferred` |
| count | int | |

**`agg_socioeconomic`** — 2011 Census join, per-capita (Module B)
| Column | Type | Notes |
|---|---|---|
| census_code_2011 | varchar | 2011 district census code |
| district_2011_name | varchar | 2011 census name (old names, e.g. Gulbarga) |
| population_2011 | bigint | |
| total_crimes_all_years | int | Vijayanagara folded into Ballari (565); specials excluded |
| crimes_per_100k | double | |
| literacy_rate / sc_share / st_share | double | area-level only (never individual profiling) |
| sex_ratio_f_per_1000m | double | descriptive only |

**`agg_timeofday`** — MODELED plane (`data_class = modeled`)
| Column | Type | Notes |
|---|---|---|
| canonical_name | varchar | |
| major_head | varchar | |
| modeled_time_of_day | varchar | Night/Daytime/Morning/Afternoon/Evening/Distributed |
| method | varchar | `category_encoded` (real signal e.g. BURGLARY-NIGHT) \| `criminological_prior` \| `default_distributed` |
| count | int | **Illustrative only — never trains real models.** |

**`entity_edges`** — REAL within-case co-occurrence graph (feeds Phase 5 Module A: Louvain + association rules)
| Column | Type | Notes |
|---|---|---|
| src_type | varchar | `crime_head` \| `act` |
| src | varchar | source entity |
| dst_type | varchar | `act` \| `district` |
| dst | varchar | target entity |
| weight | int | co-occurrence count within cases (edge sets: crime_head↔act, act↔act, crime_head↔district; low-weight tail trimmed) |

### A.2 Reference dimensions (reconstructed from distinct values)

| Table (`etl/out/`) | Columns | Maps to ER table |
|---|---|---|
| `dim_district` | canonical_name, kgis_code, lgd_code, census_code_2011, is_geographic, parent_district | `District` (+ join keys to boundaries/census/LGD) |
| `dim_crime_head` | major_head, count | `CrimeHead.CrimeGroupName` |
| `dim_crime_subhead` | major_head, sub_head, count | `CrimeSubHead.CrimeHeadName` |
| `dim_case_status` | status, count | `CaseStatusMaster` |
| `dim_gravity` | gravity, count | `GravityOffence` |
| `dim_complaint_mode` | complaint_mode, count | (not in ER — extract-only) |
| `dim_act` | act, count | `Act` |
| `dim_section` | act, section, count | `Section` — **not** `ActSectionAssociation` (see below) |
| `dim_rank` | rank, count | `Rank` (derived from `IOName` suffix) |

> **Corrected mapping.** An earlier version of this table mapped `ActSectionAssociation` to
> `dim_section`. That was wrong: `dim_section` is a *reference list* of distinct act-section pairs
> with usage counts, which is the ER's `Section`. `ActSectionAssociation` is **per case and
> one-to-many**. It had been collapsed to a single `first_act`/`first_section` in the modeling
> table, so a case citing three acts kept one — measured impact: **357,119 cases (21.3%) cite two
> or more acts**. It is now materialized at true grain (§A.4).

### A.3 Normalized core (subset of ER, materialized in Phase 1)

**`case_master`** — one row per FIR, **materialized by `etl/build_er_core.py`** →
`etl/out/case_master.parquet`, **1,674,734 rows, reconciling exactly to the source extract**.

> **Previously this section overclaimed.** It said "Materialized case-level in Phase 1 (from the
> same `ingest_fir.py`)". No `case_master` existed anywhere — not in `etl/out/`, not in the Data
> Store schema — and the deterministic surrogate `case_id` it depended on had never been written
> (`grep case_id etl/**/*.py` returned nothing). Both now exist.

`CaseMasterID` is `CM-` + a 9-digit positional ordinal — deterministic for a fixed source file and
obviously artificial. **`CrimeNo` and `CaseNo` are declared and left NULL on purpose**: the ER
documents their exact composition, so conforming values could be synthesised and would be
indistinguishable from real KSP crime numbers. A fabricated official-looking identifier is a worse
outcome than an honest null.

Not bundled with the function: at 1.67M rows it is far too large for the CSV-fallback pattern, and
the API is aggregate-only by design. It exists so the ER contract is genuinely loadable, not to be
served per case.

| ER `CaseMaster` column | Our source | Status |
|---|---|---|
| CaseMasterID (PK) | **surrogate `case_id`** (deterministic) | reconstructed — no FIR id in extract |
| CrimeNo / CaseNo | — | absent from extract |
| CrimeRegisteredDate | FIR_YEAR + FIR_MONTH + FIR_Day (day-level) | partial (no time) |
| PoliceStationID (FK Unit) | UnitName / Unit_ID | populated |
| CaseCategoryID | — | absent (extract is FIR-only) |
| GravityOffenceID | `FIR Type` (Heinous/Non-Heinous) | populated |
| CrimeMajorHeadID | `CrimeGroup_Name` | populated |
| CrimeMinorHeadID | `CrimeHead_Name` | populated |
| CaseStatusID | `FIR_Stage` | populated (normalized) |
| CourtID | — | designed-only |
| PolicePersonID (FK Employee) | `IOName` + `KGID` | partial (name+rank+KGID) |
| latitude / longitude | Latitude/Longitude (30%) + geocoded fallback | populated + `geo_precision` |
| **IncidentFromDate (DATETIME)** | — | **absent → `modeled_time_of_day`** (MODELED) |
| IncidentToDate / InfoReceivedPSDate | — | absent |
| **BriefFacts (narrative)** | — | absent (no NLP possible) |

Added columns (reconstructed): `case_id`, `canonical_name`, `parent_district`,
`kgis_code`, `geo_precision`, `modeled_time_of_day`, `dow`, `season`, `quarter`,
`is_2024_partial`.

**`unit`** (police stations) and **`district`** dimensions back the drill-down + maps
(see `dim_district`, `agg_unit`, and the KGIS boundary/station references).

---

## B. SYNTHETIC plane (Phase 5 — labelled, separate)

Never mixed with real analytics; never trains real models; persistent UI banner; every row
`is_synthetic = true`.

| Table | Purpose |
|---|---|
| `syn_person` | synthetic suspects/victims; demographic buckets matched to real aggregate marginals |
| `syn_case_person` | links synthetic persons to cases |
| `syn_offender_network` | edges: co-offending / repeat-offender / association / organized-crime clusters |

Real complement (on real data): **`entity_edges`** — within-case co-occurrence graph of
crime-type ↔ act ↔ district (produced in Phase 0, see §A.1); Phase 5 adds Louvain communities +
association rules on top.

---

### A.4 `act_section_association` — the ER's true one-to-many act/section link

Materialized by `etl/build_er_core.py` → `etl/out/act_section_association.parquet`,
**4,928,708 rows** (2.94 act-sections per case). ER-faithful columns: `CaseMasterID`, `ActID`,
`SectionID`, `ActOrderID`, `SectionOrderID`. Gitignored and not bundled, same reasoning as
`case_master`.

This is the fix for the mapping error noted in §A.2 — it is the first time the platform holds the
per-case act-section relationship at full grain rather than a single first-act.

---

## C. DESIGNED-ONLY (in ER, NOT populated) — declared, empty, and loadable

**These are now real table definitions, not prose.** All 28 ER entities — including every one
below — are emitted into `datastore_schema.json` under `er_contract_tables` with their exact ER
names and column names, so real SCRB data could be loaded without a translation layer. Each carries
a named blocker rather than being silently omitted.

| ER table | Why not populated |
|---|---|
| `ComplainantDetails`, `Victim`, `Accused` | **person identities — confidential under Indian law**; extract has only aggregate counts. Note: even the source has **no cross-case person key** (`AccusedMasterID` per-case, `PersonID`=A1/A2 within-case) → repeat-offender tracking needs fuzzy matching even with full access. |
| `ArrestSurrender`, `inv_arrestsurrenderaccused` | person + arrest-event level; only aggregate arrest counts in extract |
| `Court`, `ChargesheetDetails` | court/chargesheet detail absent (only `FIR_Stage` status + chargesheet counts) |
| `CasteMaster`, `ReligionMaster`, `OccupationMaster` | **protected attributes — never used as features** (fairness guardrail) |
| `Inv_OccuranceTime` | holds the real time-of-day; absent → we model it (MODELED, §A.1) |
| `CaseCategory`, `UnitType`, `Designation`, `State` | not distinguishable / single-state in extract |

---

## Reconstruction & guardrail notes

- **Surrogate `CaseMasterID`** — the extract has no FIR identifier; `build_er_core.py` assigns
  `CM-<9-digit positional ordinal>`, deterministic for a fixed source file, so `CaseMaster` has a
  primary key and reconciliation is exact (1,674,734 rows). *This was documented long before it
  was implemented; it exists as of 2026-07-26.*
- **`ActSection` split** → `Act` + `Section` (parses the repeating `<ACT> U/s: <secs>` free text).
- **Reference tables** rebuilt from distinct values; **rank** derived from `IOName` suffixes.
- **Geography** standardized via the canonical `dim_district` (41 FIR units → 31 KGIS polygons;
  4 non-geographic units — CID, Coastal Security, ISD, Karnataka Railways — flagged separately).
- **No protected attributes** (caste/religion/sex/occupation) are used as model features.
- **MODELED** (time-of-day) and **SYNTHETIC** (person network) planes are always labelled and
  never presented as real or used to train real analytics.

---

## D. ER contract (machine-readable)

`etl/er_schema.py` is the single source of truth for the KSP ER diagram. It encodes all **28
entities** with ER-faithful table and column names, per-column provenance
(`populated` / `reconstructed` / `absent`), the 36 declared relationships, and — where we populate
nothing — a named blocker.

Emitted by `python etl/load_datastore.py --schema` into:

| Output | Contents |
|---|---|
| `etl/out/datastore_schema.json` → `tables` | **42 serving tables** — our analytical schema; this is what `--load` populates |
| `etl/out/datastore_schema.json` → `er_contract_tables` | **28 ER entities**, exact ER names, creatable in the console; `--load` never touches them |
| `etl/out/er_conformance.json` | full conformance detail — served at `GET /schema/er` |

The two groups are deliberately **not merged**: one is our analytics schema, the other is KSP's
design. Blurring them into a single list would obscure which is which.

### Conformance at a glance

| Status | Count | Meaning |
|---|---|---|
| `populated` | 1 | every meaningful column populated (`ActSectionAssociation`) |
| `populated_subset` | 10 | some columns populated, remainder declared NULL |
| `designed_only` | 17 | declared and empty, each with a named blocker |

Blockers: `confidential_by_law` (6) · `absent_from_extract` (6) · `protected_attribute` (3) ·
`single_value_in_extract` (2) — 17 in total.

Column-level coverage is **36 of 139 (25.9%)**. That number is deliberately published: it is the
clearest single statement of how much of KSP's own design a de-identified extract can support, and
rounding it up would defeat the purpose of measuring it.

### Declared deviations

Four places where we cannot honour the ER's declared type. Each is recorded in
`er_conformance.json → deviations` rather than hidden by quietly changing the type:
`CaseMaster.CaseMasterID` (INT → varchar surrogate), `Act.ActCode` (code → parsed name),
`CrimeHead.CrimeHeadID` (INT → name), `District.DistrictID` (INT → real external KGIS/LGD/Census
codes, which is what makes the boundary and census joins independently verifiable).

### Naming notes

ER names are reproduced **exactly**, including the document's own inconsistencies
(`CasteMaster.caste_master_id` is snake_case; `ArrestSurrender.ArrestSurrenderStateId` ends `Id`
not `ID`). Tidying either would break a real SCRB load. Four table names — `Act`, `Section`,
`State`, `Rank` — are reserved words in some SQL dialects; they are declared under their true names
with `reserved_word_risk: true` and an `er_`-prefixed `alt_name` available if the console rejects
them.
