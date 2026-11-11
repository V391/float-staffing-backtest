# Evaluation

What is predicted, how it is scored, where the two rankers agree and differ, what the synthetic data can't tell you, and how this would be tested in production. The full method is in [METHODOLOGY.md](METHODOLOGY.md).

**Verdict.** On invented staffing history, adding past work raises first-pick accuracy by 2 to 4 points and top 3 accuracy by about 4 points, from 108 people up. At 54 people the gain isn't measurable. Nearly all of it comes from client history: the model breaks Smart assign's ties and sometimes overrides it, and almost never goes against role fit. Only a prospective test with real managers can settle whether real staffing works this way (last section).

## What is evaluated

| | |
| --- | --- |
| **Prediction unit** | One staffing decision: one role on one project, at the date the project started. 391 decisions in the 54-person agency, none skipped. |
| **Candidate pool** | Everyone employed for the whole role who had enough free capacity for its hours at the time. 38 people on average. |
| **Target** | The person actually booked on that allocation in Float. Here that choice came from the synthetic generator (`src/world.ts`), so it stands in for a manager's decision. It says nothing about whether the project went well. |
| **Baseline** | Reconstruction of Float's Smart assign from its help docs: role-fit tier (strong / related / weak) × 10, plus title fit, plus availability (`baselineScore`, `src/models.ts`). The tier dominates; title fit and availability order people within it. A test keeps it to title and availability only. |
| **Experience model** | Conditional logit over the six signals below, trained to give the chosen person the highest probability within each pool (`ExperienceModel`, `src/models.ts`). |
| **Split** | By project start date. Train: before 2026-02-01 (186 decisions). Test: from 2026-02-01 (205 decisions). Past work counts only if it started before the decision date; the exceptions are under limitations. |
| **Metrics** | First pick (the chosen person is ranked 1st) and top 3. Ties are broken at random, so a ranker that ties isn't scored as a miss. |

The six signals (`src/features.ts`):

| Signal | What it measures |
| --- | --- |
| `titleFit` | How close the person's role is to the role needed (same title, same job at another level, or word overlap) |
| `availability` | Share of the person's capacity still free over the role's dates, after bookings and time off |
| `sameClient` | Past projects for the same client, recent ones weighted more |
| `tagOverlap` | Share of the project's tags the person has worked on before |
| `textSim` | Similarity between the brief and the person's past project notes (TF-IDF) |
| `skillMatch` | Person's skill tags that match the project's tags, up to 3 |

Decision counts and pool size come from `npm run backtest -- --no-live` (`out/backtest.json`). The comparison below comes from `src/compare.ts` and is saved in [agreement-results.json](agreement-results.json). To rebuild it, run `npx tsx src/compare.ts --json=docs/agreement-results.json --label=live-54` for the 54-person agency. After `npm run sweep`, run it with `--sweep=gumbel-experience-<scale>` and `--label=sweep-<people>` for each size, and with `--sweep=gumbel-title-4 --label=control-216` for the control. It uses the same decisions, split and training as `src/backtest.ts`.

## Where the two rankers agree and differ

Both rankers score the same held-out pools. Each decision falls into one of three cases on first pick: both pick the same person; the baseline ties several people and the model picks one of them; or the model picks someone else. The 54-person agency is the one loaded into Float. Every other size pools the README's 10 simulated agencies.

| People | Test decisions | Same person | Baseline tied | Different person | First-pick lift | from ties | from overrides |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 54 | 205 | 74% | 14% | 13% | +3.5 | +0.1 | +3.4 |
| 108 | 3,906 | 57% | 20% | 24% | +2.8 | +1.4 | +1.3 |
| 216 | 7,941 | 36% | 31% | 33% | +3.8 | +2.5 | +1.3 |
| 324 | 12,275 | 29% | 36% | 35% | +2.3 | +2.1 | +0.3 |
| 486 | 18,362 | 18% | 46% | 36% | +2.6 | +2.3 | +0.3 |
| 216, control | 7,944 | 56% | 38% | 6% | −0.8 | −0.1 | −0.6 |

Lift is in points of first-pick accuracy. The parts can differ from the total by 0.1 because of rounding. These totals match the README. The README's +3.9 at 216 people is the average of the 10 per-agency lifts, while the +3.8 here pools their decisions. Its +4.6 also subtracts the control's lift.

**Where the lift comes from.** As agencies grow, more people share a title and the baseline ties more often, so the model's gain shifts from overriding the baseline to breaking its ties. At 54 people, all of the lift sits in 26 decisions (model right on 11, baseline on 4), too few to read on their own.

**The model reorders, it doesn't overrule role fit.** Its pick comes from a weaker role-fit tier than the baseline's in 2% of decisions or fewer at every size. It works inside the set Smart assign already considers a fit.

The rest of this section uses 216 people, the middle size with a large pooled sample. Accuracy in each case:

