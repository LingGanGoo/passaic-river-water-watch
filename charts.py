"""SVG chart generators for Passaic River Water Watch.

Every chart on the data-driven pages (home, readings, advisories) is built
here from the week records, so a new week only needs new data. Coordinate
systems reproduce the original deliverable exactly.
"""
from math import log10, ceil

INK = "#10161A"
MUT = "#4A555C"
GRID = "#C9CDC6"
PAPER = "#F4F5F2"
BAR = "#EAECE7"
GREEN = "#1B6E3C"
YELLOW = "#9A6700"
YELLOW_TEXT = "#8A5C00"
RED = "#A3231C"

MONO = "IBM Plex Mono, ui-monospace, monospace"
SANS = "IBM Plex Sans, Helvetica, sans-serif"

BAND_COLOR = {"green": GREEN, "yellow": YELLOW, "red": RED}
BAND_TEXT_COLOR = {"green": GREEN, "yellow": YELLOW_TEXT, "red": RED}


def f1(x):
    return f"{x:.1f}"


def commas(n):
    return f"{n:,.0f}"


def text(x, y, s, *, font=MONO, size=10, fill=MUT, anchor="start", weight=400,
         spacing="0", extra=""):
    return (f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" '
            f'fill="{fill}" text-anchor="{anchor}" font-weight="{weight}" '
            f'letter-spacing="{spacing}"{extra}>{s}</text>')


def patterns(prefix):
    """The three band textures: green horizontal, yellow diagonal, red crosshatch."""
    return (
        f'<defs>'
        f'<pattern id="{prefix}-g" width="8" height="8" patternUnits="userSpaceOnUse">'
        f'<rect width="8" height="8" fill="{GREEN}"/>'
        f'<path d="M0 4H8" stroke="{PAPER}" stroke-width="1.7"/></pattern>'
        f'<pattern id="{prefix}-y" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
        f'<rect width="8" height="8" fill="{YELLOW}"/>'
        f'<path d="M0 0V8" stroke="{PAPER}" stroke-width="1.9"/></pattern>'
        f'<pattern id="{prefix}-r" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
        f'<rect width="7" height="7" fill="{RED}"/>'
        f'<path d="M0 0V7M0 0H7" stroke="{PAPER}" stroke-width="1.5"/></pattern>'
        f'</defs>')


def band_chip(prefix, band, size):
    """A square chip carrying the band texture, e.g. in legends and headers."""
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 14 14" aria-hidden="true">'
            f'{patterns(prefix)}'
            f'<rect x="0.7" y="0.7" width="12.6" height="12.6" '
            f'fill="url(#{prefix}-{band[0]})" stroke="{INK}" stroke-width="1.2"/></svg>')


def strip_cell(week):
    """One 60x60 square of the weekly strip on the home page."""
    label = (f"{week['date_long']}, {week['ecoli']:g} CFU per 100 milliliters, "
             f"{week['band']}")
    return (f'<svg viewBox="0 0 60 60" role="img" aria-label="{label}">'
            f'{patterns("sp")}'
            f'<rect x="0.9" y="0.9" width="58.2" height="58.2" '
            f'fill="url(#sp-{week["band"][0]})" stroke="{INK}" stroke-width="1.8"/></svg>')


def bands_legend(criteria):
    """The three-bands panel used in the rails."""
    gm, ss = criteria["geometric_mean"], criteria["single_sample"]
    rows = [
        ("g", "GREEN", GREEN, f"under {gm} CFU/100 mL", "normal precautions"),
        ("y", "YELLOW", YELLOW_TEXT, f"{gm} to {ss} CFU/100 mL", "keep hands off your face"),
        ("r", "RED", RED, f"over {ss} CFU/100 mL", "no intentional contact"),
    ]
    out = ['<svg viewBox="0 0 260 108" role="img" aria-label="The three advisory bands, '
           'their counts and their textures">', patterns("bl")]
    y = 8.8
    for key, word, color, rng, advice in rows:
        out.append(f'<rect x="0.8" y="{y}" width="26" height="26" fill="url(#bl-{key})" '
                   f'stroke="{INK}" stroke-width="1.4"/>')
        out.append(text(36.0, y + 12.2, word, size=12, fill=color, weight=600, spacing="0.06em"))
        out.append(text(36.0, y + 24.2, rng))
        out.append(text(150.0, y + 12.2, advice, font=SANS))
        y += 34
    out.append("</svg>")
    return "".join(out)


