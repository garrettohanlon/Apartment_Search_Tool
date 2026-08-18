# Apartment Search, Next.js UI

A typed React port of the single-page interface. Same dataset, same scoring engine,
same design decisions; component structure and type safety instead of one 1,300-line
file.

## Run

    npm install
    npm run dev            # http://localhost:3000

## Build a static site

    npm run build          # emits ./out

`next.config.mjs` sets `output: 'export'`, so the build is a plain static site with
no Node process at runtime. Drop the day's `inventory-latest.json` into `out/` (or
into `public/` before building) and it loads.

## How the data gets here

The nightly agent writes `inventory-<date>.json` and `inventory-latest.json`. This UI
reads `inventory-latest.json`, or `window.__AW_DATA__` if a script tag has already
defined it, which is how the vanilla build works straight off the filesystem.

## Layout

    lib/types.ts       the dataset contract
    lib/geography.ts   ranked neighborhoods; tier seeds location scoring
    lib/engine.ts      filters, scoring, availability, near misses. Pure functions
    lib/ask.ts         natural-language search to filter changes
    lib/store.tsx      one context, localStorage persistence
    components/        SearchPanel, ResultCard, DetailDrawer, Views, MapPanel

## Tradeoff worth knowing

The vanilla `app/` build opens instantly from `file://` with no install and no server,
which is what the 8am launchd job relies on. This one needs `npm install` and a build.
Both are kept: use the vanilla one for the automated daily artifact, this one for
development and for anything that grows beyond a single file.

## Not ported

Nothing in the engine. The Neighborhood Explorer statistics table from the earlier
iteration is not here, because the simplification brief cut it from the navigation.
