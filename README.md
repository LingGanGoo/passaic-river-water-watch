# Passaic River Water Watch — site generator

A maintainable rebuild of the Passaic River Water Watch site
(originally at `crcs-site-563779.netlify.app/sample-deliverables/01-passaic-river-water-watch/goal/`).
The build output is verified to reproduce the original deliverable exactly —
every chart coordinate, statistic and table is regenerated from the dataset
at build time.

## Setup (once)

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Build and serve

```bash
.venv/bin/python build.py
python3 -m http.server 8123 -d dist
```

Then open http://localhost:8123.

## How it works

| Path | Role |
|---|---|
| `data/rutherford-reach-wq-2026.json` | **The source of truth.** All readings, station metadata, criteria. Also published verbatim on the data page. |
| `data/rutherford-reach-wq-2026.csv` | CSV twin of the dataset, published on the data page. Keep in sync with the JSON. |
| `data/editorial.json` | Written narrative: the per-week field note (`weeks[].say`) and each advisory exactly as sent (`advisories[]`). |
| `data/site.json` | Site configuration: nav, season status line, band advice text, scatter annotation, model line. |
| `build.py` | Loads data, computes season statistics (geometric means, exceedances, bands…), renders every page into `dist/`. |
| `charts.py` | Generates every data-driven SVG: weekly strip, rain/E. coli scatter, season chart with rain bars, per-record range plates, band legends. |
| `templates/` | Jinja2 templates. `base.html.j2` is the shared chrome; `index`/`readings`/`advisories` are data-driven; `methods`/`model`/`alerts`/`data`/`about` are prose pages. |
| `static/` | CSS and brand SVGs, copied into `dist/` as-is. |

Statistics, band calls (green < 126 ≤ yellow ≤ 235 < red), wet/dry splits,
split-sample RPDs and every chart scale are **computed, not typed**. Chart
domains adapt to the data (e.g. the scatter's axes are derived from the
season's min/max), so new readings land correctly without touching code.

## Adding a new week

1. **Dataset** — append the week's records to `data/rutherford-reach-wq-2026.json`
   (and the CSV): one record per characteristic (`Escherichia coli`,
   `Temperature, water`, `pH`, `Turbidity`, `Nitrate as N`, `Orthophosphate`)
   under a new `activity_id` (`RRWQ-2026-W11`). Put the duplicate plate counts
   in the E. coli record's `result_comment`
   (`"mean of duplicate plates, 9 and 9 colonies on 5 mL"` — the build parses
   this). A lab split, if any, is an extra record with activity id
   `RRWQ-2026-W11-QC` and record id ending `-ECOLI-QC`. Update `released` /
   `row_count`.
2. **Editorial** — add `{"id": "w11", "say": "…"}` to `weeks` in
   `data/editorial.json`, and an entry to `advisories` (heading, meta lines,
   the note text as sent, and `sent_label` for the archive table).
3. Adjust `season_status` in `data/site.json` if the season is still running.
4. `.venv/bin/python build.py`

The header ("LAST READING"), strip, charts, statistics tables, rail panels
and the readings record all update from step 1 alone.

Caveat: the connecting prose paragraphs on the home and readings pages
interpolate the computed numbers, but the sentences around them describe
*this* season's pattern ("every one of those four followed more than half an
inch of rain"). When the data stops supporting a sentence, rewrite the
sentence in the template — the numbers will already be right.

The prose pages (`methods`, `model`, `alerts`, `data`, `about`) are static
content; a handful of figures in them are hand-drawn SVG kept verbatim in the
templates. The two other static figures (the advisory-cycle diagram on the
advisories page) live in their templates too.

## Verifying against the original

`compare.py` in the original working scratchpad diffed every built page
against the live site (link-normalized) — all 8 pages matched with zero
changed lines at hand-off. If you want to re-verify later, mirror the live
pages and diff `dist/` against them after rewriting the
`/sample-deliverables/01-passaic-river-water-watch/goal/…` links to `/…`.
