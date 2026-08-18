#!/usr/bin/env python3
"""Assemble the dataset the Live Inventory UI reads.

Joins the agent's found-<date>.json (what is available now) to watchlist.json
(building profiles, coordinates, verified benefit status) and emits
inventory-<date>.json + inventory-latest.json into the day's output folder.

Deliberately conservative. It never upgrades the agent's confidence, never
invents square footage, and marks anything the agent surfaced without a unit
number as a building-level indication rather than a verified unit, so the UI
does not overstate what is known.

Usage: python3 build_inventory.py <YYYY-MM-DD> <output_dir>
"""
import json, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

# The agent writes prose confidence labels; the UI needs the enum.
CONF = {
    "confirmed rent stabilized": "confirmed", "confirmed": "confirmed",
    "highly likely stabilized": "highly_likely", "highly likely": "highly_likely",
    "likely stabilized": "highly_likely", "likely": "highly_likely",
    "possibly stabilized": "possible", "possible": "possible",
    "market rate": "market", "market": "market",
    "unlikely": "market", "not stabilized": "market",
    "unknown": "unknown",
}


def main():
    date = sys.argv[1] if len(sys.argv) > 1 else datetime.date.today().isoformat()
    outdir = sys.argv[2] if len(sys.argv) > 2 else DATA
    wl = json.load(open(os.path.join(HERE, "watchlist.json")))
    # Search criteria live in profile.json (gitignored), not in the watchlist.
    profile = {}
    for name in ("profile.json", "profile.example.json"):
        pp = os.path.join(HERE, name)
        if os.path.exists(pp):
            profile = json.load(open(pp, encoding="utf-8")); break
    by_id = {b["id"]: b for b in wl["buildings"]}
    aliases = wl.get("id_aliases", {})
    by_name = {(b.get("name") or "").lower(): b for b in wl["buildings"]}

    def resolve(L):
        """The agent sometimes emits a looser id (the-verdesian for verdesian).
        Resolve through the alias table, then fall back to the building name."""
        bid = L.get("building_id") or ""
        if bid in by_id:
            return bid, by_id[bid]
        if bid in aliases:
            return aliases[bid], by_id[aliases[bid]]
        nm = (L.get("building") or "").lower().strip()
        if nm in by_name:
            b = by_name[nm]
            return b["id"], b
        for key, b in by_name.items():
            if nm and (nm in key or key in nm):
                return b["id"], b
        return bid, {}

    fpath = os.path.join(DATA, f"found-{date}.json")
    found = json.load(open(fpath)) if os.path.exists(fpath) else {"listings": []}
    bpath = os.path.join(DATA, f"benefits-{date}.json")
    benefits = {b["id"]: b for b in json.load(open(bpath))} if os.path.exists(bpath) else {}

    # ---- building profiles -----------------------------------------------------
    buildings = []
    for b in wl["buildings"]:
        bn = benefits.get(b["id"], {})
        buildings.append({
            "id": b["id"], "name": b["name"], "address": b["address"],
            "neighborhood": b.get("neighborhood"), "hood_id": b.get("hood_id"),
            "lat": b.get("lat"), "lon": b.get("lon"), "bbl": b.get("bbl"),
            "year_built": b.get("built"), "units": b.get("units"),
            "avg_sf_per_unit": b.get("avg_sf_per_unit"),
            "ownership_type": "Rental", "quality_score": b.get("quality_score"),
            "management": (b.get("contact") or {}).get("name"),
            "owner": b.get("owner"), "program": b.get("program"),
            "benefit_status": bn.get("benefit_status") or b.get("dof_trend"),
            "stabilization_note": b.get("evidence"),
            "amenities": b.get("amenities") or {},
            "tier": b.get("tier"), "fit_seed": b.get("fit"),
            "contact": b.get("contact"),
            "dof_exemption_2027": b.get("dof_exemption_2027"),
            "dof_exemption_2023": b.get("dof_exemption_2023"),
        })

    # ---- listings --------------------------------------------------------------
    stamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    listings = []
    for i, L in enumerate(found.get("listings", [])):
        bid, b = resolve(L)
        if b and bid != L.get("building_id"):
            print(f"  resolved building_id {L.get('building_id')!r} -> {bid!r}")
        cls = CONF.get(str(L.get("confidence", "")).strip().lower(), "unknown")
        unit_verified = bool(L.get("unit"))
        out = {
            "id": L.get("id") or f"{date}-{L.get('building_id','x')}-{i}",
            "building_id": bid,
            "building_name": L.get("building") or b.get("name"),
            "address": L.get("address") or b.get("address"),
            "unit": L.get("unit"),
            "neighborhood": b.get("neighborhood"), "hood_id": b.get("hood_id"),
            "lat": b.get("lat"), "lon": b.get("lon"),
            "rent": L.get("rent"), "effective_rent": L.get("effective_rent"),
            "concessions_text": L.get("concessions"),
            "beds": L.get("beds"), "baths": L.get("baths"),
            "sf": L.get("sf"), "sf_source": "published" if L.get("sf") else None,
            "est_market_rent": L.get("est_market_rent"),
            "discount_pct": L.get("discount_pct"),
            "condition": L.get("condition") or b.get("program"),
            "available_date": L.get("available"),
            "listed_date": L.get("listed_date"), "last_verified": L.get("last_verified") or stamp,
            "days_on_market": L.get("days_on_market"),
            "availability_status": "available",
            "source": L.get("source"), "url": L.get("url"),
            "photos": L.get("photos") or [],
            "value_score": L.get("value_score"),
            "listing_grade": "unit_verified" if unit_verified else "building_indicated",
            "stabilization": {"class": cls, "reasons": L.get("reasons") or (
                [b["evidence"]] if b.get("evidence") else ["No unit-level reasoning supplied by the agent."])},
            "why_matches": L.get("why_matches"),
            "tradeoffs": L.get("tradeoffs"),
        }
        if not unit_verified:
            out["cross_check"] = {"status": "conflict", "note":
                "No unit number was resolved. This is a building-level indication that a two-bedroom is "
                "advertised at this rent, not a verified specific apartment. Confirm the unit, the rent and "
                "the square footage by phone before treating it as live."}
            note = ("Building-level indication only. Confirm on the call that a specific unit exists at this "
                    "rent and ask for interior square footage.")
            out["tradeoffs"] = f"{out['tradeoffs']} {note}".strip() if out["tradeoffs"] else note
        if out["sf"] is None and b.get("avg_sf_per_unit"):
            out["why_matches"] = (out["why_matches"] or "") + (
                f" Square footage is not published; the building averages {b['avg_sf_per_unit']} sq ft per unit, "
                "which includes studios and one-bedrooms, so a two-bedroom line is likely larger.")
        listings.append(out)

    payload = {
        "date": date, "generated_at": stamp, "demo": False,
        "search_criteria": profile.get("search", {}),
        "coverage": {
            "sources_blocked": found.get("blocked_sources", []),
            "buildings_searched": len(benefits) or len(buildings),
            "notes": ("Listings without a unit number are building-level indications, not verified units. "
                      "Square footage is rarely published in this market; treat the size-unconfirmed table "
                      "as the primary queue for phone calls."),
        },
        "candidate_additions": found.get("candidate_additions", []),
        "excluded_too_small": found.get("excluded_too_small", []),
        "micro_markets": found.get("micro_markets", []),
        "buildings": buildings, "listings": listings,
    }
    os.makedirs(outdir, exist_ok=True)
    for name in (f"inventory-{date}.json", "inventory-latest.json"):
        with open(os.path.join(outdir, name), "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=1)
    # Script-tag copy so the UI loads straight off the filesystem in Chrome,
    # which blocks fetch() on file:// URLs.
    with open(os.path.join(outdir, "inventory-latest.js"), "w", encoding="utf-8") as f:
        f.write("window.__AW_DATA__ = ")
        json.dump(payload, f, indent=1)
        f.write(";\n")
    print(f"inventory: {len(listings)} listing(s), {len(buildings)} building profile(s) -> {outdir}")
    uv = sum(1 for l in listings if l["listing_grade"] == "unit_verified")
    print(f"  unit-verified {uv}, building-indicated {len(listings)-uv}, "
          f"with square footage {sum(1 for l in listings if l['sf'])}")


if __name__ == "__main__":
    main()
