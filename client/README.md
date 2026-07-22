# client/ — Frontend SPA (React 18 + Vite)

Single-page app served by Catalyst **Web Client Hosting**. Renders the 8 workspaces (maps, charts, networks)
against the `crime_api` backend, with a built-in Real / Modeled / Synthetic labelling system.

## Structure
```
client/
├── index.html
├── vite.config.js
├── package.json
├── public/
└── src/
    ├── main.jsx / App.jsx     router + layout shell
    ├── api/                   fetch client ({ok,result} unwrap), endpoint helpers
    ├── components/            layout, maps/, charts/, network/, filters/, DataClassBadge
    ├── workspaces/            Dashboard, HotspotMap, PatternsMO, TrendsForecast,
    │                          RiskVulnerability, SocioEconomic, NetworkAnalysis, StrategicHub
    ├── state/                 Zustand store (filters), auth/role context
    └── styles/
```

## Stack
React 18 + Vite · React Router · TanStack Query · Zustand · React-Leaflet (+leaflet.heat) · Apache ECharts · react-force-graph · Tailwind + shadcn/ui · TanStack Table.

## Map data
Uses `datasets/external/boundaries/karnataka_districts_2021_kgis.simplified.geojson` (web layer) + the 921 police-station points.

Spec: `Plans/Frontend_architecture.md`. Built in Phase 1+.
