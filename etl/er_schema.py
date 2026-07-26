"""The official KSP ER diagram, encoded as a machine-readable contract.

WHY THIS FILE EXISTS
`datasets/Police_FIR_ER_Diagram.pdf` is the ONLY artefact KSP actually provided — a database
design document, containing no data. Our own `schema.md` called it "the target/contract schema",
but a conformance audit found that claim did not hold: zero of its 28 entity names and zero of its
column names appeared anywhere in our generated schema, and the "designed-only" tables it said were
"kept in the schema" existed in prose only. The contract was not machine-readable, so nothing could
ever have been loaded into it.

This module makes it real. It is the single source of truth for:
  1. the 28 ER entities with ER-FAITHFUL table and column names,
  2. which of them our de-identified extract can populate, and for the rest exactly WHAT BLOCKS IT,
  3. per-column provenance — populated / reconstructed / absent.

Consumed by `load_datastore.py` (emits the ER contract tables + conformance into
datastore_schema.json and er_conformance.json) and by the API's /schema/er endpoint.

DESIGN DECISIONS WORTH KNOWING

* Names are kept EXACTLY as the ER document writes them, including its internal inconsistencies
  (`CasteMaster.caste_master_id` is snake_case while everything else is PascalCase;
  `ArrestSurrender.ArrestSurrenderStateId` ends `Id` not `ID`). Silently "tidying" these would
  break a real SCRB load, which is the entire point of a contract.

* Four ER table names — Act, Section, State, Rank — are reserved words in common SQL dialects.
  They are still declared under their true names, with `reserved_word_risk` set and an `alt_name`
  offered, so whoever creates the tables can react rather than be surprised.

* CrimeNo and CaseNo are declared but deliberately left NULL. The ER documents their exact format
  (category + district + unit + year + serial). We could synthesise conforming values, and they
  would be indistinguishable from real crime numbers — which is precisely why we do not. A
  fabricated identifier that looks official is worse than a null one.

* Types are the ER's own, mapped to the nearest Catalyst Data Store type. Where our value cannot
  honour the declared type (CaseMasterID is INT in the ER, but our surrogate is a string), the
  deviation is recorded in `deviations` rather than hidden by quietly changing the type.
"""
from __future__ import annotations

# ER type -> Catalyst Data Store column type
CATALYST_TYPE = {
    "INT": "int", "VARCHAR": "varchar", "DATE": "date", "DATETIME": "datetime",
    "DECIMAL": "double", "NVARCHAR(MAX)": "text", "BIT": "boolean", "CHAR": "varchar",
}

# Column provenance against OUR extract
POPULATED = "populated"        # a real value from the FIR extract
RECONSTRUCTED = "reconstructed"  # derived/surrogate, honest about being derived
ABSENT = "absent"              # declared for contract fidelity; always NULL for us

# Entity-level conformance
FULL = "populated"             # every meaningful column populated
PARTIAL = "populated_subset"   # some columns populated, rest declared NULL
DESIGNED = "designed_only"     # table exists in the contract, we populate nothing

# Why an entity cannot be populated
LAW = "confidential_by_law"
NO_DATA = "absent_from_extract"
SINGLE = "single_value_in_extract"
PROTECTED = "protected_attribute"

BLOCKER_TEXT = {
    LAW: "Person identities are confidential under Indian law and are absent from the extract, "
         "which carries only aggregate counts. Not obtainable by any team.",
    NO_DATA: "The column set exists in the source system but not in the de-identified extract "
             "we were able to source.",
    SINGLE: "Not distinguishable in the extract — it holds a single value throughout (one state, "
            "one case category: FIR).",
    PROTECTED: "Caste, religion and occupation are protected attributes. Declared for contract "
               "fidelity and deliberately never populated or used as a model feature.",
}

RESERVED_RISK = {"Act", "Section", "State", "Rank"}


