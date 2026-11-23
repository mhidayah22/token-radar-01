/* Launch Radar dashboard: renders window.RADAR (written by main.ts) with no network. */
(function () {
  'use strict';
  var data = window.RADAR;
  if (!data || !Array.isArray(data.rows)) {
    document.getElementById('snapshot-meta').textContent = 'No radar data found: data.js did not load.';
    return;
  }

  var watchlist = {};
  (data.watchlist_slugs || []).forEach(function (s) { watchlist[s] = true; });

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n, digits) {
    if (n === null || n === undefined) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(digits === undefined ? 1 : digits) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---- header, stats, validation ---- */
  $('snapshot-meta').textContent =
    'Snapshot as of ' + data.as_of + ' · source: DefiLlama public protocols endpoint · watchlist floor ' +
    moneyFull(data.floor_usd) + ' · ' + data.rows.length + ' rows · model ' + data.model_version;

  var stats = $('stats');
  var statDefs = [
    [String(data.watchlist_size), 'protocols on the watchlist (the floor)'],
    [String(data.board_size), 'rows on the board, watchlist + early radar'],
    [String(data.live_size), 'live-token protocols in the comparison view'],
    [data.model_version, 'model: peer median × maturity, validated below'],
  ];
  stats.innerHTML = statDefs.map(function (d) {
    return '<div class="stat"><b>' + esc(d[0]) + '</b><span>' + esc(d[1]) + '</span></div>';
  }).join('');

  var val = data.validation;
  var valRows = [
    [val.in_sample, 'Same 128 live protocols the model was fitted on: the optimistic bound.'],
    [val.walk_forward, 'Fitted on protocols listed before 2025-06-01, tested on the 20 listed after.'],
    [val.leave_one_out, 'Each protocol predicted from the other 127: the honest out-of-sample test.'],
  ];
  $('validation-table').querySelector('tbody').innerHTML = valRows.map(function (pair) {
    var r = pair[0];
    return '<tr><td>' + esc(r.name) + '</td><td class="num">' + r.n + '</td>' +
      '<td class="num">×' + r.median_multiple.toFixed(2) + '</td>' +
      '<td class="num">' + r.within_2x_pct.toFixed(1) + '%</td><td>' + esc(pair[1]) + '</td></tr>';
  }).join('');

  /* ---- board state: sort + filter ---- */
  var state = { q: '', cat: '', watchOnly: false, sort: 'rank', dir: 1 };
  var SORTABLE = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    category: function (r) { return (r.category || '').toLowerCase(); },
    tvl_usd: function (r) { return r.tvl_usd; },
    change_7d: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    age_days: function (r) { return r.age_days === null ? -1 : r.age_days; },
    peer_multiple: function (r) { return r.peer_multiple; },
    implied_value_usd: function (r) { return r.implied_value_usd; },
    launch_readiness: function (r) { return r.launch_readiness; },
    ev_per_hour_usd: function (r) { return r.ev_per_hour_usd; },
  };

  var cats = [];
  data.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category); });
  cats.sort();
  $('cat').innerHTML = '<option value="">All categories</option>' +
    cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = data.rows.filter(function (r) {
      if (state.watchOnly && !watchlist[r.slug]) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (q && (r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1 &&
          (r.category || '').toLowerCase().indexOf(q) === -1)) return false;
      return true;
    });
    var key = SORTABLE[state.sort] || SORTABLE.rank;
    rows.sort(function (a, b) {
      var va = key(a), vb = key(b);
      if (va < vb) return -1 * state.dir;
      if (va > vb) return 1 * state.dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function changeCell(change) {
    if (change === null || change === undefined) return '<td class="num flat">—</td>';
    var cls = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    return '<td class="num ' + cls + '">' + pct(change) + '</td>';
  }

  function renderBoard() {
    var rows = filteredRows();
    var tb = $('board-table').querySelector('tbody');
    tb.innerHTML = rows.map(function (r) {
      var wl = watchlist[r.slug] ? '<span class="badge">WATCH</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong>' + wl + '<br><span class="count">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        changeCell(r.change_7d) +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num">×' + r.peer_multiple.toFixed(3) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td class="num">' + money(r.range_low_usd) + ' – ' + money(r.range_high_usd) + '</td>' +
        '<td class="num">' + Math.round(r.launch_readiness * 100) + '%</td>' +
        '<td class="num">' + money(r.ev_per_hour_usd) + '/h</td></tr>';
    }).join('');
    $('row-count').textContent = rows.length + ' of ' + data.rows.length + ' rows shown';
    var heads = $('board-table').querySelectorAll('th[data-sort]');
    heads.forEach(function (h) {
      h.classList.toggle('sorted', h.getAttribute('data-sort') === state.sort);
      h.textContent = h.textContent.replace(/ [▲▼]$/, '') +
        (h.getAttribute('data-sort') === state.sort ? (state.dir === 1 ? ' ▲' : ' ▼') : '');
    });
    tb.querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }

  /* ---- detail view ---- */
  function openDetail(slug) {
    var r = null;
    data.rows.forEach(function (row) { if (row.slug === slug) r = row; });
    if (!r) return;
    $('detail').hidden = false;
    $('detail-title').textContent = r.name + ' — rank #' + r.rank + (watchlist[r.slug] ? ' · on the watchlist' : '');
    var facts = [
      ['Implied value', moneyFull(r.implied_value_usd)],
      ['Honest range', moneyFull(r.range_low_usd) + ' – ' + moneyFull(r.range_high_usd)],
      ['TVL', moneyFull(r.tvl_usd)],
      ['Peer multiple', '×' + r.peer_multiple.toFixed(3) + ' (' + esc(r.category || 'no category') + ', ' + r.peer_count + ' peers)'],
      ['Maturity', '×' + r.maturity_multiplier.toFixed(3)],
      ['7-day change', r.change_7d === null ? 'not reported' : pct(r.change_7d)],
      ['Age', ageText(r.age_days) + (r.listed_at ? ' (listed ' + r.listed_at + ')' : '')],
      ['Launch readiness', Math.round(r.launch_readiness * 100) + '% of peers its age already record a token'],
    ];
    $('detail-facts').innerHTML = facts.map(function (f) {
      return '<div><span>' + esc(f[0]) + '</span><b>' + f[1] + '</b></div>';
    }).join('');
    $('detail-steps').innerHTML = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('detail-ev').textContent =
      'Farm verdict: ' + money(r.ev_per_hour_usd) + ' per active hour (index, not a dollar promise) = implied value ' +
      moneyFull(r.implied_value_usd) + ' × readiness ' + Math.round(r.launch_readiness * 100) + '% ÷ ' +
      r.active_hours + ' active hours. The value is the model’s claim; the readiness only weights how much ' +
      'farming time the position is worth, it never changes the value itself.';
    document.querySelectorAll('#board-table tbody tr').forEach(function (tr) {
      tr.classList.toggle('selected', tr.getAttribute('data-slug') === slug);
    });
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (history.replaceState) history.replaceState(null, '', '#detail-' + slug);
  }

  /* ---- live view ---- */
  $('live-table').querySelector('tbody').innerHTML = data.live.map(function (p, i) {
    return '<tr><td class="num">' + (i + 1) + '</td><td><strong>' + esc(p.name) + '</strong></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td>' +
      changeCell(p.change_7d) + '</tr>';
  }).join('');

  /* ---- wiring ---- */
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('watch-only').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderBoard(); });
  $('sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    state.dir = state.sort === 'name' || state.sort === 'category' ? 1 : -1;
    if (state.sort === 'rank') state.dir = 1;
    renderBoard();
  });
  $('reset').addEventListener('click', function () {
    state = { q: '', cat: '', watchOnly: false, sort: 'rank', dir: 1 };
    $('q').value = ''; $('cat').value = ''; $('watch-only').checked = false; $('sort').value = 'rank';
    renderBoard();
  });
  $('board-table').querySelectorAll('th[data-sort]').forEach(function (h) {
    h.addEventListener('click', function () {
      var key = h.getAttribute('data-sort');
      if (state.sort === key) { state.dir = -state.dir; } else { state.sort = key; state.dir = -1; }
      if (key === 'rank' || key === 'name' || key === 'category') state.dir = 1;
      $('sort').value = key;
      renderBoard();
    });
  });

  renderBoard();
  var hash = (location.hash || '').replace(/^#detail-/, '');
  if (hash) openDetail(hash);
})();
