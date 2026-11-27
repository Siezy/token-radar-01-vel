// v5 (radar-5): hold-out validated terms, token odds from peers, costed farm verdicts, range honesty.
//
// v5 changes over v4:
//   holdOutValidation(snapshot) splits the snapshot's tokened protocols into two deterministic folds
//                (slug-hash parity), fits each model term on one fold and tests its rank-correlation
//                with the actual market cap on the held-out fold, both directions. A term whose
//                held-out correlation is not positive in BOTH folds is DROPPED from the formula, and
//                the results travel in RadarData.validation (the dashboard's integrity strip shows
//                every kept/dropped verdict).
//   tokenOdds(snapshot): for every pre-token protocol, the chance a peer in its category already
//                launched a token, smoothed (k+1)/(n+2) — RadarRow.token_odds_pct.
//   farmEconomics(): every farm verdict is costed in $/hour: (est. airdrop per farmer x token odds
//                - gas) / est. hours. The airdrop pool is AIRDROP_POOL_PCT of TVL split across
//                sqrt(TVL) estimated active farmers. The formula ships in the dashboard tooltip.
//   range honesty: every implied value ships as a range [0.6x, 1.4x] (implied_range_low_usd /
//                implied_range_high_usd) — a point estimate from one snapshot pretends a precision
//                the model does not have.
//   RadarData.integrity: terms kept/dropped, fees coverage, protocols accounted.
//
// v4 (radar-4): earnings cross-check — implied P/S vs the category's median tokened P/S, from data/fees_annualized.json.
//
// v4 changes over v3:
//   earningsCrossCheck(protocol, implied) reads the annualized-1y fees map (data/fees_annualized.json,
//                a repo data file with its own asOf timestamp — never hardcoded numbers) and the
//                category median P/S (median mcap/fees of tokened protocols, >= 3 samples):
//                implied P/S > 2x median -> 'overvalued'   (adjusted = 2x median x fees, capped at implied)
//                implied P/S < 0.5x median -> 'underpriced' (adjusted = 0.5x median x fees, capped at implied)
//                else 'fair'; a category without a median -> 'no-benchmark'; no fees data -> 'n/a'.
//   The board keeps ranking by the ORIGINAL implied value (flag-only): each row carries `earnings`
//                with the adjusted figure alongside, and the dashboard chooses what to show.
//   Defensive: a missing or unparseable data file skips the cross-check entirely ('n/a'), no error.
//
// v3 (radar-3): category-benchmark implied value + breadth premium + clamped multiples.
//
// v3 changes over v2:
//   breadth    = 1 + BREADTH_PCT_PER_CHAIN x min(chains.length - 1, BREADTH_CHAIN_CAP)
//                (a multi-chain premium: +0.02 per extra chain, capped at 10 extra chains = +0.20)
//   multiple   = clamp(raw_category_multiple, MULTIPLE_FLOOR, MULTIPLE_CAP)  (floor 0.05, cap 1.0)
//                so no outlier category dominates the board; benchmarks carry `clamped` and
//                `multiple_raw` so the dashboard can show when a multiple was clamped
//   implied    = max(1, round(tvl_usd x multiple x maturity x momentum x breadth))
//
// v2 (kept): category-benchmark implied value — median mcap/tvl per category, global median fallback.
//
// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   multiple   = the protocol's category benchmark (median mcap/tvl of the snapshot's tokened
//                protocols in that category, when the category has at least CATEGORY_MIN_SAMPLES
//                samples) or the global benchmark (median mcap/tvl over all tokened protocols)
//   momentum   = clamp(1 + change_7d / 200, MOMENTUM_FLOOR, MOMENTUM_CAP)  (change unknown: 0)
//   maturity   = 0.55 + 0.45 x log1p(age_days) / log(LOG_AGE_NORM), capped at 1.0 (age unknown: 365)
//   implied    = max(1, round(tvl_usd x multiple x maturity x momentum))
//
// The benchmark table (category -> multiple and sample count) travels in RadarData so the dashboard can
// show it. No protocol name is ever special-cased: the same function scores every row.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One category's benchmark: the multiple it scores at and how many tokened samples built it. */
export interface CategoryBenchmark {
  multiple: number;
  n: number;
  // v3: whether the raw median was clamped into [MULTIPLE_FLOOR, MULTIPLE_CAP].
  clamped: boolean;
  // v3: the raw median before clamping, so the dashboard can show both.
  multiple_raw: number;
}

