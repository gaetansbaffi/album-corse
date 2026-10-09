/**
 * Génère site/img/contours.svg : des courbes de niveau (style carte IGN) pour le fond de l'en-tête.
 * Relief imaginaire inspiré de la dorsale corse (une crête nord-ouest / sud-est).
 *   node scripts/gen-contours.mjs
 */
import { writeFileSync } from 'node:fs';

const W = 1440, H = 640, STEP = 8;
const cols = W / STEP + 1, rows = H / STEP + 1;

// Relief : somme de « montagnes » gaussiennes + ondulations douces
const peaks = [
  [380, 120, 170, 1.0], [560, 230, 150, 0.85], [720, 330, 160, 0.9], [900, 430, 140, 0.7],
  [1080, 520, 170, 0.75], [250, 360, 120, 0.45], [1180, 160, 130, 0.5], [1300, 420, 110, 0.4], [80, 80, 110, 0.35],
];
function height(x, y) {
  let z = 0;
  for (const [px, py, r, a] of peaks) z += a * Math.exp(-((x - px) ** 2 + (y - py) ** 2) / (2 * r * r));
  z += 0.06 * Math.sin(x / 61 + y / 97) + 0.05 * Math.cos(x / 43 - y / 71) + 0.03 * Math.sin((x + y) / 23);
  return z;
}

const grid = [];
for (let j = 0; j < rows; j++) {
  grid.push([]);
  for (let i = 0; i < cols; i++) grid[j].push(height(i * STEP, j * STEP));
}

// Marching squares : segments puis chaînage en lignes
function contour(level) {
  const segs = [];
  const lerp = (a, b, va, vb) => a + ((level - va) / (vb - va)) * (b - a);
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const x = i * STEP, y = j * STEP;
      const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
      const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = [lerp(x, x + STEP, a, b), y];
      const right = [x + STEP, lerp(y, y + STEP, b, c)];
      const bottom = [lerp(x, x + STEP, d, c), y + STEP];
      const left = [x, lerp(y, y + STEP, a, d)];
      const table = {
        1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]],
        5: [[left, top], [bottom, right]], 6: [[top, bottom]], 7: [[left, top]], 8: [[left, top]],
        9: [[top, bottom]], 10: [[left, bottom], [top, right]], 11: [[top, right]], 12: [[left, right]],
        13: [[bottom, right]], 14: [[left, bottom]],
      };
      segs.push(...table[code]);
    }
  }
  const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const byPoint = new Map();
  segs.forEach((s, idx) => {
    for (const p of s) {
      const k = key(p);
      if (!byPoint.has(k)) byPoint.set(k, []);
      byPoint.get(k).push(idx);
    }
  });
  const used = new Set();
  const lines = [];
  for (let s = 0; s < segs.length; s++) {
    if (used.has(s)) continue;
    used.add(s);
    const line = [segs[s][0], segs[s][1]];
    for (const dir of [1, -1]) {
      for (;;) {
        const end = dir === 1 ? line[line.length - 1] : line[0];
        const next = (byPoint.get(key(end)) || []).find((n) => !used.has(n));
        if (next === undefined) break;
        used.add(next);
        const [p, q] = segs[next];
        const other = key(p) === key(end) ? q : p;
        if (dir === 1) line.push(other);
        else line.unshift(other);
      }
    }
    if (line.length > 3) lines.push(line);
  }
  return lines;
}

// Simplification légère (on saute les points presque alignés) puis lissage en courbes
function toPath(line) {
  const pts = line.filter((p, i) => i === 0 || i === line.length - 1 || i % 2 === 0);
  let d = `M${pts[0][0].toFixed(0)} ${pts[0][1].toFixed(0)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
    d += `Q${pts[i][0].toFixed(0)} ${pts[i][1].toFixed(0)} ${mid[0].toFixed(0)} ${mid[1].toFixed(0)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${last[0].toFixed(0)} ${last[1].toFixed(0)}`;
}

let thin = '', thick = '';
let n = 0;
for (let level = 0.08; level < 1.2; level += 0.055, n++) {
  const d = contour(level).map(toPath).join('');
  if (n % 5 === 4) thick += d;
  else thin += d;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"><path d="${thin}" stroke-opacity=".16" stroke-width="1"/><path d="${thick}" stroke-opacity=".3" stroke-width="1.8"/></svg>\n`;
writeFileSync(new URL('../site/img/contours.svg', import.meta.url), svg);
console.log(`contours.svg : ${(svg.length / 1024).toFixed(1)} Ko`);
