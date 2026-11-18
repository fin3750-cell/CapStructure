/*
 * app.js — reads the CSV files in data/, runs the math in capstruct.js and
 * draws the tables and levers. All the finance lives in capstruct.js; this
 * file only moves numbers onto the page.
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
  // each row into a card and uses data-label for the names. Each row
  // carries its place in the schedule so the slider can highlight it.
  function rowTable(columns, rows, caption) {
    const head = el('tr', null, columns.map(col =>
      el('th', { scope: 'col' }, [col.label, col.sub ? el('span', { className: 'sub', text: col.sub }) : null])
    ));
    const body = rows.map((r, idx) => el('tr', { 'data-step': String(idx) }, columns.map((col, i) => {
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

  function debtList(debts) {
    return debts.map(C.fmtDollars).join(', ');
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
  // Question c: Firm U and Firm L, with the Firm L debt slider
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
        stat('CV of ROE (σ / E)', f.roe && f.roe.cv !== null ? C.fmtRatio(f.roe.cv) : 'n/a')
      ])
    ]);
  }

  function setupFirms(d) {
    const firms = d.firms;
    const common = { assets: firms.totalAssets, rate: firms.interestRate, tax: d.tax, scenarios: d.scenarios };
    const firmU = C.firmAnalysis(Object.assign({ debt: 0 }, common));
    const tableU = firmTable('Firm U: no debt', firmU);

    $('firms-intro').textContent =
      `Both firms have ${C.fmtDollars(firms.totalAssets)} of total assets and a ${C.fmtPct(d.tax)} tax rate. ` +
      `Firm U has no debt. In the case, Firm L borrows ${C.fmtDollars(firms.firmLDebt)} at ${C.fmtPct(firms.interestRate)}. ` +
      'The CV row is not in the case\'s table; it is added so you can compare risk per unit of return.';
    $('firm-l-rate-note').textContent =
      `The interest rate is held at ${C.fmtPct(firms.interestRate)} at every amount, so the slider shows what debt does to ` +
      'Firm L\'s return and risk, not how lenders would respond.';

    const slider = $('firm-l-debt');
    slider.min = '0';
    slider.max = String(firms.sliderMax);
    slider.step = String(firms.sliderStep);

    // The Case button must land exactly on the case's debt.
    const onGrid = x => x >= 0 && x <= firms.sliderMax && Math.abs(x / firms.sliderStep - Math.round(x / firms.sliderStep)) < 1e-9;
    if (!onGrid(firms.firmLDebt)) {
      fill('firm-l-warnings', [el('p', { className: 'warning', role: 'alert',
        text: `⚠ The case's debt of ${C.fmtDollars(firms.firmLDebt)} isn't one of the slider's stops (0 to ${C.fmtDollars(firms.sliderMax)} in steps of ${C.fmtDollars(firms.sliderStep)}), so the Case button can't land on it exactly.` })]);
    }

    function show(debt) {
      const firmL = C.firmAnalysis(Object.assign({ debt }, common));
      $('firm-l-debt-out').textContent = C.fmtDollars(debt);
      slider.setAttribute('aria-valuetext', C.fmtDollars(debt));
      fill('firm-tables', [
        tableU,
        firmTable(`Firm L: ${C.fmtDollars(debt)} of debt at ${C.fmtPct(firms.interestRate)}`, firmL)
      ]);
    }

    slider.addEventListener('input', () => show(Number(slider.value)));
    $('btn-case').addEventListener('click', () => {
      slider.value = String(firms.firmLDebt);
      show(Number(slider.value));
    });

    slider.value = String(firms.firmLDebt);
    show(Number(slider.value));
    $('firms').hidden = false;
  }

  // ---------------------------------------------------------------------
  // Question d: CDSS
  // ---------------------------------------------------------------------

  function renderCdssTables(d, res) {
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
      ['Total book assets (A)', A],
      ['Management\'s share of the stock', C.fmtPct(c.managementShare)]
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
      'Value of equity S = net income / r_s, using the banker\'s r_s. Value of the firm V = S + D. Price P = V / n. ' +
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
    const newCheck = $('new-check');
    newCheck.textContent =
      (k.epsAll ? 'Check: EPS = r_s × P at every amount. ✓ ' : `⚠ EPS ≠ r_s × P at ${debtList(k.epsFailed)}. `) +
      (k.waccAll ? 'Check: WACC with market weights = EBIT × (1 − T) / V at every amount. ✓'
                 : `⚠ WACC with market weights ≠ EBIT × (1 − T) / V at ${debtList(k.waccFailed)}.`);
    newCheck.className = k.epsAll && k.waccAll ? 'check ok' : 'check bad';

    // Tax-shield method
    $('ts-note').textContent =
      'This is MM with corporate taxes and perpetual debt: the present value of the tax shields is T × D. ' +
      `The announcement adds it to today's value of the firm, so V = n × P₀ + T × D and P = V / n = ${P0} + T × D / n. ` +
      'CDSS buys back D / P shares. Net income still uses the banker\'s r_d, but the price ignores the banker\'s r_s. ' +
      'The r_s the price implies is EPS / P (g = 0), shown next to the banker\'s. WACC uses market weights with that implied r_s.';
    fill('cdss-ts', [rowTable([
      debtCol,
      { label: 'PV of tax shields', sub: 'T × D', value: r => C.fmtDollars(r.taxShield.pvTaxShield) },
      { label: 'Share price (P)', sub: 'P₀ + T × D / n', value: r => C.fmtMoney(r.taxShield.price) },
      { label: 'Shares repurchased', sub: 'D / P', value: r => C.fmtShares(r.taxShield.repurchased) },
      { label: 'Shares remaining', sub: 'n − D / P', value: r => C.fmtShares(r.taxShield.remaining) },
      { label: 'EPS', sub: 'NI / shares remaining', value: r => C.fmtMoney(r.taxShield.eps) },
      tieCol,
      { label: 'Implied r_s', sub: 'EPS / P', value: r => C.fmtPct(r.taxShield.impliedRs) },
      { label: 'Banker\'s r_s', sub: 'schedule', value: r => C.fmtPct(r.rs) },
      { label: 'WACC, market weights', sub: 'implied r_s', value: r => C.fmtPct(r.taxShield.wacc) }
    ], res.rows)]);

    const tsCheck = $('ts-check');
    tsCheck.textContent =
      (k.tsMmAll ? 'Check: implied r_s = r_U + (r_U − r_d)(1 − T) × D / S (MM Proposition II with taxes, r_U = r_s at $0) at every amount. ✓ '
                 : `⚠ Implied r_s ≠ MM Proposition II with taxes at ${debtList(k.tsMmFailed)}. It only matches when today's price equals EPS / r_s at $0. `) +
      (k.tsWaccAll ? 'Check: WACC = EBIT × (1 − T) / V at every amount. ✓'
                   : `⚠ WACC ≠ EBIT × (1 − T) / V at ${debtList(k.tsWaccFailed)}.`);
    tsCheck.className = k.tsMmAll && k.tsWaccAll ? 'check ok' : 'check bad';

    renderSummary(res);
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
    const line = ([label, i, fmt]) => el('li', null, [
      el('strong', { text: label + ': ' }),
      i >= 0 ? `${C.fmtDollars(rows[i].debt)} of debt (${fmt(rows[i])})` : 'n/a'
    ]);
    const idx = picks.map(p => p[1]);
    const agree = idx.every(i => i >= 0 && rows[i].debt === rows[idx[0]].debt);
    const verdict = agree
      ? `All four point to the same amount: ${C.fmtDollars(rows[idx[0]].debt)} of debt.`
      : 'These don\'t all point to the same amount of debt, so the app doesn\'t pick one. Compare the tables above.';

    const tsPicks = [
      ['Highest share price, tax-shield method', b.taxPrice, r => C.fmtMoney(r.taxShield.price)],
      ['Lowest WACC, tax-shield method', b.taxWacc, r => C.fmtPct(r.taxShield.wacc)]
    ];
    fill('cdss-summary', [
      el('ul', null, picks.map(line)),
      el('p', { className: agree ? 'check ok' : 'check bad', text: verdict }),
      el('p', { className: 'note', text: 'The tax-shield method is listed on its own. Its price rises and its WACC falls with every dollar of debt, because it counts the tax shields but not the banker\'s higher cost of equity, so it always points to the most debt in the schedule.' }),
      el('ul', null, tsPicks.map(line))
    ]);
  }

  // One method's results at the chosen amount of debt.
  function methodCard(title, subtitle, m, extra, waccLabel) {
    const rows = [
      ['Share price', C.fmtMoney(m.price)],
      ['Shares repurchased', C.fmtShares(m.repurchased)],
      ['Shares remaining', C.fmtShares(m.remaining)],
      ['EPS', C.fmtMoney(m.eps)],
      ['Dividends per share', C.fmtMoney(m.dps)],
      ['TIE', extra.tie],
      [waccLabel, C.fmtPct(m.wacc)]
    ].concat(extra.rows || []);

    const mg = m.management;
    let mgText;
    let mgNote = null;
    if (mg.status === 'ok') {
      mgText = C.fmtPct(mg.stake);
    } else if (mg.status === 'none-left') {
      mgText = C.fmtPct(1);
      mgNote = el('p', { className: 'check bad', text: `The buyback takes all ${C.fmtShares(mg.outside)} outside shares, so no outside shareholders would be left.` });
    } else {
      mgText = 'n/a';
      mgNote = el('p', { className: 'warning', text: `⚠ The buyback (${C.fmtShares(m.repurchased)} shares) is more than the ${C.fmtShares(mg.outside)} shares outside investors own, so management would have to sell.` });
    }
    rows.push(['Management\'s share', mgText]);

    return el('article', { className: 'method' }, [
      el('h4', { text: title }),
      el('p', { className: 'sub', text: subtitle }),
      el('dl', null, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
      mgNote
    ]);
  }

  function setupCdssLever(d, res) {
    const rows = res.rows;
    const slider = $('cdss-debt');
    slider.min = '0';
    slider.max = String(rows.length - 1);
    slider.step = '1';
    const note = $('cdss-button-note');

    function show(i) {
      const r = rows[i];
      $('cdss-debt-out').textContent = C.fmtDollars(r.debt);
      slider.setAttribute('aria-valuetext', C.fmtDollars(r.debt));
      $('cdss-at-debt').textContent =
        `At ${C.fmtDollars(r.debt)}: r_d ${r.rd === null ? '—' : C.fmtPct(r.rd)}, r_s ${C.fmtPct(r.rs)}, ` +
        `interest ${C.fmtDollars(r.interest)}, net income ${C.fmtDollars(r.netIncome)}, TIE ${C.fmtMultiple(r.tie)}.`;
      const tie = { tie: C.fmtMultiple(r.tie) };
      fill('cdss-methods', [
        methodCard('Case method', `Buy back at today's ${C.fmtMoney(d.cdss.price)}`, r.caseMethod, tie, 'WACC, book weights'),
        methodCard('New-price method', 'Buy back at P = V / n, from the banker\'s r_s', r.newPrice, tie, 'WACC, market weights'),
        methodCard('Tax-shield method', `Buy back at P = ${C.fmtMoney(d.cdss.price)} + T × D / n`, r.taxShield, {
          tie: tie.tie,
          rows: [
            ['PV of tax shields (T × D)', C.fmtDollars(r.taxShield.pvTaxShield)],
            ['Implied r_s (EPS / P)', C.fmtPct(r.taxShield.impliedRs)],
            ['Banker\'s r_s', C.fmtPct(r.rs)]
          ]
        }, 'WACC, market weights')
      ]);
      document.querySelectorAll('#cdss tr[data-step]').forEach(tr => {
        tr.classList.toggle('selected', tr.getAttribute('data-step') === String(i));
      });
    }

    function goTo(i, text) {
      slider.value = String(i);
      show(i);
      note.textContent = text;
      note.hidden = !text;
    }

    // The buttons follow CLAUDE.md: if the case method and the new-price
    // method pick the same amount, go there; if not, go to the case
    // method's amount and name both. bestIndex already takes the smaller
    // debt on an exact tie. The tax-shield method's pick is reported too.
    function pick(kind) {
      const b = res.best;
      const isPrice = kind === 'price';
      const what = isPrice ? 'share price' : 'EPS';
      const get = isPrice ? (r, m) => r[m].price : (r, m) => r[m].eps;
      const iCase = isPrice ? b.casePrice : b.caseEps;
      const iNew = isPrice ? b.newPrice : b.newEps;
      const iTax = isPrice ? b.taxPrice : b.taxEps;
      const at = (i, m) => `${C.fmtDollars(rows[i].debt)} (${C.fmtMoney(get(rows[i], m))})`;
      if (iCase < 0 && iNew < 0) { goTo(Number(slider.value), `No amount has a ${what} under either method.`); return; }
      const target = iCase >= 0 ? iCase : iNew;
      let text;
      if (iCase === iNew) {
        text = `${C.fmtDollars(rows[target].debt)} gives the highest ${what} under the case method (${C.fmtMoney(get(rows[iCase], 'caseMethod'))}) and the new-price method (${C.fmtMoney(get(rows[iNew], 'newPrice'))}).`;
      } else {
        text = `The two methods disagree. The highest ${what} is at ${iCase >= 0 ? at(iCase, 'caseMethod') : 'n/a'} under the case method and at ${iNew >= 0 ? at(iNew, 'newPrice') : 'n/a'} under the new-price method. The slider went to the ${iCase >= 0 ? 'case' : 'new-price'} method's amount.`;
      }
      if (iTax >= 0) {
        text += iTax === target
          ? ` The tax-shield method agrees (${C.fmtMoney(get(rows[iTax], 'taxShield'))}).`
          : ` Under the tax-shield method the highest ${what} is at ${at(iTax, 'taxShield')}` +
            (isPrice ? ', because its price rises with every dollar of debt.' : '.');
      }
      goTo(target, text);
    }

    slider.addEventListener('input', () => {
      note.hidden = true;
      show(Number(slider.value));
    });
    $('btn-best-price').addEventListener('click', () => pick('price'));
    $('btn-high-eps').addEventListener('click', () => pick('eps'));

    // Start at no debt, where CDSS is today.
    const start = Math.max(0, rows.findIndex(r => r.debt === d.cdss.currentDebt));
    goTo(start, '');
  }

  function setupCdss(d) {
    const res = C.analyzeCdss(d.cdss, d.schedule, d.tax);
    renderCdssTables(d, res);
    setupCdssLever(d, res);
    $('cdss').hidden = false;
  }

  // ---------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------

  async function start() {
    const status = $('status');
    try {
      const data = await loadData();
      setupFirms(data);
      setupCdss(data);
      status.hidden = true;
    } catch (err) {
      status.textContent = '⚠ ' + err.message;
      status.className = 'status error';
      console.error(err);
    }
  }

  start();

  // Register the service worker (sw.js) so the app installs and works
  // offline. The relative path keeps it inside /<repository>/ on GitHub Pages.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => {
        console.warn('The service worker did not register, so the app won\'t work offline:', err);
      });
    });
  }
})();