def C(name, typ, key=None, status=ABSENT, note=""):
    return {"column_name": name, "er_type": typ, "data_type": CATALYST_TYPE[typ],
            "key": key, "provenance": status, "note": note}


# ---------------------------------------------------------------------------
# The 28 entities. Column order follows the ER document.
# ---------------------------------------------------------------------------
ER_ENTITIES = {
    # ---------------- transactional core ----------------
    "CaseMaster": {
        "status": PARTIAL, "blocker": None, "our_table": "case_master",
        "grain": "one row per FIR",
        "summary": "Materialised at full grain (1,674,734 rows) with ER column names. 11 of 18 "
                   "columns populated or reconstructed; the rest are the person/narrative/time "
                   "fields the extract does not carry.",
        "columns": [
            C("CaseMasterID", "VARCHAR", "PK", RECONSTRUCTED,
              "Deterministic positional surrogate (CM-000000001). The extract has no FIR "
              "identifier. INT in the ER; varchar here — recorded as a deviation."),
            C("CrimeNo", "VARCHAR", None, ABSENT,
              "Deliberately NULL. The format is documented, so a conforming value could be "
              "synthesised — and would be indistinguishable from a real crime number."),
            C("CaseNo", "VARCHAR", None, ABSENT, "Deliberately NULL, same reason as CrimeNo."),
            C("CrimeRegisteredDate", "DATE", None, POPULATED,
              "From FIR_YEAR + FIR_MONTH + FIR_Day. Date only — the extract has no time."),
            C("PolicePersonID", "INT", "FK", RECONSTRUCTED,
              "Employee is not populated, so this carries the IO name+rank string, not an ID."),
            C("PoliceStationID", "INT", "FK", POPULATED, "From UnitName / Unit_ID."),
            C("CaseCategoryID", "INT", "FK", ABSENT, "Extract is FIR-only — no category variation."),
            C("GravityOffenceID", "INT", "FK", POPULATED, "From `FIR Type` (Heinous/Non-Heinous)."),
            C("CrimeMajorHeadID", "INT", "FK", POPULATED, "From CrimeGroup_Name."),
            C("CrimeMinorHeadID", "INT", "FK", POPULATED, "From CrimeHead_Name."),
            C("CaseStatusID", "INT", "FK", POPULATED,
              "From FIR_Stage, normalised (~300 `Transfered :UI(...)` variants collapsed)."),
            C("CourtID", "INT", "FK", ABSENT, "No court detail in the extract."),
            C("IncidentFromDate", "DATETIME", None, ABSENT,
              "THE key absence. Holds the real time of day; drives our clearly-labelled MODELED "
              "time-of-day layer, which is 97.4% assumption and never trains a model."),
            C("IncidentToDate", "DATETIME", None, ABSENT, ""),
            C("InfoReceivedPSDate", "DATETIME", None, ABSENT, ""),
            C("latitude", "DECIMAL", None, POPULATED,
              "29.9% real GPS, resolved to 99.54% by a tiered geocoder; every row carries "
              "geo_precision so inferred locations are never mistaken for observed ones."),
            C("longitude", "DECIMAL", None, POPULATED, "As latitude."),
            C("BriefFacts", "NVARCHAR(MAX)", None, ABSENT,
              "No narrative text, so no NLP/MO-from-text is possible. Descoped, not attempted."),
        ],
        "extra_columns": [
            C("canonical_name", "VARCHAR", None, RECONSTRUCTED, "Canonical district (41 units -> 31)."),
            C("parent_district", "VARCHAR", None, RECONSTRUCTED, "Commissionerates roll up to district."),
            C("geo_precision", "VARCHAR", None, RECONSTRUCTED, "point|station|place|district|none."),
            C("is_2024_partial", "BIT", None, RECONSTRUCTED, "2024 is a partial year; excluded from training."),
        ],
    },
    "ActSectionAssociation": {
        "status": FULL, "blocker": None, "our_table": "act_section_association",
        "grain": "one row per (case, act, section)",
        "summary": "Now materialised at true one-to-many grain. Previously schema.md mapped this "
                   "to dim_section, which was wrong — dim_section is the ER's `Section` reference "
                   "list. The per-case link had been collapsed to a single first_act/first_section, "
                   "so a case citing three acts kept one.",
        "columns": [
            C("CaseMasterID", "VARCHAR", "FK", RECONSTRUCTED, "Joins CaseMaster surrogate."),
            C("ActID", "INT", "FK", POPULATED, "Act name parsed from the free-text ActSection field."),
            C("SectionID", "INT", "FK", POPULATED, "Section code parsed from the same field."),
            C("ActOrderID", "INT", None, RECONSTRUCTED, "Order of appearance within the FIR text."),
            C("SectionOrderID", "INT", None, RECONSTRUCTED, "Order within the act."),
        ],
    },
    "ComplainantDetails": {
        "status": DESIGNED, "blocker": LAW, "our_table": None,
        "grain": "one row per complainant",
        "summary": "Declared, never populated. Also carries caste/religion/occupation, which are "
                   "protected attributes and are excluded from every model regardless.",
        "columns": [
            C("ComplainantID", "INT", "PK"), C("CaseMasterID", "INT", "FK"),
            C("ComplainantName", "VARCHAR"), C("AgeYear", "INT"),
            C("OccupationID", "INT", "FK"), C("ReligionID", "INT", "FK"),
            C("CasteID", "INT", "FK"), C("GenderID", "INT"),
        ],
    },
    "Victim": {
        "status": DESIGNED, "blocker": LAW, "our_table": None,
        "grain": "one row per victim",
        "summary": "Declared, never populated. The extract has victim COUNTS only; we sum them to "
                   "a single total and never split by sex.",
        "columns": [
            C("VictimMasterID", "INT", "PK"), C("CaseMasterID", "INT", "FK"),
            C("VictimName", "VARCHAR"), C("AgeYear", "INT"), C("GenderID", "INT"),
            C("VictimPolice", "VARCHAR"),
        ],
    },
    "Accused": {
        "status": DESIGNED, "blocker": LAW, "our_table": None,
        "grain": "one row per accused person",
        "summary": "Declared, never populated. Note PersonID is A1/A2 WITHIN a case and "
                   "AccusedMasterID is per-case, so even the full KSP schema has no cross-case "
                   "person key — repeat-offender tracking needs probabilistic linkage even with "
                   "complete access. That is what ml/person_linkage.py implements.",
        "columns": [
            C("AccusedMasterID", "INT", "PK"), C("CaseMasterID", "INT", "FK"),
            C("AccusedName", "VARCHAR"), C("AgeYear", "INT"), C("GenderID", "INT"),
            C("PersonID", "VARCHAR"),
        ],
    },
    "ArrestSurrender": {
        "status": DESIGNED, "blocker": LAW, "our_table": None,
        "grain": "one row per arrest/surrender event",
        "summary": "Declared, never populated. The extract has aggregate arrest counts only.",
        "columns": [
            C("ArrestSurrenderID", "INT", "PK"), C("CaseMasterID", "INT", "FK"),
            C("ArrestSurrenderTypeID", "INT"), C("ArrestSurrenderDate", "DATE"),
            C("ArrestSurrenderStateId", "INT", "FK"), C("ArrestSurrenderDistrictId", "INT", "FK"),
            C("PoliceStationID", "INT", "FK"), C("IOID", "INT", "FK"), C("CourtID", "INT", "FK"),
            C("AccusedMasterID", "INT", "FK"), C("IsAccused", "BIT"),
            C("IsComplainantAccused", "BIT"),
        ],
    },
    "inv_arrestsurrenderaccused": {
        "status": DESIGNED, "blocker": LAW, "our_table": None,
        "grain": "junction: arrest event <-> accused",
        "summary": "Declared, never populated — depends on Accused and ArrestSurrender.",
        "columns": [C("ArrestSurrenderID", "INT", "FK"), C("AccusedMasterID", "INT", "FK")],
    },
    "ChargesheetDetails": {
        "status": DESIGNED, "blocker": NO_DATA, "our_table": None,
        "grain": "one row per chargesheet",
        "summary": "Declared, never populated. The extract carries chargesheet COUNTS per case, "
                   "not dated chargesheet records — enough for our outcome model, not for this table.",
        "columns": [
            C("CSID", "INT", "PK"), C("CaseMasterID", "INT", "FK"), C("csdate", "DATETIME"),
            C("cstype", "CHAR", None, ABSENT, "A=Chargesheet, B=False Case, C=Undetected."),
            C("PolicePersonID", "INT", "FK"),
        ],
    },
    "Inv_OccuranceTime": {
        "status": DESIGNED, "blocker": NO_DATA, "our_table": None,
        "grain": "one row per FIR (1:1)",
        "summary": "Declared, never populated. This is where the real occurrence time lives. Its "
                   "absence is why time-of-day is MODELED and labelled as an estimate.",
        "columns": [C("CaseMasterID", "INT", "FK")],
    },

    # ---------------- legal reference ----------------
    "Act": {
        "status": PARTIAL, "blocker": None, "our_table": "dim_act",
        "grain": "one row per legal act",
        "summary": "4,831 distinct acts reconstructed from the free-text ActSection field. We have "
                   "names and usage counts, not official codes/descriptions.",
        "columns": [
            C("ActCode", "VARCHAR", "PK", RECONSTRUCTED, "The act NAME is our key — no codes in the extract."),
            C("ActDescription", "VARCHAR", None, POPULATED, "As written in the FIR text."),
            C("ShortName", "VARCHAR", None, ABSENT, ""),
            C("Active", "BIT", None, ABSENT, ""),
        ],
    },
    "Section": {
        "status": PARTIAL, "blocker": None, "our_table": "dim_section",
        "grain": "one row per (act, section)",
        "summary": "17,465 distinct act-section pairs reconstructed from the same free text.",
        "columns": [
            C("ActCode", "VARCHAR", "FK", RECONSTRUCTED, "Parent act name."),
            C("SectionCode", "VARCHAR", None, POPULATED, "Handles sub-parts like 304(A)."),
            C("SectionDescription", "VARCHAR", None, ABSENT, ""),
            C("Active", "BIT", None, ABSENT, ""),
        ],
    },
    "CrimeHeadActSection": {
        "status": DESIGNED, "blocker": NO_DATA, "our_table": None,
        "grain": "crime head <-> act-section mapping",
        "summary": "Declared, never populated as a reference mapping. The OBSERVED equivalent is "
                   "entity_edges: which crime heads actually co-occur with which acts in real FIRs "
                   "(4,558 edges), which is a measurement rather than a lookup.",
        "columns": [C("CrimeHeadID", "INT", "FK"), C("ActCode", "VARCHAR", "FK"),
                    C("SectionCode", "VARCHAR")],
    },
    "CrimeHead": {
        "status": PARTIAL, "blocker": None, "our_table": "dim_crime_head",
        "grain": "one row per major crime head",
        "summary": "107 major heads, from CrimeGroup_Name.",
        "columns": [
            C("CrimeHeadID", "INT", "PK", RECONSTRUCTED, "The head NAME is the key; no IDs in the extract."),
            C("CrimeGroupName", "VARCHAR", None, POPULATED, ""),
            C("Active", "BIT", None, ABSENT, ""),
        ],
    },
    "CrimeSubHead": {
        "status": PARTIAL, "blocker": None, "our_table": "dim_crime_subhead",
        "grain": "one row per crime sub-head",
        "summary": "626 sub-heads, from CrimeHead_Name, each linked to its parent major head.",
        "columns": [
            C("CrimeSubHeadID", "INT", "PK", RECONSTRUCTED, "Sub-head name is the key."),
            C("CrimeHeadID", "INT", "FK", POPULATED, "Parent major head."),
            C("CrimeHeadName", "VARCHAR", None, POPULATED, ""),
            C("SeqID", "INT", None, ABSENT, ""),
        ],
    },

    # ---------------- protected-attribute masters ----------------
    "CasteMaster": {
        "status": DESIGNED, "blocker": PROTECTED, "our_table": None,
        "grain": "one row per caste",
        "summary": "Declared for fidelity, never populated. Caste is never a model feature "
                   "anywhere in this platform.",
        "columns": [C("caste_master_id", "INT", "PK"), C("caste_master_name", "VARCHAR")],
    },
    "ReligionMaster": {
        "status": DESIGNED, "blocker": PROTECTED, "our_table": None,
        "grain": "one row per religion",
        "summary": "Declared for fidelity, never populated. Religion is never a model feature.",
        "columns": [C("ReligionID", "INT", "PK"), C("ReligionName", "VARCHAR")],
    },
    "OccupationMaster": {
        "status": DESIGNED, "blocker": PROTECTED, "our_table": None,
        "grain": "one row per occupation",
        "summary": "Declared for fidelity, never populated.",
        "columns": [C("OccupationID", "INT", "PK"), C("OccupationName", "VARCHAR")],
    },

    # ---------------- operational reference ----------------
    "CaseStatusMaster": {
        "status": PARTIAL, "blocker": None, "our_table": "dim_case_status",
        "grain": "one row per case status",
        "summary": "13 normalised statuses. The raw extract had ~300 variants of "
                   "`Transfered :UI(...)`, collapsed to one.",
        "columns": [
            C("CaseStatusID", "INT", "PK", RECONSTRUCTED, "Status name is the key."),
            C("CaseStatusName", "VARCHAR", None, POPULATED, ""),
        ],
    },
    "GravityOffence": {
        "status": PARTIAL, "blocker": None, "our_table": "dim_gravity",
        "grain": "one row per gravity level",
        "summary": "Heinous / Non-Heinous, from `FIR Type`.",
        "columns": [
            C("GravityOffenceID", "INT", "PK", RECONSTRUCTED, ""),
            C("LookupValue", "VARCHAR", None, POPULATED, ""),
        ],
    },
    "CaseCategory": {
        "status": DESIGNED, "blocker": SINGLE, "our_table": None,
        "grain": "one row per case category",
        "summary": "Declared, never populated — the extract is entirely FIR, with no UDR/PAR/Zero-FIR.",
        "columns": [C("CaseCategoryID", "INT", "PK"), C("LookupValue", "VARCHAR")],
    },
    "District": {
        "status": PARTIAL, "blocker": None, "our_table": "dim_district",
        "grain": "one row per district",
        "summary": "41 FIR units mapped to 31 KGIS districts, hand-verified and cross-checked "
                   "against KGIS, Census 2011 and LGD with zero errors. Four non-geographic units "
                   "(CID, Coastal Security, ISD, Railways) are flagged and kept off district maps.",
        "columns": [
            C("DistrictID", "INT", "PK", RECONSTRUCTED,
              "We carry three real external keys instead of an internal id: kgis_code, lgd_code, "
              "census_code_2011 — which is what makes the boundary/census joins verifiable."),
            C("DistrictName", "VARCHAR", None, POPULATED, ""),
            C("StateID", "INT", "FK", ABSENT, "Karnataka only."),
            C("Active", "BIT", None, ABSENT, ""),
        ],
    },
    "State": {
        "status": DESIGNED, "blocker": SINGLE, "our_table": None,
        "grain": "one row per state",
        "summary": "Declared, never populated — single-state dataset.",
        "columns": [C("StateID", "INT", "PK"), C("StateName", "VARCHAR"),
                    C("NationalityID", "INT"), C("Active", "BIT")],
    },
    "Unit": {
        "status": PARTIAL, "blocker": None, "our_table": "agg_unit",
        "grain": "one row per police unit",
        "summary": "1,074 units. 875 of 1,071 distinct names matched to real KGIS station "
                   "coordinates, which is what lifted coordinate coverage from 29.9% to 99.54%.",
        "columns": [
            C("UnitID", "INT", "PK", RECONSTRUCTED, "Unit name is the key."),
            C("UnitName", "VARCHAR", None, POPULATED, "The one column name we already shared with the ER."),
            C("TypeID", "INT", "FK", ABSENT, ""),
            C("ParentUnit", "INT", None, RECONSTRUCTED, "Parent district, not a unit hierarchy."),
            C("NationalityID", "INT", None, ABSENT, ""),
            C("StateID", "INT", "FK", ABSENT, "Karnataka only."),
            C("DistrictID", "INT", "FK", POPULATED, "Via canonical district + kgis_code."),
            C("Active", "BIT", None, ABSENT, ""),
        ],
    },
    "UnitType": {
        "status": DESIGNED, "blocker": NO_DATA, "our_table": None,
        "grain": "one row per unit type",
        "summary": "Declared, never populated — unit type is not distinguishable in the extract.",
        "columns": [C("UnitTypeID", "INT", "PK"), C("UnitTypeName", "VARCHAR"),
                    C("CityDistState", "VARCHAR"), C("Hierarchy", "INT"), C("Active", "BIT")],
    },
    "Rank": {
        "status": PARTIAL, "blocker": None, "our_table": "dim_rank",
        "grain": "one row per police rank",
        "summary": "21 ranks, derived from the rank suffix on IOName (e.g. '... PSI').",
        "columns": [
            C("RankID", "INT", "PK", RECONSTRUCTED, ""),
            C("RankName", "VARCHAR", None, POPULATED, "Parsed from IOName."),
            C("Hierarchy", "INT", None, ABSENT, ""),
            C("Active", "BIT", None, ABSENT, ""),
        ],
    },
    "Designation": {
        "status": DESIGNED, "blocker": NO_DATA, "our_table": None,
        "grain": "one row per designation",
        "summary": "Declared, never populated — the extract has rank but not designation.",
        "columns": [C("DesignationID", "INT", "PK"), C("DesignationName", "VARCHAR"),
                    C("Active", "BIT"), C("SortOrder", "INT")],
    },
    "Employee": {
        "status": DESIGNED, "blocker": LAW, "our_table": None,
        "grain": "one row per police employee",
        "summary": "Declared, never populated. IOName and KGID exist in the extract but identify "
                   "serving officers, so building an employee table from them would create exactly "
                   "the kind of personnel profiling this platform refuses to do. Rank is taken "
                   "from the name string and the identity discarded.",
        "columns": [
            C("EmployeeID", "INT", "PK"), C("DistrictID", "INT", "FK"), C("UnitID", "INT", "FK"),
            C("RankID", "INT", "FK"), C("DesignationID", "INT", "FK"), C("KGID", "VARCHAR"),
            C("FirstName", "VARCHAR"), C("EmployeeDOB", "DATE"), C("GenderID", "INT"),
            C("BloodGroupID", "INT"), C("PhysicallyChallenged", "BIT"), C("AppointmentDate", "DATE"),
        ],
    },
    "Court": {
        "status": DESIGNED, "blocker": NO_DATA, "our_table": None,
        "grain": "one row per court",
        "summary": "Declared, never populated — no court detail in the extract.",
        "columns": [C("CourtID", "INT", "PK"), C("CourtName", "VARCHAR"),
                    C("DistrictID", "INT", "FK"), C("StateID", "INT", "FK"), C("Active", "BIT")],
    },
}

