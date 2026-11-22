# Read broken CSV files faster

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/laithzz21/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/laithzz21/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

An entry for the make.fun bounty [Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121): a faster drop-in for make.fun's own csv-reader 1.0.0 that answers exactly as it does on every case.

## What it is

`solve.js` is an ES module whose `run(input)` returns csv-reader 1.0.0's reading of `{text, header}` — `{columns, rows, errors}` — byte for byte: BOM dropped, LF/CRLF record ends, blank lines skipped, stray CRs dropped (`stray_cr`), quoted fields with doubled quotes and CR/CRLF read as LF, junk after a closing quote (`quote_junk`), unterminated quotes re-read as unquoted (`unterminated_quote`), rows padded (`short_row`) or cut (`long_row`) to the first record's width, errors in order with the line and row of the record they belong to.

`main.ts` is the driver the harness runs: it reads every case from `/input/cases.json`, answers each one alone with `run`, and writes `/output/answers.json`.

## Why it is faster

csv-reader 1.0.0 reads one character at a time and builds every field a character at a time. This reader keeps the same policy but works in bulk:

- an unquoted field is found by scanning for the nearest of `,`, LF, CR, then one slice (a stray CR, rare, falls back to joining segments);
- a quoted field finds its closing quote with `indexOf` (`""` doubling folded in), counts its line breaks after it closes, and normalises CR/CRLF to LF with a single replace only when a CR is present;
- a quote that never closes falls back to the reference's re-read-as-unquoted.

Node 22, standard library only, no WebAssembly, no native addon, no network. Deterministic: the same input always gives the same answer.

## Licence

MIT — see [LICENSE](LICENSE).
