// Draws docs/lift-by-size.svg from out/sweep.json: top 3 lift by agency size, main run vs control.
//   npx tsx src/sweep-summary.ts && node scripts/build-chart.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync('out/sweep.json', 'utf8')).summary.gumbel;
const W = 720;
const H = 400;
const plot = { left: 54, right: W - 20, top: 112, bottom: H - 62 };
const ink = '#0b0b0b';
const muted = '#52514e';
const grid = '#e4e3df';
const main = '#2a78d6';
const control = '#eb6834';

const values = rows.flatMap((r) => [r.hit3.lift.low, r.hit3.lift.high, r.hit3.controlLift.low, r.hit3.controlLift.high]);
const yMin = Math.floor(Math.min(...values, 0) / 2) * 2;
const yMax = Math.ceil(Math.max(...values) / 2) * 2;
const y = (v) => plot.bottom - ((v - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);
const band = (plot.right - plot.left) / rows.length;
const x = (i) => plot.left + band * (i + 0.5);

const text = (px, py, s, { size = 13, fill = muted, anchor = 'start', weight = 400 } = {}) =>
  `<text x="${px}" y="${py}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`;

const parts = [];
for (let v = yMin; v <= yMax; v += 2) {
  parts.push(`<line x1="${plot.left}" x2="${plot.right}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? '#8c8b86' : grid}" stroke-width="1"/>`);
  parts.push(text(plot.left - 10, y(v) + 4, v > 0 ? `+${v}` : String(v), { size: 12, anchor: 'end' }));
}

const series = (key, colour, dx, labelled) =>
  rows
    .map((r, i) => {
      const s = r.hit3[key];
      const cx = x(i) + dx;
      const label = labelled ? text(cx + 11, y(s.mean) + 4, `${s.mean > 0 ? '+' : ''}${s.mean}`, { size: 13, fill: ink, weight: 600 }) : '';
      return (
        `<line x1="${cx}" x2="${cx}" y1="${y(s.low)}" y2="${y(s.high)}" stroke="${colour}" stroke-width="2"/>` +
        `<circle cx="${cx}" cy="${y(s.mean)}" r="5.5" fill="${colour}" stroke="#ffffff" stroke-width="2"/>${label}`
      );
    })
    .join('');
parts.push(series('controlLift', control, -11, false), series('lift', main, 11, true));

rows.forEach((r, i) => parts.push(text(x(i), plot.bottom + 24, String(r.people), { size: 13, anchor: 'middle' })));
parts.push(text((plot.left + plot.right) / 2, plot.bottom + 48, 'People in the agency', { size: 12, anchor: 'middle' }));

const legend = (px, colour, s) =>
  `<circle cx="${px}" cy="88" r="5.5" fill="${colour}"/>` + text(px + 12, 92, s, { size: 13, fill: ink });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d" font-family="Inter, 'Segoe UI', Helvetica, Arial, sans-serif">
<title id="t">Past work adds about 4 points to the top 3 from about 100 people</title>
<desc id="d">Lift in top 3 accuracy over a reconstruction of Smart assign, by agency size, for agencies where past work shaped staffing and for a control where it did not.</desc>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${text(0, 24, 'Past work adds about 4 points to the top 3 from about 100 people', { size: 18, fill: ink, weight: 600 })}
${text(0, 48, 'Lift in top 3 accuracy over a reconstruction of Smart assign, in percentage points', { size: 13 })}
${text(0, 66, 'Simulated agencies, 10 per size. Bars show 95% confidence intervals.', { size: 13 })}
${legend(8, main, 'Past work shaped staffing')}${legend(220, control, 'Control: past work played no part')}
${parts.join('\n')}
</svg>
`;
writeFileSync('docs/lift-by-size.svg', svg);
console.log('Wrote docs/lift-by-size.svg');
