// Two rankers over the same candidate pool:
//   baseline:   Float's documented Smart assign logic (role fit tier, then availability)
//   experience: conditional logit over all features, trained on earlier staffing decisions
import { FEATURES, type Candidate } from './features.js';

const TITLE = FEATURES.indexOf('titleFit');
const AVAIL = FEATURES.indexOf('availability');

// Smart assign shows "Strong role fit", "Related role" or "Weak role fit", then % available.
export function baselineScore(c: Candidate): number {
  const fit = c.x[TITLE]!;
  const tier = fit >= 0.85 ? 2 : fit >= 0.3 ? 1 : 0;
  return tier * 10 + fit + c.x[AVAIL]!;
}

export interface Group {
  candidates: Candidate[];
  chosen: number; // index into candidates
}

export class ExperienceModel {
  weights: number[] = FEATURES.map(() => 0);
  private mean: number[] = FEATURES.map(() => 0);
  private std: number[] = FEATURES.map(() => 1);

  standardize(x: number[]): number[] {
    return x.map((v, i) => (v - this.mean[i]!) / this.std[i]!);
  }

  score(c: Candidate): number {
    return this.standardize(c.x).reduce((s, z, i) => s + z * this.weights[i]!, 0);
  }

  // Per-feature contribution to a candidate's score, for explanations.
  contributions(c: Candidate): number[] {
    return this.standardize(c.x).map((z, i) => z * this.weights[i]!);
  }

  // Conditional logit: softmax over each decision's candidates, maximise the chosen person's probability.
  fit(groups: Group[], { epochs = 600, lr = 0.3, l2 = 0.01 } = {}): { loss: number } {
    const all = groups.flatMap((g) => g.candidates.map((c) => c.x));
    this.mean = FEATURES.map((_, i) => all.reduce((s, x) => s + x[i]!, 0) / all.length);
    this.std = FEATURES.map((_, i) => {
      const v = all.reduce((s, x) => s + (x[i]! - this.mean[i]!) ** 2, 0) / all.length;
      return Math.sqrt(v) || 1;
    });
    const Z = groups.map((g) => g.candidates.map((c) => this.standardize(c.x)));

    let loss = 0;
    for (let epoch = 0; epoch < epochs; epoch++) {
      const grad = FEATURES.map(() => 0);
      loss = 0;
      groups.forEach((g, gi) => {
        const zs = Z[gi]!;
        const scores = zs.map((z) => z.reduce((s, v, i) => s + v * this.weights[i]!, 0));
        const max = Math.max(...scores);
        const exps = scores.map((s) => Math.exp(s - max));
        const total = exps.reduce((a, b) => a + b, 0);
        loss -= Math.log(exps[g.chosen]! / total);
        zs.forEach((z, ci) => {
          const p = exps[ci]! / total - (ci === g.chosen ? 1 : 0);
          z.forEach((v, i) => (grad[i]! += p * v));
        });
      });
      this.weights = this.weights.map((w, i) => w - lr * (grad[i]! / groups.length + l2 * w));
      loss /= groups.length;
    }
    return { loss };
  }
}

// 1-based rank of the chosen candidate under a scoring function (ties count half).
export function rankOf(g: Group, score: (c: Candidate) => number): number {
  const scores = g.candidates.map(score);
  const target = scores[g.chosen]!;
  const better = scores.filter((s) => s > target).length;
  const ties = scores.filter((s) => s === target).length - 1;
  return 1 + better + ties / 2;
}