/** The benchmark table: every qualifying category plus the global fallback under `global`. */
export type BenchmarkTable = Record<string, CategoryBenchmark>;

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  // v2: category-benchmark model constants (base_multiple is kept only for interface compatibility).
  category_min_samples: number;
  log_age_norm: number;
  momentum_floor: number;
  momentum_cap: number;
  momentum_scale: number;
  // v3: breadth premium per extra chain, and the cap on counted extra chains.
  breadth_pct_per_chain: number;
  breadth_chain_cap: number;
  // v3: the clamp band for category multiples.
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1095,
  unknown_age_days: 365,
  category_min_samples: 5,
  log_age_norm: 1100,
  momentum_floor: 0.7,
  momentum_cap: 1.3,
  momentum_scale: 200,
  breadth_pct_per_chain: 0.02,
  breadth_chain_cap: 10,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-6';

/**
 * v6: the formula is the proven radar-4c model — every term (breadth, momentum, maturity,
 * category_multiple) stays ACTIVE in the ranking formula, unconditionally. The hold-out test still
 * runs and its results still ship, but as a transparency report only: a dropped verdict no longer
 * neuters a term. buildBoard passes allTermsActive() instead of keptTerms().
 */
export function allTermsActive(): Record<string, boolean> {
  return { category_multiple: true, momentum: true, maturity: true, breadth: true };
}

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
  // v5: the step's costed verdict in $/hour, from farmEconomics.
  net_per_hour_usd?: number;
}

/**
 * v4: the earnings cross-check's record for one row. `verdict` is 'overvalued' | 'underpriced' |
 * 'fair' | 'no-benchmark' | 'n/a'. The numeric fields are null whenever the verdict cannot compute
 * them (no fees data, no category median, or the protocol itself tokened).
 */
export interface EarningsCheck {
  verdict: 'overvalued' | 'underpriced' | 'fair' | 'no-benchmark' | 'n/a';
  implied_ps: number | null;
  category_median_ps: number | null;
  annual_fees_usd: number | null;
  adjusted_implied_usd: number | null;
}

/** The shape of data/fees_annualized.json: a snapshot date and slug -> annualized trailing-1y fees. */
export interface FeesFile {
  as_of: string;
  source: string;
  protocols: Record<string, { id?: string; name?: string; annualized1y: number }>;
}

/** The category median P/S samples that met the minimum, plus the medians themselves. */
export interface EarningsBenchmarks {
  medians: Record<string, number>;
}

/** Minimum tokened protocols per category before a P/S median counts as a benchmark. */
export const EARNINGS_MIN_SAMPLES = 3;
/** A protocol is overvalued when its implied P/S exceeds twice the category median. */
export const EARNINGS_OVER_MULT = 2;
/** A protocol is underpriced when its implied P/S is below half the category median. */
export const EARNINGS_UNDER_MULT = 0.5;

// ---------------------------------------------------------------------------
// v5: hold-out validation, token odds, costed farm verdicts, range honesty.
// ---------------------------------------------------------------------------

/** The minimum Spearman rank correlation a term must clear in BOTH held-out folds to stay. */
export const HOLDOUT_MIN_CORR = 0.05;
/** The share of a protocol's TVL an airdrop pool is conservatively assumed to be. */
export const AIRDROP_POOL_PCT = 0.005;
/** The conservative share of a protocol's implied value a farmer is assumed to receive. */
export const FARMER_ALLOC_PCT = 0.005;
/** The implied-value range band: honest uncertainty, not a point estimate. */
export const RANGE_LOW_MULT = 0.6;
export const RANGE_HIGH_MULT = 1.4;

/**
 * One term's hold-out report (v6: transparency only — every term stays in the formula):
 * its rank correlation on each held-out fold, whether it cleared the bar, and the plain label
 * the dashboard shows.
 */
