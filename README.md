# Launch Radar — which protocol's token would be worth the most?

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mhidayah22/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mhidayah22/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for the make.fun bounty "Build the best token launch radar".
It reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that record
no token, and ranks 226 of them by an implied launch value in a dashboard a reader
can sort, filter and open protocol by protocol.

## The model (radar-2)

**implied value = TVL × peer multiple × maturity.**

- The peer multiple is the median market-cap-to-TVL ratio of live-token protocols
  in the same category, fitted from the snapshot itself at run time. A category
  with fewer than 3 live peers falls back to the global median.
- Maturity is 0.6 for a newborn protocol and rises to 1.0 after three years with
  no token recorded.
- Every row carries an honest range from the 25th to the 75th percentile of its
  category's ratios, instead of one bare number.
- Launch odds by age and seven-day growth were measured and left out of the value:
  both made the blind tests worse. Growth is shown as a column only; the odds appear
  as a launch-readiness column and in the farm verdict, never in the value.

The dashboard shows the three validation runs, all computed from the snapshot at
run time: in-sample, walk-forward (fitted before 2025-06-01, tested after) and
leave-one-out over the 128 live-token protocols.

## How it runs

`main.ts` uses only the Node.js standard library. It reads the snapshot, writes
`board.json` (226 rows, each with an implied value, an honest range and a six-step
farm plan), writes the dashboard's data, copies `dashboard/` and `screenshots/`,
and writes `dossier.json` with the vendored make.fun library. The run is
deterministic: the same snapshot always produces the same output bytes, with no
network, no clock and no randomness.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

## Files

- `main.ts` — the entrypoint: reads the snapshot, writes the board, the data and the dossier.
- `lib/model.ts` — the radar-2 model, the farm plans and the runtime validation.
- `dashboard/` — the static page: board, detail view, filters and the live-token comparison.
- `vendor/makefun-board.ts` — the make.fun dossier library, copied from the kit.
- `screenshots/` — the board, a protocol's detail view and a filtered view.

## License

MIT — see `LICENSE`.
