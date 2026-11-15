/* Passaic River Water Watch: source map.
   Station readings come from /map/data.json, which build.py writes from the
   published dataset. Outfalls, monitoring stations and model rainfall load
   live in the visitor's browser. */
(function () {
  'use strict';

  var CFG = {
    reachBox: [-74.22, 40.70, -74.08, 40.95],   // Paterson to Newark Bay, so upstream overflows are included
    localBox: [-74.15, 40.80, -74.09, 40.86],   // both banks within about two miles of the dock
    csoUrl: 'https://mapsdep.nj.gov/arcgis/rest/services/Features/Utilities/MapServer/0/query',
    ms4Url: 'https://mapsdep.nj.gov/arcgis/rest/services/Applications/MS4_Map/MapServer/5/query',
    wqpStations: 'https://www.waterqualitydata.us/data/Station/search',
    wqpResults: 'https://www.waterqualitydata.us/data/Result/search',
    meteo: 'https://archive-api.open-meteo.com/v1/archive'
  };
  // Dry and wet use the same cut points as the rest of the site: under 0.25 in, and 0.5 in or more.
  var RAIN_BANDS = [
    { label: 'Dry', range: 'under 0.25 in', test: function (r) { return r < 0.25; } },
    { label: 'Between', range: '0.25 to 0.49 in', test: function (r) { return r >= 0.25 && r < 0.5; } },
    { label: 'Wet', range: '0.50 to 0.99 in', test: function (r) { return r >= 0.5 && r < 1; } },
    { label: 'Heavy', range: '1 in or more', test: function (r) { return r >= 1; } }
  ];
  var TIDES = [
    { key: 'ebb', label: 'Falling tide', hint: 'water moving downstream' },
    { key: 'flood', label: 'Rising tide', hint: 'water moving upstream' },
    { key: 'slack', label: 'Slack', hint: 'at the turn' }
  ];
  var css = getComputedStyle(document.documentElement);
  var tok = function (n) { return css.getPropertyValue(n).trim(); };
  var RAMP = ['--seq0', '--seq1', '--seq2', '--seq3', '--seq4'].map(tok);
  var INK = tok('--ink'), PAPER = tok('--paper'), MUTED = tok('--muted'), BORDER = tok('--border');

  var state = { data: null, modelRain: null, modelDaily: null, rainSrc: 'recorded', cso: null, ms4: null };
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var DAY = 864e5;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var dShort = function (iso) { return +iso.slice(8, 10) + ' ' + MONTHS[+iso.slice(5, 7) - 1]; };
  var isoDay = function (ms) { return new Date(ms).toISOString().slice(0, 10); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function geomean(a) { return a.length ? Math.exp(a.reduce(function (s, v) { return s + Math.log(v); }, 0) / a.length) : NaN; }
  function hexToRgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  // One-hue sequential colour on a log scale from the 126 level to 3,000
  function colorFor(v) {
    var lo = state.data.criteria.geometric_mean;
    var t = (Math.log(v) - Math.log(lo)) / (Math.log(3000) - Math.log(lo));
    t = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
    var i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
    var a = hexToRgb(RAMP[i]), b = hexToRgb(RAMP[i + 1]);
    var c = a.map(function (x, k) { return Math.round(x + (b[k] - x) * f); });
    var lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    return { bg: 'rgb(' + c.join(',') + ')', ink: lum > 0.5 ? INK : PAPER };
  }
  function rainOf(ev) {
    if (state.rainSrc === 'model' && state.modelRain && state.modelRain[ev.id] != null) return state.modelRain[ev.id];
    return ev.rain48_in;
  }
  var tideLabel = function (k) { for (var i = 0; i < TIDES.length; i++) if (TIDES[i].key === k) return TIDES[i].label.toLowerCase(); return 'not recorded'; };

  /* tooltip */
  var tip = $('tip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.style.display = 'block';
    var w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 14)) + 'px';
    tip.style.top = Math.max(8, (y + h + 24 > window.innerHeight ? y - h - 12 : y + 16)) + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }
  function bindTip(el, html) {
    el.addEventListener('mousemove', function (e) { showTip(html, e.clientX, e.clientY); });
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('focus', function () { var r = el.getBoundingClientRect(); showTip(html, r.left, r.bottom); });
    el.addEventListener('blur', hideTip);
  }
  function evTip(ev) {
    var crit = state.data.criteria;
    return '<b>' + esc(ev.id) + ', ' + dShort(ev.date) + ', ' + esc(ev.time) + '</b><br>' +
      fmt(ev.ecoli) + ' ' + esc(crit.unit) + '<br>' +
      'Rain in the prior 48 h: ' + (ev.rain48_in == null ? 'not recorded' : ev.rain48_in.toFixed(2) + ' in') +
      (state.modelRain && state.modelRain[ev.id] != null ? ' (model ' + state.modelRain[ev.id].toFixed(2) + ' in)' : '') +
      '<br>Tide: ' + esc(ev.tide_stage);
  }

  /* summary figures */
  function renderTiles() {
    var ev = state.data.events, crit = state.data.criteria, vals = ev.map(function (e) { return e.ecoli; });
    var gm = geomean(vals), over = vals.filter(function (v) { return v > crit.single_sample; }).length;
    var max = ev.reduce(function (a, b) { return b.ecoli > a.ecoli ? b : a; });
    var tiles = [
      ['Season geometric mean', fmt(gm), crit.unit + ', ' + vals.length + ' readings'],
      ['Against the 126 level', (gm / crit.geometric_mean).toFixed(1) + '×', 'EPA geometric mean criterion'],
      ['Over ' + crit.single_sample, over + ' of ' + vals.length, 'readings above the single sample value'],
      ['Highest reading', fmt(max.ecoli), max.id + ', ' + dShort(max.date) + ', ' + (max.rain48_in == null ? 'rain not recorded' : max.rain48_in.toFixed(2) + ' in of rain')]
    ];
    $('tiles').innerHTML = tiles.map(function (t) {
      return '<div><dt>' + esc(t[0]) + '</dt><dd>' + esc(t[1]) + '<small>' + esc(t[2]) + '</small></dd></div>';
    }).join('');
  }

  /* rain on the gauge between two dates, or null if any day is missing */
  function gaugeSum(fromMs, toMs) {
    var g = state.data.rain_gauge_daily_in, sum = 0, gaps = 0;
    for (var t = fromMs; t <= toMs; t += DAY) { var k = isoDay(t); if (k in g) sum += g[k]; else gaps++; }
    return { sum: sum, gaps: gaps };
  }
  function list(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  /* heatmap */
  function renderHeatmap() {
    var ev = state.data.events, hm = $('hm'), crit = state.data.criteria;
    hm.innerHTML = '';
    var add = function (cls, html) { var d = document.createElement('div'); d.className = cls; d.innerHTML = html; hm.appendChild(d); return d; };
    add('ch', '');
    RAIN_BANDS.forEach(function (b) { add('ch', '<b>' + b.label + '</b><br>' + b.range); });
    TIDES.forEach(function (t) {
      add('rh', '<b>' + t.label + '</b><span>' + t.hint + '</span>');
      RAIN_BANDS.forEach(function (b) {
        var hits = ev.filter(function (e) { var r = rainOf(e); return e.tide_phase === t.key && r != null && b.test(r); });
        if (!hits.length) { add('cell empty', 'no readings'); return; }
        var gm = geomean(hits.map(function (e) { return e.ecoli; })), c = colorFor(gm);
        var d = add('cell', '<span class="v">' + fmt(gm) + '</span><span class="n">' +
          hits.map(function (e) { return e.id; }).join(', ') + ' (n=' + hits.length + ')</span>');
        d.style.background = c.bg; d.style.color = c.ink; d.tabIndex = 0;
        d.setAttribute('aria-label', t.label + ', ' + b.label + ': geometric mean ' + fmt(gm) + ', ' + hits.length + ' readings');
        bindTip(d, '<b>' + t.label + ', ' + b.label.toLowerCase() + '</b><br>' + hits.map(function (e) {
          return esc(e.id) + ', ' + dShort(e.date) + ': ' + fmt(e.ecoli) + ' (' + rainOf(e).toFixed(2) + ' in)';
        }).join('<br>'));
      });
    });

    // plain-language reading, computed from the data with the site's dry and wet cut points
    var has = ev.filter(function (e) { return rainOf(e) != null; });
    var dry = has.filter(function (e) { return rainOf(e) < 0.25; }), wet = has.filter(function (e) { return rainOf(e) >= 0.5; });
    var ebb = ev.filter(function (e) { return e.tide_phase === 'ebb'; }), fl = ev.filter(function (e) { return e.tide_phase === 'flood'; });
    var g = function (a) { return a.length ? fmt(geomean(a.map(function (e) { return e.ecoli; }))) + ' (n=' + a.length + ')' : 'no readings'; };
    var txt = 'Geometric means: dry ' + g(dry) + ', wet ' + g(wet) + '; falling tide ' + g(ebb) + ', rising tide ' + g(fl) + '. ';

    // which zero-rain readings followed heavier rain a few days earlier?
    var zero = has.filter(function (e) { return rainOf(e) === 0; });
    if (zero.length && state.rainSrc === 'recorded') {
      var allOver = zero.every(function (e) { return e.ecoli > crit.single_sample; });
      var after = [], unknown = [], clear = [];
      zero.forEach(function (e) {
        var t = Date.parse(e.date + 'T00:00:00Z');
        var s = gaugeSum(t - 7 * DAY, t - 2 * DAY);
        if (s.sum >= 0.25) after.push(e.id + ' (' + s.sum.toFixed(2) + ' in on the gauge 3 to 7 days before)');
        else if (s.gaps) unknown.push(e.id); else clear.push(e.id);
      });
      txt += word(zero.length, true) + ' readings had no rain in the 48 hours before' + (allOver ? ', and all were above ' + crit.single_sample : '') + '.';
      if (after.length) txt += ' ' + list(after) + ' came a few days after heavier rain, which may still have been draining.';
      if (unknown.length) txt += ' ' + list(unknown) + ' had no gauge record for the week before (see the note under the table).';
      if (clear.length) txt += ' ' + list(clear) + ' followed a dry week on the gauge.';
      txt += ' Readings that stay high after a long dry spell are the ones that point to a steady source.';
    }
    $('hmNote').textContent = txt;
    renderEventTable();
  }
  function word(n, cap) {
    var w = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n);
    return cap ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }

  function renderEventTable() {
    var hasModel = !!state.modelRain;
    var rows = state.data.events.map(function (e) {
      var m = hasModel && state.modelRain[e.id] != null ? state.modelRain[e.id] : null;
      var differs = m != null && e.rain48_in != null && Math.abs(m - e.rain48_in) >= 0.25;
      return '<tr><td class="tid">' + esc(e.id) + '</td><td class="tid">' + dShort(e.date) + ', ' + esc(e.time) + '</td><td class="n">' + fmt(e.ecoli) +
        '</td><td>' + esc(e.tide_stage) + '</td><td>' + tideLabel(e.tide_phase) + '</td><td class="n">' + (e.rain48_in == null ? 'n/a' : e.rain48_in.toFixed(2)) +
        '</td><td class="n' + (differs ? ' warn' : '') + '">' + (m == null ? (hasModel ? 'n/a' : '&middot;') : m.toFixed(2)) +
        '</td><td class="wrap">' + esc(e.rain_source) + '</td></tr>';
    }).join('');
    $('evTable').innerHTML = '<thead><tr><th>Week</th><th>Sampled</th><th class="n">E. coli</th><th>Tide note</th><th>Read as</th>' +
      '<th class="n">Rain 48 h, in</th><th class="n">Model, in</th><th>Rain source</th></tr></thead><tbody>' + rows + '</tbody>';
  }

  /* timeline: two stacked panels on one time axis, never a dual axis */
  function renderTimeline() {
    var ev = state.data.events, crit = state.data.criteria, W = 960, H = 390, L = 58, R = 18;
    var first = Date.parse(ev[0].date + 'T00:00:00Z'), last = Date.parse(ev[ev.length - 1].date + 'T00:00:00Z');
    var t0 = first - 4 * DAY, t1 = last + 4 * DAY;
    var x = function (ms) { return L + (ms - t0) / (t1 - t0) * (W - L - R); };
    var usingModel = state.rainSrc === 'model' && !!state.modelDaily;
    var rain = usingModel ? state.modelDaily : state.data.rain_gauge_daily_in;
    var rTop = 20, rH = 90, eTop = 146, eH = 196;
    var vals = Object.keys(rain).map(function (k) { return rain[k]; });
    var rMax = Math.max(1, Math.ceil(Math.max.apply(null, vals.concat([0])) * 2) / 2);
    var ly = function (v) { return eTop + eH - (Math.log10(v) - 2) / (Math.log10(5000) - 2) * eH; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily rainfall and each E. coli reading through the season">';

    s += '<text class="lab" x="' + L + '" y="' + (rTop - 8) + '">Daily rain, in' + (usingModel ? ' (Open-Meteo model estimate)' : ' (project gauge)') + '</text>';
    [0, rMax].forEach(function (v) {
      var y = rTop + rH - v / rMax * rH;
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="' + BORDER + '"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + v.toFixed(1) + '</text>';
    });
    if (!usingModel) {
      var cur = null;
      for (var t = t0; t <= t1; t += DAY) {
        var missing = !(isoDay(t) in rain);
        if (missing && cur == null) cur = t;
        if ((!missing || t + DAY > t1) && cur != null) {
          var end = missing ? t + DAY : t;
          s += '<rect x="' + x(cur) + '" y="' + rTop + '" width="' + (x(end) - x(cur)) + '" height="' + rH + '" fill="' + tok('--surface') + '"/>';
          cur = null;
        }
      }
    }
    Object.keys(rain).forEach(function (k) {
      var v = rain[k], ms = Date.parse(k + 'T00:00:00Z'); if (!(v > 0) || ms < t0 || ms > t1) return;
      var h = v / rMax * rH, bw = Math.max(2, x(ms + DAY) - x(ms) - 2);
      s += '<rect class="rb" data-k="' + k + '" x="' + (x(ms) + 1) + '" y="' + (rTop + rH - h) + '" width="' + bw + '" height="' + h + '" fill="' + RAMP[3] + '"/>';
    });

    s += '<text class="lab" x="' + L + '" y="' + (eTop - 10) + '">E. coli, ' + esc(crit.unit) + ', log scale</text>';
    [100, 300, 1000, 3000].forEach(function (v) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + ly(v) + '" y2="' + ly(v) + '" stroke="' + BORDER + '" stroke-opacity=".6"/><text x="' + (L - 6) + '" y="' + (ly(v) + 4) + '" text-anchor="end">' + fmt(v) + '</text>';
    });
    [[crit.geometric_mean, crit.geometric_mean + ' geometric mean criterion'], [crit.single_sample, crit.single_sample + ' single sample value']].forEach(function (th) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + ly(th[0]) + '" y2="' + ly(th[0]) + '" stroke="' + MUTED + '" stroke-dasharray="4 4"/>' +
        '<text x="' + (L + 6) + '" y="' + (ly(th[0]) + -5) + '">' + th[1] + '</text>';
    });
    ev.forEach(function (e, i) {
      var ms = Date.parse(e.date + 'T' + e.time + ':00Z'), cx = x(ms), cy = ly(e.ecoli);
      s += '<line x1="' + cx + '" x2="' + cx + '" y1="' + (rTop + rH) + '" y2="' + (cy - 7) + '" stroke="' + BORDER + '" stroke-dasharray="2 3"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="' + (e.tide_phase === 'flood' ? PAPER : INK) + '" stroke="' + INK + '" stroke-width="2"/>';
      s += '<circle class="pt" data-i="' + i + '" tabindex="0" cx="' + cx + '" cy="' + cy + '" r="14" fill="transparent"/>';
      s += '<text x="' + cx + '" y="' + (cy - 12) + '" text-anchor="middle">' + e.id + '</text>';
    });
    var m = new Date(t0); m = Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1);
    for (; m <= t1; m = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth() + 1, 1)) {
      var px = x(m);
      s += '<line x1="' + px + '" x2="' + px + '" y1="' + (eTop + eH) + '" y2="' + (eTop + eH + 5) + '" stroke="' + INK + '"/>' +
        '<text x="' + px + '" y="' + (eTop + eH + 19) + '" text-anchor="middle">1 ' + MONTHS[new Date(m).getUTCMonth()] + '</text>';
    }
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (eTop + eH) + '" y2="' + (eTop + eH) + '" stroke="' + INK + '"/>';
    s += '<circle cx="' + (L + 6) + '" cy="' + (H - 9) + '" r="5" fill="' + INK + '"/><text x="' + (L + 16) + '" y="' + (H - 5) + '">falling tide or slack</text>';
    s += '<circle cx="' + (L + 176) + '" cy="' + (H - 9) + '" r="5" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="2"/><text x="' + (L + 186) + '" y="' + (H - 5) + '">rising tide</text>';
    s += '</svg>';
    $('timelineFig').innerHTML = s;
    Array.prototype.forEach.call($('timelineFig').querySelectorAll('.pt'), function (el) { bindTip(el, evTip(ev[+el.getAttribute('data-i')])); });
    Array.prototype.forEach.call($('timelineFig').querySelectorAll('.rb'), function (el) {
      var k = el.getAttribute('data-k'); bindTip(el, '<b>' + dShort(k) + '</b><br>' + rain[k].toFixed(2) + ' in');
    });
    $('tlNote').innerHTML = usingModel
      ? '<b>Daily rain from the Open-Meteo model</b> for the station point. It is an estimate, not a measurement.'
      : '<b>Daily rain from the project gauge near the boathouse.</b> Shaded days have no gauge reading. Hover a reading for its details.';
  }

  /* model rainfall, used only as a cross-check */
  function loadRain() {
    var ev = state.data.events, start = isoDay(Date.parse(ev[0].date + 'T00:00:00Z') - 4 * DAY);
    var end = isoDay(Math.min(Date.parse(ev[ev.length - 1].date + 'T00:00:00Z'), Date.now() - 6 * DAY));
    var q = '?latitude=' + state.data.station.lat + '&longitude=' + state.data.station.lon + '&start_date=' + start + '&end_date=' + end +
      '&hourly=precipitation&precipitation_unit=inch&timezone=America%2FNew_York';
    return fetch(CFG.meteo + q).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
      var times = j.hourly.time, p = j.hourly.precipitation, idx = {}, daily = {};
      times.forEach(function (t, i) { idx[t] = i; if (p[i] != null) daily[t.slice(0, 10)] = (daily[t.slice(0, 10)] || 0) + p[i]; });
      var model = {};
      ev.forEach(function (e) {
        var i = idx[e.date + 'T' + e.time.slice(0, 2) + ':00']; if (i == null) return;
        var sum = 0, n = 0;
        for (var k = Math.max(0, i - 47); k <= i; k++) if (p[k] != null) { sum += p[k]; n++; }
        if (n >= 40) model[e.id] = Math.round(sum * 100) / 100;
      });
      if (!Object.keys(model).length) throw new Error('no overlap');
      state.modelRain = model; state.modelDaily = daily;
      document.querySelector('input[value="model"]').disabled = false;
      $('lblModel').removeAttribute('aria-disabled'); $('modelState').textContent = '';
      renderHeatmap();
    }).catch(function () { $('modelState').textContent = '(unavailable right now)'; });
  }

  /* map */
  var map, statusEls = {};
  function chip(key, label) {
    var el = document.createElement('span'); el.textContent = label + ': loading';
    $('status').appendChild(el); statusEls[key] = { el: el, label: label };
  }
  function setChip(key, text, err) { var s = statusEls[key]; s.el.textContent = s.label + ': ' + text; s.el.classList.toggle('err', !!err); }
  function arcgis(url, box, fields) {
    var q = '?f=geojson&where=1%3D1&geometry=' + box.join(',') + '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326' +
      '&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=' + fields;
    return fetch(url + q).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { if (!j.features) throw new Error('no features'); return j; });
  }
  function propTable(p, keys) {
    return keys.filter(function (k) { return p[k[0]] != null && p[k[0]] !== ''; }).map(function (k) { return k[1] + ': ' + esc(p[k[0]]); }).join('<br>');
  }
  function distMi(lat, lon) {
    var s = state.data.station, rad = Math.PI / 180;
    var dy = (lat - s.lat) * 69.05, dx = (lon - s.lon) * 69.17 * Math.cos(s.lat * rad);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function renderNearest() {
    var rows = [];
    [['cso', 'Combined sewer overflow'], ['ms4', 'Stormwater']].forEach(function (kind) {
      (state[kind[0]] || []).forEach(function (f) {
        var c = f.geometry && f.geometry.coordinates; if (!c) return;
        var p = f.properties || {};
        rows.push({ type: kind[1], id: p.CSO_ID || p.OUTFALL_ID || p.LOCAL_ID || '', town: p.MUNICIPALITY || '',
          water: p.RECV_WATER || p.ROADNAME || '', d: distMi(c[1], c[0]), up: c[1] > state.data.station.lat });
      });
    });
    if (!rows.length) {
      if (state.csoFail && state.ms4Fail) $('nearTable').innerHTML = '<tbody><tr><td>Outfall data did not load. Try again later, or open the NJDEP links under Sources.</td></tr></tbody>';
      return;
    }
    rows.sort(function (a, b) { return a.d - b.d; });
    $('nearTable').innerHTML = '<thead><tr><th>Type</th><th>Outfall ID</th><th>Municipality</th><th>Receiving water or road</th><th class="n">Miles</th><th>Side</th></tr></thead><tbody>' +
      rows.slice(0, 15).map(function (r) {
        return '<tr><td>' + r.type + '</td><td class="tid">' + esc(r.id) + '</td><td>' + esc(r.town) + '</td><td>' + esc(r.water) +
          '</td><td class="n">' + r.d.toFixed(1) + '</td><td>' + (r.up ? 'upstream (north)' : 'downstream (south)') + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function parseCsv(text) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];
    var head = rows[0];
    return rows.slice(1).filter(function (r) { return r.length === head.length; }).map(function (r) {
      var o = {}; head.forEach(function (h, k) { o[h] = r[k]; }); return o;
    });
  }

  function initMap() {
    var st = state.data.station;
    map = L.map('map', { scrollWheelZoom: false }).setView([st.lat, st.lon], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    var layers = { cso: L.layerGroup().addTo(map), ms4: L.layerGroup().addTo(map), stn: L.layerGroup().addTo(map) };
    L.control.layers(null, { 'Combined sewer overflows': layers.cso, 'Stormwater outfalls': layers.ms4, 'Monitoring stations': layers.stn },
      { collapsed: window.innerWidth < 640 }).addTo(map);
    var gm = geomean(state.data.events.map(function (e) { return e.ecoli; }));
    var dock = L.circleMarker([st.lat, st.lon], { radius: 9, color: PAPER, weight: 3, fillColor: INK, fillOpacity: 1 })
      .bindPopup('<b>' + esc(st.id) + ', Nereid Boat Club dock</b><br>Season geometric mean ' + fmt(gm) + ' ' + esc(state.data.criteria.unit) +
        ' (' + state.data.events.length + ' readings)<br>Position rounded to two decimal places.');

    chip('cso', 'Combined sewer overflows');
    chip('ms4', 'Stormwater outfalls');
    chip('stn', 'Monitoring stations');

    arcgis(CFG.csoUrl, CFG.reachBox, 'CSO_ID,PERMITTEE,MUNICIPALITY,RECV_WATER,STP,CSO_STAT,DMR_URL').then(function (j) {
      state.cso = j.features;
      j.features.forEach(function (f) {
        var c = f.geometry.coordinates, p = f.properties;
        var html = '<b>Combined sewer overflow</b><br>' + propTable(p, [['CSO_ID', 'ID'], ['MUNICIPALITY', 'Municipality'], ['PERMITTEE', 'Permittee'],
          ['RECV_WATER', 'Receiving water'], ['STP', 'Treatment plant'], ['CSO_STAT', 'Status']]) +
          (/^https?:\/\//.test(p.DMR_URL || '') ? '<br><a href="' + esc(p.DMR_URL) + '" target="_blank" rel="noopener">Discharge monitoring reports</a>' : '');
        L.circleMarker([c[1], c[0]], { radius: 6, color: PAPER, weight: 1.5, fillColor: tok('--cso'), fillOpacity: 1 }).bindPopup(html).addTo(layers.cso);
      });
      var up = j.features.filter(function (f) { return f.geometry.coordinates[1] > st.lat; }).length;
      setChip('cso', j.features.length + ' from Paterson to Newark Bay, ' + up + ' upstream of the dock and ' + (j.features.length - up) + ' downstream'); renderNearest();
    }).catch(function () { state.csoFail = true; setChip('cso', 'could not load from NJDEP', true); renderNearest(); });

    arcgis(CFG.ms4Url, CFG.localBox, 'OUTFALL_ID,LOCAL_ID,MUNICIPALITY,ROADNAME,OWNERTYPE,OUTFALLTYPE,PIPEMATERIAL,CONTRIBUTINGDA').then(function (j) {
      state.ms4 = j.features;
      j.features.forEach(function (f) {
        var c = f.geometry.coordinates, p = f.properties;
        L.circleMarker([c[1], c[0]], { radius: 4, color: PAPER, weight: 1, fillColor: tok('--ms4'), fillOpacity: 1 })
          .bindPopup('<b>Stormwater outfall</b><br>' + propTable(p, [['OUTFALL_ID', 'ID'], ['LOCAL_ID', 'Local ID'], ['MUNICIPALITY', 'Municipality'],
            ['ROADNAME', 'Road'], ['OWNERTYPE', 'Owner'], ['OUTFALLTYPE', 'Type'], ['PIPEMATERIAL', 'Pipe'], ['CONTRIBUTINGDA', 'Drains']])).addTo(layers.ms4);
      });
      var more = j.exceededTransferLimit || (j.properties && j.properties.exceededTransferLimit);
      setChip('ms4', j.features.length + (more ? '+, list cut short by the server,' : '') + ' within about 2 miles'); renderNearest();
    }).catch(function () { state.ms4Fail = true; setChip('ms4', 'could not load from NJDEP', true); renderNearest(); });

    // NJHDG ran the stations to 2019; IEC publishes them from 2021 under new IDs. Merge by name and position.
    var bb = 'organization=NJHDG&organization=IEC-NYNJCT&bBox=' + CFG.reachBox.join(',');
    Promise.all([
      fetch(CFG.wqpStations + '?' + bb + '&mimeType=csv&zip=no').then(function (r) { if (!r.ok) throw new Error(); return r.text(); }),
      fetch(CFG.wqpResults + '?' + bb + '&characteristicName=Escherichia%20coli&startDateLo=01-01-2010&mimeType=csv&zip=no&dataProfile=narrowResult')
        .then(function (r) { if (!r.ok) throw new Error(); return r.text(); })
    ]).then(function (res) {
      var stations = parseCsv(res[0]), results = parseCsv(res[1]), siteOf = {}, sites = {};
      stations.forEach(function (s) {
        var lat = parseFloat(s.LatitudeMeasure), lon = parseFloat(s.LongitudeMeasure); if (!isFinite(lat) || !isFinite(lon)) return;
        var key = s.MonitoringLocationName.trim().toLowerCase() + '|' + lat.toFixed(3) + '|' + lon.toFixed(3);
        var o = sites[key] = sites[key] || { name: s.MonitoringLocationName, lat: lat, lon: lon, ids: [], days: {} };
        o.ids.push(s.MonitoringLocationIdentifier); siteOf[s.MonitoringLocationIdentifier] = o;
      });
      results.forEach(function (r) {
        var o = siteOf[r.MonitoringLocationIdentifier]; if (!o) return;
        if ((r.MeasureQualifierCode || '').split(/[;,\s]+/).indexOf('QC') >= 0) return;   // quality-control problems
        var v = parseFloat(String(r.ResultMeasureValue).replace(/[^0-9.]/g, '')); if (!(v > 0)) return;
        (o.days[r.ActivityStartDate] = o.days[r.ActivityStartDate] || []).push(v);
      });
      var n = 0;
      Object.keys(sites).forEach(function (k) {
        var o = sites[k], days = Object.keys(o.days).sort();
        var html = '<b>' + esc(o.name) + '</b><br>' + o.ids.map(esc).join(', ') + '<br>';
        var fill = PAPER;
        if (days.length) {
          var g = geomean(days.map(function (d) { return geomean(o.days[d]); }));
          var over = days.filter(function (d) { return geomean(o.days[d]) > state.data.criteria.single_sample; }).length;
          fill = colorFor(g).bg;
          html += 'E. coli geometric mean ' + fmt(g) + ' over ' + days.length + ' sampling days, ' + days[0].slice(0, 4) + ' to ' + days[days.length - 1].slice(0, 4) +
            '<br>' + Math.round(over / days.length * 100) + '% of days above ' + state.data.criteria.single_sample +
            '<br>Latest published: ' + dShort(days[days.length - 1]) + ' ' + days[days.length - 1].slice(0, 4);
        } else html += 'No E. coli results since 2010 in the portal.';
        L.marker([o.lat, o.lon], { icon: L.divIcon({ className: '', iconSize: [14, 14],
          html: '<div class="stn-mark" style="width:14px;height:14px;background:' + fill + '"></div>' }) }).bindPopup(html).addTo(layers.stn);
        n++;
      });
      if (!n) throw new Error('none');
      setChip('stn', n + ' locations, E. coli results since 2010');
    }).catch(function () { setChip('stn', 'could not load from the Water Quality Portal', true); });
    dock.addTo(map);
  }

  /* boot */
  fetch('/map/data.json').then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (d) {
    state.data = d;
    renderTiles(); renderHeatmap(); renderTimeline();
    Array.prototype.forEach.call(document.querySelectorAll('input[name="rainsrc"]'), function (inp) {
      inp.addEventListener('change', function () { state.rainSrc = inp.value; renderHeatmap(); renderTimeline(); });
    });
    try { initMap(); } catch (e) { $('map').textContent = 'The map could not start.'; }
    loadRain();
  }).catch(function () {
    $('tiles').innerHTML = '<p class="note">The station data did not load. Try reloading the page.</p>';
  });
})();
