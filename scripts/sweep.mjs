// Backtests simulated agencies of different sizes in parallel (offline, nothing is sent to Float).
//   node scripts/sweep.mjs                 main runs and the control, 10 seeds per size
//   node scripts/sweep.mjs --workers=8     use fewer processes
// Finished runs are kept in out/sweep/, so an interrupted sweep picks up where it stopped.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const WORKERS = Number(arg('workers') ?? Math.max(1, cpus().length - 6));
const SEEDS = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010];

const jobs = [];
for (const staffing of ['experience', 'title']) {
  for (const scale of [1, 2, 4, 6, 9]) for (const seed of SEEDS) jobs.push({ noise: 'gumbel', staffing, scale, seed });
  // Robustness check: the same test with noise a logit doesn't assume.
  for (const scale of [2, 4]) for (const seed of SEEDS) jobs.push({ noise: 'normal', staffing, scale, seed });
}
jobs.sort((a, b) => a.scale - b.scale);

const tsx = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => (code ? reject(new Error(`${args.join(' ')}\n${err.slice(-800)}`)) : resolve()));
  });

async function run({ noise, staffing, scale, seed }) {
  const dir = `out/sweep/${noise}-${staffing}-${scale}-${seed}`;
  if (existsSync(`${dir}/backtest.json`)) return;
  mkdirSync(dir, { recursive: true });
  await tsx(['src/world.ts', `--scale=${scale}`, `--seed=${seed}`, `--staffing=${staffing}`, `--noise=${noise}`, `--out=${dir}`]);
  await tsx(['src/simexport.ts', `--in=${dir}/world.json`]);
  await tsx(['src/backtest.ts', `--in=${dir}/float-export.json`, `--report=${dir}/backtest.json`, '--no-live']);
  console.log(`done ${dir}`);
}

let next = 0;
let failed = 0;
await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      await run(job).catch((e) => {
        failed++;
        console.error(`FAILED ${JSON.stringify(job)}\n${e.message}`);
      });
    }
  }),
);
if (failed) {
  console.error(`${failed} of ${jobs.length} runs failed`);
  process.exit(1);
}
await tsx(['src/sweep-summary.ts']).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
console.log('Wrote out/sweep.json. Run `npx tsx src/sweep-summary.ts` to print the tables.');
