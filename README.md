# Apartment Search

A Manhattan apartment search built around two ideas: only show units that are
genuinely available now, and surface rent-stabilized opportunities the major listing
sites miss.

Two halves, deliberately separate:

- **A research agent** (Python + `claude -p`) that runs on a schedule, searches
  broadly, verifies availability, and writes a structured dataset.
- **A Next.js UI** that renders that dataset. It never invents a listing fact.

The split matters. The agent's job is to find and verify; the UI's job is to rank and
explain. Because the agent supplies component sub-scores rather than a blended score,
moving a ranking weight re-ranks instantly with no round trip.

## Deploy the UI to Vercel

The repository root is a Next.js app, so Vercel needs no configuration:

1. Import the repo at [vercel.com/new](https://vercel.com/new). Framework detects as
   Next.js. No root directory override needed.
2. Deploy. It comes up immediately showing the bundled demo dataset, clearly labelled
   as fabricated.

That gets you a working UI with fake data. To show real inventory, the agent has to
publish to it.

### Wiring the agent to the deployment

Vercel has no filesystem to write to and no credentials to search with, so the local
agent sends its dataset up.

1. In the Vercel project, create a **Blob** store (Storage tab). That sets
   `BLOB_READ_WRITE_TOKEN` automatically.
2. Add an environment variable `INGEST_SECRET` set to a long random string.
3. On the machine running the agent, create `.env.publish` (gitignored):

   ```
   DEPLOY_URL=https://your-project.vercel.app
   INGEST_SECRET=the-same-long-random-string
   ```

4. `run.sh` now publishes automatically at the end of each run. Or run
   `./publish.sh` by hand.

`POST /api/inventory` requires a bearer token matching `INGEST_SECRET`, and refuses
outright with 503 if that variable is not set, rather than leaving an open write
endpoint on a public deployment. `GET /api/inventory` serves the latest dataset with
`Cache-Control: no-store`, so a new run appears without a redeploy.

If you would rather not use Blob, set `INVENTORY_URL` to any publicly readable JSON
URL and the app will read from there instead.

### What never gets published

`sanitize()` strips the search-criteria and qualifying blocks from the dataset before
anything is stored or served. That is where income lives. Anything personal stays in
`profile.json`, which is gitignored and never leaves the local machine.

## Run the UI locally

```
npm install
npm run dev        # http://localhost:3000
```

## Run the agent

```
cp profile.example.json profile.json    # then edit it
./run.sh
./install.sh                            # optional: daily launchd schedule
```

`profile.json` holds your search criteria and anything personal. It is gitignored.

## Layout

```
src/app/            Next App Router. page.tsx is the whole UI
src/app/api/        inventory GET and POST
src/components/     SearchPanel, ResultCard, DetailDrawer, Views, MapPanel
src/lib/engine.ts   filters, scoring, availability, near misses. Pure functions
src/lib/ask.ts      natural-language search to filter changes
src/lib/store.tsx   one context, localStorage persistence
src/lib/inventory.ts  where the deployed UI gets its data

prepare.py          verifies tax exemptions against the live NYC DOF roll
prompt.md           the agent's instructions
record.py           new vs carried-over, computed rather than judged
build_inventory.py  joins findings to building profiles
watchlist.json      buildings, from HCR registrations joined to the DOF roll
publish.sh          send a dataset to the deployment

legacy-ui/          the original zero-dependency build. Opens from file:// with no
                    install, which is what the local scheduled job uses
```

## Design rules worth knowing before changing anything

**Missing data is never a failure.** Only about one listing in eight publishes a square
footage, so a hard size filter would delete exactly the large prewar and conversion
units worth finding. Unpublished sizes, unknown amenities and geography-only exclusions
are surfaced separately with the reason, never silently dropped.

**Only a Required filter excludes.** Strong and Nice preferences cost points and change
ordering. A single missed minor preference must never delete an exceptional apartment.
Anything blocked by geography alone, or by exactly one Required filter, appears under
"one filter away" with the blocking reason stated.

**Availability is a judgement with evidence attached.** A listing with no resolved unit
number can never rate above Low confidence. A building page advertising "2 bedrooms
from $X" is a lead, not an apartment.

**Apartments and buildings stay apart.** Buildings with no qualifying availability
appear only under Buildings to Watch or Off-Market, so a building never reads as
inventory it does not have.

**Never claim a unit is confirmed stabilized without unit-specific evidence.** The
standing position for anything short of that is: potentially stabilized,
tenant-specific DHCR verification required.
