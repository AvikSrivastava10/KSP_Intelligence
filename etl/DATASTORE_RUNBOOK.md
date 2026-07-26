# Catalyst Data Store — enablement runbook

Goal: make the deployed `crime_api` read its tables from the **Catalyst Data Store** instead of
the bundled CSVs, so `/health` reports `storage: "catalyst_datastore"`.

> **First, the thing that trips everyone up:** the bundled CSVs are **not** fake, sample or
> degraded data. They are the real precomputed tables built by the offline ETL from the
> 1,674,734-row FIR extract, and the Data Store copy is loaded *from these very files*. The two
> backends serve byte-identical content — `/health` reports `data_is_real: true` in both modes.
> Moving to the Data Store is an **architecture/scalability** step (queryable storage, the
> Catalyst-native path), not a data-quality fix.

Linked project (read automatically from `.catalystrc`): **KSP** · `53358000000023001` · env `Development`.

---

## Step 0 — protect your secrets first

`.gitignore` already excludes `.env`, `.env.*`, `*.pem`, `*.key`, `credentials.json` and
`client-secret*.json`, so a local `.env` is safe to create. Verify before you start:

```bash
git check-ignore -v .env
```

Never paste OAuth values into chat, screenshots, logs or commits — a committed secret cannot be
fully un-published.

---

## Step 1 — create the tables (Catalyst console)

Catalyst has **no public create-table API**, so tables are created once in the console.
The authoritative spec is generated from the real data:

```bash
python etl/load_datastore.py --schema
```

That writes `etl/out/datastore_schema.json` — **42 tables**, every column with its exact type and
a **measured** `max_length` (varchar widths are sized from the longest actual value + 50% headroom,
so long text like `association_rules.reading` (varchar 500) or `socio_correlations.caveat`
(varchar 1000) is never silently truncated).

In the console: **Data Store → New Table** → create each table with the columns/types from the JSON.

Check the inventory and row counts any time (no credentials needed):

```bash
python etl/load_datastore.py
```

---

## Step 2 — set credentials (your machine, your step)

Create a Zoho **self-client** OAuth app with scopes
`ZohoCatalyst.tables.rows.CREATE`, `ZohoCatalyst.tables.rows.DELETE`, `ZohoCatalyst.tables.READ`,
then set these environment variables. `CATALYST_PROJECT_ID` and `CATALYST_ENVIRONMENT` are read
from `.catalystrc` automatically — only the rest are required:

```powershell
$env:CATALYST_API_DOMAIN = "https://api.catalyst.zoho.in"   # region-matched (.in / .com / .eu)
$env:ZOHO_ACCOUNTS_URL   = "https://accounts.zoho.in"       # must match the same region
$env:ZOHO_CLIENT_ID      = "<your client id>"
$env:ZOHO_CLIENT_SECRET  = "<your client secret>"
$env:ZOHO_REFRESH_TOKEN  = "<your refresh token>"
```

---

## Step 3 — load the rows

```bash
python etl/load_datastore.py --load
```

Idempotent (truncate + batched insert), so it is safe to re-run after any model re-run.
Load a subset while testing:

```bash
python etl/load_datastore.py --load --only dim_district agg_outcomes
```

---

### Loading only part of the schema is fine

`store.js` falls back to the bundled table **per table**, so you do not need all 42 in place before
deploying. Creating the ~15 tables the core screens read (`dim_district`, `agg_outcomes`,
`agg_case_status`, `agg_socioeconomic`, `agg_unit`, `agg_timeofday`, `risk_scores`, `alerts`,
`anomalies`, `mo_clusters`, `outcomes_by_district`, `outcome_drivers`, `network_nodes`,
`network_communities`, `socio_correlations`) is enough for `/health` to report
`storage: "catalyst_datastore"`, with the remainder still served from the bundle. Four large tables
(`hotspot_cells`, `agg_hotspots`, `agg_district_month`, `forecasts`) are pinned CSV-only by design
and never need creating.

## Step 4 — deploy with the Data Store switched on

`USE_DATASTORE` already defaults to `true` in `functions/crime_api/catalyst-config.json`, so no edit
is needed unless you want it off. Then:

```bash
cd client && npm run build
catalyst deploy
```

Verify: `GET /server/crime_api/health` should return
`"storage": "catalyst_datastore"`.

---

## Why the CSV fallback stays wired

`store.js` falls back to the bundled CSVs if a Data Store query fails. Keep it:

* it is the Phase 7 milestone in `Plans/plan.md` — *"live on Catalyst, resilient (CSV fallback)"*;
* the function stays self-contained, so a Data Store hiccup degrades to identical data instead of
  a broken dashboard during a demo;
* large tables (`hotspot_cells`, `agg_district_month`, `forecasts`, `agg_hotspots`) are pinned
  CSV-only on purpose — paging 140k rows over ZCQL at 300/query would be hundreds of round trips
  per request.

In normal operation on Catalyst the fallback never fires; it is a safety net, not the primary path.

## Local development note

Running `node src/index.js` on localhost **always** reports `bundled_tables`, even with
`USE_DATASTORE=true`. The Catalyst SDK initialises from a Catalyst request context, which does not
exist off-platform. This is expected — not a misconfiguration.