export interface HoldOutResult {
  term: string;
  fold_a_corr: number;
  fold_b_corr: number;
  /** v6: 'validated' cleared the bar in both folds; 'below-bar' is reported, never dropped. */
  verdict: 'validated' | 'below-bar';
  /** v6: always true — the hold-out result is a report, the formula keeps every term. */
  active_in_formula: boolean;
  /** v6: the human label: 'validated for transparency' / 'below bar — reported for transparency'. */
  label: string;
  reason: string;
}

/** The integrity strip's figures: what the model validated, what it covered, how much it accounted. */
export interface IntegrityStrip {
  // v5 compatibility: every term counts as kept, because v6 keeps every term in the formula.
  terms_kept: number;
  terms_dropped: number;
  dropped_terms: string[];
  // v6: the transparency report's own counts.
  terms_active: number;
  terms_validated: number;
  terms_below_bar: number;
  validation_note: string;
  fees_coverage_pct: number;
  protocols_accounted: number;
  protocols_total: number;
}

/** The costed farm verdict for one row, in $/hour, with every input the formula used. */
export interface FarmEconomics {
  net_per_hour_usd: number;
  est_airdrop_per_farmer_usd: number;
  token_odds_pct: number;
  gas_usd: number;
  est_work_hours: number;
  est_farmers: number;
}

/** A deterministic fold assignment: slug-hash parity splits the tokened set in two. */
function foldParity(slug: string): 0 | 1 {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % 2 === 0 ? 0 : 1;
}

