/*
 * capstruct.js — the finance math for the AGE capital structure app.
 *
 * Every function here is plain math on numbers and arrays. Nothing touches
 * the page, so you can check any of it with Node, for example:
 *   node -e "const C = require('./capstruct.js'); console.log(C.roundHalfUp(0.14025 * 100, 2))"
 *
 * Notation (as in CLAUDE.md): T = tax rate, D = amount borrowed,
 * n = shares outstanding before any buyback, P0 = today's price,
 * A = total book assets.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------
  // Reading the CSV files
  // ---------------------------------------------------------------------

  // Turns CSV text into an array of objects keyed by the header row.
  // Handles quoted fields, "" inside quotes, Windows line endings and a
  // leading byte-order mark. Blank lines are skipped.
  function parseCSV(text) {
    const src = String(text).replace(/^﻿/, '');
    const records = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inQuotes) {
        if (c === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); records.push(row); row = []; field = '';
      } else if (c !== '\r') {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); records.push(row); }

    const nonBlank = records.filter(r => r.some(f => f.trim() !== ''));
    if (!nonBlank.length) return [];
    const header = nonBlank[0].map(h => h.trim());
    return nonBlank.slice(1).map(r => {
      const obj = {};
      header.forEach((h, j) => { obj[h] = (r[j] === undefined ? '' : r[j]).trim(); });
      return obj;
    });
  }

  // A blank cell becomes null. Anything else must be a plain number, or we
  // stop with an error that names the file and the cell. No guessing.
  function toNumber(value, where) {
    const s = String(value === undefined || value === null ? '' : value).trim();
    if (s === '') return null;
    const x = Number(s);
    if (!Number.isFinite(x)) throw new Error(`${where}: "${s}" is not a number.`);
    return x;
  }

  function requireColumns(rows, columns, file) {
    if (!rows.length) throw new Error(`${file} has no data rows.`);
    const missing = columns.filter(c => !(c in rows[0]));
    if (missing.length) throw new Error(`${file} is missing the column(s): ${missing.join(', ')}.`);
  }

  // For files laid out as name,value rows (cdss.csv, assumptions.csv,
  // example_firms.csv). Returns { name: number }.
  function readNamedValues(rows, file, keyCol, required) {
    requireColumns(rows, [keyCol, 'value'], file);
    const out = {};
    rows.forEach(r => {
      const key = r[keyCol];
      if (key in out) throw new Error(`${file}: "${key}" appears more than once.`);
      out[key] = toNumber(r.value, `${file}, ${key}`);
    });
    required.forEach(name => {
      if (!(name in out) || out[name] === null) throw new Error(`${file} needs a value for "${name}".`);
    });
    return out;
  }

  function readCdss(rows, file) {
    const v = readNamedValues(rows, file, 'item', [
      'sales', 'variable_cost_rate', 'fixed_costs', 'total_assets', 'debt',
      'shares_outstanding', 'share_price', 'management_share'
    ]);
    if (v.shares_outstanding <= 0) throw new Error(`${file}: shares_outstanding must be above 0.`);
    if (v.share_price <= 0) throw new Error(`${file}: share_price must be above 0.`);
    if (v.total_assets <= 0) throw new Error(`${file}: total_assets must be above 0.`);
    return {
      sales: v.sales,
      variableCostRate: v.variable_cost_rate,
      fixedCosts: v.fixed_costs,
      totalAssets: v.total_assets,
      currentDebt: v.debt,
      shares: v.shares_outstanding,
      price: v.share_price,
      managementShare: v.management_share
    };
  }

  function readTaxRate(rows, file) {
    return readNamedValues(rows, file, 'assumption', ['tax_rate']).tax_rate;
  }

  function readExampleFirms(rows, file) {
    const v = readNamedValues(rows, file, 'item', [
      'total_assets', 'firm_l_debt', 'interest_rate', 'slider_max', 'slider_step'
    ]);
    if (v.slider_step <= 0) throw new Error(`${file}: slider_step must be above 0.`);
    if (v.slider_max < 0) throw new Error(`${file}: slider_max must be 0 or more.`);
    return {
      totalAssets: v.total_assets,
      firmLDebt: v.firm_l_debt,
      interestRate: v.interest_rate,
      sliderMax: v.slider_max,
      sliderStep: v.slider_step
    };
  }

  // The banker's schedule: one row per amount of borrowing. The $0 row has
  // no cost of debt. Every other row must have both costs. Rows come back
  // sorted from least to most debt.
  function readSchedule(rows, file) {
    requireColumns(rows, ['debt', 'cost_of_debt', 'cost_of_equity'], file);
    const out = rows.map((r, i) => {
      const where = `${file}, row ${i + 2}`;
      const debt = toNumber(r.debt, `${where}, debt`);
      const rd = toNumber(r.cost_of_debt, `${where}, cost_of_debt`);
      const rs = toNumber(r.cost_of_equity, `${where}, cost_of_equity`);
      if (debt === null || debt < 0) throw new Error(`${where}: debt must be 0 or more.`);
      if (rs === null || rs <= 0) throw new Error(`${where}: cost_of_equity must be above 0.`);
      if (debt > 0 && rd === null) throw new Error(`${where}: cost_of_debt is blank, but only the $0 row may leave it blank.`);
      return { debt, rd: debt > 0 ? rd : null, rs };
    });
    out.sort((a, b) => a.debt - b.debt);
    for (let i = 1; i < out.length; i++) {
      if (out[i].debt === out[i - 1].debt) throw new Error(`${file}: the amount ${out[i].debt} appears more than once.`);
    }
    return out;
  }

  function readScenarios(rows, file) {
    requireColumns(rows, ['probability', 'sales', 'operating_costs'], file);
    const out = rows.map((r, i) => {
      const where = `${file}, row ${i + 2}`;
      const probability = toNumber(r.probability, `${where}, probability`);
      const sales = toNumber(r.sales, `${where}, sales`);
      const operatingCosts = toNumber(r.operating_costs, `${where}, operating_costs`);
      if (probability === null || sales === null || operatingCosts === null) {
        throw new Error(`${where}: probability, sales and operating_costs are all needed.`);
      }
      return { probability, sales, operatingCosts };
    });
    const total = out.reduce((s, r) => s + r.probability, 0);
    if (Math.abs(total - 1) > 1e-9) throw new Error(`${file}: the probabilities add up to ${total}, not 1.`);
    return out;
  }

  // ---------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------

  // Expected value = probability-weighted average.
  // Standard deviation = square root of the probability-weighted squared
  // deviations. CV = standard deviation / expected value.
  function weightedStats(probabilities, values) {
    const mean = probabilities.reduce((s, p, i) => s + p * values[i], 0);
    const variance = probabilities.reduce((s, p, i) => s + p * (values[i] - mean) ** 2, 0);
    const sd = Math.sqrt(variance);
    return { mean, sd, cv: mean !== 0 ? sd / mean : null };
  }

  // ---------------------------------------------------------------------
  // Firm U and Firm L (question c)
  // ---------------------------------------------------------------------

  // One firm with the given debt. Firm U is the same call with debt = 0.
  // Interest = rate × debt. ROE uses book equity = assets − debt.
  function firmAnalysis(opts) {
    const assets = opts.assets, debt = opts.debt, rate = opts.rate, tax = opts.tax;
    const equity = assets - debt;
    const interest = rate * debt;
    const outcomes = opts.scenarios.map(s => {
      const ebit = s.sales - s.operatingCosts;
      const ebt = ebit - interest;
      const taxes = tax * ebt;
      const netIncome = ebt - taxes;
      return {
        probability: s.probability,
        sales: s.sales,
        operatingCosts: s.operatingCosts,
        ebit, interest, ebt, taxes, netIncome,
        roe: equity > 0 ? netIncome / equity : null,
        tie: interest > 0 ? ebit / interest : null   // no interest: "n/a"
      };
    });
    const probs = outcomes.map(o => o.probability);
    const roe = equity > 0 ? weightedStats(probs, outcomes.map(o => o.roe)) : null;
    const tie = interest > 0 ? weightedStats(probs, outcomes.map(o => o.tie)) : null;
    return { assets, debt, equity, rate, tax, interest, outcomes, roe, tie };
  }

  // ---------------------------------------------------------------------
  // CDSS at each amount of borrowing (question d)
  // ---------------------------------------------------------------------

  // EBIT = sales × (1 − variable cost rate) − fixed costs. The case says it
  // stays the same at every amount of debt.
  function cdssEbit(cdss) {
    return cdss.sales * (1 - cdss.variableCostRate) - cdss.fixedCosts;
  }

  // Relative closeness test for the built-in checks.
  function close(a, b) {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }

  // Management's share after the buyback. Management doesn't sell, so only
  // outside investors' shares, (1 − management's share) × n, can be bought.
  function managementStake(cdss, repurchased, remaining) {
    const n = cdss.shares;
    const m = cdss.managementShare;
    const outside = (1 - m) * n;
    if (close(repurchased, outside)) return { status: 'none-left', stake: 1, outside };
    if (repurchased > outside) return { status: 'must-sell', stake: null, outside };
    return { status: 'ok', stake: m * n / remaining, outside };
  }

  // One amount of borrowing, all three buyback methods. rU is the cost of
  // equity at $0 (the unlevered cost), or null if the schedule has no $0 row.
  function cdssAtDebt(cdss, tax, ebit, step, rU) {
    const D = step.debt;
    const rd = step.rd;            // null at $0
    const rs = step.rs;
    const n = cdss.shares;
    const P0 = cdss.price;
    const A = cdss.totalAssets;
    const afterTaxRd = D > 0 ? rd * (1 - tax) : 0;

    // The same under both methods: the buyback price doesn't change interest.
    const interest = D > 0 ? rd * D : 0;
    const ebt = ebit - interest;
    const taxes = tax * ebt;
    const netIncome = (ebit - interest) * (1 - tax);
    const tie = interest > 0 ? ebit / interest : null;

    // Case method (d(3) and d(4)): buy back at today's price P0.
    const caseRepurchased = D / P0;
    const caseRemaining = n - caseRepurchased;
    const caseEps = caseRemaining > 0 ? netIncome / caseRemaining : null;
    const casePrice = caseEps !== null ? caseEps / rs : null;   // g = 0, all earnings paid out
    const waccBook = (D / A) * afterTaxRd + ((A - D) / A) * rs;

    // New-price method: buy back at the price after the announcement.
    const S = netIncome / rs;            // value of equity
    const V = S + D;                     // value of the firm
    const P = V / n;                     // price per share before the buyback
    const newRepurchased = D / P;
    const newRemaining = n - newRepurchased;
    const newEps = newRemaining > 0 ? netIncome / newRemaining : null;
    const waccMarket = (D / V) * afterTaxRd + (S / V) * rs;

    // Tax-shield method (MM with corporate taxes, perpetual debt): the
    // announcement adds the present value of the tax shields, T × D, to
    // today's value of the firm, n × P0. CDSS buys back at that price.
    // It uses the banker's r_d for interest but not the banker's r_s.
    const pvTaxShield = tax * D;
    const tsFirmValue = n * P0 + pvTaxShield;
    const tsPrice = tsFirmValue / n;               // = P0 + T × D / n
    const tsRepurchased = D / tsPrice;
    const tsRemaining = n - tsRepurchased;
    const tsEps = tsRemaining > 0 ? netIncome / tsRemaining : null;
    const tsEquityValue = tsFirmValue - D;
    // With g = 0 and all earnings paid out, price = EPS / r_s, so the r_s
    // this price implies is EPS / P.
    const tsImpliedRs = tsEps !== null ? tsEps / tsPrice : null;
    const tsWacc = tsImpliedRs !== null
      ? (D / tsFirmValue) * afterTaxRd + (tsEquityValue / tsFirmValue) * tsImpliedRs
      : null;
    // MM Proposition II with taxes: r_s = r_U + (r_U − r_d)(1 − T) D / S.
    const tsMmRs = rU !== null && tsEquityValue > 0
      ? rU + (rU - (D > 0 ? rd : 0)) * (1 - tax) * D / tsEquityValue
      : null;

    return {
      debt: D, rd, rs, interest, ebt, taxes, netIncome, tie,
      caseMethod: {
        repurchased: caseRepurchased,
        remaining: caseRemaining,
        eps: caseEps,
        dps: caseEps,                    // all earnings paid out
        price: casePrice,
        wacc: waccBook,
        management: managementStake(cdss, caseRepurchased, caseRemaining)
      },
      taxShield: {
        pvTaxShield,
        firmValue: tsFirmValue,
        equityValue: tsEquityValue,
        price: tsPrice,
        repurchased: tsRepurchased,
        remaining: tsRemaining,
        eps: tsEps,
        dps: tsEps,
        impliedRs: tsImpliedRs,
        wacc: tsWacc,
        management: managementStake(cdss, tsRepurchased, tsRemaining),
        // Checks: WACC = EBIT(1 − T) / V, and the implied r_s = MM Prop. II.
        waccCheck: ebit * (1 - tax) / tsFirmValue,
        waccCheckOk: tsWacc !== null && close(tsWacc, ebit * (1 - tax) / tsFirmValue),
        mmRs: tsMmRs,
        mmCheckOk: tsMmRs !== null && tsImpliedRs !== null && close(tsImpliedRs, tsMmRs)
      },
      newPrice: {
        equityValue: S,
        firmValue: V,
        price: P,
        repurchased: newRepurchased,
        remaining: newRemaining,
        eps: newEps,
        dps: newEps,
        wacc: waccMarket,
        // Checks from CLAUDE.md: EPS = r_s × P, and WACC = EBIT(1 − T) / V.
        epsCheck: rs * P,
        waccCheck: ebit * (1 - tax) / V,
        epsCheckOk: newEps !== null && close(newEps, rs * P),
        waccCheckOk: close(waccMarket, ebit * (1 - tax) / V),
        management: managementStake(cdss, newRepurchased, newRemaining)
      }
    };
  }

  // Index of the best value. Ties keep the first row, which is the smaller
  // amount of debt because the schedule is sorted from least to most debt.
  function bestIndex(values, mode) {
    let best = -1;
    values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) return;
      if (best === -1 || (mode === 'max' ? v > values[best] : v < values[best])) best = i;
    });
    return best;
  }

  function analyzeCdss(cdss, schedule, tax) {
    const ebit = cdssEbit(cdss);
    const zeroStep = schedule.find(s => s.debt === 0);
    const rU = zeroStep ? zeroStep.rs : null;
    const rows = schedule.map(step => cdssAtDebt(cdss, tax, ebit, step, rU));
    const warnings = [];

    if (cdss.currentDebt !== 0) {
      warnings.push(`The calculations assume CDSS starts with no debt, as in the case, but cdss.csv lists debt of ${cdss.currentDebt}.`);
    }

    // Check: EPS / r_s at $0 should equal today's price in cdss.csv.
    // "Equal" here means equal to the cent.
    const zero = rows.find(r => r.debt === 0);
    let zeroCheck = null;
    if (!zero) {
      warnings.push('The banker\'s schedule has no $0 row, so the app can\'t check EPS / r_s at $0 against today\'s price.');
    } else {
      const implied = zero.caseMethod.eps / zero.rs;
      zeroCheck = {
        eps: zero.caseMethod.eps,
        rs: zero.rs,
        implied,
        price: cdss.price,
        ok: Math.abs(roundHalfUp(implied, 2) - roundHalfUp(cdss.price, 2)) < 1e-9
      };
      if (!zeroCheck.ok) {
        warnings.push(`EPS / r_s at $0 gives ${fmtMoney(implied)}, but cdss.csv says today's price is ${fmtMoney(cdss.price)}. The schedule's cost of equity at $0 doesn't fit today's price, so the case method's buyback at ${fmtMoney(cdss.price)} and the new-price method start from different prices.`);
      }
    }

    rows.forEach(r => {
      if (r.caseMethod.remaining <= 0) {
        warnings.push(`At ${fmtDollars(r.debt)} the case method would buy back every share (${fmtShares(r.caseMethod.repurchased)} shares), so it has no EPS or price.`);
      }
      if (r.netIncome <= 0) {
        warnings.push(`At ${fmtDollars(r.debt)} net income is ${fmtDollars(r.netIncome)}, so the price formulas don't apply.`);
      }
    });

    const best = {
      casePrice: bestIndex(rows.map(r => r.caseMethod.price), 'max'),
      newPrice: bestIndex(rows.map(r => r.newPrice.price), 'max'),
      waccBook: bestIndex(rows.map(r => r.caseMethod.wacc), 'min'),
      waccMarket: bestIndex(rows.map(r => r.newPrice.wacc), 'min'),
      caseEps: bestIndex(rows.map(r => r.caseMethod.eps), 'max'),
      newEps: bestIndex(rows.map(r => r.newPrice.eps), 'max'),
      taxPrice: bestIndex(rows.map(r => r.taxShield.price), 'max'),
      taxEps: bestIndex(rows.map(r => r.taxShield.eps), 'max'),
      taxWacc: bestIndex(rows.map(r => r.taxShield.wacc), 'min')
    };

    const checks = {
      epsAll: rows.every(r => r.newPrice.epsCheckOk),
      waccAll: rows.every(r => r.newPrice.waccCheckOk),
      epsFailed: rows.filter(r => !r.newPrice.epsCheckOk).map(r => r.debt),
      waccFailed: rows.filter(r => !r.newPrice.waccCheckOk).map(r => r.debt),
      tsWaccAll: rows.every(r => r.taxShield.waccCheckOk),
      tsWaccFailed: rows.filter(r => !r.taxShield.waccCheckOk).map(r => r.debt),
      // MM Prop. II matches only if today's value n × P0 equals the
      // unlevered value EBIT(1 − T) / r_U, which is the $0 check.
      tsMmAll: rows.every(r => r.taxShield.mmCheckOk),
      tsMmFailed: rows.filter(r => !r.taxShield.mmCheckOk).map(r => r.debt)
    };

    return { ebit, tax, cdss, rows, best, zeroCheck, checks, warnings };
  }

  // ---------------------------------------------------------------------
  // Rounding and display
  // ---------------------------------------------------------------------

  // Round half up on the decimal value, to d decimals. toPrecision(12)
  // first strips the tiny binary error, so 14.024999999999999 (the
  // book-weight WACC at $500,000, really 14.025) rounds to 14.03, and
  // 3.4949999... (really 3.495) rounds to 3.50. Halves round away from zero.
  function roundHalfUp(x, d) {
    if (x === null || !Number.isFinite(x)) return x;
    const f = 10 ** d;
    const scaled = Number((Math.abs(x) * f).toPrecision(12));
    const r = Math.round(scaled) / f;
    return x < 0 ? -r : r;
  }

  function formatNumber(x, d) {
    const r = roundHalfUp(x, d);
    const parts = Math.abs(r).toFixed(d).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const s = parts.join('.');
    return r < 0 ? '-' + s : s;
  }

  const NA = 'n/a';
  const ok = x => x !== null && x !== undefined && Number.isFinite(x);

  // Dollars to the nearest dollar.
  function fmtDollars(x) {
    if (!ok(x)) return NA;
    const r = roundHalfUp(x, 0);
    return (r < 0 ? '-$' : '$') + formatNumber(Math.abs(r), 0);
  }
  // A cost shown in parentheses, as in the case's income statements.
  function fmtCost(x) {
    if (!ok(x)) return NA;
    return '(' + formatNumber(x, 0) + ')';
  }
  // Prices, EPS and dividends to the cent.
  function fmtMoney(x) {
    if (!ok(x)) return NA;
    const r = roundHalfUp(x, 2);
    return (r < 0 ? '-$' : '$') + formatNumber(Math.abs(r), 2);
  }
  // Rates as percents to two decimals. x is a decimal: 0.14025 -> "14.03%".
  function fmtPct(x) {
    return ok(x) ? formatNumber(x * 100, 2) + '%' : NA;
  }
  // TIE, CV and other multiples to two decimals.
  function fmtMultiple(x) {
    return ok(x) ? formatNumber(x, 2) + '×' : NA;
  }
  function fmtRatio(x) {
    return ok(x) ? formatNumber(x, 2) : NA;
  }
  // Share counts are never rounded in the math; shown to two decimals.
  function fmtShares(x) {
    return ok(x) ? formatNumber(x, 2) : NA;
  }

  const CapStruct = {
    parseCSV, toNumber,
    readCdss, readTaxRate, readExampleFirms, readSchedule, readScenarios,
    weightedStats, firmAnalysis,
    cdssEbit, cdssAtDebt, analyzeCdss, bestIndex, managementStake,
    roundHalfUp, formatNumber,
    fmtDollars, fmtCost, fmtMoney, fmtPct, fmtMultiple, fmtRatio, fmtShares
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = CapStruct;
  } else {
    global.CapStruct = CapStruct;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
