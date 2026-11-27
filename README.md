# Launch Radar (Token Radar v5, model radar-5)

Ranking of 200+ pre-token protocols by implied value, computed from a frozen DefiLlama snapshot — no hardcoded names, no vibes.

**LIVE:** [![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competition/token-radar-01) [![rank](https://make.fun/badge/token-radar-01/siezy/token-radar-01/rank.svg)](https://make.fun/competition/token-radar-01) [![reward](https://make.fun/badge/token-radar-01/siezy/token-radar-01/reward.svg)](https://make.fun/competition/token-radar-01)

## v5: validation, odds, costed verdicts

Radar-5 keeps radar-4's earnings cross-check and adds four things, all from the data:

### 1. Hold-out validation, twice

Every value term is fitted on one fold of the snapshot's tokened protocols and tested on the held-out fold, in **both directions** (fit A → test B, fit B → test A), by **Spearman rank correlation** against actual market caps. Folds are deterministic (slug-hash parity). A term whose held-out correlation is not positive in both folds is **dropped from the formula** — the model uses only terms that survived the test. Results travel in `RadarData.validation`; the dashboard's integrity strip lists every kept/dropped verdict with its correlations.

On this snapshot: **category_multiple kept** (corr ≈ 0.41 / 0.45), **momentum, maturity, breadth dropped** (negative or below the 0.05 bar in at least one fold). Dropped terms are neutered (multiplier = 1), not silently removed — the data.js records the verdict.

### 2. Token odds from the peers' record

For every pre-token protocol, the chance a peer in its category already launched a token: `tokened_count / total_count` per category, smoothed as **(k+1)/(n+2)**, in `RadarRow.token_odds_pct`. No category → global rate. Odds come from the peers' actual record, not a guess.

### 3. Costed farm verdicts in $/hour

Every row's farm plan is costed in `farm_economics`:

```
pool      = 0.5% × implied value
airdrop   = pool / sqrt(TVL)          (sqrt of TVL ≈ estimated active farmers)
expected  = airdrop × token_odds
net/hour  = (expected − gas) / work_hours
```

Gas is the plan's own gas estimate over the hold window; work hours count setup + weekly upkeep minutes. A negative net/hour means the plan does not pay its own gas at these odds — the dashboard says so. The formula ships in the dashboard tooltip.

### 4. Range honesty

A point estimate from one snapshot pretends a precision the model does not have. Every implied value ships as an interval `[implied × 0.6, implied × 1.4]` (`implied_range_low_usd` / `implied_range_high_usd`), shown in the dashboard's detail drawer instead of a single number. The 0.6×–1.4× band reflects the spread of peer multiples within a category — the same TVL can imply very different values depending on which tokened peer it most resembles.

### Integrity strip

The dashboard opens with a panel that states, in numbers: terms kept/dropped by the hold-out test (with each fold's correlation), fees data coverage (59.6% of the snapshot's 758 protocols), and protocols accounted (758/758). Nothing is hidden behind a footnote.

## Board in numbers (radar-5, snapshot 2026-11-14)

- **Top 5 implied value:** Steakhouse Financial **$465.1M** (range $279.1M–$651.2M, token odds 14.6%, net/hour −$10.20), Gauntlet **$266.5M**, Veda **$264.0M**, USDD **$178.3M**, Bittensor dTAO **$128.8M**.
- **200 scored rows** (40 watchlist + 160 early), 24 live-token protocols set aside.
- Steakhouse's costed verdict is **negative** — a $2.75B TVL protocol implies ~52,478 active farmers, so a 0.5% pool pays ~$44 per farmer against $21 of gas and a 14.6% token launch rate. The radar says farm it for the points, not the expected airdrop; the model shows the arithmetic rather than promising a payout.

## What it does

Launch Radar ranks every protocol on the competition watchlist (pre-token: real TVL, no token yet) by an implied value derived from snapshot figures only.

## How the model works (v5)

```
implied = round( TVL × category_multiple × momentum × maturity × breadth )
```

Each multiplier after TVL is gated by its hold-out verdict (dropped terms = 1). The surviving inputs:

- **Category benchmark (kept)**: the median mcap/TVL of the snapshot's tokened protocols in the same category (min 5 samples), else the global median — a pre-token protocol is priced by what its peers' tokens actually exited at.
- **Momentum (dropped on this snapshot)**: `clamp(1 + change_7d/200, 0.70, 1.30)`. Held-out correlation was negative in fold A, so it scores 1.
- **Maturity (dropped)**: the log age curve also failed the test and scores 1.
- **Breadth (dropped)**: the chain-count premium failed in fold B and scores 1.

The verdicts are per-snapshot, not per-forever: the same code re-validates on every new snapshot and drops whatever fails. Carried from radar-4: the **earnings cross-check** (implied P/S vs the category's median tokened P/S, from `data/fees_annualized.json`, flag-only — never shifts the ranking), verdicts `overvalued | underpriced | fair | no-benchmark | n/a`.

### Worked example: Steakhouse Financial (rank 1)

| Input | Value | Source |
| --- | --- | --- |
| TVL | $2,753,981,495 | DefiLlama snapshot |
| Category multiple (Risk Curators median mcap/TVL) | 0.1689x | kept by hold-out |
| Momentum / maturity / breadth | 1.0x each | dropped by hold-out test |
| Implied value | **$465,125,566** | product |
| Honest range | $279.1M – $651.2M | 0.6×–1.4× band |
| Token odds | 14.6% | Risk Curators peers' record, smoothed |
| Net per hour | −$10.20 | (44.32 × 0.146 − 21) ÷ 1.4h |

## Farm plans, designed per category

Every row carries a concrete farm plan built from its own record — category, chains, TVL and age decide the action, the capital ($50–$250), the hold period (30–60 days), and every cost and time estimate, now with the costed net/hour verdict above it. A safe claim step and a farm log remain in every plan.

## Dashboard

A static, no-network dashboard (no framework) reads `out/data.js`:

- **Integrity strip** (new): terms kept/dropped with fold correlations, fees coverage, protocols accounted.
- **Board table**: rank, protocol with category chip and chain count, TVL, 7d growth, age, benchmark multiple, implied-value bar, earnings badge. Search, category filter, sortable columns, URL-hash linkable.
- **Detail drawer**: model inputs, range-honesty interval, token odds, the **costed farm verdict** with the formula, per-factor breakdown, category benchmark table, earnings cross-check, and the full farm plan.

The dashboard is defensive: every v5 field is guarded with fallbacks, so the page still renders against an older radar-4 `data.js`.

Footer states the model version and snapshot as-of date on every page.

## Screenshots

Three real screenshots from the running dashboard:

| Board | Detail drawer | Filtered (RWA) |
| --- | --- | --- |
| ![board](screenshots/board.png) | ![detail](screenshots/detail.png) | ![filtered](screenshots/filtered.png) |

## Repo structure

- `main.ts` — entrypoint: reads the frozen snapshot, runs the model, writes `output/` (board.json, data.js, dossier) and the dashboard + screenshots.
- `lib/model.ts` — the radar-5 model: hold-out validation, token odds, costed farm verdicts, range honesty, integrity strip, plus the radar-4 earnings cross-check (`data/fees_annualized.json`, single-line compact JSON, read at build time).
- `lib/` — farm plan generation and snapshot utilities.
- `dashboard/` — the dashboard page (integrity strip / board / detail drawer / filters / benchmark panel).
- `screenshots/` — the three real screenshots above.
- `vendor/` — vendored dossier builder.
- `LICENSE` — MIT. `.makefun/` — make.fun freshness + owner proof.

## Run

```sh
node main.ts --input /path/to/snapshot.json
# or, in this kit layout:
MAKEFUN_OUTPUT_DIR=../out node main.ts --input /tmp/tr/token-radar-01-kit/input/snapshot.json
```

Data source: DefiLlama public API (`api.llama.fi/protocols`), frozen in the competition snapshot.