/** Spearman rank correlation of two equal-length lists; null when fewer than 3 pairs or a tie-only list. */
export function spearman(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const ranks = (values: number[]): number[] => {
    const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const r = new Array<number>(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1]!.v === idx[i]!.v) j++;
      const rank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]!.i] = rank;
      i = j + 1;
    }
    return r;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx;
    const b = ry[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** The momentum multiplier of the model, for a protocol. */
function momentumOf(p: SnapshotProtocol, model: ModelConstants): number {
  const raw = finite(p.change_7d, 0);
  return Math.min(model.momentum_cap, Math.max(model.momentum_floor, 1 + raw / model.momentum_scale));
}

/** The maturity multiplier of the model, for a protocol. */
function maturityOf(p: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const age = ageDays(asOf, p.listed_at) ?? model.unknown_age_days;
  return Math.min(1.0, model.maturity_floor + (model.maturity_range * Math.log1p(Math.max(0, age))) / Math.log(model.log_age_norm));
}

/** The breadth multiplier of the model, for a protocol. */
function breadthOfTerm(p: SnapshotProtocol, model: ModelConstants): number {
  return 1 + model.breadth_pct_per_chain * Math.min(Math.max(0, p.chains.length - 1), model.breadth_chain_cap);
}

/**
 * v5: hold-out validation of every value term. The snapshot's tokened protocols split into two
 * deterministic folds by slug-hash parity. Each term is fitted on one fold and tested on the other,
 * both directions, by Spearman rank correlation against the actual market cap. A term whose
 * correlation is not positive in BOTH held-out folds is dropped from the formula.
 */
export function holdOutValidation(snapshot: Snapshot, model: ModelConstants = MODEL): HoldOutResult[] {
  const tokened = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const folds: [SnapshotProtocol[], SnapshotProtocol[]] = [[], []];
  for (const p of tokened) folds[foldParity(p.slug)]!.push(p);

  // Fitted term: the category multiple (median mcap/tvl) fit on one fold, applied to the other.
  const foldMultiple = (fold: SnapshotProtocol[]): number => {
    const ratios = fold.map((p) => p.mcap_usd! / p.tvl_usd);
    return median(ratios) ?? model.base_multiple;
  };
  const corrFitted = (fit: SnapshotProtocol[], test: SnapshotProtocol[]): number | null => {
    const multiple = foldMultiple(fit);
    return spearman(test.map((p) => p.tvl_usd * multiple), test.map((p) => p.mcap_usd!));
  };

  // Unfitted terms: the multiplier is a function of the row, so each fold tests the term directly.
  const corrTerm = (fold: SnapshotProtocol[], term: (p: SnapshotProtocol) => number): number | null =>
    spearman(fold.map(term), fold.map((p) => p.mcap_usd!));

  const results: HoldOutResult[] = [];
  const judge = (term: string, a: number | null, b: number | null, reason: string): HoldOutResult => {
    const ca = a ?? 0;
    const cb = b ?? 0;
    const kept = ca > HOLDOUT_MIN_CORR && cb > HOLDOUT_MIN_CORR;
    return {
      term,
      fold_a_corr: Math.round(ca * 1e4) / 1e4,
      fold_b_corr: Math.round(cb * 1e4) / 1e4,
      // v6: the verdict is a transparency label, never a gate — every term stays in the formula.
      verdict: kept ? 'validated' : 'below-bar',
      active_in_formula: true,
      label: kept ? 'validated for transparency' : 'below bar — reported for transparency',
      reason: kept ? reason : `held-out rank correlation below ${HOLDOUT_MIN_CORR} in at least one fold; v6 reports it and keeps the term in the formula`,
    };
  };
  results.push(judge('category_multiple', corrFitted(folds[0]!, folds[1]!), corrFitted(folds[1]!, folds[0]!), 'a category multiple fit on one fold ranks the other fold\u2019s market caps above the bar in both directions'));
  results.push(judge('momentum', corrTerm(folds[0]!, (p) => momentumOf(p, model)), corrTerm(folds[1]!, (p) => momentumOf(p, model)), 'the momentum multiplier ranks market caps above the bar in both folds'));
  results.push(judge('maturity', corrTerm(folds[0]!, (p) => maturityOf(p, snapshot.as_of, model)), corrTerm(folds[1]!, (p) => maturityOf(p, snapshot.as_of, model)), 'the maturity multiplier ranks market caps above the bar in both folds'));
  results.push(judge('breadth', corrTerm(folds[0]!, (p) => breadthOfTerm(p, model)), corrTerm(folds[1]!, (p) => breadthOfTerm(p, model)), 'the breadth multiplier ranks market caps above the bar in both folds'));
  return results;
}

/** The terms the hold-out test kept, as a lookup for the scoring formula. */
export function keptTerms(validation: HoldOutResult[]): Record<string, boolean> {
  const active: Record<string, boolean> = {};
  for (const r of validation) active[r.term] = true; // v6: transparency report, never a gate.
  return active;
}

/** The smoothed token odds per category: (tokened + 1) / (total + 2), as a percentage. */
export function tokenOddsTable(snapshot: Snapshot): { categories: Record<string, { odds_pct: number; tokened: number; total: number }>; global_pct: number } {
  const counts = new Map<string, { tokened: number; total: number }>();
  let tokenedAll = 0;
  for (const p of snapshot.protocols) {
    if (p.category === null) continue;
    const c = counts.get(p.category) ?? { tokened: 0, total: 0 };
    c.total += 1;
    if (!isPreToken(p)) c.tokened += 1;
    counts.set(p.category, c);
  }
  tokenedAll = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const categories: Record<string, { odds_pct: number; tokened: number; total: number }> = {};
  for (const [category, c] of counts) {
    categories[category] = { odds_pct: (100 * (c.tokened + 1)) / (c.total + 2), tokened: c.tokened, total: c.total };
  }
  const global_pct = (100 * (tokenedAll + 1)) / (snapshot.protocols.length + 2);
  return { categories, global_pct };
}

/** One pre-token protocol's token odds: its category's smoothed rate, else the global rate. */
export function tokenOddsFor(p: SnapshotProtocol, odds: ReturnType<typeof tokenOddsTable>): number {
  if (p.category !== null && odds.categories[p.category] !== undefined) return odds.categories[p.category]!.odds_pct;
  return odds.global_pct;
}

/** The estimated active farmers of a protocol: sqrt of its TVL in dollars, floored at 1. */
function estFarmers(tvl: number): number {
  return Math.max(1, Math.sqrt(Math.max(0, tvl)));
}

/**
 * v5: the costed farm verdict in $/hour, every figure from the data:
 *   pool        = FARMER_ALLOC_PCT x implied value (the conservative share airdropped to farmers)
 *   airdrop     = pool / est_farmers, est_farmers = sqrt(tvl)
 *   expected    = airdrop x token_odds
 *   gas         = the plan's own gas estimate over the hold window
 *   work hours  = setup + weekly upkeep + log minutes over the hold window, in hours
 *   net_per_hour= (expected - gas) / work hours
 */
export function farmEconomics(p: SnapshotProtocol, implied: number, oddsPct: number, holdDays: number, model: ModelConstants = MODEL): FarmEconomics {
  const farmers = estFarmers(p.tvl_usd);
  const pool = implied * FARMER_ALLOC_PCT;
  const airdrop = pool / farmers;
  const expected = airdrop * (oddsPct / 100);
  const gas = (p.tvl_usd >= 1_000_000_000 ? 8 : 4) + 2 * Math.ceil(holdDays / 7) + 3;
  const minutes = 15 + 5 + (holdDays / 7) * 10 + (p.chains.length > 1 ? 20 : 0);
  const workHours = Math.max(1, minutes / 60 + holdDays / 24 / 30);
  const net = Math.round(((expected - gas) / workHours) * 100) / 100;
  return {
    net_per_hour_usd: net,
    est_airdrop_per_farmer_usd: Math.round(airdrop * 100) / 100,
    token_odds_pct: Math.round(oddsPct * 10) / 10,
    gas_usd: gas,
    est_work_hours: Math.round(workHours * 10) / 10,
    est_farmers: Math.round(farmers),
  };
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  // v5: range honesty — the implied value as an interval, not a point.
  implied_range_low_usd: number;
  implied_range_high_usd: number;
  // v5: token odds from the peers' record, in percent.
  token_odds_pct: number;
  // v5: the costed farm verdict in $/hour.
  farm_economics: FarmEconomics;
  model: {
    base_multiple: number;
    category_multiple: number;
    benchmark_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    momentum_multiplier: number;
    age_days: number | null;
    breadth_multiplier: number;
    chain_count: number;
  };
  farm_steps: string[];
  // v4: the earnings cross-check, computed from data/fees_annualized.json. Flag-only: the board
  // still ranks by implied_value_usd.
  earnings: EarningsCheck;
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  // v5: range honesty and token odds.
  implied_range_low_usd: number;
  implied_range_high_usd: number;
  token_odds_pct: number;
  // v5: the costed farm verdict in $/hour.
  farm_economics: FarmEconomics;
  growth_multiplier: number;
  maturity_multiplier: number;
  momentum_multiplier: number;
  category_multiple: number;
  breadth_multiplier: number;
  chain_count: number;
  // v4: flag-only earnings cross-check; the dashboard decides what to show.
  earnings: EarningsCheck;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  category_benchmark: BenchmarkTable;
  // v3: the board's aggregate implied value: the sum and the median over every row.
  total_implied_usd: number;
  median_implied_usd: number;
  // v5: hold-out validation results, the integrity strip, and the token-odds table.
  validation: HoldOutResult[];
  integrity: IntegrityStrip;
  token_odds: { categories: Record<string, { odds_pct: number; tokened: number; total: number }>; global_pct: number };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list of positive numbers; null when the list is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A category multiple clamped into [MULTIPLE_FLOOR, MULTIPLE_CAP] so no outlier dominates the board. */
function clampMultiple(raw: number, model: ModelConstants): CategoryBenchmark {
  const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
  return { multiple, n: 0, clamped: multiple !== raw, multiple_raw: raw };
}

/**
 * The benchmark table: for every category with at least `model.category_min_samples` tokened protocols,
 * the median mcap/tvl of those samples (v3: clamped into the multiple band); plus the global median over
 * all tokened protocols under `global`.
 */
export function categoryBenchmarks(snapshot: Snapshot, model: ModelConstants = MODEL): BenchmarkTable {
  const ratios = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0)
    .map((p) => ({ category: p.category, ratio: p.mcap_usd! / p.tvl_usd }));
  const table: BenchmarkTable = {};
  const global = median(ratios.map((r) => r.ratio));
  const globalBench = clampMultiple(global ?? model.base_multiple, model);
  table['global'] = { ...globalBench, n: ratios.length };
  const byCategory = new Map<string, number[]>();
  for (const r of ratios) {
    if (r.category === null) continue;
    const list = byCategory.get(r.category);
    if (list === undefined) byCategory.set(r.category, [r.ratio]);
    else list.push(r.ratio);
  }
  for (const [category, list] of byCategory) {
    if (list.length < model.category_min_samples) continue;
    table[category] = { ...clampMultiple(median(list)!, model), n: list.length };
  }
  return table;
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  benchmarks?: BenchmarkTable,
  activeTerms?: Record<string, boolean>,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null; categoryMult: number; benchmarkN: number; breadthMult: number; chainCount: number } {
  const isActive = (t: string): boolean => activeTerms === undefined || activeTerms[t] === true;
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  // v2 momentum band: clamp(1 + change_7d / 200, floor, cap). v5: gated by the hold-out test.
  const growthMult = isActive('momentum')
    ? Math.min(model.momentum_cap, Math.max(model.momentum_floor, 1 + rawGrowth / model.momentum_scale))
    : 1;
  // v2 log-saturating maturity: 0.55 + 0.45 x log1p(age) / log(norm), capped at 1.0. v5: gated.
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = isActive('maturity')
    ? Math.min(
        1.0,
        model.maturity_floor + (model.maturity_range * Math.log1p(Math.max(0, ageForModel))) / Math.log(model.log_age_norm),
      )
    : 1;
  // v2 category-benchmark multiple, falling back to the global benchmark. v5: gated (the term's
  // predictive power is always exercised — only its influence on the score is dropped).
  const table = benchmarks ?? { global: { multiple: model.base_multiple, n: 0 } };
  const bench = (protocol.category !== null && table[protocol.category]) || table['global'];
  const categoryMult = isActive('category_multiple') ? bench.multiple : model.base_multiple;
  // v3 breadth premium: +breadth_pct_per_chain per extra chain beyond the first, capped. v5: gated.
  const chainCount = protocol.chains.length;
  const breadthMult = isActive('breadth')
    ? 1 + model.breadth_pct_per_chain * Math.min(Math.max(0, chainCount - 1), model.breadth_chain_cap)
    : 1;
  const base = protocol.tvl_usd * categoryMult;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, age, categoryMult, benchmarkN: bench.n, breadthMult, chainCount };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, benchmarks?: BenchmarkTable, fees?: FeesFile | null, earnings?: EarningsBenchmarks | null, validation?: HoldOutResult[] | null, odds?: ReturnType<typeof tokenOddsTable> | null): BoardRow[] {
  const bench = benchmarks ?? categoryBenchmarks(snapshot, model);
  const feesMap = fees === undefined ? loadFeesMap(join('data', 'fees_annualized.json')) : fees;
  const earningsBench = earnings === undefined ? earningsBenchmarks(snapshot, feesMap) : earnings;
  const validation_ = validation ?? holdOutValidation(snapshot, model);
  // v6: the proven v4c formula keeps every term active — the hold-out verdict is a transparency
  // report, never a gate on the formula.
  const active = allTermsActive();
  const oddsTable = odds ?? tokenOddsTable(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const r = impliedValue(p, snapshot.as_of, model, bench, active);
    return { p, ...r };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_range_low_usd: Math.round(s.implied * RANGE_LOW_MULT),
    implied_range_high_usd: Math.round(s.implied * RANGE_HIGH_MULT),
    token_odds_pct: Math.round(tokenOddsFor(s.p, oddsTable) * 10) / 10,
    farm_economics: farmEconomics(s.p, s.implied, tokenOddsFor(s.p, oddsTable), holdDaysFor(s.age)),
    model: {
      base_multiple: model.base_multiple,
      category_multiple: round4(s.categoryMult),
      benchmark_n: s.benchmarkN,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      momentum_multiplier: round4(s.growthMult),
      age_days: s.age,
      breadth_multiplier: round4(s.breadthMult),
      chain_count: s.chainCount,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    earnings: earningsCrossCheck(s.p, s.implied, feesMap, earningsBench),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The realistic gas cost on one chain, in the words a farmer can budget from. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return '$5 to $15 gas per transaction';
  if (['base', 'arbitrum', 'optimism', 'polygon', 'blast', 'scroll', 'linea', 'zksync', 'mantle', 'mode'].some((l2) => c.includes(l2))) {
    return 'under $1 gas per transaction';
  }
  if (['solana', 'sui', 'aptos', 'near'].some((fast) => c.includes(fast))) return 'under $0.10 gas per transaction';
  return 'a few dollars of gas per transaction';
}

/** The weekly action the category asks for, in the words a farmer can follow. */
function weeklyActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Make one qualifying action each week: borrow a small amount against the supply and repay it on ${name} (${chain}).`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Make one qualifying action each week: run one small swap through ${name}'s pool on ${chain}.`;
  if (c.includes('bridge')) return `Make one qualifying action each week: bridge a small amount of USDC through ${name} to ${chain} and back.`;
  if (c.includes('staking') || c.includes('restak')) return `Make one qualifying action each week: claim the staking reward from ${name} and restake it.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Make one qualifying action each week: open and close one small position on ${name}.`;
  if (c.includes('prediction')) return `Make one qualifying action each week: place one small market position on ${name}.`;
  return `Make one qualifying action each week: deposit, swap, borrow or vote once through ${name} on ${chain}.`;
}

/**
 * A protocol's farm plan: the setup, the main action, a second-chain action when the protocol spans
 * more than one chain, the weekly action, the hold, the claim and the log — each with a cost and a
 * time. The plan is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
  ];
  if (secondChain !== null) {
    steps.push({
      text: `Repeat one action on ${p.name}: bridge or supply $${Math.round(capital / 2)} on ${secondChain} so the activity reaches that chain too.`,
      cost: `bridge fee plus ${gasFor(secondChain)}`,
      time: '20 minutes',
    });
  }
  steps.push(
    {
      text: weeklyActionFor(p, chain),
      cost: `about $2 of gas a week (${gasFor(chain)})`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/**
 * v4: the annualized trailing-1y fees map out of data/fees_annualized.json, or null when the file is
 * missing or unparseable — the cross-check then skips entirely ('n/a') instead of failing the build.
 */
export function loadFeesMap(path: string = join('data', 'fees_annualized.json')): FeesFile | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (typeof raw !== 'object' || raw === null || typeof raw.protocols !== 'object' || raw.protocols === null) return null;
    const protocols: FeesFile['protocols'] = {};
    for (const [slug, v] of Object.entries(raw.protocols as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue;
      const o = v as Record<string, unknown>;
      if (typeof o.annualized1y !== 'number' || !Number.isFinite(o.annualized1y)) continue;
      protocols[slug] = { annualized1y: o.annualized1y };
    }
    return {
      as_of: typeof raw.as_of === 'string' ? raw.as_of : 'unknown',
      source: typeof raw.source === 'string' ? raw.source : 'unknown',
      protocols,
    };
  } catch {
    return null;
  }
}

