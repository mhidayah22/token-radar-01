// Radar-2: the token launch radar's model.
//
// One sealed snapshot of the protocol universe in, one ranked board out. The board covers every slug
// in the snapshot's watchlist (the floor, never the ceiling) and adds every rankable pre-token protocol
// below the watchlist floor: the early rows the radar exists to find. A protocol records no token when
// its record carries no market cap, no CoinGecko id and no symbol; the snapshot's live-token protocols
// are kept apart in their own view and shown at the market's own value, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures, fitted at runtime from the live-token
// protocols in the same snapshot:
//
//   peer     = median(mcap / TVL) of live protocols in the same category (at least 3 peers, else the
//              median of all live protocols)
//   maturity = 0.6 + 0.4 * min(age_days, 1095) / 1095        (age unknown: 365 days)
//   implied  = max(1, round(TVL * peer * maturity))
//
// Every row also carries an honest range, [TVL * p25 * maturity, TVL * p75 * maturity] over the same
// category's ratios, so a reader sees how wide the value could be instead of one bare number.
//
// Two terms were measured and dropped from the value, and the dashboard says so:
//   - launch odds by age: multiplying by the share of protocols that already have a token made the
//     leave-one-out error worse, and this bounty does not predict whether or when a token is issued.
//     The odds are shown as a "launch readiness" column and used only in the farm verdict.
//   - seven-day growth: a fitted growth slope was an artefact (falling TVL inflates the ratio) and made
//     the error worse. Growth is shown as a column and a stability marker, never as a value multiplier.
//
// The three validation numbers on the dashboard are computed here, at runtime, from the same snapshot:
// in-sample, walk-forward (trained on protocols listed before 2025-06-01, tested on those listed after)
// and leave-one-out. No protocol name is ever special-cased: the same functions score every row.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  min_peers: number;
}

