# functions/crime_api/ — Backend API (Node + Express)

The Catalyst **Advanced I/O Function** that serves the platform's REST API. A **thin serving layer**:
it reads precomputed tables (Catalyst Data Store → CSV fallback) and returns JSON. No ML runs here.

## Structure
```
crime_api/
├── src/
│   ├── index.js        app entry (Express); mounts at /server/crime_api (Catalyst) and / (local)
│   ├── routes/         endpoint handlers grouped by workspace (overview, hotspots, trends, risk, network, ...)
│   ├── lib/            data-access (Data Store → CSV fallback), {ok,result} envelope, cache, security middleware
│   └── data/           bundled CSV fallback = copies of etl/out + ml/out (so the API never hard-fails)
├── package.json
└── catalyst-config.json   (added during Phase 1 scaffold)
```

## Contract
- Envelope: `{ ok: true, result }` / `{ ok: false, error, request_id }`.
- Every payload carries a `data_class` field (`real` | `modeled` | `synthetic`) for UI labelling.
- Reads Data Store (ZCQL) first, falls back to bundled CSV.

## Stack
Node 18 + Express · `zcatalyst-sdk-node` · `zod` · `helmet`/`cors`/`express-rate-limit` · Jest + Supertest.

Spec: `Plans/Backend_architecture.md`. Built in Phase 1.