| Case | Share | First pick: baseline → model | Top 3: baseline → model |
| --- | --- | --- | --- |
| Same person | 36% | 24.3% → 24.3% | 40.7% → 42.0% |
| Baseline tied | 31% | 18.9% → 26.9% | 50.4% → 53.7% |
| Different person | 33% | 15.1% → 19.2% | 36.5% → 44.9% |
| All | | 19.6% → 23.4% | 42.4% → 46.6% |

**Why they differ.** For each difference, the signal that most separates the model's pick from the baseline's (2,587 decisions):

| Signal behind the difference | Decisions | Model right (first pick) | Baseline right |
| --- | --- | --- | --- |
| `sameClient` | 1,958 (76%) | 21.3% | 15.0% |
| `skillMatch` | 295 | 10.2% | 17.0% |
| `tagOverlap` | 288 | 12.8% | 15.0% |
| `textSim` | 31 | 12.9% | 12.9% |
| `availability` | 14 | 50.0% | 0% |
| `titleFit` | 1 | 0% | 0% |

Client history earns its place. Swaps driven by skill tags lose first picks to the baseline (10.2% against 17.0% on 295 decisions), so that signal is the first candidate to cap or drop. Tag overlap is close here but loses clearly at 324 and 486 people (in agreement-results.json), so it is next. Text similarity is too close to call.

**The backstory, from the generator.** `src/world.ts` records how it filled each role, so the misses can be explained, not just counted:

- **Least-loaded picks favour the baseline.** 12% of choices went to whoever was least loaded among people with the exact title, which is what the baseline's availability term targets. On those decisions the baseline gets 42.0% first pick and the model 29.5%. On the other 88% the model wins, 22.6% against 16.5%.
- **Some reasons are invisible to the model.** In 33% of the model's first-pick misses, the person chosen had a reason the model can't see (an industry affinity, or past work with the project's producer) and the model's pick had neither. In the control, where those reasons drive nothing, the same pattern turns up by coincidence in 18%. Past work with the producer is in Float's allocations and could become a signal. Industry affinity isn't in Float at all.
- **The rest is unexplained.** It includes the generator's random noise and another signal it uses that the model lacks: how many past projects a person has in the client's industry.

**Control.** When past work plays no part in staffing, the model differs from the baseline on only 6% of decisions. When it does differ, it is usually wrong (7.9% first pick against 18.2%), which costs 0.8 points overall (21.3% → 20.5%). It doesn't invent a signal, but it isn't free either.

## Limitations of the synthetic data

- **The target is my generator, not a manager.** The staffing rules in `src/world.ts` are mine. A model that recovers them shows the pipeline can learn a history-driven choice, not that real managers make one.
- **The generator and the model share a shape.** Choices are a weighted score plus Gumbel noise, which is exactly what a conditional logit assumes. The normal-noise rerun in the README didn't shrink the lift, but real decisions won't follow any single formula.
- **The baseline is a reconstruction.** It matched the real Smart assign's first pick on 15 of 20 live roles. A weaker baseline flatters the lift.
- **Agreement isn't correctness.** "Same person" means both rankers picked the same person, not that the pick was good.
- **Small leaks remain.** TF-IDF word weights use all projects, the pool knows if someone later leaves, and time off isn't dated by when it was booked.
- **Real data needs change history.** Float allocations show the final booking, not who was considered or when. Logging at decision time (below) closes this gap going forward.

## Next step: prospective evaluation in production

A backtest on invented history can't settle this. The next step is to put the recommendation in front of real managers and measure what they do with it.

1. **Shadow mode, 2 to 4 weeks.** For every new open role, log the pool, the experience model's top 3 and Smart assign's top 3 at the moment the role opens, without showing the model's list. Then compare with who gets booked. Managers book with Smart assign on screen, so these labels lean toward Smart assign. Shadow mode is a sanity check, not the decision.
2. **Human approval.** Show the top 3 with reasons (e.g. "3 past projects for this client", "70% free over the dates"). The manager books one, picks someone else, or dismisses the list. Nothing is booked without that click.
3. **Measure one thing to decide, the rest to learn:**

| Metric | Role |
| --- | --- |
| Acceptance rate: a recommended person is booked | **Primary.** Compared with Smart assign, with the margin set before the test |
| Override rate, and who was picked instead | Diagnostic. Each override is a labelled miss and new training data |
| Override reason (optional one click: unavailable, wrong skills, client asked, other) | Diagnostic. Separates model errors from information the model never had |
| Time from open role to booking | Diagnostic. Whether recommendations save the manager work |
| Rebooked within 2 weeks | Guardrail. Catches accepted picks that didn't stick |

4. **A/B by account**, not by role within an account, so no manager sees both rankers. As a rough estimate, detecting a 5-point gain from an assumed 40% acceptance rate takes about 1,500 open roles per arm (two-sided, 5% significance, 80% power). It takes more in practice, because roles cluster within accounts.
5. **Guardrails.** Watch whether the same few people are always recommended (utilisation spread). Fall back to Smart assign for new clients and new hires, who have no history.