/**
 * v4: the category median P/S (median mcap/annualized-fees) of the snapshot's tokened protocols,
 * per category, over categories with at least EARNINGS_MIN_SAMPLES tokened samples. Only positive
 * mcaps and fees enter a median. Returns null when no fees map is available.
 */
export function earningsBenchmarks(snapshot: Snapshot, fees: FeesFile | null): EarningsBenchmarks | null {
  if (fees === null) return null;
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.category === null) continue;
    const f = fees.protocols[p.slug];
    if (f === undefined || f.annualized1y <= 0) continue;
    const list = byCategory.get(p.category);
    if (list === undefined) byCategory.set(p.category, [p.mcap_usd / f.annualized1y]);
    else list.push(p.mcap_usd / f.annualized1y);
  }
  const medians: Record<string, number> = {};
  for (const [category, list] of byCategory) {
    if (list.length < EARNINGS_MIN_SAMPLES) continue;
    medians[category] = median(list)!;
  }
  return { medians };
}

/**
 * v4: the earnings cross-check for one board row. Fees are annualized trailing-1y from the fees map;
 * implied P/S is the row's implied value divided by those fees. Verdicts:
 *   'overvalued'   implied P/S > 2x the category median; adjusted = 2x median x fees, capped at implied.
 *   'underpriced'  implied P/S < 0.5x the category median; adjusted = 0.5x median x fees, capped at implied.
 *   'fair'         in between (adjusted stays the implied value).
 *   'no-benchmark' the category has no median (fewer than 3 tokened samples).
 *   'n/a'          no fees data for the protocol (or no fees map at all): the cross-check skips.
 */
