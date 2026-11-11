# Evaluation

One page: what is predicted, how it is scored, where the two rankers agree and differ, what the synthetic data can't tell you, and how this would be evaluated in production. The full method is in [METHODOLOGY.md](METHODOLOGY.md).

## What is evaluated

| | |
| --- | --- |
| **Prediction unit** | One staffing decision: one role on one project, at the date the project started. 391 decisions in the 54-person agency, none skipped. |
| **Candidate pool** | Everyone who was employed for the whole role and had enough free capacity for its hours at the time. 38 people on average. |
| **Target** | The person actually booked on that allocation in Float. In this repo that choice came from the synthetic generator (`src/world.ts`), so it is a proxy for a manager's decision, not a measure of project success. |
| **Baseline** | Reconstruction of Float's Smart assign from its help docs: role-fit tier (strong / related / weak), then title fit, then availability (`baselineScore`, `src/models.ts`). Uses title and availability only, enforced by a test. |
| **Experience model** | Conditional logit over the six signals below, trained to give the chosen person the highest probability within each pool (`ExperienceModel`, `src/models.ts`). |
| **Split** | By project start date. Train: before 2026-02-01 (186 decisions). Test: from 2026-02-01 (205 decisions). History is cut at the decision date for every signal. |
| **Metrics** | First pick (chosen person ranked 1st) and top 3, ties broken at random so a ranker that ties isn't scored as a miss. |

The six signals, all computed from what was known at the decision date (`src/features.ts`):

| Signal | What it measures |
| --- | --- |
| `titleFit` | How close the person's role is to the role needed (same title, same job at another level, or word overlap) |
| `availability` | Share of the person's capacity still free over the role's dates, after bookings and time off |
| `sameClient` | Past projects for the same client, recent ones weighted more |
| `tagOverlap` | Share of the project's tags the person has worked on before |
| `textSim` | Similarity between the brief and the person's past project notes (TF-IDF) |
| `skillMatch` | Person's skill tags that match the project's tags, up to 3 |

Reproduce: `npx tsx src/compare.ts` for the 54-person agency, and after `npm run sweep`, `npx tsx src/compare.ts --sweep=gumbel-experience-4` (216 people) or `--sweep=gumbel-title-4` (control). It uses the same decisions, split and training as `src/backtest.ts`, and its overall hit rates match the README. Every number on this page is in [agreement-results.json](agreement-results.json).

## Where the two rankers agree and where they differ

