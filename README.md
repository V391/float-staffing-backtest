# float-staffing-backtest

Experience-aware staffing recommendations for [Float](https://www.float.com), backtested against the logic of Float's Smart assign. Two-page write-up: [docs/Experience-aware-staffing-for-Float.pdf](docs/Experience-aware-staffing-for-Float.pdf).

Smart assign ranks people by job title and availability ([help article](https://support.float.com/en/articles/13868430-role-based-planning-smart-assign)), so for a given role it suggests the same people whatever the client. This repo adds past work as a signal (same client, similar projects, skills, colleagues) and measures whether that picks the person a manager actually chose.

## Results

**On a 54-person agency loaded into a Float Pro trial** (205 held-out decisions after Feb 2026):

| Ranker | Top 3 | First pick |
| --- | --- | --- |
| Float-style (title, then availability) | 68% | 32% |
| Experience model | 71% | 37% |

**Against Float's real Smart assign on 20 live open roles** (recorded in the app, `data/smart-assign-capture.csv`): Smart assign 15/20 top 3, experience model 16/20. My copy of Smart assign's logic matched its first pick on 15/20.

**By agency size** (simulated offline, 3 seeds each, first pick):

| People | Float-style | Experience model |
| --- | --- | --- |
| 54 | 40% | 45% |
| 108 | 25% | 33% |
| 216 | 13% | 23% |
| 324 | 11% | 21% |
| 486 | 5% | 15% |

**Control: an agency where past work plays no part in staffing** (`--staffing=title`, same people and projects, 3 seeds each). The experience model learns that and gives client history about zero weight (about 0.17 in the main run, between -0.05 and 0.06 in the control). It still beats the Float-style ranker on first pick, which shows part of the lift comes from weighting title and availability better, not from experience:

| People | First-pick lift, main run | Lift in control | Lift from experience |
| --- | --- | --- | --- |
| 54 | +5 pts | +5 pts | 0 |
| 108 | +8 pts | +3 pts | +5 pts |
| 216 | +10 pts | +5 pts | +5 pts |
| 324 | +10 pts | +7 pts | +3 pts |
| 486 | +10 pts | +6 pts | +4 pts |

So the honest claim is 3 to 5 points of first-pick accuracy from experience at 100+ people, and none at 54.

**What this does not prove.** The agency is synthetic and the staffing rules are mine, so the size results show a direction, not Float customer accuracy. Only the 54-person agency went through Float itself.

## How it works

```
src/world.ts      generate a fictional agency + 18 months of staffing (seeded)
src/load.ts       load it into Float through the public API (resumable, rate limited)
src/pull.ts       read it back out, read-only -> out/float-export.json
src/features.ts   7 signals per candidate, using only what was known at decision time
src/models.ts     Float-style ranker + experience model (conditional logit)
src/backtest.ts   replay every decision, train before 2026-02-01, test after
src/mcp.ts        MCP server: recommend_people, recommend_for_brief, list_open_roles
warehouse/        dbt (DuckDB) rebuild of the features in SQL, with tests
```

The dbt project models the raw export into staging, intermediate and mart layers, and tests it: keys and relationships, **no feature uses data from after its decision** (`assert_no_feature_leakage`), **every actual pick is in its candidate pool**, and **the SQL features match the TypeScript ones row for row** (`assert_ts_sql_feature_parity`, 16,663 rows). DuckDB stands in for BigQuery.

## Run it

Needs Node 22+, and Python 3.11+ for the dbt part.

```bash
npm install
npm run world                 # generate the agency
cp .env.example .env          # add a Float API token and contact email
npm run ping                  # read-only: token works, account is empty
npm run load                  # ~20 min at Float's rate limit
npm run pull                  # read it back
npm run backtest              # results -> out/backtest.json
```

Without a Float account, the same backtest runs on a simulated export:

```bash
npx tsx src/simexport.ts --in=out/world.json --out=out/float-export.json
npm run backtest -- --no-live
```

Size sweep and the control: `powershell -File scripts/sweep.ps1` and `scripts/sweep.ps1 -Staffing title -Scales 1,4,9`.

dbt:

```bash
python -m venv .venv && .venv/Scripts/pip install -r warehouse/requirements.txt
npm run warehouse             # dumps TS features, then dbt build (models + 46 tests)
```

`npm run cleanup -- --yes` deletes from Float exactly what `load` created, nothing else.

`npm test` typechecks and runs the unit tests in `tests/` (title matching tiers, baseline ordering, tie handling, and that the model learns a planted signal). The dbt tests cover the data layer.

## Evidence, not just results

- `data/smart-assign-capture.csv`: Smart assign's actual top 3 for 20 open roles, recorded in the Float app on 17 Oct 2026. The baseline ranker is checked against this, not against my reading of the docs.
- `out/backtest.json` (after a run): every decision, candidate pool size, learned weights, and the live comparison, so a number in the README can be traced to the rows that produced it.
- `warehouse/tests/assert_no_feature_leakage.sql` fails the build if any feature uses data from after the decision it feeds. `assert_ts_sql_feature_parity.sql` fails it if the SQL and TypeScript features disagree on any of the 16,663 candidate rows.
- Loading is resumable: `out/manifest.json` records every Float id created, so an interrupted load continues instead of duplicating, and cleanup removes exactly those ids.

## How I used Claude Code

Most of the code was first drafted with Claude Code and then reworked. The parts that mattered, I designed and checked myself: the staffing rule behind the synthetic agency, the decision to replay history as of each project's start date, the control run that tests whether the model invents an effect, and reading Smart assign's live picks against the baseline. Things I rejected or rewrote along the way: a Python Timefold path (the binding was archived in 2025), retrying writes on 5xx (a POST may already have applied), and a first version of the results that claimed the lift "doubles" when half of it came from weighting title and availability better. The commits carry a co-author line because that is what happened.

## MCP

`npm run mcp` starts a stdio MCP server over the pulled data. Register it with Claude Code or Claude Desktop as `node --import tsx src/mcp.ts` from this folder. Ask it things like "who should be Senior Designer on KST-P083?" or "who fits an Art Director role for a new Stride Athletics campaign in January?"

Smart assign's own suggestions are not exposed by Float's public API or Float MCP, which is why they were recorded from the app.