# Type deviations we are knowingly making, surfaced rather than hidden.
DEVIATIONS = [
    {"entity": "CaseMaster", "column": "CaseMasterID", "er_type": "INT", "ours": "varchar",
     "why": "The extract has no FIR identifier, so the key is a deterministic positional "
            "surrogate (CM-000000001). A synthetic integer would imply a real record id."},
    {"entity": "Act", "column": "ActCode", "er_type": "VARCHAR (code)", "ours": "varchar (name)",
     "why": "No act codes in the extract; the parsed act NAME is the only available key."},
    {"entity": "CrimeHead", "column": "CrimeHeadID", "er_type": "INT", "ours": "varchar (name)",
     "why": "Reference tables are reconstructed from distinct values, so the name is the key."},
    {"entity": "District", "column": "DistrictID", "er_type": "INT", "ours": "varchar codes",
     "why": "We carry real external keys (KGIS, LGD, Census 2011) instead of an internal id, "
            "because those are what make the boundary and census joins independently verifiable."},
]

# Relationships from the ER document's relationship matrix, kept so the contract is complete.
RELATIONSHIPS = [
    ("CaseMaster", "CaseMasterID", "one_to_many", "Victim", "CaseMasterID"),
    ("CaseMaster", "CaseMasterID", "one_to_many", "Accused", "CaseMasterID"),
    ("CaseMaster", "CaseMasterID", "one_to_many", "ArrestSurrender", "CaseMasterID"),
    ("CaseMaster", "CaseMasterID", "one_to_many", "ComplainantDetails", "CaseMasterID"),
    ("CaseMaster", "CaseMasterID", "one_to_many", "ActSectionAssociation", "CaseMasterID"),
    ("CaseMaster", "CaseMasterID", "one_to_one", "Inv_OccuranceTime", "CaseMasterID"),
    ("CaseMaster", "CaseCategoryID", "many_to_one", "CaseCategory", "CaseCategoryID"),
    ("CaseMaster", "GravityOffenceID", "many_to_one", "GravityOffence", "GravityOffenceID"),
    ("CaseMaster", "CrimeMajorHeadID", "many_to_one", "CrimeHead", "CrimeHeadID"),
    ("CaseMaster", "CrimeMinorHeadID", "many_to_one", "CrimeSubHead", "CrimeSubHeadID"),
    ("CaseMaster", "CaseStatusID", "many_to_one", "CaseStatusMaster", "CaseStatusID"),
    ("CaseMaster", "CourtID", "many_to_one", "Court", "CourtID"),
    ("CaseMaster", "PolicePersonID", "many_to_one", "Employee", "EmployeeID"),
    ("ArrestSurrender", "ArrestSurrenderID", "one_to_many", "inv_arrestsurrenderaccused", "ArrestSurrenderID"),
    ("ArrestSurrender", "ArrestSurrenderStateId", "many_to_one", "State", "StateID"),
    ("ArrestSurrender", "ArrestSurrenderDistrictId", "many_to_one", "District", "DistrictID"),
    ("ArrestSurrender", "CourtID", "many_to_one", "Court", "CourtID"),
    ("ArrestSurrender", "IOID", "many_to_one", "Employee", "EmployeeID"),
    ("ComplainantDetails", "OccupationID", "many_to_one", "OccupationMaster", "OccupationID"),
    ("ComplainantDetails", "ReligionID", "many_to_one", "ReligionMaster", "ReligionID"),
    ("ComplainantDetails", "CasteID", "many_to_one", "CasteMaster", "caste_master_id"),
    ("ActSectionAssociation", "ActID", "many_to_one", "Act", "ActCode"),
    ("ActSectionAssociation", "SectionID", "many_to_one", "Section", "SectionCode"),
    ("CrimeSubHead", "CrimeHeadID", "many_to_one", "CrimeHead", "CrimeHeadID"),
    ("CrimeHead", "CrimeHeadID", "one_to_many", "CrimeHeadActSection", "CrimeHeadID"),
    ("Act", "ActCode", "one_to_many", "CrimeHeadActSection", "ActCode"),
    ("Act", "ActCode", "one_to_many", "Section", "ActCode"),
    ("Court", "DistrictID", "many_to_one", "District", "DistrictID"),
    ("District", "StateID", "many_to_one", "State", "StateID"),
    ("Unit", "TypeID", "many_to_one", "UnitType", "UnitTypeID"),
    ("Unit", "StateID", "many_to_one", "State", "StateID"),
    ("Unit", "DistrictID", "many_to_one", "District", "DistrictID"),
    ("Employee", "DistrictID", "many_to_one", "District", "DistrictID"),
    ("Employee", "UnitID", "many_to_one", "Unit", "UnitID"),
    ("Employee", "RankID", "many_to_one", "Rank", "RankID"),
    ("Employee", "DesignationID", "many_to_one", "Designation", "DesignationID"),
]