Both rankers score the same held-out pools. Two samples: the 54-person agency loaded into Float (205 test decisions) and 10 simulated agencies of 216 people, pooled (7,941 test decisions, the README's 216 row). Each decision falls into one of three cases on first pick:

| First pick | 54 people | 216 people | 216, control |
| --- | --- | --- | --- |
| Same person | 74% | 36% | 56% |
| Baseline tied, model picks one of the tied | 14% | 31% | 38% |
| Different person | 13% | 33% | 6% |

Accuracy in each case, 216 people:

| Case | Share | First pick: baseline → model | Top 3: baseline → model |
| --- | --- | --- | --- |
| Same person | 36% | 24.3% → 24.3% | 40.7% → 42.0% |
| Baseline tied | 31% | 18.9% → 26.9% | 50.4% → 53.7% |
| Different person | 33% | 15.1% → 19.2% | 36.5% → 44.9% |
| All | | 19.6% → 23.4% | 42.4% → 46.6% |

**Where the lift comes from.** Of the 3.8-point first-pick lift, 2.5 points come from breaking Smart assign's ties (people with the same role fit and availability) and 1.3 from overriding it. Of the 4.2-point top 3 lift, 2.7 come from overrides. At 54 people the two agree on 74% of decisions and all the lift sits in 26 decisions (model right on 11, baseline on 4), too few to read on their own.

**The model reorders, it doesn't overrule role fit.** When the picks differ, the model's person comes from a weaker role-fit tier only 3.7% of the time. It works inside the set Smart assign already considers a fit.

**Why they differ.** For each difference, the signal that most separates the model's pick from the baseline's (216 people, 2,587 decisions):

| Signal behind the difference | Decisions | Model right (first pick) | Baseline right |
| --- | --- | --- | --- |
| `sameClient` | 1,958 (76%) | 21.3% | 15.0% |
| `skillMatch` | 295 | 10.2% | 17.0% |
| `tagOverlap` | 288 | 12.8% | 15.0% |
| `textSim` | 31 | 12.9% | 12.9% |
| `availability` | 14 | 50.0% | 0% |
| `titleFit` | 1 | 0% | 0% |

Client history is the signal that earns its place. Swaps driven by skill tags or tag overlap lose first picks to the baseline, so those two are the first candidates to cap or drop.

**The backstory, from the generator.** `src/world.ts` records how it filled each role, so the misses can be explained, not just counted (216 people):

- 12% of choices were "whoever is least loaded", not a judgment. They are 11% of the model's first-pick misses, and no history-based ranker should get them.
- In 33% of the model's misses, the person chosen had a reason the model can't see (an industry affinity, or past work with the project's producer) and the model's pick had neither. In the control, where those reasons don't drive anything, the same pattern turns up by coincidence in 18%. Past work with the producer is in Float's allocations and could become a signal; industry affinity isn't in Float at all.
- The rest is the generator's random noise, which no ranker can recover.

**Control.** When past work plays no part in staffing, the model differs from the baseline on only 6% of decisions. When it does differ it is usually wrong (7.9% first pick against 18.2%), which costs 0.8 points overall (21.3% → 20.5%). It doesn't invent a signal, but it isn't free either.

## Limitations of the synthetic data

- **The target is my generator, not a manager.** The staffing rules in `src/world.ts` are mine. A model that recovers them shows the pipeline can learn a history-driven choice, not that real managers make one.
- **The generator and the model share a shape.** Choices are a weighted score plus Gumbel noise, which is exactly what a conditional logit assumes. The normal-noise rerun in the README didn't shrink the lift, but real decisions won't follow any single formula.
- **The baseline is a reconstruction.** It matched the real Smart assign's first pick on 15 of 20 live roles. A weaker baseline flatters the lift.
- **Agreement isn't correctness.** "Same pick" means both rankers made the same choice, not that it was a good one. The target says who was booked, not whether the project went well.
- **Small leaks remain.** TF-IDF weights use all projects, the pool knows if someone later leaves, and time off isn't dated by when it was booked.
- **Real data needs change history.** Float allocations show the final booking, not who was considered or when. A fair replay on real data needs the edit log.

## Next step: prospective evaluation in production

A backtest on invented history can't settle this. The next step is to put the recommendation in front of real managers and measure what they do with it.

1. **Shadow mode, 2 to 4 weeks.** For every new open role, log the experience model's top 3 and Smart assign's top 3, without showing them. Compare with who the manager books. This gives a real-data version of the tables above at no risk.
2. **Human approval.** Show the top 3 with the reasons (e.g. "3 past projects for this client", "70% free over the dates"). The manager accepts one, picks someone else, or dismisses the list. Nothing is booked without that click.
3. **Measure:**

| Metric | Why |
| --- | --- |
| Acceptance rate (a recommended person booked) | The main success measure, against Smart assign's own rate |
| Override rate, and the person picked instead | Each override is a labelled miss, and the new training data |
| Override reason (optional one-click: unavailable, wrong skills, client asked, other) | Separates model errors from information the model never had |
| Time from open role to booking | Whether recommendations save the manager work |
| Rebooking rate within 2 weeks | Catches accepted picks that didn't stick |

4. **Roll out by A/B on accounts**, not on roles within one account, so one manager doesn't see both rankers. Ship only if acceptance beats Smart assign and the override rate falls.
5. **Guardrails.** Watch whether the same few people are always recommended (utilisation spread), and fall back to Smart assign for new clients or new hires with no history.
