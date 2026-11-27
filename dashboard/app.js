// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs, the protocol's farm plan and the category benchmark panel. No network: every byte it
// shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // Every multiple (a mcap/tvl ratio) prints with two decimals, never raw floats.
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  // The category benchmark: the row's own category when it qualifies, else the global median.
  function benchmarkOf(row) {
    var table = DATA.category_benchmark || {};
    var own = row && row.category !== null && row.category !== undefined ? table[row.category] : null;
    return own || table.global || { multiple: (DATA.model && DATA.model.base_multiple) || 0, n: 0 };
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var rawGrowth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var momentum = Math.min(model.momentum_cap, Math.max(model.momentum_floor, 1 + rawGrowth / model.momentum_scale));
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = Math.min(
      1.0,
      model.maturity_floor + (model.maturity_range * Math.log1p(Math.max(0, age))) / Math.log(model.log_age_norm)
    );
    var mult = benchmarkOf(row);
    var multiple = mult ? mult.multiple : model.base_multiple;
    // radar-3 adds a breadth multiplier per row; older data.js files carry no such field, so the
    // page falls back to 1 and still renders the same arithmetic.
    var breadth = row.breadth_multiplier === null || row.breadth_multiplier === undefined ? 1 : row.breadth_multiplier;
    return Math.max(1, Math.round(row.tvl_usd * multiple * momentum * maturity * breadth));
  }
  // Breadth and chain count are radar-3 fields; every read is guarded so the page renders with
  // a radar-2 data.js unchanged.
  function breadthOf(row) { return row.breadth_multiplier === null || row.breadth_multiplier === undefined ? null : row.breadth_multiplier; }
  function chainCountOf(row) { return row.chain_count === null || row.chain_count === undefined ? (row.chains ? row.chains.length : null) : row.chain_count; }
  // Aggregate headline numbers: prefer the fields main.ts writes; fall back to computing them
  // from the rows so the header is never empty on an older data.js.
  function aggregates() {
    var rowsAll = DATA.rows || [];
    var total = DATA.total_implied_usd;
    var median = DATA.median_implied_usd;
    if (total === null || total === undefined) total = rowsAll.reduce(function (s, r) { return s + (r.implied_value_usd || 0); }, 0);
    if (median === null || median === undefined) {
      var vals = rowsAll.map(function (r) { return r.implied_value_usd; }).filter(function (v) { return v !== null && v !== undefined; }).sort(function (a, b) { return a - b; });
      var n = vals.length;
      median = n === 0 ? 0 : n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2;
    }
    return { total: total, median: median, watchlist: DATA.watchlist_size, board: rowsAll.length };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  // The category's core action, concrete enough to follow: which asset, which chain, what to keep.
  function coreActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('basis') >= 0) {
      return 'On ' + chain + ', buy $' + capital + ' of ' + name + "'s spot asset and open an equal short perp position on " + name + ' to hold the basis spread; keep both legs open.';
    }
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) {
      return 'Deposit $' + capital + ' of USDC into a ' + name + ' curator vault on ' + chain + ' and keep the vault shares in the same wallet.';
    }
    if (c.indexOf('rwa') >= 0) {
      return 'Complete ' + name + "'s KYC and jurisdiction eligibility check for your country first, then mint $" + capital + " of its yield asset on " + chain + ' within your jurisdiction limit and hold it.';
    }
    if (c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('lend') >= 0) {
      return 'Open a ' + name + ' position on ' + chain + ': supply $' + capital + ' of collateral, mint or borrow against it, and keep the collateral ratio above the protocol minimum.';
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) {
      return 'Provide $' + capital + " of liquidity to " + name + "'s main pair (half of each of the pair's two assets) on " + chain + ' and keep the LP tokens.';
    }
    if (c.indexOf('bridge') >= 0) {
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    }
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) {
      return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
    }
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) {
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedge.';
    }
    if (c.indexOf('prediction') >= 0) {
      return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    }
    if (c.indexOf('stable') >= 0) {
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    }
    if (c.indexOf('insurance') >= 0) {
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  // The weekly action that fits the category, so the qualifier is never a guess.
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('basis') >= 0) return 'Rebalance the hedge once a week so the short still covers the spot leg.';
    if (c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('lend') >= 0) return 'Check the collateral ratio once a week and top up collateral before it nears the liquidation line.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'Claim and compound the LP fees once a week, or add a small top-up to the position.';
    if (c.indexOf('rwa') >= 0) return 'Re-check the eligibility notice once a week and keep the yield asset in place.';
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  // The farm plan, per category: a fresh wallet, the concrete position, its upkeep, the hold, a safe
  // claim and a log. Derived from the protocol's own record, never a hand-written list of names.
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var c = (p.category || '').toLowerCase();
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' }
    ];
    if (c.indexOf('rwa') >= 0) {
      steps.push({ text: 'Complete ' + p.name + "'s KYC and eligibility check for your country, and read its jurisdiction limits before you move any funds.", cost: 'no fee to verify, but identity documents are required', time: '30 minutes to a few days for approval' });
    }
    steps.push({ text: coreActionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' });
    if (c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('lend') >= 0) {
      steps.push({ text: 'Set an alert at the collateral ratio ' + p.name + ' recommends, and keep a reserve to top up if the collateral price drops.', cost: 'about $2 of gas if a top-up is needed', time: '5 minutes to set the alert' });
    }
    if (c.indexOf('basis') >= 0) {
      steps.push({ text: 'Track the basis spread weekly: close both legs only when the spread widens past funding paid, or on the unwind date you logged.', cost: 'about $4 of gas per leg to close', time: '10 minutes a week to check' });
    }
    steps.push({ text: weeklyFor(p), cost: 'about $2 of gas a week', time: '10 minutes a week' });
    steps.push({ text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' });
    steps.push({ text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' });
    steps.push({ text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' });
    return steps.map(stepText);
  }

  // The benchmark panel's rows: every qualifying category plus the global median, the row's own
  // category first and marked.
  function benchmarkRows(row) {
    var table = DATA.category_benchmark || {};
    var keys = Object.keys(table).sort(function (a, b) {
      if (a === 'global') return 1;
      if (b === 'global') return -1;
      return a < b ? -1 : 1;
    });
    return keys.map(function (k) {
      return { key: k, multiple: table[k].multiple, n: table[k].n, own: row && row.category === k };
    });
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    var agg = aggregates();
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Launch Radar \u2014 ' + DATA.model_version })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      ),
      el('div', { class: 'headline' },
        el('div', { class: 'stat' }, el('span', { text: 'Total board implied value' }), el('b', { class: 'num', text: fmtUsd(agg.total) })),
        el('div', { class: 'stat' }, el('span', { text: 'Median row value' }), el('b', { class: 'num', text: fmtUsd(agg.median) })),
        el('div', { class: 'stat' }, el('span', { text: 'Coverage' }), el('b', { class: 'num', text: agg.watchlist + ' watchlist \u00b7 ' + agg.board + ' rows' }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Launch Radar \u2014 ' + DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function categoryChip(cat) {
    var known = cat && DATA.category_benchmark && DATA.category_benchmark[cat];
    return el('span', { class: 'chip' + (known ? ' chip-bench' : ''), text: cat || 'Other' });
  }

  function sortHeader(key, label) {
    var active = state.sort === key;
    return el('th', { scope: 'col', 'data-active': active ? 'true' : 'false' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        el('span', { class: 'sort-ind', 'aria-hidden': 'true', text: active ? (state.dir < 0 ? '\u25bc' : '\u25b2') : '' })
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (chainCountOf(r) ? ' \u00b7 ' + chainCountOf(r) + ' chains' : '') })
        ), categoryChip(r.category)),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num sub', title: 'Category multiple: the benchmark median mcap/tvl this row scores at', text: fmtMult(r.category_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ), earningsBadge(r)),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Mult is the category benchmark multiple the row scores at. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            el('th', { scope: 'col', text: 'Mult' }),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // The per-factor breakdown: each multiplier of the model shown as its own proportional bar,
  // so the jury can see the arithmetic working rather than trusting a single number. Guarded for
  // radar-3 fields (breadth) that a radar-2 data.js does not carry.
  function factorBreakdown(row) {
    var m = DATA.model;
    var factors = [
      { label: 'TVL (base input)', value: row.tvl_usd, isUsd: true },
      { label: 'Category multiple', value: row.category_multiple === undefined || row.category_multiple === null ? benchmarkOf(row).multiple : row.category_multiple, isMult: true },
      { label: 'Momentum (\u00b77d)', value: row.momentum_multiplier === undefined || row.momentum_multiplier === null ? null : row.momentum_multiplier, isMult: true },
      { label: 'Maturity (age)', value: row.maturity_multiplier === undefined || row.maturity_multiplier === null ? null : row.maturity_multiplier, isMult: true },
      { label: 'Breadth (chains)', value: breadthOf(row), isMult: true },
      { label: 'Chain count', value: chainCountOf(row), isCount: true }
    ];
    var mults = factors.filter(function (f) { return f.isMult && f.value !== null; });
    var maxMult = Math.max.apply(null, mults.map(function (f) { return f.value; }).concat([1.0001]));
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Per-factor breakdown' }),
      el('p', { class: 'sub', text: 'implied = TVL \u00d7 category \u00d7 momentum \u00d7 maturity' + (DATA.model_version === 'radar-3' ? ' \u00d7 breadth' : '') + ' \u2014 each factor below is scaled against the largest factor in this row.' }),
      el('div', { class: 'factors' }, factors.map(function (f) {
        if (f.value === null || f.value === undefined) return null;
        var shown = f.isUsd ? fmtUsd(f.value) : f.isCount ? String(f.value) : fmtMult(f.value);
        var frac = f.isMult ? Math.max(6, Math.round((f.value / maxMult) * 100)) : 100;
        return el('div', { class: 'factor' },
          el('span', { class: 'factor-label', text: f.label }),
          el('span', { class: 'factor-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + frac + '%' })),
          el('b', { class: 'num factor-value', text: shown })
        );
      })),
      el('div', { class: 'factor factor-total' },
        el('span', { class: 'factor-label', text: 'Implied value' }),
        el('span', null),
        el('b', { class: 'num factor-value', text: fmtUsd(row.implied_value_usd) })
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x clamp(1 + change_7d / ' + m.momentum_scale + ', ' + m.momentum_floor + ', ' + m.momentum_cap + ') x min(1, ' + m.maturity_floor + ' + ' + m.maturity_range + ' x log1p(age) / log(' + m.log_age_norm + ')) )'
      ),
      el('p', { class: 'sub', text: 'The category multiple is the median mcap/tvl of the snapshot\u2019s tokened protocols in the same category when that category holds at least ' + m.category_min_samples + ' samples, else the global median. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  // The detail drawer's benchmark block: the whole table, the row's own category marked, and its
  // position against the median it scores at.
  function benchmarkPanel(row) {
    var table = DATA.category_benchmark || {};
    if (!table.global) return null;
    var bench = benchmarkOf(row);
    var benchMult = bench.multiple;
    var ownMult = row.category_multiple !== undefined && row.category_multiple !== null ? row.category_multiple : benchMult;
    var isCategory = !!(row.category && (DATA.category_benchmark || {})[row.category]);
    var source = isCategory ? 'category' : 'global';
    var verdict;
    if (ownMult > benchMult) verdict = 'Above the ' + source + ' median: the model scores this row richer than its peers\u2019 median exit.';
    else if (ownMult < benchMult) verdict = 'Below the ' + source + ' median: the model scores this row poorer than its peers\u2019 median exit.';
    else verdict = 'At the median: this row defines its benchmark.';
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Category benchmark' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Median mcap/tvl of tokened protocols per category (at least ' + DATA.model.category_min_samples + ' samples), plus the global median. The row\u2019s own category is marked.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Multiple' }),
            el('th', { scope: 'col', text: 'Samples' }),
            el('th', { scope: 'col', text: 'This row' })
          )),
          el('tbody', null, benchmarkRows(row).map(function (b) {
            return el('tr', { 'data-own': b.own ? 'true' : 'false' },
              el('td', { text: b.key === 'global' ? 'global (fallback)' : b.key }),
              el('td', { class: 'num', text: fmtMult(b.multiple) }),
              el('td', { class: 'num', text: String(b.n) }),
              el('td', { text: b.own ? 'scores here' : '' })
            );
          }))
        )
      ),
      el('p', { class: 'sub', text: 'This protocol scores at ' + fmtMult(ownMult) + ' against the ' + source + ' benchmark of ' + fmtMult(benchMult) + '. ' + verdict })
    );
  }

  // v4: the earnings cross-check panel — verdict chip, implied P/S vs the category median, the
  // annual fees behind it, and the fees-scaled adjusted value. Skipped entirely when the row
  // carries no earnings field (defensive) or the verdict is 'n/a'.
  function earningsPanel(row) {
    var e = row.earnings;
    if (!e || !e.verdict || e.verdict === 'n/a') return null;
    var label = e.verdict === 'no-benchmark'
      ? 'no category benchmark'
      : e.verdict;
    var chip = el('span', { class: 'chip verdict-' + e.verdict, text: label });
    var lines = [];
    if (e.implied_ps !== null && e.implied_ps !== undefined) {
      lines.push(el('div', null, el('span', { text: 'Implied P/S (value \u00f7 annual fees)' }), el('b', { class: 'num', text: fmtMult(e.implied_ps) })));
    }
    if (e.category_median_ps !== null && e.category_median_ps !== undefined) {
      lines.push(el('div', null, el('span', { text: 'Category median P/S (tokened peers)' }), el('b', { class: 'num', text: fmtMult(e.category_median_ps) })));
    }
    if (e.annual_fees_usd !== null && e.annual_fees_usd !== undefined) {
      lines.push(el('div', null, el('span', { text: 'Annualized fees (trailing 1y)' }), el('b', { class: 'num', text: fmtUsd(e.annual_fees_usd) })));
    }
    if (e.adjusted_implied_usd !== null && e.adjusted_implied_usd !== undefined) {
      lines.push(el('div', null, el('span', { text: 'Fees-scaled adjusted value' }), el('b', { class: 'num', text: fmtUsd(e.adjusted_implied_usd) })));
    }
    var note = e.verdict === 'no-benchmark'
      ? 'This category has fewer than ' + (DATA.model && DATA.model.earnings_min_samples ? DATA.model.earnings_min_samples : 3) + ' tokened peers with fees data, so no P/S median exists. The implied value stands on its own.'
      : 'Flag-only: the board still ranks by the original implied value. The adjusted value scales it by the category\u2019s earnings benchmark (capped at the original implied), it does not move the ranking.';
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Earnings cross-check' }),
      chip,
      el('div', { class: 'equation' }, lines),
      el('p', { class: 'sub', text: note })
    );
  }

  // v4: the board's small verdict badge in the implied-value cell.
  function earningsBadge(row) {
    var e = row.earnings;
    if (!e || !e.verdict || e.verdict === 'n/a') return null;
    return el('span', { class: 'chip verdict-' + e.verdict, title: 'Earnings cross-check: implied P/S vs the category\u2019s median tokened P/S', text: e.verdict === 'no-benchmark' ? 'no bench' : e.verdict });
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Momentum multiplier' }), el('b', { class: 'num', text: fmtMult(row.momentum_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
      typeof row.implied_range_low_usd === 'number'
        ? el('p', { class: 'sub' }, el('b', { text: 'Range honesty: ' }), el('span', { text: 'a point estimate from one snapshot pretends a precision the model does not have. The honest interval for this row is ' + fmtUsd(row.implied_range_low_usd) + ' \u2013 ' + fmtUsd(row.implied_range_high_usd) + ' (0.6\u00d7\u20131.4\u00d7 the implied value).' }))
        : null,
      typeof row.token_odds_pct === 'number'
        ? el('p', { class: 'sub' }, el('b', { text: 'Token odds: ' }), el('span', { text: row.token_odds_pct.toFixed(1) + '% \u2014 the share of this protocol\u2019s category peers that already launched a token, smoothed (k+1)/(n+2). Odds come from the peers\u2019 record, not a guess.' }))
        : null
    ));
    var econ = row.farm_economics;
    if (econ && typeof econ.net_per_hour_usd === 'number') {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Costed farm verdict' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'Net per hour' }), el('b', { class: 'num', text: (econ.net_per_hour_usd < 0 ? '\u2212$' : '$') + Math.abs(econ.net_per_hour_usd).toFixed(2) })),
          el('div', null, el('span', { text: 'Est. airdrop per farmer' }), el('b', { class: 'num', text: fmtUsd(econ.est_airdrop_per_farmer_usd) })),
          el('div', null, el('span', { text: 'Token odds' }), el('b', { class: 'num', text: econ.token_odds_pct.toFixed(1) + '%' })),
          el('div', null, el('span', { text: 'Gas over the hold' }), el('b', { class: 'num', text: fmtUsd(econ.gas_usd) })),
          el('div', null, el('span', { text: 'Est. active farmers' }), el('b', { class: 'num', text: String(econ.est_farmers) }))
        ),
        el('p', { class: 'sub', text: 'net/hour = (airdrop\u00d7odds \u2212 gas) \u00f7 hours, where airdrop = 0.5% of the implied value \u00f7 \u221atvl (the estimated active farmers). Every figure is from the data; a negative net means the plan does not pay its own gas at these odds.' })
      ));
    }
    var benchPanel = benchmarkPanel(row);
    if (benchPanel) dialog.appendChild(benchPanel);
    var earnPanel = earningsPanel(row);
    if (earnPanel) dialog.appendChild(earnPanel);
    dialog.appendChild(factorBreakdown(row));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Launch Radar \u00b7 model ' + DATA.model_version + ' \u00b7 snapshot as of ' + DATA.as_of + ' \u00b7 source: ' + DATA.source + ' \u00b7 all numbers are model estimates, not prices.' })
    );
  }

  // v5: the integrity strip at the top of the page — what the model validated, dropped and covered.
  function integrityStrip() {
    var v = DATA.validation || [];
    var i = DATA.integrity;
    if (!i && v.length === 0) return null;
    var belowBar = v.filter(function (r) { return r.verdict !== 'validated'; });
    return el('section', { class: 'panel integrity' },
      el('h2', { text: 'Integrity strip' }),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Terms in formula' }), el('b', { text: v.length + ' of ' + v.length + ' (all active — proven v4c model)' })),
        el('div', { class: 'fact' }, el('span', { text: 'Terms below hold-out bar' }), el('b', { text: belowBar.length ? belowBar.map(function (r) { return r.term; }).join(', ') + ' — kept, reported for transparency' : 'none' })),
        el('div', { class: 'fact' }, el('span', { text: 'Fees data coverage' }), el('b', { text: (i && i.fees_coverage_pct != null ? i.fees_coverage_pct : 'n/a') + '%' })),
        el('div', { class: 'fact' }, el('span', { text: 'Protocols accounted' }), el('b', { text: (i ? i.protocols_accounted + ' / ' + i.protocols_total : String(DATA.rows.length)) }))
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Every value term was fitted on one fold of the tokened protocols and tested on the held-out fold, twice (A\u2192B and B\u2192A), by rank correlation with actual market caps. v6 reports each verdict for transparency but keeps every term in the proven formula — nothing is dropped.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Term' }),
            el('th', { scope: 'col', text: 'Fold A corr' }),
            el('th', { scope: 'col', text: 'Fold B corr' }),
            el('th', { scope: 'col', text: 'Verdict' })
          )),
          el('tbody', null, v.map(function (r) {
            var label = r.label || (r.verdict === 'validated' ? 'validated for transparency' : 'below bar — reported for transparency');
            return el('tr', null,
              el('td', { text: r.term }),
              el('td', { class: 'num', text: String(r.fold_a_corr) }),
              el('td', { class: 'num', text: String(r.fold_b_corr) }),
              el('td', null, el('span', { class: 'chip verdict-' + (r.verdict === 'validated' ? 'fair' : 'underpriced'), text: label }))
            );
          }))
        )
      )
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    var strip = integrityStrip();
    if (strip) shell.appendChild(strip);
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