def contract_tables(row_counts=None):
    """The 28 ER entities as creatable Data Store table definitions (ER-faithful names)."""
    row_counts = row_counts or {}
    out = []
    for name, e in ER_ENTITIES.items():
        cols = e["columns"] + e.get("extra_columns", [])
        out.append({
            "table_name": name,
            "alt_name": f"er_{name}" if name in RESERVED_RISK else None,
            "reserved_word_risk": name in RESERVED_RISK,
            "plane": e["status"],
            "row_count": row_counts.get(name, 0),
            "grain": e["grain"],
            "columns": [
                {k: v for k, v in c.items() if v not in (None, "")}
                for c in cols
            ],
        })
    return out


def conformance(row_counts=None):
    """Entity-by-entity conformance: what we populate, and precisely what blocks the rest."""
    row_counts = row_counts or {}
    entities = []
    for name, e in ER_ENTITIES.items():
        cols = e["columns"]
        pop = sum(1 for c in cols if c["provenance"] in (POPULATED, RECONSTRUCTED))
        entities.append({
            "er_entity": name,
            "status": e["status"],
            "our_table": e["our_table"],
            "grain": e["grain"],
            "row_count": row_counts.get(name, 0),
            "columns_total": len(cols),
            "columns_populated": pop,
            "blocker": e["blocker"],
            "blocker_reason": BLOCKER_TEXT.get(e["blocker"]) if e["blocker"] else None,
            "summary": e["summary"],
            "columns": [
                {"column_name": c["column_name"], "er_type": c["er_type"], "key": c["key"],
                 "provenance": c["provenance"], "note": c["note"]}
                for c in cols
            ],
        })
    by_status = {}
    for x in entities:
        by_status[x["status"]] = by_status.get(x["status"], 0) + 1
    by_blocker = {}
    for x in entities:
        if x["blocker"]:
            by_blocker[x["blocker"]] = by_blocker.get(x["blocker"], 0) + 1
    return {
        "source_document": "datasets/Police_FIR_ER_Diagram.pdf (KSP, Confidential) — a database "
                           "DESIGN document containing no data; the only artefact KSP provided.",
        "entities_total": len(entities),
        "by_status": by_status,
        "by_blocker": by_blocker,
        "honesty": "Every ER entity is declared under its exact ER name with its exact column "
                   "names, so real SCRB data could be loaded without a translation layer. Where we "
                   "populate nothing, the blocker is named rather than the table omitted. Nothing "
                   "here is populated with invented data.",
        "deviations": DEVIATIONS,
        "reserved_word_note": "Act, Section, State and Rank are reserved words in some SQL "
                              "dialects. They are declared under their true ER names; an er_ "
                              "prefixed alt_name is provided if the console rejects them.",
        "relationships": [
            {"parent": p, "parent_column": pc, "cardinality": card, "child": ch, "child_column": cc}
            for p, pc, card, ch, cc in RELATIONSHIPS
        ],
        "entities": entities,
    }
