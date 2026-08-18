# NYC Apartment Watch, UI specification

Version 2, 2026-08-18. Supersedes the implicit spec of the static daily brief, which is retained
in full as a tab.

## Architecture, and why

The nightly agent does **not** generate the interface. It produces a structured dataset; a stable
hand-built single-page app renders it.

```
prepare.py        verifies each building's tax exemption against the live NYC DOF roll,
                  picks the day's targets, writes data/context-<date>.md
      |
claude -p         searches listing sites, verifies availability, resolves contacts,
                  writes the HTML brief + data/found-<date>.json
      |
record.py         merges into data/seen.json  (new vs carried-over is computed, not judged)
      |
build_inventory.py  joins findings to watchlist.json: building profiles, coordinates,
                    verified benefit status. Emits inventory-<date>.json and
                    inventory-latest.js into the day's output folder
      |
app/              index.html + app.js + styles.css, copied alongside. Reads the dataset.
```

Three reasons this split matters:

1. **Instant re-ranking.** The agent supplies component sub-scores; the app computes the Fit Score
   from the user's weights. Moving a slider re-ranks with no round trip. If the LLM computed a
   blended score, every weight change would need a new run.
2. **Reliability.** An LLM regenerating 1,200 lines of interactive JavaScript nightly will break it.
   The renderer is written once and tested.
3. **Honesty.** The app cannot invent a listing fact. It only displays what is in the dataset, and
   the dataset only contains what the agent verified.

`inventory-latest.js` exists because Chrome blocks `fetch()` on `file://` URLs. It is the same
payload assigned to `window.__AW_DATA__`. The app prefers it and falls back to `fetch` when served
over HTTP.

## Tabs

| Tab | Contents |
|---|---|
| **Apartment Search / Live Inventory** | Dashboard, filter rail, results feed, map. The default. |
| **Neighborhood Explorer** | Per-area statistics and agent micro-market recommendations. |
| **Watchlist** | Saved apartments, followed buildings, change detection. |
| **Daily Brief** | The existing static HTML brief, unchanged, in an iframe. |

## Availability gate

The feed contains only genuinely live inventory. A listing is excluded when:

- `availability_status` is anything other than `available` or `active`
- `cross_check.status` is `gone`
- `last_verified` is more than 7 days old

Listings the agent could not tie to a specific unit are marked `listing_grade: building_indicated`,
shown with a source-conflict flag, and described as a building-level indication rather than a
verified apartment. This distinction was added after the 2026-08-18 run, where seven of eight
findings were aggregator-reported building rents with no unit number.

## The four-level requirement model

Every filter carries an importance, set by the R / S / N / dash control beside it.

| Level | Behaviour |
|---|---|
| **Required** | Hard filter. Excludes non-matching listings. Shown in red. |
| **Strong preference** | Never excludes. Costs 18 points of Fit. |
| **Nice to have** | Never excludes. Costs 6 points of Fit. |
| **Ignore** | No effect. |

**Missing data is never a failure.** This is the central design rule and it applies in three places:

- **Square footage.** Unpublished size does not fail the 1,000 sq ft floor. Those listings go to a
  separate "Size not published" table with the building's average sf/unit for context. Applying the
  floor to unknown sizes would silently delete exactly the large prewar and conversion units being
  hunted, and in practice only about one listing in eight publishes a size.
- **Amenities.** `amenState()` is tri-state: true, false, or null. Only an explicit `false` fails a
  Required amenity. Null routes to an "Unverified, ask on the call" note.
- **Near misses.** Anything blocked by geography alone, or by exactly one Required filter, is
  surfaced in its own section with the blocking reason stated. This exists because the first
  verification run showed 71 Broadway, the single most actionable find, being deleted purely because
  the Financial District chip was off by default.

Unknowns carry a small Fit penalty (1 to 3 points) so a confirmed match outranks an unconfirmed one
without the unconfirmed one disappearing.

## Scoring

**Fit Score, 0 to 100.** Weighted mean of eight agent-supplied components (location, size, price,
building quality, apartment quality, stabilization, amenities, value), using the user's weights,
minus importance penalties, minus unknown penalties, plus a learned bias term. Every component is
shown with its weight in the listing drawer.

**Value Score, 0 to 100.** Agent-supplied, because it needs comparable-set knowledge the app does not
have. Explicitly not cheapness: it accounts for rent against comps, quality, size, layout efficiency,
amenities, stabilization, concessions, fees, effective rent, location, and scarcity of comparable
inventory.

**Effective rent.** Amortises free months over the lease term. Displayed beside asking rent wherever
they differ.

**Learned bias.** Saving an apartment or following a building nudges that building up by up to 6 and 3
points; hiding nudges down. It only ever moves ranking. It cannot override a Required filter. Signals
persist to `localStorage` and export via "Export signals for agent" to
`data/signals.json`, which the next run reads.

## Search modes

Weight presets, applied instantly: Best Overall, Stabilized Hunt, Best Value, Best Building,
Maximum Space, West Side Only (adds a hard W 38th St latitude ceiling), Hidden Gems (bonuses for
below-market pricing, freshness, thin comparable sets, and absent photos as a poor-marketing proxy).

## Map

Leaflet with CARTO dark tiles, no API key. Markers show rent and square footage, are outlined green
when stabilized, and open the listing drawer. Neighborhood centroids are clickable directly on the
map and cycle include / off / exclude. "Draw area" builds a polygon by clicking, closed by
double-click, filtered with a ray-casting point-in-polygon test. "Filter to viewport" re-filters the
loaded dataset on pan and zoom.

**Honest limitation:** viewport filtering narrows the loaded dataset. It does not fetch new inventory,
because there is no live listing API behind this. Fresh inventory requires an agent run.

## Rent stabilization

Classified `confirmed`, `highly_likely`, `possible`, `market`, or `unknown`, with the reasoning shown
as a list in the drawer. Anything short of `confirmed` displays the standing caveat: *potentially
stabilized, tenant-specific DHCR verification required.* The app never upgrades the agent's
confidence.

## Neighborhood Explorer

Per selected area: qualifying count, median rent, median $/sf, average size, stabilized or likely
count, new inventory in 7 days, best building, best value, best overall. Selecting here also
constrains the Live Inventory feed.

Below it, agent-supplied micro-market recommendations: specific blocks or sub-areas pricing better
than the surrounding neighborhood, with median $/sf against the parent area. Recommendations outside
the current selection are labelled as such and offered with an "Add to search" button. They never
override a hard geographic filter.

## Not implemented, and why

| Asked for | Status |
|---|---|
| Continuous evaluation | Daily at 08:00 ET, plus on-demand. Intraday cadence is a plist change. |
| Zoom to refresh inventory | Re-filters loaded data. No live listing API exists to query. |
| Photos | Rendered when the source permits hotlinking; most do not, and the card falls back to a labelled placeholder. |
| Commute times | Needs a destination and a routing API. Building `transit` carries lines and walk time where the agent found them. |
| Cross-source verification at scale | Attempted per listing, but roughly nine domains block automated access. Blocked sources are listed in the UI so the gap is visible rather than silent. |

## Persistence

`localStorage`, keyed `aw.v1.*`: filter values, importances, weights, neighborhood state, excluded
streets and buildings, saved, hidden, followed, notes, status flags, interaction signals, last visit,
and a snapshot used for price-drop and back-on-market detection. Nothing leaves the machine.
