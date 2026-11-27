# Launch Radar (Token Radar v4, model radar-4)

Ranking of 200+ pre-token protocols by implied value, computed from a frozen DefiLlama snapshot — no hardcoded names, no vibes.

**LIVE:** [![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competition/token-radar-01) [![rank](https://make.fun/badge/token-radar-01/siezy/token-radar-01/rank.svg)](https://make.fun/competition/token-radar-01) [![reward](https://make.fun/badge/token-radar-01/siezy/token-radar-01/reward.svg)](https://make.fun/competition/token-radar-01)

## The board in numbers (radar-3, snapshot 2026-11-14)

- **Top 3 implied value:** Steakhouse Financial **$527.1M** (TVL $2.75B, Risk Curators, 11 chains), Gauntlet **$313.9M** (TVL $1.58B, 14 chains), Veda **$292.9M** (TVL $1.56B, Onchain Capital Allocator, 13 chains).
- **Total board implied value:** $3.10B across **200 scored rows** (40 watchlist protocols above the $50M floor plus 160 early pre-token protocols below it).
- **Median row value:** $3.4M — the board is a long tail: a handful of billion-dollar TVL curators, then hundreds of small pre-token protocols.
- **24 live-token protocols** set aside: their market cap is a fact, not a model, so they never mix into the pre-token ranking.

## What it does

Launch Radar ranks every protocol on the competition watchlist (pre-token: real TVL, no token yet) by an implied value derived from snapshot figures only.

## How the model works (v3)

One function scores every protocol. No protocol name is special-cased, and no row is hand-picked:

```
implied = round( TVL × category_multiple × momentum × maturity × breadth )
```

- **Category benchmark**: the median mcap/TVL of the snapshot's *tokened* protocols in the same category (minimum 5 samples), else the global median. This is the central input — a pre-token protocol is priced by what its peers' tokens actually exited at.
- **Momentum (clamped)**: the 7-day TVL change becomes a multiplier `clamp(1 + change_7d / 200, 0.70, 1.30)`. Hot protocols rank up, but one good week can never more than 1.3× a row, and a bad week can never crater it below 0.7×.
- **Log maturity**: days listed without a token enters as `min(1, 0.55 + 0.45 × log1p(age) / log(1100))` — older protocols score modestly higher, with diminishing returns; unknown age defaults to 365 days.
- **Breadth (new in v3)**: multi-chain protocols score a higher implied value, because a launch that spans many chains reaches more users. The breadth multiplier is clamped so a long chain list cannot dominate the model (see the benchmark table with clamp info in the model output). Rows also carry a `chain_count` for transparency.

### Worked example: Steakhouse Financial (rank 1)

| Input | Value | Source |
| --- | --- | --- |
| TVL | $2,753,981,495 | DefiLlama snapshot |
| Category multiple (Risk Curators median mcap/TVL) | 0.1689x | 144 tokened peers |
| Momentum (7d change −2.19%) | 0.989x | clamp(1 + −2.19/200, 0.70, 1.30) |
| Maturity (543 days listed) | 0.9548x | log curve, capped at 1.0 |
| Breadth (11 chains) | 1.20x | clamped breadth multiplier |

Product: $2.75B × 0.1689 × 0.989 × 0.9548 × 1.20 ≈ **$527,052,713 implied value**. The dashboard recomputes this same number in the browser from `data.js` and shows it next to the board's figure, so the page's arithmetic and the data are visibly identical.

## Earnings cross-check (v4)

New in radar-4: every row carries an **earnings cross-check** — the model's implied value divided by the protocol's annualized trailing-1y fees (its implied **P/S**), compared against the median P/S of the snapshot's *tokened* protocols in the same category (minimum 3 samples with positive mcap and fees). Fees come from `data/fees_annualized.json`, a repo data file built from the DefiLlama fees API with its own `asOf` timestamp inside — no fee number is hardcoded in the model; the model reads the file at build time with `fs`. If the file is missing or unparseable, the cross-check skips entirely (`n/a`) and the build still succeeds.

Verdicts:

- **overvalued** — implied P/S is more than **2×** the category median. The record carries an adjusted value: `2 × median × annual fees`, capped at the original implied value (never inflated).
- **underpriced** — implied P/S is below **0.5×** the category median; adjusted = `0.5 × median × annual fees`, also capped at the original implied.
- **fair** — in between.
- **no-benchmark** — the category has fewer than 3 tokened peers with fees data (e.g. Risk Curators), so no median exists.
- **n/a** — the protocol has no fees data (annualized fees ≤ 0 or absent from the map).

**Flag-only by design:** the board still ranks by the *original* implied value. Each row carries the adjusted figure alongside (`earnings.adjusted_implied_usd`), and the dashboard decides what to display — the ranking in `board.json` is never shifted by the cross-check.

**Coverage:** 14/20 (70%) of the top-20 and 110/200 (55%) of the top-200 rows have usable fees data; the remaining ~45% of top-200 protocols (mostly pre-token vaults and curators) are not reported on the DefiLlama `/overview/fees` endpoint — a stated limitation, flagged `n/a` rather than guessed.

**Examples:** USDD (CDP) implies a P/S of **41.8×** against a category median of **~1.06×** → `overvalued`; its adjusted value drops roughly 90% to about $15.4M. OnRe (RWA) implies **4.01×** against a median of ~6.9× → `fair`, no adjustment. The dashboard's detail drawer renders the verdict as a colored chip (red overvalued, green fair, blue underpriced, grey n/a), the implied vs median P/S, the annual fees, and the adjusted value; the board table shows a small verdict badge per row.

## Farm plans, designed per category

Every row carries a concrete farm plan built from its own record — category, chains, TVL and age decide the action, the capital ($50–$250), the hold period (30–60 days), and every cost and time estimate:

- the exact position to open (curator vault deposit, LP pair, collateral + borrow, basis hedge, staked receipt token…), on which chain;
- the weekly qualifying action that fits the category;
- the hold window so the activity lands in more than one snapshot;
- a safe claim step (only from the protocol's own published page, never pay to claim) and a farm log.

## Dashboard

A static, no-network dashboard (no framework) reads `out/data.js` and gives the jury three views:

- **Board table** (default sort: implied value, descending): rank, protocol with category chip and chain count, TVL, 7d growth, age, benchmark multiple, an implied-value bar, token status. Search, category filter, and sortable columns with an active-sort indicator; aggregate headline (total board implied value, median row value, coverage) at the top.
- **Detail drawer** per protocol: the model inputs, a **per-factor breakdown** where every multiplier (category, momentum, maturity, breadth) is drawn as a proportional bar against the row's largest factor, the category benchmark table with the row's own category marked, and the full farm plan.
- **Filters that work**: category dropdown plus free-text search across name, category and chain, shared in the URL hash so a filtered view is linkable.

The dashboard is defensive: fields new in radar-3 (`breadth_multiplier`, `chain_count`, `total_implied_usd`, `median_implied_usd`) are guarded with fallbacks, so the page renders correctly even against an older radar-2 `data.js`.

Footer states the model version and snapshot as-of date on every page.

## Screenshots

Three real screenshots from the running dashboard:

| Board | Detail drawer | Filtered (RWA) |
| --- | --- | --- |
| ![board](screenshots/board.png) | ![detail](screenshots/detail.png) | ![filtered](screenshots/filtered.png) |

## Repo structure

- `main.ts` — entrypoint: reads the frozen snapshot, runs the model, writes `output/` (board.json, data.js, dossier) and the dashboard + screenshots.
- `lib/model.ts` — the radar-4 implied-value model: category-benchmark multiples, clamped momentum, log maturity, breadth multiplier with clamp info, plus the v4 earnings cross-check (`lib/model.ts` reads `data/fees_annualized.json`).
- `lib/` — farm plan generation and snapshot utilities.
- `dashboard/` — the dashboard page (board / detail drawer with per-factor breakdown / filters / benchmark panel).
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
