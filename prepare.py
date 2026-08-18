#!/usr/bin/env python3
"""Deterministic prep step for the NYC Apartment Watch agent.

Does the parts that must NOT be left to an LLM:
  1. Re-verifies, against the live NYC DOF assessment roll, whether each watchlist
     building's tax exemption is still running. A 421-a / 421-g exemption that has
     lapsed means new vacancies in that building are almost certainly unregulated,
     which changes the building's priority.
  2. Chooses the day's target set: every Tier 1 building every run, plus a rotating
     slice of Tier 2/3 so a full sweep completes each week without making any single
     run enormous.
  3. Loads the "already seen" listing ledger so the daily brief can separate genuinely
     NEW vacancies from ones carried over.
  4. Writes data/context-<DATE>.md, which run.sh splices into the prompt.

Usage: python3 prepare.py <YYYY-MM-DD>
"""
import json, os, sys, datetime, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
DOF = "https://data.cityofnewyork.us/resource/8y4t-faws.json"


def load_profile():
    """Read profile.json, the only place personal detail lives.

    Gitignored on purpose: income, disability status and anything else about the
    tenant belongs here and nowhere else in the repo. Falls back to
    profile.example.json so a fresh clone still runs, with placeholder values.
    """
    for name in ("profile.json", "profile.example.json"):
        path = os.path.join(HERE, name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                p = json.load(f)
            if name.endswith("example.json"):
                print("NOTE: profile.json not found, running from profile.example.json. "
                      "Copy it to profile.json and set your own values.", file=sys.stderr)
            return p
    raise SystemExit("No profile.json or profile.example.json found. Copy the example and edit it.")
# An exemption below this is noise (co-op/condo abatement, small STAR-type items),
# not a live 421-a/421-g/J-51 benefit on a large rental building.
LIVE_EXEMPTION_FLOOR = 1_000_000


def dof_exemption(block, lot):
    """Return (latest_exempt, latest_year, trend_label) for a BBL.

    The DOF dataset carries several rows per BBL per roll year (different assessment
    periods), and multiple roll years at once. Taking rows[0] after an ORDER BY silently
    mixes years, so this pulls every row, buckets by year, takes the max within each
    year, and reports the newest year plus the multi-year direction.

    Direction matters: a 421-a exemption steps down over the final years of the benefit
    period, so a falling exemption is an early warning that the building's stabilization
    is due to end.
    """
    q = (f"?boro=1&block={block}&lot={lot}&$limit=60"
         f"&$select=year,curactextot,finactextot,units,owner")
    try:
        raw = urllib.request.urlopen(DOF + urllib.parse.quote(q, safe="?&=$,"), timeout=45).read()
        rows = json.loads(raw)
    except Exception as e:
        print(f"  DOF lookup failed for block {block} lot {lot}: {e}", file=sys.stderr)
        return None, None, "lookup failed"
    if not rows:
        return None, None, "no record"

    by_year = {}
    for r in rows:
        y = str(r.get("year") or "")
        if not y:
            continue
        try:
            v = float(r.get("curactextot") or r.get("finactextot") or 0)
        except (TypeError, ValueError):
            v = 0.0
        by_year[y] = max(by_year.get(y, 0.0), v)
    if not by_year:
        return None, None, "no usable rows"

    years = sorted(by_year)
    latest, earliest = years[-1], years[0]
    now, then = by_year[latest], by_year[earliest]

    if now >= LIVE_EXEMPTION_FLOOR:
        if then > 0 and now < then * 0.85:
            trend = f"PHASING DOWN (was ${then:,.0f} on the {earliest} roll), benefit period is ending"
        else:
            trend = "stable"
    elif then >= LIVE_EXEMPTION_FLOOR:
        trend = f"EXPIRED (was ${then:,.0f} on the {earliest} roll, now zero)"
    else:
        trend = "no benefit on record"
    return now, latest, trend


def rotation_slice(buildings, run_date):
    """Tier 1 every day; Tier 2/3 split into 7 buckets, one bucket per weekday."""
    tier1 = [b for b in buildings if b["tier"] == 1 and b["watch"]]
    rest = [b for b in buildings if b["tier"] != 1 and b["watch"]]
    bucket = run_date.toordinal() % 7
    rotating = [b for i, b in enumerate(rest) if i % 7 == bucket]
    return tier1, rotating


def main():
    date_str = sys.argv[1] if len(sys.argv) > 1 else datetime.date.today().isoformat()
    run_date = datetime.date.fromisoformat(date_str)
    os.makedirs(DATA, exist_ok=True)

    wl = json.load(open(os.path.join(HERE, "watchlist.json")))
    profile = load_profile()
    crit = profile["search"]
    tenant = profile.get("tenant_context", {})
    qual = profile.get("qualifying", {})
    tier1, rotating = rotation_slice(wl["buildings"], run_date)
    targets = tier1 + rotating

    # --- 1. live benefit verification -------------------------------------------------
    print(f"Verifying tax benefits for {len(targets)} target buildings against DOF...")
    for b in targets:
        ex, yr, trend = dof_exemption(b["block"], b["lot"])
        b["_dof_exemption"] = ex
        b["_dof_year"] = yr
        b["_dof_trend"] = trend
        if ex is None:
            b["_benefit_status"] = ("UNREADABLE (condo billing lot or no DOF record). "
                                    "Verify manually on the DOF property tax bill.")
        elif ex >= LIVE_EXEMPTION_FLOOR:
            b["_benefit_status"] = f"LIVE: ${ex:,.0f} exempt on the {yr} roll. Trend: {trend}."
        elif trend.startswith("EXPIRED"):
            b["_benefit_status"] = (f"BENEFIT EXPIRED: {trend}. New vacancies here are very likely "
                                    "unregulated. Treat as a size/location play, not a stabilization play.")
        else:
            b["_benefit_status"] = (f"NO LIVE BENEFIT (${ex:,.0f} on the {yr} roll). "
                                    "Only relevant if the building is pre-1974, where stabilization "
                                    "does not depend on a tax benefit.")
        print(f"  {b['name'][:38]:38s} {b['_benefit_status']}")

    # --- 2. seen ledger ---------------------------------------------------------------
    seen_path = os.path.join(DATA, "seen.json")
    seen = json.load(open(seen_path)) if os.path.exists(seen_path) else {"listings": []}
    recent = [l for l in seen["listings"]
              if (run_date - datetime.date.fromisoformat(l["first_seen"])).days <= 45]

    # --- 3. write the context block ---------------------------------------------------
    lines = [f"# Watch context for {date_str}", ""]
    floor = crit["min_sf_hard_floor"]
    # The context block lands in data/, which is gitignored, so this is the one
    # place personal detail is allowed to appear in generated output.
    who = [x for x in (tenant.get("profile_note"), tenant.get("protected_class_note")) if x]
    lines.append(f"Target {crit.get('beds', 2)}BR, rent ${crit['rent_min']:,} to "
                 f"${crit['rent_max']:,} (stretch ${crit['rent_stretch_max']:,})."
                 + (" " + " ".join(who) if who else ""))
    if tenant.get("exclude_income_restricted"):
        lines.append("Do not surface income-restricted or AMI-capped units, including Housing "
                     "Connect lotteries, Mitchell-Lama and HPD/HDC set-asides.")
    lines.append("")
    lines.append(f"**HARD SIZE FLOOR: {floor:,} sq ft.** Do not report any two-bedroom confirmed "
                 f"smaller than {floor:,} sq ft as a candidate; log it as excluded with its actual "
                 f"size. {crit['target_sf']:,}+ sq ft remains the target, so sort largest first. "
                 "Listings with no published square footage go in the size-unconfirmed table, never "
                 "dropped silently and never estimated as fact.")
    income = qual.get("annual_income") or 0
    if income:
        mult = qual.get("income_multiple", 40)
        ceiling = income // mult
        extra = qual.get("extra_income_sources") or []
        lines.append(f"At a {mult}x standard, stated income of ${income:,} qualifies to about "
                     f"${ceiling:,}/month. Flag anything above that as needing "
                     + (", ".join(x.split(",")[0] for x in extra) + ", " if extra else "")
                     + "assets shown, or a guarantor.")
        if qual.get("notes"):
            lines.append(qual["notes"])
    lines.append("")
    lines.append(f"## Today's target buildings ({len(tier1)} Tier 1 + {len(rotating)} rotating)")
    lines.append("")
    for b in targets:
        c = b["contact"]
        contact_bits = []
        if c.get("phone"):
            contact_bits.append(f"phone {c['phone']}" + ("" if c.get("verified") else " (UNVERIFIED)"))
        if c.get("url"):
            contact_bits.append(c["url"])
        contact = "; ".join(contact_bits) if contact_bits else "NO CONTACT ON FILE - look this up and report it"
        lines.append(f"### {b['name']} ({b['address']})")
        lines.append(f"- Tier {b['tier']}, Fit {b['fit']}, {b['neighborhood']}, BBL {b['bbl']}")
        avg = b["avg_sf_per_unit"]
        if avg is None:
            size_note = "avg sf/unit unknown"
        elif avg < floor:
            size_note = (f"avg {avg} sf/unit, BELOW the {floor:,} sq ft floor. A qualifying 2BR here is "
                         "the exception, not the norm: check the largest lines and corner units "
                         "specifically, and expect most inventory to be excluded on size.")
        elif avg >= crit["target_sf"]:
            size_note = f"avg {avg} sf/unit, at or above the {crit['target_sf']:,} sq ft target. Prioritize."
        else:
            size_note = f"avg {avg} sf/unit, clears the floor but below the {crit['target_sf']:,} sq ft target."
        lines.append(f"- Built {b['built']}, {b['units']} units, {size_note}")
        lines.append(f"- Program on file: {b['program']}")
        lines.append(f"- Benefit status verified today: {b['_benefit_status']}")
        lines.append(f"- Owner/manager: {b['owner']}")
        lines.append(f"- Contact on file: {contact}")
        lines.append(f"- Evidence: {b['evidence']}")
        lines.append("")

    lines.append("## Listings already surfaced in the last 45 days")
    lines.append("Treat these as CARRIED OVER, not new. Note if the rent has changed or it is gone.")
    lines.append("")
    if recent:
        for l in recent:
            lines.append(f"- {l['building']} unit {l.get('unit','?')}, "
                         f"${l.get('rent','?')}, {l.get('sf','?')} sf, first seen {l['first_seen']}")
    else:
        lines.append("- (none on file yet; this is an early run)")
    lines.append("")

    ctx_path = os.path.join(DATA, f"context-{date_str}.md")
    with open(ctx_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"\nWrote {ctx_path}")

    # Snapshot today's verified benefit status for trend tracking.
    with open(os.path.join(DATA, f"benefits-{date_str}.json"), "w", encoding="utf-8") as f:
        json.dump([{k: v for k, v in b.items() if not k.startswith("_")} |
                   {"dof_exemption": b["_dof_exemption"], "dof_year": b["_dof_year"], "dof_trend": b["_dof_trend"],
                    "benefit_status": b["_benefit_status"]} for b in targets], f, indent=2)


if __name__ == "__main__":
    main()
