#!/usr/bin/env python3
"""Build the Passaic River Water Watch site into dist/.

Usage:  .venv/bin/python build.py

Inputs:
  data/rutherford-reach-wq-2026.json  - the published dataset, the source of truth
  data/editorial.json                 - written narrative: weekly notes, advisories as sent
  data/site.json                      - site configuration
  templates/                          - Jinja2 templates
  static/                             - CSS and brand SVGs

Everything numeric on the home, readings and advisories pages - statistics,
tables, and every chart - is computed from the dataset at build time. The
build tolerates a young season: missing rain records, non-detects, and
sections that need more data simply do not render yet.
"""
import json
import math
import re
import shutil
from datetime import date, datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

import charts

ROOT = Path(__file__).parent
DIST = ROOT / "dist"

WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
         "nine", "ten", "eleven", "twelve"]
ORDINALS = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth",
            "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"]


def word(n, capitalize=False):
    w = WORDS[n] if 0 <= n < len(WORDS) else str(n)
    return w.capitalize() if capitalize else w


def ordinal(n):
    return ORDINALS[n] if 0 < n < len(ORDINALS) else f"{n}th"


def d_long(d):
    return f"{d.day} {d.strftime('%B')} {d.year}"


def d_noyear(d):
    return f"{d.day} {d.strftime('%B')}"


def d_short(d):
    return f"{d.day} {d.strftime('%b')}"


def join_and(items, oxford=False):
    items = [str(i) for i in items]
    if len(items) < 2:
        return "".join(items)
    sep = ", and " if oxford else " and "
    return ", ".join(items[:-1]) + sep + items[-1]


def geomean(values):
    return math.exp(sum(math.log(v) for v in values) / len(values))