def rain_scatter(weeks, criteria, annotate_id, annotate_lines, model_line_in=None):
    """Home page figure: 48 h rainfall against E. coli, log y, one point per week."""
    ss = criteria["single_sample"]
    rains = [w["rain"] for w in weeks]
    values = [w["ecoli"] for w in weeks]
    xmax = max(rains) + 0.1
    vmin = min(values) / 1.5
    vmax = max(values) * 1.25
    x0, x1, ytop, ybot = 78, 660, 26, 330
    xs = (x1 - x0) / xmax

    def X(rain):
        return x0 + rain * xs

    def Y(v):
        return ybot - (log10(v) - log10(vmin)) * (ybot - ytop) / (log10(vmax) - log10(vmin))

    out = ['<svg viewBox="0 0 720 430" role="img" aria-label="Each Saturday plotted as '
           '48 hour rainfall against E. coli, with the half inch line and the 235 line drawn">',
           patterns("rs")]
    # horizontal log gridlines at the decades
    d = 100
    while d < vmax:
        if d > vmin:
            y = f1(Y(d))
            out.append(f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="{GRID}" stroke-width="1"/>')
            out.append(text(f1(x0 - 8), f1(Y(d) + 3.5), commas(d), anchor="end"))
        d *= 10
    # the half inch line
    xh = f1(X(0.5))
    out.append(f'<line x1="{xh}" y1="{ytop}" x2="{xh}" y2="{ybot}" stroke="{INK}" '
               f'stroke-width="1.5" stroke-dasharray="6 4"/>')
    out.append(text(f1(X(0.5) + 6), f1(ytop + 12), "0.5 in", size=10.5, fill=INK, weight=600))
    # the single sample line
    ys = f1(Y(ss))
    out.append(f'<line x1="{x0}" y1="{ys}" x2="{x1}" y2="{ys}" stroke="{RED}" stroke-width="1.6"/>')
    out.append(text(f1(x0 + 4), f1(Y(ss) - 6), f"{ss} CFU/100 mL", size=10.5, fill=RED))
    # the model line
    if model_line_in is not None:
        xm = f1(X(model_line_in))
        out.append(f'<line x1="{xm}" y1="{ytop}" x2="{xm}" y2="{ybot}" stroke="{MUT}" '
                   f'stroke-width="1.1" stroke-dasharray="2 3"/>')
        out.append(text(f1(X(model_line_in) - 6), f1(ytop + 12),
                        f"model line, {model_line_in} in", anchor="end"))
    # axes
    out.append(f'<line x1="{x0}" y1="{ytop}" x2="{x0}" y2="{ybot}" stroke="{INK}" stroke-width="1.2"/>')
    out.append(f'<line x1="{x0}" y1="{ybot}" x2="{x1}" y2="{ybot}" stroke="{INK}" stroke-width="1.2"/>')
    t = 0.0
    while t <= xmax - 0.2:
        xt = f1(X(t))
        out.append(f'<line x1="{xt}" y1="{ybot}" x2="{xt}" y2="{ybot + 5}" stroke="{INK}" stroke-width="1.2"/>')
        out.append(text(xt, f1(ybot + 18), f"{t:.2f}", anchor="middle"))
        t += 0.25
    out.append(text(f1(x0), f1(ybot + 36), "48 HOUR ANTECEDENT RAINFALL, INCHES", spacing="0.08em"))
    out.append(f'<text x="-{ybot}" y="16" transform="rotate(-90)" font-family="{MONO}" '
               f'font-size="10" fill="{MUT}" letter-spacing="0.08em">E. COLI, CFU/100 mL, LOG SCALE</text>')
    # points
    ann = None
    for w in weeks:
        cx, cy = X(w["rain"]), Y(w["ecoli"])
        out.append(f'<rect x="{f1(cx - 6.5)}" y="{f1(cy - 6.5)}" width="13" height="13" '
                   f'fill="url(#rs-{w["band"][0]})" stroke="{INK}" stroke-width="1.4"/>')
        if cx > 590:
            out.append(text(f1(cx - 11), f1(cy + 4), w["date_short"], anchor="end"))
        else:
            out.append(text(f1(cx + 11), f1(cy + 4), w["date_short"]))
        if w["id"] == annotate_id:
            ann = (cx, cy)
    if ann:
        out.append(f'<circle cx="{f1(ann[0])}" cy="{f1(ann[1])}" r="15" fill="none" '
                   f'stroke="{INK}" stroke-width="1.2" stroke-dasharray="3 3"/>')
        for i, line in enumerate(annotate_lines):
            out.append(text(f1(ann[0] + 20), f1(ann[1] + 26 + 13 * i), line, font=SANS,
                            size=10.5, fill=INK))
    # the dry and wet summary under the axis
    dry = [w for w in weeks if w["rain"] < 0.5]
    wet = [w for w in weeks if w["rain"] >= 0.5]
    dry_over = sum(1 for w in dry if w["ecoli"] > ss)
    wet_over = sum(1 for w in wet if w["ecoli"] > ss)
    out.append(f'<line x1="{x0}" y1="378" x2="{x1}" y2="378" stroke="{GRID}" stroke-width="1"/>')
    out.append(text(f1(x0), "396.0", "DRY, under 0.5 in", spacing="0.07em"))
    out.append(text(f1(x0), "410.0",
                    f"{len(dry)} Saturdays, "
                    + ("none over the line" if dry_over == 0 else f"{dry_over} of them over the line"),
                    font=SANS, size=10.5, fill=INK))
    out.append(text("338.0", "396.0", "WET, 0.5 in or more", spacing="0.07em"))
    out.append(text("338.0", "410.0",
                    f"{len(wet)} Saturdays, "
                    + ("none over the line" if wet_over == 0 else f"{wet_over} of them over the line"),
                    font=SANS, size=10.5, fill=INK))
    out.append("</svg>")
    return "".join(out)


def season_chart(weeks, criteria):
    """Readings page figure: E. coli by week on a log scale with the rain bars below."""
    gm, ss = criteria["geometric_mean"], criteria["single_sample"]
    x0, x1 = 72, 690
    ytop, ybot = 22, 250
    vmin, vmax = 10, 4000
    step = (x1 - x0) / len(weeks)

    def X(i):
        return x0 + step * (i + 0.5)

    def Y(v):
        return ybot - (log10(v) - log10(vmin)) * (ybot - ytop) / (log10(vmax) - log10(vmin))

    rain_base, rain_top = 372, 300
    rains = [w["rain"] for w in weeks if w["rain"] is not None]
    rain_max = ceil(max(rains + [0.5]) / 0.5) * 0.5
    rain_px = (rain_base - rain_top) / rain_max

    out = ['<svg viewBox="0 0 720 452" role="img" aria-label="E. coli by week on a log '
           'scale with the 126 and 235 lines, and the 48 hour rainfall for each week below">',
           patterns("sc")]
    d = 10
    while d <= 1000:
        y = f1(Y(d))
        out.append(f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="{GRID}" stroke-width="1"/>')
        out.append(text(f1(x0 - 8), f1(Y(d) + 3.5), commas(d), anchor="end"))
        d *= 10
    for v in (20, 50, 200, 500, 2000):
        y = f1(Y(v))
        out.append(f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="{GRID}" '
                   f'stroke-width="0.6" stroke-dasharray="2 4"/>')
    yg, yr = f1(Y(gm)), f1(Y(ss))
    out.append(f'<line x1="{x0}" y1="{yg}" x2="{x1}" y2="{yg}" stroke="{GREEN}" '
               f'stroke-width="1.6" stroke-dasharray="7 4"/>')
    out.append(f'<line x1="{x0}" y1="{yr}" x2="{x1}" y2="{yr}" stroke="{RED}" stroke-width="1.6"/>')
    out.append(f'<line x1="{x0}" y1="{ytop}" x2="{x0}" y2="{ybot}" stroke="{INK}" stroke-width="1.2"/>')
    out.append(f'<line x1="{x0}" y1="{ybot}" x2="{x1}" y2="{ybot}" stroke="{INK}" stroke-width="1.2"/>')
    out.append(f'<text x="-{ybot}" y="16" transform="rotate(-90)" font-family="{MONO}" '
               f'font-size="10" fill="{MUT}" letter-spacing="0.08em">E. COLI, CFU/100 mL, LOG SCALE</text>')
    pts = " ".join(f"{f1(X(i))},{f1(Y(w['ecoli']))}" for i, w in enumerate(weeks))
    out.append(f'<polyline points="{pts}" fill="none" stroke="{INK}" stroke-width="1.3"/>')
    for i, w in enumerate(weeks):
        cx, cy = X(i), Y(w["ecoli"])
        out.append(f'<rect x="{f1(cx - 6.5)}" y="{f1(cy - 6.5)}" width="13" height="13" '
                   f'fill="url(#sc-{w["band"][0]})" stroke="{INK}" stroke-width="1.4"/>')
        out.append(text(f1(cx), f1(cy - 12), commas(w["ecoli"]), size=10.5, fill=INK,
                        anchor="middle", weight=600))
    out.append(text(f1(x0 + 8), f1(Y(ss) - 7.9), f"{ss}, single sample", fill=RED,
                    extra=f' paint-order="stroke" stroke="{PAPER}" stroke-width="3.2" stroke-linejoin="round"'))
    out.append(text(f1(x0 + 8), f1(Y(gm) + 12.4), f"{gm}, geometric mean criterion", fill=GREEN,
                    extra=f' paint-order="stroke" stroke="{PAPER}" stroke-width="3.2" stroke-linejoin="round"'))
    # rain panel
    out.append(f'<line x1="{x0}" y1="{rain_base}" x2="{x1}" y2="{rain_base}" stroke="{INK}" stroke-width="1.2"/>')
    out.append(text(f1(x0 - 8), f1(rain_top + 4), f"{rain_max:g}", anchor="end"))
    out.append(text(f1(x0 - 8), f1(rain_base + 4), "0", anchor="end"))
    out.append(f'<text x="-{rain_base}" y="16" transform="rotate(-90)" font-family="{MONO}" '
               f'font-size="10" fill="{MUT}" letter-spacing="0.08em">48 h RAIN, IN</text>')
    for i, w in enumerate(weeks):
        cx = X(i)
        if w["rain"] is not None and w["rain"] > 0:
            h = w["rain"] * rain_px
            out.append(f'<rect x="{f1(cx - 13)}" y="{f1(rain_base - h)}" width="26" '
                       f'height="{f1(h)}" fill="{BAR}" stroke="{INK}" stroke-width="1"/>')
            label_y = rain_base - h - 5
        else:
            out.append(f'<line x1="{f1(cx - 13)}" y1="{rain_base}" x2="{f1(cx + 13)}" '
                       f'y2="{rain_base}" stroke="{MUT}" stroke-width="1.2"/>')
            label_y = rain_base - 5
        rain_label = "n/a" if w["rain"] is None else f"{w['rain']:.2f}"
        out.append(text(f1(cx), f1(label_y), rain_label, size=9.5, anchor="middle"))
        day, mon = w["date_short"].split()
        out.append(text(f1(cx), f1(rain_base + 16), day, anchor="middle"))
        out.append(text(f1(cx), f1(rain_base + 27), mon, size=9, anchor="middle"))
    out.append(text(f1(x0), "444.0", "Rain is the total in the 48 hours before the sample, "
                    "read from the gauge at the boathouse."))
    out.append("</svg>")
    return "".join(out)


PLATE_ROWS = [
    ("E. COLI", "ecoli"),
    ("48 H RAIN", "rain"),
    ("WATER TEMP", "temp"),
    ("TURBIDITY", "turbidity"),
    ("NITRATE N", "nitrate"),
    ("ORTHO P", "orthop"),
]
PLATE_FMT = {"ecoli": commas, "rain": lambda v: f"{v:.2f}", "temp": lambda v: f"{v:.1f}",
             "turbidity": lambda v: f"{v:g}", "nitrate": lambda v: f"{v:.2f}",
             "orthop": lambda v: f"{v:.2f}"}


def record_plate(week, index, ranges):
    """The small 'this week in the range so far' panel beside each record."""
    prefix = f"pl{index}"
    tx0, tx1 = 92, 196
    rows = [(label, key) for label, key in PLATE_ROWS
            if week.get(key) is not None and key in ranges]
    height = 30 + (len(rows) - 1) * 24 + 21
    out = [f'<svg viewBox="0 0 250 {height}" role="img" aria-label="This week measured '
           'against the range of the weeks published so far">', patterns(prefix)]
    out.append(text("0.0", "10.0", "THIS WEEK IN THE RANGE SO FAR", size=8.6, spacing="0.07em"))
    ty = 30.0
    for label, key in rows:
        v = week[key]
        lo, hi = ranges[key]
        if key == "ecoli":
            frac = (log10(v) - log10(lo)) / (log10(hi) - log10(lo)) if hi > lo else 0.5
        else:
            frac = (v - lo) / (hi - lo) if hi > lo else 0.5
        cx = tx0 + frac * (tx1 - tx0)
        out.append(text("0.0", f1(ty + 3), label, size=8.6, spacing="0.06em"))
        out.append(f'<line x1="{tx0}" y1="{f1(ty)}" x2="{tx1}" y2="{f1(ty)}" stroke="{GRID}" stroke-width="1"/>')
        out.append(f'<line x1="{tx0}" y1="{f1(ty - 4)}" x2="{tx0}" y2="{f1(ty + 4)}" stroke="{GRID}" stroke-width="1"/>')
        out.append(f'<line x1="{tx1}" y1="{f1(ty - 4)}" x2="{tx1}" y2="{f1(ty + 4)}" stroke="{GRID}" stroke-width="1"/>')
        if key == "ecoli":
            out.append(f'<rect x="{f1(cx - 4.5)}" y="{f1(ty - 4.5)}" width="9" height="9" '
                       f'fill="url(#{prefix}-{week["band"][0]})" stroke="{INK}" stroke-width="1.2"/>')
        else:
            out.append(f'<rect x="{f1(cx - 3.5)}" y="{f1(ty - 3.5)}" width="7" height="7" fill="{INK}"/>')
        out.append(text("250.0", f1(ty + 3), PLATE_FMT[key](v), fill=INK, anchor="end", weight=600))
        ty += 24
    out.append("</svg>")
    return "".join(out)
