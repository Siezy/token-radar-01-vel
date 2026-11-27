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
export const MODEL_VERSION = 'radar-3';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
  growth_multiplier: number;
  maturity_multiplier: number;
  momentum_multiplier: number;
  category_multiple: number;
  breadth_multiplier: number;
  chain_count: number;
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
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null; categoryMult: number; benchmarkN: number; breadthMult: number; chainCount: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  // v2 momentum band: clamp(1 + change_7d / 200, floor, cap).
  const growthMult = Math.min(model.momentum_cap, Math.max(model.momentum_floor, 1 + rawGrowth / model.momentum_scale));
  // v2 log-saturating maturity: 0.55 + 0.45 x log1p(age) / log(norm), capped at 1.0.
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = Math.min(
    1.0,
    model.maturity_floor + (model.maturity_range * Math.log1p(Math.max(0, ageForModel))) / Math.log(model.log_age_norm),
  );
  // v2 category-benchmark multiple, falling back to the global benchmark.
  const table = benchmarks ?? { global: { multiple: model.base_multiple, n: 0 } };
  const bench = (protocol.category !== null && table[protocol.category]) || table['global'];
  const categoryMult = bench.multiple;
  // v3 breadth premium: +breadth_pct_per_chain per extra chain beyond the first, capped.
  const chainCount = protocol.chains.length;
  const breadthMult = 1 + model.breadth_pct_per_chain * Math.min(Math.max(0, chainCount - 1), model.breadth_chain_cap);
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
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, benchmarks?: BenchmarkTable): BoardRow[] {
  const bench = benchmarks ?? categoryBenchmarks(snapshot, model);
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
    const r = impliedValue(p, snapshot.as_of, model, bench);
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
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    momentum_multiplier: row.model.momentum_multiplier,
    category_multiple: row.model.category_multiple,
    breadth_multiplier: row.model.breadth_multiplier,
    chain_count: row.model.chain_count,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const bench = categoryBenchmarks(snapshot, model);
  const board = buildBoard(snapshot, model, bench);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const implieds = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const mid = implieds.length >> 1;
  const medianImplied = implieds.length === 0 ? 0 : implieds.length % 2 === 1 ? implieds[mid]! : (implieds[mid - 1]! + implieds[mid]!) / 2;
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
