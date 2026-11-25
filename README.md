# Token Radar v2

Ranking of 200+ pre-token protocols by implied value, computed from a frozen DefiLlama snapshot — no hardcoded names, no vibes.

**LIVE:** [![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competition/token-radar-01) [![rank](https://make.fun/badge/token-radar-01/siezy/token-radar-01/rank.svg)](https://make.fun/competition/token-radar-01) [![reward](https://make.fun/badge/token-radar-01/siezy/token-radar-01/reward.svg)](https://make.fun/competition/token-radar-01)

## What it does

Token Radar v2 ranks every protocol on the competition watchlist (pre-token: real TVL, no token yet) by an implied value derived from snapshot figures only:

- **Category benchmark (v2 model, one model overall — not several globals)**: implied value is computed by ONE v2 model whose central input is the per-category benchmark. For each DefiLlama category, the model computes the median mcap/TVL ratio from same-category protocols whose tokens already trade, and applies that multiple to each pre-token protocol's TVL. There is no global multiple and no separate per-protocol model: the category benchmark is the benchmark.
- **Log maturity**: days-listed-without-a-token enters as a log term — older pre-token protocols get a modestly higher implied value, with diminishing returns.
- **Momentum band**: the 7d TVL change shifts the implied value within a bounded band, so hot protocols rank up but one good week can't dominate.
- Protocols whose tokens already trade are scored separately and never mixed into the pre-token ranking.

## Per-category farm plans

Each watchlist protocol gets a concrete farm plan: the exact action (deposit, LP, lock), which chain, points program, estimated cost (gas + minimum deposit) and estimated duration — built per category, not slogans.

## Dashboard

A built dashboard (no framework pasted wholesale) with:

- search, filter (by category, chain), and sort on every column;
- a detail drawer per protocol: benchmark context, implied value breakdown, farm plan;
- a model sandbox: adjust benchmark assumptions and see the ranking recompute live.

## Screenshots

Three real screenshots from the running dashboard:

| Board | Detail drawer | Filtered (RWA) |
| --- | --- | --- |
| ![board](screenshots/board.png) | ![detail](screenshots/detail.png) | ![filtered](screenshots/filtered.png) |

## Repo structure

- `main.ts` — entrypoint: reads the frozen snapshot, runs the model, writes `output/` (board.json, data.js, dossier) and the dashboard + screenshots.
- `lib/model.ts` — the v2 implied-value model: category-benchmark multiples, log maturity, momentum band.
- `lib/` — farm plan generation and snapshot utilities.
- `dashboard/` — the dashboard page (search / filter / sort / detail drawer / model sandbox).
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