export const MODEL: ModelConstants = {
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  min_peers: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The walk-forward split: trained on protocols listed before this day, tested on the rest. */
export const WALK_FORWARD_CUTOFF = '2025-06-01';

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
  range_low_usd: number;
  range_high_usd: number;
  peer_multiple: number;
  peer_count: number;
  launch_readiness: number;
  ev_per_hour_usd: number;
  active_hours: number;
  model: {
    peer_multiple: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row, farm plan included so the detail view needs no second fetch. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  range_low_usd: number;
  range_high_usd: number;
  peer_multiple: number;
  peer_count: number;
  launch_readiness: number;
  ev_per_hour_usd: number;
  active_hours: number;
  maturity_multiplier: number;
  farm_steps: string[];
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

/** One validation run: median error as a multiple, and the share of predictions within 2x. */
export interface ValidationRun {
  name: string;
  n: number;
  median_multiple: number;
  within_2x_pct: number;
}

/** The three validation runs the dashboard shows, all computed from the snapshot at runtime. */
export interface Validation {
  in_sample: ValidationRun;
  walk_forward: ValidationRun;
  leave_one_out: ValidationRun;
  live_n: number;
}

/** Everything the dashboard needs: the board, the live set, the model and its validation. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist_slugs: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  validation: Validation;
  rows: RadarRow[];
  live: LiveRow[];
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

/** The maturity multiplier for an age in days: 0.6 for a newborn protocol, 1.0 after three years. */
export function maturityMultiplier(age: number | null, model: ModelConstants = MODEL): number {
  const days = age ?? model.unknown_age_days;
  const capped = Math.min(Math.max(days, 0), model.maturity_days);
  return model.maturity_floor + (capped / model.maturity_days) * model.maturity_range;
}

/** The median of sorted numbers, by linear interpolation (the 50th percentile). */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** A category's peer statistics, from the live protocols' market-cap-to-TVL ratios. */
export interface PeerStats {
  multiple: number;
  low: number;
  high: number;
  peers: number;
}

function sortedRatios(live: SnapshotProtocol[]): number[] {
  return live
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd)
    .sort((a, b) => a - b);
}

/** The peer multiple, range and peer count for one category, with the global fallback. */
export function peerStats(live: SnapshotProtocol[], category: string | null, model: ModelConstants = MODEL): PeerStats {
  const global = sortedRatios(live);
  const globalMultiple = quantile(global, 0.5);
  const globalLow = quantile(global, 0.25);
  const globalHigh = quantile(global, 0.75);
  if (category === null) return { multiple: globalMultiple, low: globalLow, high: globalHigh, peers: 0 };
  const own = sortedRatios(live.filter((p) => p.category === category));
  if (own.length < model.min_peers) return { multiple: globalMultiple, low: globalLow, high: globalHigh, peers: own.length };
  return { multiple: quantile(own, 0.5), low: quantile(own, 0.25), high: quantile(own, 0.75), peers: own.length };
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

/** The age buckets the launch-readiness column uses. */
function ageBucket(age: number | null): string {
  if (age === null) return 'unknown';
  if (age < 180) return 'under-180d';
  if (age < 365) return '180d-1y';
  if (age < 730) return '1y-2y';
  return 'over-2y';
}

/**
 * Launch readiness: the share of protocols in the same age bucket that already record a token.
 * It is a description of the peers, not a prediction, and it never enters the implied value.
 */
export function launchReadiness(snapshot: Snapshot, asOf: string, age: number | null): number {
  const bucket = ageBucket(age);
  let total = 0;
  let withToken = 0;
  for (const p of snapshot.protocols) {
    if (ageBucket(ageDays(asOf, p.listed_at)) !== bucket) continue;
    total++;
    if (!isPreToken(p)) withToken++;
  }
  if (total === 0) return 0;
  return Math.round((withToken / total) * 1000) / 1000;
}

/** The three multipliers and the implied value one protocol gets, plus its honest range. */
export function impliedValue(
  protocol: SnapshotProtocol,
  snapshot: Snapshot,
  live: SnapshotProtocol[],
  model: ModelConstants = MODEL,
): { implied: number; low: number; high: number; peerMultiple: number; maturityMult: number; age: number | null; peers: number } {
  const age = ageDays(snapshot.as_of, protocol.listed_at);
  const stats = peerStats(live, protocol.category, model);
  const maturityMult = maturityMultiplier(age, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * stats.multiple * maturityMult));
  const low = Math.max(1, Math.round(protocol.tvl_usd * stats.low * maturityMult));
  const high = Math.max(1, Math.round(protocol.tvl_usd * stats.high * maturityMult));
  return { implied, low, high, peerMultiple: stats.multiple, maturityMult, age, peers: stats.peers };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
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
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC through ${name} on ${chain} and leave the loan open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Add $${capital} of liquidity to the main ${name} pool on ${chain} and leave it in place.`;
  if (c.includes('bridge')) return `Move $${capital} of USDC to ${chain} with ${name}, then put the bridged funds to work in its app.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${capital} of the chain asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return `Post $${capital} of USDC as margin on ${name} and open a single small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Put $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield asset ${name} issues on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy live.`;
  if (c.includes('launchpad')) return `Commit $${capital} to the next ${name} sale on ${chain} and hold the allocation.`;
  if (c.includes('payment') || c.includes('card')) return `Spend $${capital} through ${name}'s card or payment flow on ${chain}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so the activity lands in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction, so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** Active hours a farm plan takes: setup and logging, the weekly actions, and the final claim. */
export function activeHoursFor(holdDays: number): number {
  const weeks = holdDays / 7;
  return Math.round((0.33 + weeks * 0.17 + 0.25) * 100) / 100;
}

/** The farm verdict: an index of implied value per active hour, weighted by launch readiness. */
export function evPerHour(implied: number, readiness: number, activeHours: number): number {
  if (activeHours <= 0) return 0;
  return Math.max(0, Math.round((implied * readiness) / activeHours));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, not just the largest.
  // A chosen protocol stays chosen; nothing here replaces a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot, live, model);
    const readiness = launchReadiness(snapshot, snapshot.as_of, v.age);
    const hold = holdDaysFor(v.age);
    const hours = activeHoursFor(hold);
    return { p, ...v, readiness, hold, hours };
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
    range_low_usd: s.low,
    range_high_usd: s.high,
    peer_multiple: round4(s.peerMultiple),
    peer_count: s.peers,
    launch_readiness: s.readiness,
    ev_per_hour_usd: evPerHour(s.implied, s.readiness, s.hours),
    active_hours: s.hours,
    model: {
      peer_multiple: round4(s.peerMultiple),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
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

/** A board row's compact form for data.js, with the farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    range_low_usd: row.range_low_usd,
    range_high_usd: row.range_high_usd,
    peer_multiple: row.peer_multiple,
    peer_count: row.peer_count,
    launch_readiness: row.launch_readiness,
    ev_per_hour_usd: row.ev_per_hour_usd,
    active_hours: row.active_hours,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

// ---------------------------------------------------------------- validation

/** The live protocols' mcap/TVL ratios by category, plus the global list, from one training set. */
interface PeerTable {
  byCategory: Map<string, number[]>;
  global: number[];
}

function peerTable(live: SnapshotProtocol[]): PeerTable {
  const byCategory = new Map<string, number[]>();
  const global: number[] = [];
  for (const p of live) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    global.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  global.sort((a, b) => a - b);
  for (const list of byCategory.values()) list.sort((a, b) => a - b);
  return { byCategory, global };
}

function tableMultiple(table: PeerTable, category: string | null, model: ModelConstants): number {
  if (category !== null) {
    const own = table.byCategory.get(category);
    if (own !== undefined && own.length >= model.min_peers) return quantile(own, 0.5);
  }
  return quantile(table.global, 0.5);
}

/** The radar-2 prediction for one live protocol, from one training set's peer table. */
function predictLive(p: SnapshotProtocol, asOf: string, table: PeerTable, model: ModelConstants): number {
  const age = ageDays(asOf, p.listed_at);
  const multiple = tableMultiple(table, p.category, model);
  return Math.max(1, Math.round(p.tvl_usd * multiple * maturityMultiplier(age, model)));
}

/** One validation run's numbers: median error as a multiple, and the share within 2x. */
function scoreRun(name: string, pairs: { predicted: number; actual: number }[]): ValidationRun {
  const errors = pairs
    .filter((x) => x.predicted > 0 && x.actual > 0)
    .map((x) => Math.abs(Math.log(x.predicted / x.actual)))
    .sort((a, b) => a - b);
  const within = pairs.filter((x) => x.predicted > 0 && x.actual > 0 && x.predicted / x.actual >= 0.5 && x.predicted / x.actual <= 2).length;
  return {
    name,
    n: pairs.length,
    median_multiple: errors.length === 0 ? NaN : Math.round(Math.exp(quantile(errors, 0.5)) * 100) / 100,
    within_2x_pct: pairs.length === 0 ? 0 : Math.round((within / pairs.length) * 1000) / 10,
  };
}

/**
 * The three validation runs, computed from the snapshot at runtime. In-sample fits on all 128 live
 * protocols and tests on the same set; walk-forward fits on protocols listed before 2025-06-01 and
 * tests on the 20 listed after; leave-one-out fits each protocol on the other 127 and tests on it.
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): Validation {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const full = peerTable(live);
  const inSample = scoreRun(
    'in-sample',
    live.map((p) => ({ predicted: predictLive(p, snapshot.as_of, full, model), actual: p.mcap_usd! })),
  );
  const train = live.filter((p) => p.listed_at !== null && p.listed_at < WALK_FORWARD_CUTOFF);
  const test = live.filter((p) => p.listed_at !== null && p.listed_at >= WALK_FORWARD_CUTOFF);
  const trainTable = peerTable(train);
  const walkForward = scoreRun(
    'walk-forward',
    test.map((p) => ({ predicted: predictLive(p, snapshot.as_of, trainTable, model), actual: p.mcap_usd! })),
  );
  const looPairs = live.map((p) => {
    const rest = live.filter((q) => q.slug !== p.slug);
    return { predicted: predictLive(p, snapshot.as_of, peerTable(rest), model), actual: p.mcap_usd! };
  });
  const leaveOneOut = scoreRun('leave-one-out', looPairs);
  return { in_sample: inSample, walk_forward: walkForward, leave_one_out: leaveOneOut, live_n: live.length };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const validation = validateModel(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    validation,
    rows: board.map(radarRow),
    live,
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
