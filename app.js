/*
 * app.js — reads the CSV files in data/, runs the math in capstruct.js and
 * draws the tables. All the finance lives in capstruct.js; this file only
 * moves numbers onto the page.
 */
(function () {
  'use strict';

  const C = window.CapStruct;

  // Relative paths, so the app works at https://<user>.github.io/<repo>/.
  const FILES = {
    cdss: 'data/cdss.csv',
    assumptions: 'data/assumptions.csv',
    schedule: 'data/banker_schedule.csv',
    firms: 'data/example_firms.csv',
    scenarios: 'data/ebit_scenarios.csv'
  };

  // ---------------------------------------------------------------------
  // Small DOM helpers. Text goes in with textContent, never as HTML.
  // ---------------------------------------------------------------------

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(k => {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'className') node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(c => {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function $(id) { return document.getElementById(id); }

  function fill(id, children) {
    const node = $(id);
    node.replaceChildren(...children);
    return node;
  }

  // A table with one row per amount of borrowing. On a phone, CSS turns
  // each row into a card and uses data-label for the names.
  function rowTable(columns, rows, caption) {
    const head = el('tr', null, columns.map(col =>
      el('th', { scope: 'col' }, [col.label, col.sub ? el('span', { className: 'sub', text: col.sub }) : null])
    ));
    const body = rows.map(r => el('tr', null, columns.map((col, i) => {
      const attrs = { 'data-label': col.label, text: col.value(r) };
      if (i === 0) { attrs.scope = 'row'; return el('th', attrs); }
      return el('td', attrs);
    })));
    return el('table', { className: 'data stack' }, [
      caption ? el('caption', { text: caption }) : null,
      el('thead', null, [head]),
      el('tbody', null, body)
    ]);
  }

  function shareCount(x) {
    return Number.isInteger(x) ? C.formatNumber(x, 0) : C.fmtShares(x);
  }

  // ---------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------

  async function fetchText(path) {
    let res;
    try {
      res = await fetch(path, { cache: 'no-cache' });
    } catch (e) {
      throw new Error(`Couldn't read ${path}. If you opened index.html straight from your computer, the browser blocks it from reading the data files. The app works once it is published with GitHub Pages or served by a web server.`);
    }
    if (!res.ok) throw new Error(`Couldn't read ${path} (the server answered ${res.status}).`);
    return res.text();
  }

  async function loadData() {
    const keys = Object.keys(FILES);
    const texts = await Promise.all(keys.map(k => fetchText(FILES[k])));
    const raw = {};
    keys.forEach((k, i) => { raw[k] = C.parseCSV(texts[i]); });
    return {
      cdss: C.readCdss(raw.cdss, FILES.cdss),
      tax: C.readTaxRate(raw.assumptions, FILES.assumptions),
      schedule: C.readSchedule(raw.schedule, FILES.schedule),
      firms: C.readExampleFirms(raw.firms, FILES.firms),
      scenarios: C.readScenarios(raw.scenarios, FILES.scenarios)
    };
  }

  // ---------------------------------------------------------------------
  // Question c: Firm U and Firm L
  // ---------------------------------------------------------------------

  function firmTable(title, f) {
    const outcomes = f.outcomes;
    const each = (label, fmt) => el('tr', null, [
      el('th', { scope: 'row', text: label }),
      ...outcomes.map(o => el('td', { text: fmt(o) }))
    ]);
    const stat = (label, text) => el('tr', { className: 'stat' }, [
      el('th', { scope: 'row', text: label }),
      el('td', { colspan: String(outcomes.length), text })
    ]);

    return el('table', { className: 'data firm' }, [
      el('caption', { text: title }),
      el('thead', null, [el('tr', null, [
        el('th', { scope: 'col', text: 'Probability' }),
        ...outcomes.map(o => el('th', { scope: 'col', text: C.fmtRatio(o.probability) }))
      ])]),
      el('tbody', null, [
        each('Assets', () => C.fmtDollars(f.assets)),
        each('Equity', () => C.fmtDollars(f.equity)),
        each('Sales', o => C.fmtDollars(o.sales)),
        each('Oper. costs', o => C.fmtCost(o.operatingCosts)),
        each('EBIT', o => C.fmtDollars(o.ebit)),
        each('Interest', o => C.fmtCost(o.interest)),
        each('EBT', o => C.fmtDollars(o.ebt)),
        each(`Taxes (${C.fmtPct(f.tax)})`, o => C.fmtCost(o.taxes)),
        each('Net income', o => C.fmtDollars(o.netIncome)),
        each('ROE', o => C.fmtPct(o.roe)),
        each('TIE', o => C.fmtMultiple(o.tie)),
        stat('E(ROE)', f.roe ? C.fmtPct(f.roe.mean) : 'n/a'),
        stat('E(TIE)', f.tie ? C.fmtMultiple(f.tie.mean) : 'n/a'),
        stat('σ(ROE)', f.roe ? C.fmtPct(f.roe.sd) : 'n/a'),
        stat('σ(TIE)', f.tie ? C.fmtMultiple(f.tie.sd) : 'n/a'),
        stat('CV of ROE (σ / E)', f.roe ? C.fmtRatio(f.roe.cv) : 'n/a')
      ])
    ]);
  }

  function renderFirms(d) {
    const common = { assets: d.firms.totalAssets, rate: d.firms.interestRate, tax: d.tax, scenarios: d.scenarios };
    const firmU = C.firmAnalysis(Object.assign({ debt: 0 }, common));
    const firmL = C.firmAnalysis(Object.assign({ debt: d.firms.firmLDebt }, common));

    $('firms-intro').textContent =
      `Both firms have ${C.fmtDollars(d.firms.totalAssets)} of total assets and a ${C.fmtPct(d.tax)} tax rate. ` +
      `Firm U has no debt. Firm L borrows ${C.fmtDollars(d.firms.firmLDebt)} at ${C.fmtPct(d.firms.interestRate)}. ` +
      'The CV row is not in the case\'s table; it is added so you can compare risk per unit of return.';

    fill('firm-tables', [
      firmTable('Firm U: no debt', firmU),
      firmTable(`Firm L: ${C.fmtDollars(d.firms.firmLDebt)} of debt at ${C.fmtPct(d.firms.interestRate)}`, firmL)
    ]);
    $('firms').hidden = false;
  }

  // ---------------------------------------------------------------------
  // Question d: CDSS
  // ---------------------------------------------------------------------

  function renderCdss(d) {
    const res = C.analyzeCdss(d.cdss, d.schedule, d.tax);
    const c = d.cdss;
    const P0 = C.fmtMoney(c.price);
    const A = C.fmtDollars(c.totalAssets);

    fill('cdss-warnings', res.warnings.map(w => el('p', { className: 'warning', role: 'alert', text: '⚠ ' + w })));

    const inputs = [
      ['Sales', C.fmtDollars(c.sales)],
      ['Variable costs', `${C.fmtPct(c.variableCostRate)} of sales`],
      ['Fixed costs', C.fmtDollars(c.fixedCosts)],
      ['EBIT = sales × (1 − variable cost rate) − fixed costs, the same at every amount of debt', C.fmtDollars(res.ebit)],
      ['Tax rate (T)', C.fmtPct(d.tax)],
      ['Shares outstanding before any buyback (n)', shareCount(c.shares)],
      ['Today\'s price (P₀)', P0],
      ['Total book assets (A)', A]
    ];
    fill('cdss-inputs', inputs.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));

    const debtCol = { label: 'Debt (D)', value: r => C.fmtDollars(r.debt) };
    const tieCol = { label: 'TIE', sub: 'EBIT / interest', value: r => C.fmtMultiple(r.tie) };

    fill('cdss-earnings', [rowTable([
      debtCol,
      { label: 'r_d', sub: 'cost of debt', value: r => r.rd === null ? '—' : C.fmtPct(r.rd) },
      { label: 'r_s', sub: 'cost of equity', value: r => C.fmtPct(r.rs) },
      { label: 'Interest', sub: 'r_d × D', value: r => C.fmtDollars(r.interest) },
      { label: 'EBT', sub: 'EBIT − interest', value: r => C.fmtDollars(r.ebt) },
      { label: 'Taxes', sub: 'T × EBT', value: r => C.fmtDollars(r.taxes) },
      { label: 'Net income', sub: '(EBIT − interest)(1 − T)', value: r => C.fmtDollars(r.netIncome) }
    ], res.rows)]);

    // Case method
    $('case-heading').textContent = `Case method (questions d(3) and d(4)): buy back at today's ${P0}`;
    $('case-note').textContent =
      `CDSS buys back D / P₀ shares at ${P0} each. EPS = net income / shares remaining. ` +
      'CDSS pays out all its earnings, so dividends per share = EPS and g = 0, which makes price = EPS / r_s. ' +
      `WACC uses book weights, the AGE solution's method for d(7): D/A × r_d × (1 − T) + (A − D)/A × r_s, with A = ${A}.`;
    fill('cdss-case', [rowTable([
      debtCol,
      { label: 'Shares repurchased', sub: 'D / P₀', value: r => C.fmtShares(r.caseMethod.repurchased) },
      { label: 'Shares remaining', sub: 'n − D / P₀', value: r => C.fmtShares(r.caseMethod.remaining) },
      { label: 'EPS', sub: 'NI / shares remaining', value: r => C.fmtMoney(r.caseMethod.eps) },
      tieCol,
      { label: 'Share price', sub: 'EPS / r_s', value: r => C.fmtMoney(r.caseMethod.price) },
      { label: 'WACC, book weights', sub: 'D/A, (A − D)/A', value: r => C.fmtPct(r.caseMethod.wacc) }
    ], res.rows)]);

    const z = res.zeroCheck;
    const caseCheck = $('case-check');
    if (z) {
      caseCheck.textContent = `Check at $0: EPS / r_s = ${C.fmtMoney(z.eps)} / ${C.fmtPct(z.rs)} = ${C.fmtMoney(z.implied)}. ` +
        (z.ok ? `That matches today's price in cdss.csv (${C.fmtMoney(z.price)}). ✓`
              : `That does not match today's price in cdss.csv (${C.fmtMoney(z.price)}). ⚠`);
      caseCheck.className = z.ok ? 'check ok' : 'check bad';
    } else {
      caseCheck.textContent = '';
    }

    // New-price method
    $('new-note').textContent =
      'Value of equity S = net income / r_s. Value of the firm V = S + D. Price P = V / n. ' +
      'CDSS buys back D / P shares, so shares remaining = n − D / P and EPS = net income / shares remaining. ' +
      'WACC uses market weights: D/V × r_d × (1 − T) + S/V × r_s.';
    fill('cdss-new', [rowTable([
      debtCol,
      { label: 'Value of equity (S)', sub: 'NI / r_s', value: r => C.fmtDollars(r.newPrice.equityValue) },
      { label: 'Value of firm (V)', sub: 'S + D', value: r => C.fmtDollars(r.newPrice.firmValue) },
      { label: 'Share price (P)', sub: 'V / n', value: r => C.fmtMoney(r.newPrice.price) },
      { label: 'Shares repurchased', sub: 'D / P', value: r => C.fmtShares(r.newPrice.repurchased) },
      { label: 'Shares remaining', sub: 'n − D / P', value: r => C.fmtShares(r.newPrice.remaining) },
      { label: 'EPS', sub: 'NI / shares remaining', value: r => C.fmtMoney(r.newPrice.eps) },
      tieCol,
      { label: 'WACC, market weights', sub: 'D/V, S/V', value: r => C.fmtPct(r.newPrice.wacc) }
    ], res.rows)]);

    const k = res.checks;
    const list = debts => debts.map(C.fmtDollars).join(', ');
    const newCheck = $('new-check');
    newCheck.textContent =
      (k.epsAll ? 'Check: EPS = r_s × P at every amount. ✓ ' : `⚠ EPS ≠ r_s × P at ${list(k.epsFailed)}. `) +
      (k.waccAll ? 'Check: WACC with market weights = EBIT × (1 − T) / V at every amount. ✓'
                 : `⚠ WACC with market weights ≠ EBIT × (1 − T) / V at ${list(k.waccFailed)}.`);
    newCheck.className = k.epsAll && k.waccAll ? 'check ok' : 'check bad';

    renderSummary(res);
    $('cdss').hidden = false;
  }

  function renderSummary(res) {
    const rows = res.rows;
    const b = res.best;
    const picks = [
      ['Highest share price, case method', b.casePrice, r => C.fmtMoney(r.caseMethod.price)],
      ['Highest share price, new-price method', b.newPrice, r => C.fmtMoney(r.newPrice.price)],
      ['Lowest WACC, book weights', b.waccBook, r => C.fmtPct(r.caseMethod.wacc)],
      ['Lowest WACC, market weights', b.waccMarket, r => C.fmtPct(r.newPrice.wacc)]
    ];
    const items = picks.map(([label, i, fmt]) => el('li', null, [
      el('strong', { text: label + ': ' }),
      i >= 0 ? `${C.fmtDollars(rows[i].debt)} of debt (${fmt(rows[i])})` : 'n/a'
    ]));
    const idx = picks.map(p => p[1]);
    const agree = idx.every(i => i >= 0 && rows[i].debt === rows[idx[0]].debt);
    const verdict = agree
      ? `All four point to the same amount: ${C.fmtDollars(rows[idx[0]].debt)} of debt.`
      : 'These don\'t all point to the same amount of debt, so the app doesn\'t pick one. Compare the tables above.';
    fill('cdss-summary', [
      el('ul', null, items),
      el('p', { className: agree ? 'check ok' : 'check bad', text: verdict })
    ]);
  }

  // ---------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------

  async function start() {
    const status = $('status');
    try {
      const data = await loadData();
      renderFirms(data);
      renderCdss(data);
      status.hidden = true;
    } catch (err) {
      status.textContent = '⚠ ' + err.message;
      status.className = 'status error';
      console.error(err);
    }
  }

  start();
})();