def opt_float(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def load_weeks(dataset, editorial):
    """Merge the dataset records into one object per sampling week."""
    by_activity = {}
    for r in dataset["records"]:
        # QC splits carry a "-QC" activity id; file them with their parent week
        by_activity.setdefault(r["activity_id"].replace("-QC", ""), []).append(r)
    ed_weeks = {w["id"]: w for w in editorial["weeks"]}
    gm = dataset["criteria"]["geometric_mean"]
    ss = dataset["criteria"]["single_sample"]

    weeks = []
    for i, (aid, recs) in enumerate(sorted(by_activity.items()), start=1):
        by_char = {r["characteristic_name"]: r for r in recs
                   if not r["record_id"].endswith("QC")}

        def val(char):
            r = by_char.get(char)
            return opt_float(r["result_value"]) if r else None

        def display(char, fmt="{}"):
            """Human-readable value: honors non-detects and missing records."""
            r = by_char.get(char)
            if r is None:
                return None
            if r["result_detection_condition"]:
                cond = r["result_detection_condition"]
                return {"not detected": "negligible",
                        "too numerous to count": "TNTC"}.get(cond, cond)
            return fmt.format(r["result_value"])

        ec = by_char["Escherichia coli"]
        d = date.fromisoformat(ec["activity_start_date"])
        value = float(ec["result_value"])
        band = "green" if value < gm else ("red" if value > ss else "yellow")
        plates = re.search(r"(\d+) and (\d+) colonies", ec["result_comment"])
        qc = next((r for r in recs if r["record_id"].endswith("QC")), None)
        split = None
        if qc:
            lab = float(qc["result_value"])
            split = {
                "lab": lab,
                "rpd": abs(lab - value) / ((lab + value) / 2) * 100,
                "logdiff": abs(math.log10(lab) - math.log10(value)),
            }
        turb = by_char.get("Turbidity")
        w = {
            "id": f"w{i:02d}",
            "num": i,
            "activity_id": aid,
            "date": d,
            "date_long": d_long(d),
            "date_noyear": d_noyear(d),
            "date_short": d_short(d),
            "time": ec["activity_start_time"],
            "tide": ec["tide_stage"],
            "ecoli": value,
            "ecoli_comment": ec["result_comment"],
            "rain": opt_float(ec["antecedent_rain_48h_in"]),
            "temp": val("Temperature, water"),
            "ph": display("pH"),
            "turbidity": val("Turbidity"),
            "turbidity_unit": turb["result_unit"] if turb else "",
            "nitrate": val("Nitrate as N"),
            "nitrate_raw": display("Nitrate as N"),
            "orthop": val("Orthophosphate"),
            "orthop_str": display("Orthophosphate"),
            "coliform": display("Total coliforms"),
            "plate_a": int(plates.group(1)) if plates else None,
            "plate_b": int(plates.group(2)) if plates else None,
            "band": band,
            "band_word": band.upper(),
            "split": split,
            "say": ed_weeks.get(f"w{i:02d}", {}).get("say", ""),
        }
        weeks.append(w)
    return weeks


def season_stats(weeks, criteria):
    ss = criteria["single_sample"]
    values = [w["ecoli"] for w in weeks]
    rained = [w for w in weeks if w["rain"] is not None]
    dry = [w for w in rained if w["rain"] < 0.25]
    wet = [w for w in rained if w["rain"] >= 0.5]
    over = [w for w in weeks if w["ecoli"] > ss]
    wet_over = [w for w in wet if w["ecoli"] > ss]
    ranked = sorted(values)
    n = len(values)
    if n % 2 == 0:
        median = (ranked[n // 2 - 1] + ranked[n // 2]) / 2
        median_rule = (f"mean of the {ordinal(n // 2)} and {ordinal(n // 2 + 1)} "
                       f"values in rank order")
    else:
        median = ranked[n // 2]
        median_rule = (f"the {ordinal(n // 2 + 1)} value in rank order" if n > 1
                       else "the single value so far")
    lo = min(weeks, key=lambda w: w["ecoli"])
    hi = max(weeks, key=lambda w: w["ecoli"])
    colors = {b: sum(1 for w in weeks if w["band"] == b) for b in ("green", "yellow", "red")}
    splits = [w["split"] for w in weeks if w["split"]]
    expected = (weeks[-1]["date"] - weeks[0]["date"]).days // 7 + 1
    return {
        "n": n,
        "gaps": expected - n,
        "season_gm": round(geomean(values)),
        "dry_gm": round(geomean([w["ecoli"] for w in dry])) if dry else None,
        "wet_gm": round(geomean([w["ecoli"] for w in wet])) if wet else None,
        "wet_dry_ratio": (geomean([w["ecoli"] for w in wet])
                          / geomean([w["ecoli"] for w in dry])) if dry and wet else None,
        "median": f"{median:g}",
        "median_rule": median_rule,
        "over": over,
        "over_count": len(over),
        "over_weeks": join_and([w["num"] for w in over]),
        "dry_count": len(dry),
        "wet_count": len(wet),
        "wet_over_count": len(wet_over),
        "lo": lo,
        "hi": hi,
        "colors": colors,
        "colors_line": ", ".join(f"{colors[b]} {b}" for b in ("green", "yellow", "red")
                                 if colors[b]),
        "split_count": len(splits),
        "split_max_log": (math.ceil(max(s["logdiff"] for s in splits) * 100) / 100
                          if splits else None),
        # rain-based analysis only makes sense with at least two of each kind of week
        "has_rain_story": len(dry) >= 2 and len(wet) >= 2,
    }


def main():
    dataset = json.loads((ROOT / "data" / "rutherford-reach-wq-2026.json").read_text())
    editorial = json.loads((ROOT / "data" / "editorial.json").read_text())
    site = json.loads((ROOT / "data" / "site.json").read_text())

    criteria = dataset["criteria"]
    weeks = load_weeks(dataset, editorial)
    stats = season_stats(weeks, criteria)
    latest = weeks[-1]
    updated = date.fromisoformat(dataset["released"])
    advisories = editorial["advisories"]
    week_by_id = {w["id"]: w for w in weeks}
    for a in advisories:
        a["week"] = week_by_id[a["week_id"]] if "week_id" in a else weeks[a_index(a)]

    if len(weeks) == 1:
        season_range = f"began {d_long(weeks[0]['date'])}"
    else:
        season_range = f"{d_noyear(weeks[0]['date'])} to {d_long(weeks[-1]['date'])}"

    # the annotated scatter needs at least two weeks with a rain record
    ann = site.get("scatter_annotation")
    ann_week = week_by_id.get(ann["week"]) if ann else None
    scatter = None
    rained = [w for w in weeks if w["rain"] is not None]
    if len(rained) >= 2:
        ann_lines = []
        if ann_week:
            ann_lines = [
                f"{ann_week['date_noyear']}: {ann_week['rain']:.2f} in of rain, "
                f"{charts.commas(ann_week['ecoli'])} CFU/100 mL,",
                ann["second_line"],
            ]
        scatter = charts.rain_scatter(rained, criteria,
                                      ann["week"] if ann_week else None, ann_lines,
                                      model_line_in=site.get("model_line_in"))

    ranges = {}
    for key in ("ecoli", "rain", "temp", "turbidity", "nitrate", "orthop"):
        vals = [w[key] for w in weeks if w[key] is not None]
        if vals:
            ranges[key] = (0 if key == "rain" else min(vals), max(vals))

    env = Environment(loader=FileSystemLoader(ROOT / "templates"), autoescape=False)
    env.globals.update(
        site=site,
        station=dataset["station"],
        license=dataset["license"],
        row_count=dataset["row_count"],
        ann_week=ann_week,
        criteria=criteria,
        weeks=weeks,
        latest=latest,
        stats=stats,
        advisories=advisories,
        updated_long=d_long(updated),
        season_range=season_range,
        commas=charts.commas,
        word=word,
        charts={
            "band_chip": charts.band_chip,
            "strip_cells": [charts.strip_cell(w) for w in weeks],
            "bands_legend": charts.bands_legend(criteria),
            "rain_scatter": scatter,
            "season_chart": charts.season_chart(weeks, criteria),
            "record_plates": {w["id"]: charts.record_plate(w, i + 1, ranges)
                              for i, w in enumerate(weeks)},
        },
        weekday=lambda d: d.strftime("%A"),
    )

    pages = {
        "index": "",
        "readings": "readings",
        "advisories": "advisories",
        "methods": "methods",
        "data": "data",
        "about": "about",
    }
    if DIST.exists():
        shutil.rmtree(DIST)
    for name, out_dir in pages.items():
        html = env.get_template(f"{name}.html.j2").render(nav_page=name)
        out = DIST / out_dir / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(html)
        print(f"built {out.relative_to(ROOT)}  ({len(html):,} bytes)")
    shutil.copytree(ROOT / "static", DIST, dirs_exist_ok=True)
    # publish the dataset itself from data/, the single source of truth
    pub = DIST / "assets" / "data"
    pub.mkdir(parents=True, exist_ok=True)
    for f in (ROOT / "data").glob("rutherford-reach-*.*"):
        shutil.copy(f, pub / f.name)
    print(f"copied static assets + dataset -> dist/  [{datetime.now():%H:%M:%S}]")


def a_index(a):
    """Advisory id 'a07' -> weeks list index 6."""
    return int(a["id"][1:]) - 1


if __name__ == "__main__":
    main()
