#!/usr/bin/env python3
"""Merge today's found listings into the persistent seen ledger.

Kept separate from the LLM step so the new-vs-carried-over distinction is
deterministic and cannot drift. Listings are keyed on building_id + unit.

Usage: python3 record.py <YYYY-MM-DD>
"""
import json, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")


def main():
    date_str = sys.argv[1] if len(sys.argv) > 1 else datetime.date.today().isoformat()
    found_path = os.path.join(DATA, f"found-{date_str}.json")
    seen_path = os.path.join(DATA, "seen.json")

    if not os.path.exists(found_path):
        print(f"No found-{date_str}.json; nothing to record.")
        return

    try:
        found = json.load(open(found_path))
    except json.JSONDecodeError as e:
        print(f"found-{date_str}.json is not valid JSON ({e}); skipping merge.", file=sys.stderr)
        return

    seen = json.load(open(seen_path)) if os.path.exists(seen_path) else {"listings": []}
    index = {(l.get("building_id"), l.get("unit")): l for l in seen["listings"]}

    new_count = 0
    for l in found.get("listings", []):
        key = (l.get("building_id"), l.get("unit"))
        if key in index:
            # Already tracked: refresh the volatile fields, keep first_seen.
            existing = index[key]
            existing["last_seen"] = date_str
            if l.get("rent") is not None and l.get("rent") != existing.get("rent"):
                existing.setdefault("rent_history", []).append(
                    {"date": date_str, "rent": l["rent"]})
                existing["rent"] = l["rent"]
        else:
            l["first_seen"] = date_str
            l["last_seen"] = date_str
            seen["listings"].append(l)
            index[key] = l
            new_count += 1

    # Drop anything not seen in 120 days to keep the ledger from growing without bound.
    cutoff = datetime.date.fromisoformat(date_str) - datetime.timedelta(days=120)
    before = len(seen["listings"])
    seen["listings"] = [
        l for l in seen["listings"]
        if datetime.date.fromisoformat(l.get("last_seen", l["first_seen"])) >= cutoff]

    with open(seen_path, "w", encoding="utf-8") as f:
        json.dump(seen, f, indent=2)

    print(f"Recorded {new_count} new listing(s); ledger holds {len(seen['listings'])} "
          f"(pruned {before - len(seen['listings'])}).")


if __name__ == "__main__":
    main()