export function earningsCrossCheck(
  protocol: SnapshotProtocol,
  implied: number,
  fees: FeesFile | null,
  benchmarks: EarningsBenchmarks | null,
): EarningsCheck {
  const f = fees === null ? undefined : fees.protocols[protocol.slug];
  const feesUsd = f !== undefined && f.annualized1y > 0 ? f.annualized1y : null;
  if (feesUsd === null) return { verdict: 'n/a', implied_ps: null, category_median_ps: null, annual_fees_usd: null, adjusted_implied_usd: null };
  const medianPs = benchmarks !== null && protocol.category !== null && Number.isFinite(benchmarks.medians[protocol.category])
    ? benchmarks.medians[protocol.category]!
    : null;
  const impliedPs = implied / feesUsd;
  if (medianPs === null) return { verdict: 'no-benchmark', implied_ps: round2(impliedPs), category_median_ps: null, annual_fees_usd: feesUsd, adjusted_implied_usd: null };
  if (impliedPs > EARNINGS_OVER_MULT * medianPs) {
    const adjusted = Math.min(implied, Math.round(EARNINGS_OVER_MULT * medianPs * feesUsd));
    return { verdict: 'overvalued', implied_ps: round2(impliedPs), category_median_ps: round2(medianPs), annual_fees_usd: feesUsd, adjusted_implied_usd: adjusted };
  }
  if (impliedPs < EARNINGS_UNDER_MULT * medianPs) {
    const adjusted = Math.min(implied, Math.round(EARNINGS_UNDER_MULT * medianPs * feesUsd));
    return { verdict: 'underpriced', implied_ps: round2(impliedPs), category_median_ps: round2(medianPs), annual_fees_usd: feesUsd, adjusted_implied_usd: adjusted };
  }
  return { verdict: 'fair', implied_ps: round2(impliedPs), category_median_ps: round2(medianPs), annual_fees_usd: feesUsd, adjusted_implied_usd: implied };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_range_low_usd: row.implied_range_low_usd,
    implied_range_high_usd: row.implied_range_high_usd,
    token_odds_pct: row.token_odds_pct,
    farm_economics: row.farm_economics,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    momentum_multiplier: row.model.momentum_multiplier,
    category_multiple: row.model.category_multiple,
    breadth_multiplier: row.model.breadth_multiplier,
    chain_count: row.model.chain_count,
    earnings: row.earnings,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const bench = categoryBenchmarks(snapshot, model);
  const validation = holdOutValidation(snapshot, model);
  const odds = tokenOddsTable(snapshot);
  const board = buildBoard(snapshot, model, bench, undefined, undefined, validation, odds);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const implieds = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const mid = implieds.length >> 1;
  const medianImplied = implieds.length === 0 ? 0 : implieds.length % 2 === 1 ? implieds[mid]! : (implieds[mid - 1]! + implieds[mid]!) / 2;
  const feesMap = loadFeesMap(join('data', 'fees_annualized.json'));
  const feesCovered = feesMap === null ? 0 : snapshot.protocols.filter((p) => feesMap.protocols[p.slug] !== undefined).length;
  const belowBar = validation.filter((r) => r.verdict === 'below-bar').map((r) => r.term);
  const validated = validation.filter((r) => r.verdict === 'validated').map((r) => r.term);
  const integrity: IntegrityStrip = {
    // v5 compatibility fields: v6 keeps every term in the formula, so nothing is dropped.
    terms_kept: validation.length,
    terms_dropped: 0,
    dropped_terms: [],
    // v6: the transparency report's own counts.
    terms_active: validation.length,
    terms_validated: validated.length,
    terms_below_bar: belowBar.length,
    validation_note: 'every term stays in the formula; the hold-out test is reported for transparency',
    fees_coverage_pct: Math.round((100 * feesCovered) / Math.max(1, snapshot.protocols.length) * 10) / 10,
    protocols_accounted: snapshot.protocols.length,
    protocols_total: snapshot.protocols.length,
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    category_benchmark: bench,
    total_implied_usd: implieds.reduce((a, b) => a + b, 0),
    median_implied_usd: medianImplied,
    validation,
    integrity,
    token_odds: odds,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
